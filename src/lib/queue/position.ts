import { db } from '@/lib/db';

/**
 * How many queued jobs the worker will take before this project's, or null when
 * the project has nothing waiting in the queue.
 *
 * Read off the database queue in the order the worker claims from it: higher
 * priority first, then oldest. With another queue driver there is no table to
 * count, and the answer is null.
 */
export async function videosAhead(projectId: string): Promise<number | null> {
  const mine = await db.queueMessage
    .findFirst({ where: { status: 'queued', payload: { contains: projectId } }, orderBy: { enqueuedAt: 'desc' } })
    .catch(() => null);
  if (!mine) return null;
  return db.queueMessage.count({
    where: {
      status: 'queued',
      OR: [{ priority: { gt: mine.priority } }, { priority: mine.priority, enqueuedAt: { lt: mine.enqueuedAt } }],
    },
  });
}

/** True when some worker has reported progress recently — the queue is moving, just busy. */
export async function workerIsBusy(withinMs = 3 * 60_000): Promise<boolean> {
  const recent = await db.job
    .count({ where: { status: 'running', updatedAt: { gt: new Date(Date.now() - withinMs) } } })
    .catch(() => 0);
  return recent > 0;
}

/** What a waiting video's progress line says. */
export function waitingLabel(ahead: number): string {
  return ahead === 0 ? 'Next in line — starting shortly' : `Waiting in line — ${ahead} video${ahead === 1 ? '' : 's'} ahead of yours`;
}
