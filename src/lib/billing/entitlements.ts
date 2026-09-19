import { db } from '@/lib/db';
import { getPlan } from './plans';

/**
 * What a project's plan entitles it to, at the moment it is rendered.
 *
 * Read from `project.planAtUpload` rather than from the account's plan today.
 * That column exists precisely so that somebody who downgrades after making a
 * video does not find a watermark appearing on work they already paid for —
 * and, in the other direction, so that upgrading does not retroactively clean
 * the watermark off a video made on the free tier without re-rendering it.
 *
 * Derived here rather than trusted from the EDL, because an EDL can be edited
 * in the browser and sent back: a watermark a client can delete from a JSON
 * document is not a watermark. `renderVideo` applies this over whatever the
 * document says, which is the one place every render passes through.
 */
export async function entitlementsFor(projectId: string): Promise<{
  watermark: boolean;
  maxHeight: number;
  /** Queue priority — see src/lib/queue/index.ts. Higher goes first. */
  priority: number;
}> {
  const project = await db.project
    .findUnique({ where: { id: projectId }, select: { planAtUpload: true } })
    .catch(() => null);

  return entitlementsOf(project?.planAtUpload ?? 'free');
}

/** The same thing when the plan is already in hand, so nothing is read twice. */
export function entitlementsOf(planId: string | null | undefined) {
  const plan = getPlan(planId ?? 'free');
  return {
    watermark: plan.watermark,
    maxHeight: plan.maxRenderHeight,
    priority: plan.priorityQueue ? 1 : 0,
  };
}
