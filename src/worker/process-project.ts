import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { entitlementsFor } from '@/lib/billing/entitlements';
import { renderDelta, worthSplicing } from '@/lib/render/diff';
import { DEFAULT_QUALITY, scaleFor, type RenderQuality } from '@/lib/render/quality';
import { localMusicPath } from '@/lib/assets/music';
import { parseLayersOff } from '@/lib/edl/layers';
import { recordUsage } from '@/lib/billing/usage';
import { readyMail, sendMail } from '@/lib/email';
import { env } from '@/lib/config/env';
import { db, parseJson, stringifyJson } from '@/lib/db';
import { EdlSchema, type Edl } from '@/lib/edl/types';
import { cleanupWorkDir, runPipeline } from '@/lib/pipeline/run';
import { STAGE_LABELS, type Stage } from '@/lib/pipeline/types';
import { renderVideo, renderWorkDir } from '@/lib/render';
import { assetKey, storage } from '@/lib/storage';
import type { StageLogEntry } from '@/lib/pipeline/types';

/**
 * One job, start to finish: run the pipeline, persist the EDL, render, store the
 * outputs, and update the project so the dashboard reflects reality.
 *
 * Progress is written to the database rather than held in memory, because the
 * browser polls a different process than the one doing the work.
 */

export interface ProcessJobPayload {
  projectId: string;
  jobId: string;
  resumeFrom?: Stage;
}

