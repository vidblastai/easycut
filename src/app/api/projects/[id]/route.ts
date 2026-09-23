import { NextResponse } from 'next/server';
import { stalledJob, stalledProject } from '@/lib/pipeline/stalled';
import { db, parseJson } from '@/lib/db';
import { healEdl } from '@/lib/edl/operations';
import { readStageLog } from '@/worker/process-project';
import { STAGE_LABELS, type Stage } from '@/lib/pipeline/types';
import { guardProject } from '@/lib/auth';
import { purgeProject } from '@/worker/sweep';

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

      // Retention, so the editor can be honest rather than failing at render
      // time. Once the footage is swept a video can still be watched and
      // downloaded; it can no longer be re-cut, because re-rendering needs the
      // original file.
      planAtUpload: project.planAtUpload,
      sourceExpiresAt: project.sourceExpiresAt,
      sourceDeletedAt: project.sourceDeletedAt,
      renderExpiresAt: project.renderExpiresAt,
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
          startedAt: job.startedAt,
          queuedAt: job.queuedAt,
          // Null unless nothing has moved for long enough to be worth saying.
          // See src/lib/pipeline/stalled.ts for why the thresholds are long.
          stalled: stalledJob(job),
          log: readStageLog(job.log),
        }
      : // No job row at all, but the project says it is working. There is
        // nothing to resume and nothing in any queue — which is worth saying
        // out loud rather than spinning forever.
        stalledProject(project, false)
        ? { status: 'queued', stage: 'ingest', stageLabel: STAGE_LABELS.ingest, progress: 0,
            progressLabel: '', errorMessage: null, startedAt: null, queuedAt: null,
            stalled: stalledProject(project, false), log: [] }
        : null,
    edl: edl
      ? {
          id: edl.id,
          version: edl.version,
          // Healed on the way out: this is the document the editor opens.
          document: stillWorking ? null : healEdl(parseJson(edl.document, null)),
        }
      : null,
    renders: project.renders.map((r) => ({
      id: r.id,
      aspect: r.aspect,
      // The real pixels, so the editor can label a 4K export as one without
      // keeping a separate flag that could disagree with the file.
      width: r.width,
      height: r.height,
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

/**
 * Deletes a project and everything it owns.
 *
 * Two bugs lived here. It never checked WHOSE project it was — every other
 * route on this path calls `guardProject` and this one did not, so any signed-in
 * account could delete any other account's work by guessing an id. And it
 * removed the database row while leaving the files behind: a source video is
 * ~90 MB a minute, so "delete" quietly meant "hide, and keep paying to store".
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const denied = await guardProject(id);
  if (denied) return denied;

  const bytesFreed = await purgeProject(id);
  return NextResponse.json({ ok: true, bytesFreed });
}
