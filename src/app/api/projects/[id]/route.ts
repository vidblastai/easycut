import { NextResponse } from 'next/server';
import { db, parseJson } from '@/lib/db';
import { readStageLog } from '@/worker/process-project';
import { STAGE_LABELS, type Stage } from '@/lib/pipeline/types';
import { guardProject } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * Everything the project page needs in one round trip — status, live job
 * progress, the finished render and the EDL summary. The editor polls this
 * while a job is running, so it stays deliberately small.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const denied = await guardProject(id);
  if (denied) return denied;

  const project = await db.project.findUnique({
    where: { id },
    include: {
      jobs: { orderBy: { queuedAt: 'desc' }, take: 1 },
      renders: { orderBy: { createdAt: 'desc' }, take: 5 },
      edls: { orderBy: { version: 'desc' }, take: 1 },
      assets: true,
    },
  });

  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const job = project.jobs[0];
  const edl = project.edls[0];

  /**
   * The EDL is only sent once there is something to edit.
   *
   * The project page polls this route every 1.8 seconds while a video is
   * rendering, and a ten-minute EDL is about 200 KB — 301 caption cards, each
   * with its words and their timings. Over a forty-minute render that is 1,300
   * requests and a quarter of a gigabyte, for one person watching one video, to
   * redeliver a document the page cannot use yet: while the status is
   * `processing` it is showing a progress panel, not the editor.
   *
   * The poll that flips the status to `ready` is itself a ready response, so
   * the document arrives on exactly the request where it first becomes useful.
   * The id and version always go, so the client can tell a version exists.
   */
  const stillWorking = project.status === 'processing' || project.status === 'draft';

  return NextResponse.json({
    project: {
      id: project.id,
      title: project.title,
      mode: project.mode,
      styleId: project.styleId,
      inputMode: project.inputMode,
      status: project.status,
      errorMessage: project.errorMessage,
      durationSec: project.durationSec,
      previewUrl: project.previewUrl,
      thumbnailUrl: project.thumbnailUrl,
      socialCaption: project.socialCaption,
      hashtags: parseJson<string[]>(project.hashtags, []),
      costUsd: project.costUsd,
      costReport: parseJson(project.costReport, {}),
      createdAt: project.createdAt,
    },
    job: job
      ? {
          id: job.id,
          status: job.status,
          stage: job.stage,
          stageLabel: STAGE_LABELS[job.stage as Stage] ?? job.stage,
          progress: job.progress,
          progressLabel: job.progressLabel,
          errorMessage: job.errorMessage,
          log: readStageLog(job.log),
        }
      : null,
    edl: edl
      ? {
          id: edl.id,
          version: edl.version,
          document: stillWorking ? null : parseJson(edl.document, null),
        }
      : null,
    renders: project.renders.map((r) => ({
      id: r.id,
      aspect: r.aspect,
      status: r.status,
      progress: r.progress,
      url: r.url,
      sizeBytes: r.sizeBytes,
      renderMs: r.renderMs,
      createdAt: r.createdAt,
    })),
    source: project.assets.find((a) => a.kind === 'source')
      ? {
          url: project.assets.find((a) => a.kind === 'source')!.url,
          durationSec: project.assets.find((a) => a.kind === 'source')!.durationSec,
        }
      : null,
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.project.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