export async function processProject(payload: ProcessJobPayload): Promise<void> {
  const { projectId, jobId } = payload;

  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { assets: { where: { kind: 'source' }, take: 1 } },
  });
  if (!project) throw new Error(`Project ${projectId} not found`);

  const source = project.assets[0];
  if (!source) throw new Error('Project has no source asset');

  await db.job.update({
    where: { id: jobId },
    data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } },
  });
  await db.project.update({ where: { id: projectId }, data: { status: 'processing', errorMessage: null } });

  try {
    /* ------------------------------ pipeline ------------------------------ */

    const result = await runPipeline(
      {
        projectId,
        mode: project.mode as 'short' | 'long',
        styleId: project.styleId,
        captionPreset: project.captionPreset,
        inputMode: project.inputMode as 'raw' | 'roughcut',
        userNote: project.userNote ?? undefined,
        layersOff: parseLayersOff(project.layersOff),
        sourceKey: source.storageKey,
        resumeFrom: payload.resumeFrom,
      },
      async (stage, fraction, label, log) => {
        await db.job.update({
          where: { id: jobId },
          data: {
            stage,
            progress: Math.min(0.95, fraction),
            progressLabel: label ?? STAGE_LABELS[stage],
            // Written as it happens. A log that only lands on success is a log
            // that is missing from every job you actually need it for.
            ...(log ? { log: stringifyJson(log) } : {}),
          },
        });
      },
    );

    const edl = EdlSchema.parse(result.edl);

    /*
     * Meter what was actually processed.
     *
     * ffprobe's duration, not the browser's — the browser's figure was only
     * ever good enough to refuse a job early. Recorded here, after the analysis
     * stages have run and before the render, because that is the point at which
     * the money has genuinely been spent: transcription and the director are
     * ~85 % of the bill and neither can be taken back.
     */
    const measuredMinutes = (result.context.media?.durationSec ?? 0) / 60;
    if (measuredMinutes > 0) {
      await db.project.update({ where: { id: projectId }, data: { sourceMinutes: measuredMinutes } });
      await recordUsage(project.userId, measuredMinutes);
    }

    /*
     * The format the file turned out to be.
     *
     * The row was created from the browser's guess, before the bytes existed
     * server-side. ffprobe settled it in `stageIngest`, and if the two differ
     * the row is the one that is wrong — the video has already been built as
     * the format below, so leaving the row alone would have the dashboard and
     * the editor describing a video that does not exist.
     */
    if (result.context.mode !== project.mode) {
      await db.project.update({ where: { id: projectId }, data: { mode: result.context.mode } });
    }

    // Cache the two expensive stages so every later tweak is free.
    await db.project.update({
      where: { id: projectId },
      data: {
        transcriptJson: stringifyJson(result.context.transcript ?? null),
        directorPlanJson: stringifyJson(result.context.plan ?? null),
        mediaJson: stringifyJson(result.context.media ?? null),
        cutsJson: stringifyJson([
          ...(result.context.silenceRemovals ?? []),
          ...(result.context.cleanupRemovals ?? []),
        ]),
      },
    });

    // Persist the EDL as a new version. Every later tweak forks from here.
    const previous = await db.edl.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const edlRow = await db.edl.create({
      data: {
        projectId,
        version: (previous?.version ?? 0) + 1,
        document: stringifyJson(edl),
        origin: 'pipeline',
      },
    });

    /* ------------------------------ delivery ------------------------------ */

    /*
     * The job ends with the EDIT, not with a file.
     *
     * Rendering here meant everybody waited for a video before they had seen
     * the edit — and the first change they made in the editor threw that video
     * away. So the job finishes at the document, the editor opens on it and
     * plays it live, and the frames are drawn when somebody asks for them.
     */
    await db.job.update({
      where: { id: jobId },
      data: { stage: 'deliver', progress: 0.94, progressLabel: STAGE_LABELS.deliver },
    });

    const [thumbObject, proxyObject] = await Promise.all([
      makePosterFrame(projectId, edl, result.context.sourcePath),
      publishProxy(projectId, result.context.proxyPath),
    ]);

    if (proxyObject) {
      await db.asset.create({
        data: {
          projectId,
          kind: 'proxy',
          storageKey: proxyObject.key,
          url: proxyObject.url,
          contentType: 'video/mp4',
          sizeBytes: proxyObject.sizeBytes,
          durationSec: edl.source.durationSec,
        },
      });
    }

    if (thumbObject) {
      await db.asset.create({
        data: {
          projectId,
          kind: 'thumbnail',
          storageKey: thumbObject.key,
          url: thumbObject.url,
          contentType: 'image/jpeg',
          sizeBytes: thumbObject.sizeBytes,
        },
      });
    }

    await db.project.update({
      where: { id: projectId },
      data: {
        status: 'ready',
        durationSec: edl.format.durationSec,
        // No file yet, and that is the normal, finished state of a job now.
        previewUrl: null,
        thumbnailUrl: thumbObject?.url ?? null,
        socialCaption: edl.deliverable.socialCaption,
        hashtags: stringifyJson(edl.deliverable.hashtags),
        title: edl.deliverable.title || project.title,
        costUsd: result.costUsd,
        costReport: stringifyJson(result.context.ledger.toJSON()),
      },
    });

    await notifyReady(projectId, edl);

    await db.job.update({
      where: { id: jobId },
      data: {
        status: 'succeeded',
        stage: 'done',
        progress: 1,
        progressLabel: 'Done',
        log: stringifyJson(result.context.log),
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    const message = (error as Error).message;
    await db.job.update({
      where: { id: jobId },
      data: { status: 'failed', errorMessage: message, finishedAt: new Date() },
    });
    await db.project.update({
      where: { id: projectId },
      data: { status: 'failed', errorMessage: message },
    });
    throw error;
  } finally {
    await cleanupWorkDir(projectId);
  }
}

/**
 * "Your video is ready."
 *
 * Five minutes is long enough that the tab gets closed, and a finished render
 * nobody is told about may as well not have happened.
 *
 * Three rules, all of them about not making things worse:
 *
 *  - It never throws. The video exists; a mail provider having a bad afternoon
 *    is not a reason to mark the job failed and re-run a job that cost money.
 *  - It stamps the project before it is sent, so a re-render, a resumed job or
 *    a restarted worker cannot send a second copy.
 *  - It says when the video will be deleted, because that is the half of the
 *    retention promise people need to see without reading a policy page.
 */
async function notifyReady(projectId: string, edl: Edl): Promise<void> {
  try {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: {
        title: true,
        mode: true,
        readyEmailSentAt: true,
        renderExpiresAt: true,
        sourceExpiresAt: true,
        user: { select: { email: true, name: true } },
      },
    });

    if (!project?.user?.email) return;       // signed-out, or auth is switched off
    if (project.readyEmailSentAt) return;    // already told them

    // Claim it first. Two workers finishing a re-render at the same moment
    // would otherwise both pass the check above and both send.
    const claimed = await db.project.updateMany({
      where: { id: projectId, readyEmailSentAt: null },
      data: { readyEmailSentAt: new Date() },
    });
    if (claimed.count === 0) return;

    const mail = readyMail({
      to: project.user.email,
      name: project.user.name?.split(' ')[0] ?? null,
      projectTitle: edl.deliverable.title || project.title,
      projectUrl: `${env.appUrl}/projects/${projectId}`,
      mode: project.mode === 'long' ? 'long' : 'short',
      durationSec: edl.format.durationSec,
      cuts: Math.max(0, edl.segments.length - 1),
      captions: edl.captions.length,
      brollCount: edl.broll.length,
      expiresAt: project.renderExpiresAt,
      sourceExpiresAt: project.sourceExpiresAt,
    });

    const sent = await sendMail(mail);
    if (!sent.sent) {
      // Hand the stamp back so a later re-render can try again.
      await db.project.update({ where: { id: projectId }, data: { readyEmailSentAt: null } });
      console.warn(`[email] ready mail not sent for ${projectId}: ${sent.reason}`);
    }
  } catch (error) {
    console.warn(`[email] ready mail failed for ${projectId}: ${(error as Error).message}`);
  }
}

