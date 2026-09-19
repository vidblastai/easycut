import { NextResponse } from 'next/server';
import { entitlementsOf } from '@/lib/billing/entitlements';
import { z } from 'zod';
import { db } from '@/lib/db';
import { queue } from '@/lib/queue';
import { storage } from '@/lib/storage';
import { currentUserId, guardProject } from '@/lib/auth';
import { checkQuota } from '@/lib/billing/usage';
import { getPlan, renderExpiresAt, sourceExpiresAt } from '@/lib/billing/plans';

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

  const project = await db.project.findUnique({
    where: { id },
    include: { assets: { where: { kind: 'source' } } },
  });
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  let source = project.assets[0];

  if (!source && body.storageKey) {
    const key = body.storageKey;
    if (!(await storage().exists(key))) {
      return NextResponse.json({ error: 'Upload not found in storage' }, { status: 400 });
    }
    source = await db.asset.create({
      data: {
        projectId: id,
        kind: 'source',
        storageKey: key,
        url: storage().publicUrl(key),
        contentType: body.contentType ?? 'video/mp4',
        sizeBytes: body.sizeBytes ?? 0,
      },
    });
  }

  if (!source) {
    return NextResponse.json({ error: 'No footage uploaded yet.' }, { status: 400 });
  }

  // Don't stack jobs — a second "start" on a running project is a no-op.
  const running = await db.job.findFirst({
    where: { projectId: id, status: { in: ['queued', 'running'] } },
  });
  if (running) {
    return NextResponse.json({ ok: true, jobId: running.id, alreadyRunning: true });
  }

  /* ------------------------------------------------------------ the meter */

  const userId = await currentUserId();
  const minutes = (body.sourceDurationSec ?? source.durationSec ?? 0) / 60;
  const quota = await checkQuota(userId, minutes);
  if (!quota.ok) {
    // 402 rather than 403: this is not "you may not", it is "not on this plan".
    return NextResponse.json({ error: quota.reason, quota: true, plan: quota.usage?.plan.id }, { status: 402 });
  }

  // The retention clocks start the moment the work does, and they are fixed to
  // the plan in force NOW — a downgrade next month must not retroactively
  // shorten a promise somebody has already paid for.
  const plan = quota.usage?.plan ?? getPlan(null);
  const uploadedAt = new Date();
  await db.project.update({
    where: { id },
    data: {
      planAtUpload: plan.id,
      sourceMinutes: minutes,
      sourceExpiresAt: sourceExpiresAt(plan, uploadedAt),
      renderExpiresAt: renderExpiresAt(plan, uploadedAt),
    },
  });

  const job = await db.job.create({ data: { projectId: id, type: 'pipeline', status: 'queued' } });
  await db.project.update({ where: { id }, data: { status: 'processing', errorMessage: null } });

  // Priority is fixed at the moment of queueing, from the plan this footage
  // was accepted under — not looked up when a worker picks the job up, which
  // would let somebody upgrade to overtake jobs already waiting behind them.
  await queue().enqueue(
    'pipeline',
    { projectId: id, jobId: job.id },
    { priority: entitlementsOf(plan.id).priority },
  );

  return NextResponse.json({ ok: true, jobId: job.id });
}
