import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { env } from '@/lib/config/env';
import type { Edl } from '@/lib/edl/types';
import { muxVideoAudio, renderAudio } from '@/lib/media/audio-mix';
import { extractFrame } from '@/lib/media/ffmpeg';
import { sfxUrl, SFX_NAMES } from '@/lib/assets/sfx';
import { startAssetServer, type AssetServer } from './asset-server';
import { DEFAULT_QUALITY, scaleFor, type RenderQuality } from './quality';
import { reportError } from '@/lib/errors/report';

/**
 * Rendering.
 *
 * Video frames and the audio mix are produced CONCURRENTLY and muxed at the
 * end. That is the single biggest speed win in the whole pipeline: the audio
 * mix — cut-and-join, loudness, ducking, effect placement — is the fiddliest
 * part of the edit and it finishes in seconds while the frames are still going.
 *
 * Two drivers:
 *  - `local`  — @remotion/renderer on this machine. Correct, no setup, slow.
 *  - `lambda` — fans frame ranges across N workers. ~2 min for a 10-minute video.
 */

export interface RenderOptions {
  edl: Edl;
  /**
   * Local path to the source VIDEO.
   *
   * The EDL carries an HTTP URL because the browser preview needs one, but the
   * renderer must not fetch its own source over the network: on the local
   * storage driver that URL is served by the web app, so a worker running
   * without the app up would 404, and even with it up every frame would make an
   * HTTP round trip. When this is set, the renderer reads the file directly.
   */
  sourceVideoPath?: string;
  /** Local path to the full-quality source audio, for the mix. */
  sourceAudioPath: string;
  /** Local path to the music file, if a track was chosen. */
  musicPath?: string | null;
  outputDir: string;
  onProgress?: (fraction: number, label: string) => void;
  /**
   * Whether the finished video carries the EasyCut mark.
   *
   * Applied here, over whatever the EDL says, because this is the single point
   * every render goes through. The document itself round-trips through the
   * browser editor, so a watermark that lived only in the document could be
   * removed with the developer tools — see src/lib/billing/entitlements.ts.
   */
  watermark?: boolean;
  /**
   * Which resolution to draw at — see src/lib/render/quality.ts.
   *
   * The compositions are laid out at a 1080 base and never consult this:
   * `scale` multiplies the output, so a 4K export is the same layout drawn on
   * a bigger canvas. Absent means HD, because a missing field must never
   * quadruple somebody's render time.
   */
  quality?: RenderQuality;
  /**
   * Amend an existing render instead of drawing the whole thing again.
   *
   * Set only when `renderDelta` says the change is confined to one stretch of
   * output time and nothing audible moved. The frames outside that stretch,
   * and the whole audio track, are copied from the previous file — so a
   * one-word caption fix costs about as long as that caption lasts rather than
   * as long as the video lasts.
   *
   * Always optional, and never load-bearing: if anything about it does not add
   * up the renderer draws the whole video, which is what it would have done
   * anyway.
   */
  incremental?: {
    previousVideoPath: string;
    fromSec: number;
    toSec: number;
  };
}

export interface RenderResult {
  videoPath: string;
  thumbnailPath: string;
  durationSec: number;
  renderMs: number;
  driver: 'local' | 'lambda';
}

export async function renderVideo(options: RenderOptions): Promise<RenderResult> {
  const startedAt = Date.now();
  await mkdir(options.outputDir, { recursive: true });

  // Serve the source locally for the duration of the render, if we have it on
  // disk. With object storage the EDL's URL is already public and this is a no-op.
  let assetServer: AssetServer | null = null;
  let edl = options.watermark === undefined
    ? options.edl
    : { ...options.edl, watermark: options.watermark };

  if (options.sourceVideoPath) {
    const path = await renderSourceFor(options.sourceVideoPath, edl, options.quality ?? DEFAULT_QUALITY);
    assetServer = await startAssetServer(dirname(path));
    const url = assetServer.urlFor(path);
    if (url) edl = { ...edl, source: { ...edl.source, url } };
  }

  try {
    return await renderWithSource(edl, options, startedAt);
  } finally {
    await assetServer?.close();
  }
}


