import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { localMusicPath } from '@/lib/assets/music';
import { parseLayersOff } from '@/lib/edl/layers';
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

    /* ------------------------------- render ------------------------------- */

    await db.job.update({
      where: { id: jobId },
      data: { stage: 'render', progress: 0.62, progressLabel: STAGE_LABELS.render },
    });

    const render = await db.render.create({
      data: {
        projectId,
        edlId: edlRow.id,
        aspect: edl.format.aspect,
        width: edl.format.width,
        height: edl.format.height,
        fps: edl.format.fps,
        status: 'running',
      },
    });

    const outputDir = renderWorkDir(projectId, render.id);
    const rendered = await renderVideo({
      edl,
      sourceVideoPath: result.context.sourcePath,
      sourceAudioPath: result.context.mixAudioPath!,
      musicPath: edl.music ? localMusicPath(edl.music.url) : null,
      outputDir,
      onProgress: async (fraction, label) => {
        await db.render.update({ where: { id: render.id }, data: { progress: fraction } }).catch(() => {});
        await db.job
          .update({
            where: { id: jobId },
            data: { progress: 0.62 + fraction * 0.32, progressLabel: label },
          })
          .catch(() => {});
      },
    });

    /* ------------------------------ delivery ------------------------------ */

    await db.job.update({
      where: { id: jobId },
      data: { stage: 'deliver', progress: 0.95, progressLabel: STAGE_LABELS.deliver },
    });

    const driver = storage();
    const videoKey = assetKey(projectId, 'render', `${render.id}.mp4`);
    const thumbKey = assetKey(projectId, 'thumbnail', `${render.id}.jpg`);

    const [videoObject, thumbObject] = await Promise.all([
      driver.putFile(videoKey, rendered.videoPath, 'video/mp4'),
      driver.putFile(thumbKey, rendered.thumbnailPath, 'image/jpeg').catch(() => null),
    ]);

    await db.asset.createMany({
      data: [
        {
          projectId,
          kind: 'render',
          storageKey: videoKey,
          url: videoObject.url,
          contentType: 'video/mp4',
          sizeBytes: videoObject.sizeBytes,
          width: edl.format.width,
          height: edl.format.height,
          fps: edl.format.fps,
          durationSec: edl.format.durationSec,
        },
        ...(thumbObject
          ? [
              {
                projectId,
                kind: 'thumbnail',
                storageKey: thumbKey,
                url: thumbObject.url,
                contentType: 'image/jpeg',
                sizeBytes: thumbObject.sizeBytes,
              },
            ]
          : []),
      ],
    });

    await db.render.update({
      where: { id: render.id },
      data: {
        status: 'succeeded',
        progress: 1,
        url: videoObject.url,
        sizeBytes: videoObject.sizeBytes,
        durationSec: edl.format.durationSec,
        renderMs: rendered.renderMs,
        costUsd: result.costUsd,
        finishedAt: new Date(),
      },
    });

    await db.project.update({
      where: { id: projectId },
      data: {
        status: 'ready',
        durationSec: edl.format.durationSec,
        previewUrl: videoObject.url,
        thumbnailUrl: thumbObject?.url ?? null,
        socialCaption: edl.deliverable.socialCaption,
        hashtags: stringifyJson(edl.deliverable.hashtags),
        title: edl.deliverable.title || project.title,
        costUsd: result.costUsd,
        costReport: stringifyJson(result.context.ledger.toJSON()),
      },
    });

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

/* --------------------------------------------------------- re-render path */

/**
 * Re-renders an existing EDL without re-running any analysis.
 *
 * This is what makes every tweak in the editor cheap: swapping a style, nudging
 * a caption or changing aspect ratio costs one render and zero API calls.
 */
export async function rerenderProject(projectId: string, edlId: string): Promise<void> {
  const row = await db.edl.findUnique({ where: { id: edlId } });
  if (!row) throw new Error('EDL not found');

  const edl = EdlSchema.parse(parseJson<Edl>(row.document, {} as Edl));

  const render = await db.render.create({
    data: {
      projectId,
      edlId,
      aspect: edl.format.aspect,
      width: edl.format.width,
      height: edl.format.height,
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
      sourceVideoPath: sourcePath,
      sourceAudioPath: audioPath,
      musicPath: edl.music ? localMusicPath(edl.music.url) : null,
      outputDir: workDir,
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
