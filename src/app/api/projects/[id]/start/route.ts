import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUserId, guardProject } from '@/lib/auth';
import { startProjectJob } from '@/lib/projects/start';

export const runtime = 'nodejs';

const StartSchema = z.object({
  /** Set when the browser uploaded straight to object storage. */
  storageKey: z.string().optional(),
  filename: z.string().optional(),
  contentType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  /**
   * What the browser measured the footage at.
   *
   * Used only to refuse a job that cannot fit the account's allowance before
   * the work starts. The meter is advanced later by ffprobe's figure, so a
   * client understating this buys nothing.
   */
  sourceDurationSec: z.number().nonnegative().optional(),
});

/**
 * Kicks off the pipeline. Registers the source asset if the upload bypassed us
 * (presigned PUT), then enqueues the job and returns immediately — the browser
 * follows progress by polling the project route.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = StartSchema.parse((await request.json().catch(() => ({}))) ?? {});

  const denied = await guardProject(id);
  if (denied) return denied;

  const outcome = await startProjectJob({
    projectId: id,
    userId: await currentUserId(),
    storageKey: body.storageKey,
    contentType: body.contentType,
    sizeBytes: body.sizeBytes,
    sourceDurationSec: body.sourceDurationSec,
  });
  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.error, ...(outcome.quota ? { quota: true, plan: outcome.plan } : {}) },
      { status: outcome.status },
    );
  }
  return NextResponse.json({ ok: true, jobId: outcome.jobId, ...(outcome.alreadyRunning ? { alreadyRunning: true } : {}) });
}
