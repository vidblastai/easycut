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
    edl: edl ? { id: edl.id, version: edl.version, document: parseJson(edl.document, null) } : null,
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
