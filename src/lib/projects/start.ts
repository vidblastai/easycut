import { entitlementsOf } from '@/lib/billing/entitlements';
import { checkQuota } from '@/lib/billing/usage';
import { getPlan, renderExpiresAt, sourceExpiresAt } from '@/lib/billing/plans';
import { db } from '@/lib/db';
import { queue } from '@/lib/queue';
import { storage } from '@/lib/storage';

/**
 * Registers the footage and queues the pipeline: the one path every way of
 * starting an edit goes through, the upload page and the MCP server alike, so
 * the quota, the retention clocks and the queue priority cannot drift apart.
 */

export interface StartInput {
  projectId: string;
  /** Whose allowance this runs against; null when auth is off. */
  userId: string | null;
  /** Set when the upload went straight to object storage. */
  storageKey?: string;
  contentType?: string;
  sizeBytes?: number;
  /** The client's measurement, only good enough to refuse early. */
  sourceDurationSec?: number;
}

export type StartOutcome =
  | { ok: true; jobId: string; alreadyRunning?: boolean }
  | { ok: false; status: number; error: string; quota?: boolean; plan?: string };

export async function startProjectJob(input: StartInput): Promise<StartOutcome> {
  const { projectId: id } = input;
  const project = await db.project.findUnique({
    where: { id },
    include: { assets: { where: { kind: 'source' } } },
  });
  if (!project) return { ok: false, status: 404, error: 'Project not found' };

  let source = project.assets[0];
  if (!source && input.storageKey) {
    const key = input.storageKey;
    if (!(await storage().exists(key))) return { ok: false, status: 400, error: 'Upload not found in storage' };
    source = await db.asset.create({
      data: {
        projectId: id,
        kind: 'source',
        storageKey: key,
        url: storage().publicUrl(key),
        contentType: input.contentType ?? 'video/mp4',
        sizeBytes: input.sizeBytes ?? 0,
      },
    });
  }
  if (!source) return { ok: false, status: 400, error: 'No footage uploaded yet.' };

  // Don't stack jobs — a second "start" on a running project is a no-op.
  const running = await db.job.findFirst({ where: { projectId: id, status: { in: ['queued', 'running'] } } });
  if (running) return { ok: true, jobId: running.id, alreadyRunning: true };

  const minutes = (input.sourceDurationSec ?? source.durationSec ?? 0) / 60;
  const quota = await checkQuota(input.userId, minutes);
  // 402 rather than 403: this is not "you may not", it is "not on this plan".
  if (!quota.ok) return { ok: false, status: 402, error: quota.reason, quota: true, plan: quota.usage?.plan.id };

  // The retention clocks start the moment the work does, fixed to the plan in
  // force NOW — a downgrade next month must not shorten a promise already paid for.
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

  // Priority is fixed when queued, from the plan the footage was accepted
  // under — upgrading later must not overtake jobs already waiting.
  await queue().enqueue('pipeline', { projectId: id, jobId: job.id }, { priority: entitlementsOf(plan.id).priority });
  return { ok: true, jobId: job.id };
}