/* --------------------------------------------------------- re-render path */

/**
 * Whether the last render can be amended instead of redone, and where.
 *
 * Everything here is best-effort and returns null the moment anything is not
 * exactly as expected — a missing file, a render of a different shape, a
 * change that touches every frame. Null means "render it properly", which is
 * what this code path did for its whole life before today, so there is no
 * failure mode worse than the status quo.
 *
 * The audio is what makes this safe. `renderDelta` only ever reports a span
 * when nothing audible changed, so the previous render's audio track is
 * carried over untouched and there is no mix to get out of step.
 */
async function planIncremental(
  projectId: string,
  next: Edl,
  workDir: string,
  /** What this render multiplies the composition by — 1 for HD, 2 for 4K. */
  scale: number,
): Promise<{ previousVideoPath: string; fromSec: number; toSec: number } | null> {
  try {
    const previous = await db.render.findFirst({
      where: { projectId, status: 'succeeded', url: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { url: true, width: true, height: true, fps: true, edl: { select: { document: true } } },
    });
    if (!previous?.url || !previous.edl) return null;

    /*
     * A different shape is a different composition, whatever the documents say
     * — and a different RESOLUTION is too. Splicing 1080 frames into a 4K file
     * would produce a video that changes size halfway through, so comparing
     * against the scaled dimensions is what makes "export this one in 4K"
     * safely fall through to a full render. Two 4K renders of the same edit
     * still match each other, so the cheap path survives where it is correct.
     */
    if (
      previous.width !== next.format.width * scale ||
      previous.height !== next.format.height * scale ||
      Math.abs(previous.fps - next.format.fps) > 0.01
    ) {
      return null;
    }

    const before = EdlSchema.safeParse(parseJson<Edl>(previous.edl.document, {} as Edl));
    if (!before.success) return null;

    const delta = renderDelta(before.data, next);
    if (delta.kind === 'all') {
      console.log(`[render] full render: ${delta.reason}`);
      return null;
    }
    if (delta.kind === 'none') {
      // Nothing on screen moved. Still worth re-rendering rather than
      // returning the old file, because "nothing changed" is a claim about
      // this diff and the customer asked for a render — but there is no point
      // pretending it is incremental.
      return null;
    }
    if (!worthSplicing(delta, next.format.durationSec)) {
      console.log(`[render] full render: ${delta.reason}, but it spans most of the video`);
      return null;
    }

    // Bring the previous file down next to the new one.
    const { localPathFor } = await import('@/lib/storage');
    const key = storageKeyOf(previous.url);
    let path = key ? localPathFor(key) : null;
    if (!path && key) {
      const { writeFile } = await import('node:fs/promises');
      path = join(workDir, 'previous.mp4');
      await writeFile(path, await storage().get(key));
    }
    if (!path) return null;

    console.log(
      `[render] amending the last render: ${delta.reason} ` +
        `(${delta.fromSec.toFixed(1)}s–${delta.toSec.toFixed(1)}s of ${next.format.durationSec.toFixed(1)}s)`,
    );
    return { previousVideoPath: path, fromSec: delta.fromSec, toSec: delta.toSec };
  } catch (error) {
    console.warn('[render] could not plan an incremental render:', (error as Error).message);
    return null;
  }
}

/** The storage key inside a render URL we wrote ourselves. */
function storageKeyOf(url: string): string | null {
  const match = url.match(/projects\/[^/]+\/render\/[^/?#]+/);
  return match ? match[0] : null;
}


/**
 * Re-renders an existing EDL without re-running any analysis.
 *
 * This is what makes every tweak in the editor cheap: swapping a style, nudging
 * a caption or changing aspect ratio costs one render and zero API calls.
 *
 * `quality` is the one thing here that is not cheap — a 4K export redraws every
 * frame at four times the pixels and takes three to four times as long — so it
 * arrives from the route that already checked the customer's plan allows it,
 * and defaults to HD when absent.
 */
export async function rerenderProject(
  projectId: string,
  edlId: string,
  quality: RenderQuality = DEFAULT_QUALITY,
): Promise<void> {
  const row = await db.edl.findUnique({ where: { id: edlId } });
  if (!row) throw new Error('EDL not found');

  const edl = EdlSchema.parse(parseJson<Edl>(row.document, {} as Edl));

  // The row records the pixels the file will actually have, not the
  // composition's 1080 base — so a 4K export is self-describing and a label can
  // never disagree with the video it names.
  const scale = scaleFor(quality);
  const render = await db.render.create({
    data: {
      projectId,
      edlId,
      aspect: edl.format.aspect,
      width: edl.format.width * scale,
      height: edl.format.height * scale,
      fps: edl.format.fps,
      status: 'running',
    },
  });

  // The source audio has to come back down for the mix.
  const source = await db.asset.findFirst({ where: { projectId, kind: 'source' } });
  if (!source) throw new Error('Source asset missing');

  const workDir = renderWorkDir(projectId, render.id);
  const { mkdir, rm, writeFile } = await import('node:fs/promises');
  await mkdir(workDir, { recursive: true });

  // Can this be an amendment to the last render rather than a new one?
  const incremental = await planIncremental(projectId, edl, workDir, scale);

  // A re-render is the cheap path — change a style, change a caption look, and
  // it replays without touching an API. Which is exactly why its scratch space
  // has to be swept up: a ten-minute video's uncompressed mix is 110 MB, and
  // somebody trying five caption looks on one video would otherwise leave half
  // a gigabyte behind for the privilege.
  try {
    const { localPathFor } = await import('@/lib/storage');
    let sourcePath = localPathFor(source.storageKey);
    if (!sourcePath) {
      sourcePath = join(workDir, 'source.mp4');
      await writeFile(sourcePath, await storage().get(source.storageKey));
    }

    const { extractAudio } = await import('@/lib/media/ffmpeg');
    const audioPath = join(workDir, 'mix.wav');
    await extractAudio(sourcePath, audioPath);

    const rendered = await renderVideo({
      edl,
      watermark: (await entitlementsFor(projectId)).watermark,
      quality,
      sourceVideoPath: sourcePath,
      sourceAudioPath: audioPath,
      musicPath: edl.music ? localMusicPath(edl.music.url) : null,
      outputDir: workDir,
      incremental: incremental ?? undefined,
      onProgress: async (fraction) => {
        await db.render.update({ where: { id: render.id }, data: { progress: fraction } }).catch(() => {});
      },
    });

    const key = assetKey(projectId, 'render', `${render.id}.mp4`);
    const object = await storage().putFile(key, rendered.videoPath, 'video/mp4');

    await db.render.update({
      where: { id: render.id },
      data: {
        status: 'succeeded',
        progress: 1,
        url: object.url,
        sizeBytes: object.sizeBytes,
        durationSec: edl.format.durationSec,
        renderMs: rendered.renderMs,
        finishedAt: new Date(),
      },
    });

    await db.project.update({
      where: { id: projectId },
      data: { status: 'ready', previewUrl: object.url, durationSec: edl.format.durationSec },
    });
  } catch (error) {
    // Without this the row stays `running` for ever and the editor shows a
    // progress bar that will never move again.
    await db.render
      .update({
        where: { id: render.id },
        data: { status: 'failed', errorMessage: (error as Error).message, finishedAt: new Date() },
      })
      .catch(() => {});
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}


export function readStageLog(json: string): StageLogEntry[] {
  return parseJson<StageLogEntry[]>(json, []);
}

export async function readEdl(edlId: string): Promise<Edl | null> {
  const row = await db.edl.findUnique({ where: { id: edlId } });
  if (!row) return null;
  try {
    return EdlSchema.parse(JSON.parse(row.document));
  } catch {
    return null;
  }
}

export async function loadSourceFile(storageKey: string): Promise<Buffer> {
  const { localPathFor } = await import('@/lib/storage');
  const local = localPathFor(storageKey);
  return local ? readFile(local) : storage().get(storageKey);
}

/**
 * A still from the footage, for the dashboard card and the editor's poster.
 *
 * The thumbnail used to be a frame of the rendered video, which no longer
 * exists at this point. The first moment the edit actually keeps is the honest
 * substitute: it is the frame the finished video opens on, and it comes out of
 * the source in well under a second.
 *
 * Never fatal. A project without a picture on its card is a cosmetic loss; a
 * job failed at the last step over one is not.
 */
async function makePosterFrame(
  projectId: string,
  edl: Edl,
  sourcePath: string | undefined,
): Promise<{ key: string; url: string; sizeBytes: number } | null> {
  if (!sourcePath) return null;
  try {
    const { extractFrame } = await import('@/lib/media/ffmpeg');
    const { join } = await import('node:path');
    const { mkdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');

    const dir = join(tmpdir(), 'easycut', projectId);
    await mkdir(dir, { recursive: true });
    const framePath = join(dir, 'poster.jpg');

    // Half a second into the first shot the edit keeps: far enough in to be
    // past a cut or a blink, and it is what the video opens on.
    const at = (edl.segments[0]?.sourceStartSec ?? 0) + 0.5;
    await extractFrame(sourcePath, at, framePath, 720);

    const key = assetKey(projectId, 'thumbnail', 'poster.jpg');
    const object = await storage().putFile(key, framePath, 'image/jpeg');
    return { key, url: object.url, sizeBytes: object.sizeBytes };
  } catch (error) {
    console.warn(`[worker] no poster frame for ${projectId}: ${String(error).slice(0, 140)}`);
    return null;
  }
}

/**
 * Publishes the small proxy the pipeline already made.
 *
 * The editor plays the edit live, and it was playing it off the ORIGINAL —
 * which from a phone is 4K HEVC. A browser seeking around that file drops
 * frames on a laptop and stalls on anything less, so the editor felt broken
 * while the edit underneath it was fine. The pipeline already builds a 540p
 * H.264 proxy for the face tracker; this puts it where the browser can reach
 * it. The export is untouched — it reads the original.
 *
 * Never fatal. Without it the editor falls back to the source, exactly as
 * before.
 */
async function publishProxy(
  projectId: string,
  proxyPath: string | undefined,
): Promise<{ key: string; url: string; sizeBytes: number } | null> {
  if (!proxyPath) return null;
  try {
    const key = assetKey(projectId, 'proxy', 'preview.mp4');
    const object = await storage().putFile(key, proxyPath, 'video/mp4');
    return { key, url: object.url, sizeBytes: object.sizeBytes };
  } catch (error) {
    console.warn(`[worker] no preview proxy for ${projectId}: ${String(error).slice(0, 140)}`);
    return null;
  }
}