/**
 * The file the renderer should actually read frames from.
 *
 * Phones record 4K HEVC. The renderer pulls one frame at a time out of
 * whatever it is given, so on that file every single frame of the export pays
 * a 4K HEVC decode — for pixels that are then scaled down to 1080. On a small
 * container the parallel decodes also exhaust its memory, the browser tab dies
 * part-way through, and it surfaces as a frame that never rendered:
 *
 *     waiting for the page to render the React component at frame 179 failed
 *
 * So a source materially larger than the export gets transcoded once, and
 * every frame after that is cheap. Built beside the source and reused, because
 * changing a caption and exporting again must not pay for it twice.
 *
 * Deliberately NOT down to the output's own size: a punch-in crops into the
 * picture, and it should find real pixels there. One and a half times the
 * output's long edge is past what any of our zooms reach.
 *
 * Every failure here returns the original path. A slower render is a render;
 * a failed one is not.
 */
async function renderSourceFor(sourcePath: string, edl: Edl, quality: RenderQuality): Promise<string> {
  try {
    const { probe, makeRenderSource } = await import('@/lib/media/ffmpeg');
    const { stat } = await import('node:fs/promises');

    const outputLongEdge = Math.max(edl.format.width, edl.format.height) * scaleFor(quality);
    const wanted = Math.round(outputLongEdge * RENDER_SOURCE_HEADROOM);

    const media = await probe(sourcePath);
    const sourceLongEdge = Math.max(media.width, media.height);
    // Only when there is something real to save. A source already near the
    // output's size would be transcoded for a rounding error.
    if (sourceLongEdge <= wanted * 1.2) return sourcePath;

    /*
     * In the project's work directory, not beside the upload: it is a
     * derivative, it is worth keeping between exports of the same project, and
     * `cleanupWorkDir` already owns everything under here. Written next to the
     * upload it would sit on the storage volume forever, unknown to the sweep.
     */
    const { mkdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const workDir = join(tmpdir(), 'easycut', edl.projectId);
    await mkdir(workDir, { recursive: true });
    const target = join(workDir, `render-${wanted}.mp4`);
    const [existing, original] = await Promise.all([
      stat(target).catch(() => null),
      stat(sourcePath).catch(() => null),
    ]);
    if (existing && original && existing.mtimeMs >= original.mtimeMs) return target;

    const startedAt = Date.now();
    await makeRenderSource(sourcePath, target, wanted);
    console.info(
      `[render] source ${sourceLongEdge}px → ${wanted}px in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );
    return target;
  } catch (error) {
    console.warn(`[render] could not prepare a render source, using the original: ${String(error).slice(0, 160)}`);
    return sourcePath;
  }
}

/** How much bigger than the output the render source is kept. See above. */
const RENDER_SOURCE_HEADROOM = 1.5;

async function renderWithSource(
  edl: Edl,
  options: RenderOptions,
  startedAt: number,
): Promise<RenderResult> {
  const quality = options.quality ?? DEFAULT_QUALITY;
  const silentVideoPath = join(options.outputDir, 'video-silent.mp4');
  const audioPath = join(options.outputDir, 'audio.m4a');
  const finalPath = join(options.outputDir, 'final.mp4');
  const thumbnailPath = join(options.outputDir, 'thumbnail.jpg');

  if (options.incremental) {
    const patched = await renderIncrementally(edl, options, startedAt, finalPath, thumbnailPath);
    if (patched) return patched;
    // Fell through: whatever did not add up is already logged, and a full
    // render is the correct answer to all of it.
  }

  options.onProgress?.(0.02, 'Starting render');

  // The two halves, in parallel — this is the main speed win in the pipeline.
  await Promise.all([
    renderFrames(edl, silentVideoPath, (f) => options.onProgress?.(0.02 + f * 0.82, 'Rendering frames'), quality),
    renderAudio(edl, {
      sourceAudioPath: options.sourceAudioPath,
      sfxPaths: localSfxPaths(),
      musicPath: options.musicPath ?? null,
      outputPath: audioPath,
    }).catch((error) => {
      // A failed mix must not lose the render — fall back to no audio track and
      // let the caller record the degradation. But a silent video is a
      // deliverable the customer notices immediately, so it is reported even
      // though the render goes on to succeed.
      void reportError(error, { where: 'render.audio-mix', aspect: edl.format.aspect, projectId: edl.projectId });
      return null;
    }),
  ]);

  options.onProgress?.(0.88, 'Muxing');
  await muxVideoAudio(silentVideoPath, audioPath, finalPath);

  options.onProgress?.(0.95, 'Making thumbnail');
  await extractFrame(finalPath, edl.deliverable.thumbnailAtSec, thumbnailPath, Math.min(1080, edl.format.width))
    .catch(() => extractFrame(finalPath, 0.5, thumbnailPath));

  options.onProgress?.(1, 'Done');

  return {
    videoPath: finalPath,
    thumbnailPath,
    durationSec: edl.format.durationSec,
    renderMs: Date.now() - startedAt,
    driver: env.render.driver,
  };
}

/* ------------------------------------------------------------ incremental */

/**
 * Draw only what changed, and copy the rest.
 *
 * Returns null rather than throwing whenever the amendment cannot be made
 * safely. Every one of those exits is a fast path back to a normal render, so
 * the worst case of this whole feature is the behaviour it replaced.
 *
 * The frame count of the result is checked against the original before it is
 * accepted. The failures this can have — a join that eats a frame, a copy that
 * lands a frame late — are all silent and all show up in that one number, so
 * it is the difference between an optimisation and a liability.
 */
async function renderIncrementally(
  edl: Edl,
  options: RenderOptions,
  startedAt: number,
  finalPath: string,
  thumbnailPath: string,
): Promise<RenderResult | null> {
  const plan = options.incremental;
  if (!plan) return null;
  /*
   * The chunk has to be drawn at the same size as the file it is spliced into.
   * The caller is responsible for not offering an incremental plan across a
   * quality change at all (see `planIncremental` in the worker), but reading
   * the option here rather than assuming HD means the two can never silently
   * disagree if that ever slips.
   */
  const quality = options.quality ?? DEFAULT_QUALITY;

  const { existsSync } = await import('node:fs');
  if (!existsSync(plan.previousVideoPath)) {
    console.warn('[render] previous file is gone; rendering in full');
    return null;
  }

  const { keyframeAtOrBefore, keyframeAtOrAfter, frameCount, spliceVideo } = await import('./splice');
  const { fps } = edl.format;

  const previousFrames = await frameCount(plan.previousVideoPath);
  const expected = Math.round(edl.format.durationSec * fps);

  // A previous render of a different length is a previous render of a
  // different video, whatever the diff thought.
  if (Math.abs(previousFrames - expected) > 1 || previousFrames === 0) {
    console.warn(`[render] previous render is ${previousFrames} frames, this edit is ${expected}; rendering in full`);
    return null;
  }

  /*
   * Both ends of the chunk have to sit on keyframes of the OLD file, because
   * both neighbours are stream copies and a copy can only begin at one.
   *
   * The head ends at the keyframe at or before the change; the tail begins at
   * the keyframe at or after it. Both snap outwards, so the only cost is
   * drawing a few frames that did not need it — at most one keyframe interval
   * at each end, which is a second apiece at the interval the renderer uses.
   * Snapping the tail INWARDS is the bug this replaced: ffmpeg would silently
   * start the copy at the keyframe before and emit the overlap twice.
   */
  const startSec = await keyframeAtOrBefore(plan.previousVideoPath, Math.max(0, plan.fromSec));
  const fromFrame = Math.max(0, Math.floor(startSec * fps + 1e-6));

  const endSec = await keyframeAtOrAfter(plan.previousVideoPath, plan.toSec);
  // No keyframe left means the change runs into the last GOP: draw to the end
  // and there is no tail to copy.
  const toFrame = endSec === null ? previousFrames : Math.min(previousFrames, Math.round(endSec * fps));
  if (toFrame <= fromFrame) return null;

  options.onProgress?.(0.05, 'Re-rendering what changed');

  const chunkPath = join(options.outputDir, 'chunk.mp4');
  await renderFrames(
    edl,
    chunkPath,
    (f) => options.onProgress?.(0.05 + f * 0.75, 'Re-rendering what changed'),
    quality,
    [fromFrame, toFrame - 1],
  );

  options.onProgress?.(0.85, 'Stitching it back together');
  const { frames } = await spliceVideo({
    previousPath: plan.previousVideoPath,
    chunkPath,
    fromFrame,
    workDir: options.outputDir,
    outputPath: finalPath,
  });

  if (Math.abs(frames - previousFrames) > 0) {
    console.warn(`[render] splice produced ${frames} frames, expected ${previousFrames}; rendering in full`);
    return null;
  }

  options.onProgress?.(0.95, 'Making thumbnail');
  await extractFrame(finalPath, edl.deliverable.thumbnailAtSec, thumbnailPath, Math.min(1080, edl.format.width))
    .catch(() => extractFrame(finalPath, 0.5, thumbnailPath));

  options.onProgress?.(1, 'Done');
  console.log(
    `[render] amended ${((toFrame - fromFrame) / fps).toFixed(1)}s of ${edl.format.durationSec.toFixed(1)}s ` +
      `(${(((toFrame - fromFrame) / previousFrames) * 100).toFixed(0)}% of the frames)`,
  );

  return {
    videoPath: finalPath,
    thumbnailPath,
    durationSec: edl.format.durationSec,
    renderMs: Date.now() - startedAt,
    driver: env.render.driver,
  };
}

/* ----------------------------------------------------------------- frames */

async function renderFrames(
  edl: Edl,
  outputPath: string,
  onProgress: (fraction: number) => void,
  quality: RenderQuality,
  /** Only these frames, for an incremental render. Inclusive at both ends. */
  frameRange?: [number, number],
): Promise<void> {
  if (env.render.driver === 'lambda' && env.render.lambdaFunctionName && env.render.lambdaServeUrl) {
    // Lambda splits a render across functions by frame and has its own notion
    // of a range; amending one there is a different design, so it draws the
    // whole video as it always has.
    if (frameRange) return renderLocally(edl, outputPath, onProgress, quality, frameRange);
    return renderOnLambda(edl, outputPath, onProgress, quality);
  }
  return renderLocally(edl, outputPath, onProgress, quality, frameRange);
}

async function renderLocally(
  edl: Edl,
  outputPath: string,
  onProgress: (fraction: number) => void,
  quality: RenderQuality,
  frameRange?: [number, number],
): Promise<void> {
  const { bundle } = await import('@remotion/bundler');
  const { renderMedia, selectComposition } = await import('@remotion/renderer');

  const entry = join(process.cwd(), 'remotion', 'index.ts');
  // The bundle is deterministic for a given source tree, so it's cached across
  // renders in the same process — a cold bundle costs ~20s and we pay it once.
  const serveUrl = cachedBundle ?? (cachedBundle = await bundle({ entryPoint: entry }));

  const inputProps = { edl, previewAudio: false };
  const composition = await selectComposition({
    serveUrl,
    id: 'EasyCutVideo',
    inputProps,
    browserExecutable: env.render.browserExecutable,
    chromiumOptions: { ignoreCertificateErrors: env.render.ignoreCertificateErrors },
  });

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps,
    // No audio here: ffmpeg is building the real mix in parallel.
    muted: true,
    concurrency: env.render.concurrency,
    /*
     * The whole of 4K, in one option.
     *
     * `scale` multiplies the output dimensions and leaves the composition's
     * own layout alone, so every `px` in `remotion/` still means what it meant
     * at 1080 and nothing needed rewriting for this.
     */
    scale: scaleFor(quality),
    // CRF 21 at 1080p is visually transparent for talking-head content and
    // roughly a third the size of CRF 17. At 4K the same CRF produces a file
    // three times the size for a difference nobody can see at four times the
    // pixel density, so it steps back two — which is the standard adjustment
    // and keeps a ten-minute 4K export at a size somebody can actually upload.
    crf: quality === '4k' ? 23 : 21,
    ...(frameRange ? { frameRange } : {}),
    /*
     * A keyframe every second.
     *
     * Left to itself x264 puts them where the picture changes, which on a
     * talking head is every three to five seconds and nowhere predictable.
     * An incremental render can only copy up to a keyframe, so those gaps are
     * frames it has to redraw for no reason — and on a static shot the gap can
     * be the whole video, which turns every amendment into a full render.
     * One second costs a few per cent of file size and buys a cut point
     * wherever an edit happens to land.
     */
    gopSize: edl.format.fps,
    onProgress: ({ progress }) => onProgress(progress),
    /*
     * Remotion's default is 30s per frame, which a single slow decode can
     * exceed on a busy container — and one frame over the line fails the whole
     * export. The render source above makes that unlikely; this makes it
     * survivable.
     */
    timeoutInMilliseconds: 120_000,
    browserExecutable: env.render.browserExecutable,
    // Pinned rather than derived from the host's free memory. Remotion's own
    // default is a share of whatever RAM happens to be there, which means the
    // same ten-minute video takes ~6 GB on a workstation and something else
    // entirely on a small container — speed, and whether the OOM killer turns
    // up, become properties of the box instead of the job.
    offthreadVideoCacheSizeInBytes: env.render.offthreadCacheMb * 1024 * 1024,
    chromiumOptions: {
      // Unset by default, and that is the point: see `render.gl` in
      // src/lib/config/env.ts for the 4× this is worth.
      gl: env.render.gl,
      ignoreCertificateErrors: env.render.ignoreCertificateErrors,
    },
  });
}

let cachedBundle: string | null = null;

async function renderOnLambda(
  edl: Edl,
  outputPath: string,
  onProgress: (fraction: number) => void,
  quality: RenderQuality,
): Promise<void> {
  const { renderMediaOnLambda, getRenderProgress } = await import('@remotion/lambda/client');
  const { writeFile } = await import('node:fs/promises');

  const { renderId, bucketName } = await renderMediaOnLambda({
    region: env.render.lambdaRegion as never,
    functionName: env.render.lambdaFunctionName!,
    serveUrl: env.render.lambdaServeUrl!,
    composition: 'EasyCutVideo',
    inputProps: { edl, previewAudio: false },
    codec: 'h264',
    muted: true,
    scale: scaleFor(quality),
    // See the note on the local path: 4K steps the CRF back two.
    crf: quality === '4k' ? 23 : 21,
    // The main cost/speed dial: fewer frames per Lambda means more parallelism
    // and lower latency, at the price of more cold starts.
    framesPerLambda: env.render.framesPerLambda,
    privacy: 'public',
    downloadBehavior: { type: 'play-in-browser' },
  });

  for (;;) {
    const progress = await getRenderProgress({
      renderId,
      bucketName,
      functionName: env.render.lambdaFunctionName!,
      region: env.render.lambdaRegion as never,
    });

    if (progress.fatalErrorEncountered) {
      throw new Error(`Lambda render failed: ${progress.errors[0]?.message ?? 'unknown error'}`);
    }
    onProgress(progress.overallProgress);

    if (progress.done && progress.outputFile) {
      const response = await fetch(progress.outputFile);
      await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/* ---------------------------------------------------------------- helpers */

/** Maps SFX names to files on disk for the ffmpeg mix. */
function localSfxPaths(): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const name of SFX_NAMES) {
    paths[name] = join(process.cwd(), 'public', sfxUrl(name).replace(/^\//, ''));
  }
  return paths;
}

export function renderWorkDir(projectId: string, renderId: string): string {
  return join(tmpdir(), 'easycut', projectId, 'renders', renderId);
}
