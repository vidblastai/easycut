import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { env } from '@/lib/config/env';
import type { Edl } from '@/lib/edl/types';
import { muxVideoAudio, renderAudio } from '@/lib/media/audio-mix';
import { extractFrame } from '@/lib/media/ffmpeg';
import { sfxUrl, SFX_NAMES } from '@/lib/assets/sfx';
import { startAssetServer, type AssetServer } from './asset-server';

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
  let edl = options.edl;

  if (options.sourceVideoPath) {
    assetServer = await startAssetServer(dirname(options.sourceVideoPath));
    const url = assetServer.urlFor(options.sourceVideoPath);
    if (url) edl = { ...edl, source: { ...edl.source, url } };
  }

  try {
    return await renderWithSource(edl, options, startedAt);
  } finally {
    await assetServer?.close();
  }
}

async function renderWithSource(
  edl: Edl,
  options: RenderOptions,
  startedAt: number,
): Promise<RenderResult> {
  const silentVideoPath = join(options.outputDir, 'video-silent.mp4');
  const audioPath = join(options.outputDir, 'audio.m4a');
  const finalPath = join(options.outputDir, 'final.mp4');
  const thumbnailPath = join(options.outputDir, 'thumbnail.jpg');

  options.onProgress?.(0.02, 'Starting render');

  // The two halves, in parallel — this is the main speed win in the pipeline.
  await Promise.all([
    renderFrames(edl, silentVideoPath, (f) => options.onProgress?.(0.02 + f * 0.82, 'Rendering frames')),
    renderAudio(edl, {
      sourceAudioPath: options.sourceAudioPath,
      sfxPaths: localSfxPaths(),
      musicPath: options.musicPath ?? null,
      outputPath: audioPath,
    }).catch((error) => {
      // A failed mix must not lose the render — fall back to no audio track and
      // let the caller record the degradation.
      console.error('[render] audio mix failed:', (error as Error).message);
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

/* ----------------------------------------------------------------- frames */

async function renderFrames(
  edl: Edl,
  outputPath: string,
  onProgress: (fraction: number) => void,
): Promise<void> {
  if (env.render.driver === 'lambda' && env.render.lambdaFunctionName && env.render.lambdaServeUrl) {
    return renderOnLambda(edl, outputPath, onProgress);
  }
  return renderLocally(edl, outputPath, onProgress);
}

async function renderLocally(
  edl: Edl,
  outputPath: string,
  onProgress: (fraction: number) => void,
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
    // CRF 21 at 1080p is visually transparent for talking-head content and
    // roughly a third the size of CRF 17.
    crf: 21,
    onProgress: ({ progress }) => onProgress(progress),
    browserExecutable: env.render.browserExecutable,
    // SwANGLE is the software GL path: slower than a GPU but identical output on
    // every machine, which matters when a render can be resumed on another host.
    chromiumOptions: {
      gl: 'swangle',
      ignoreCertificateErrors: env.render.ignoreCertificateErrors,
    },
  });
}

let cachedBundle: string | null = null;

async function renderOnLambda(
  edl: Edl,
  outputPath: string,
  onProgress: (fraction: number) => void,
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
    crf: 21,
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
