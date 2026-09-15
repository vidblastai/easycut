import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * The database queue.
 *
 * Worth real tests rather than a smoke run, because every failure mode here is
 * silent: a job claimed twice renders the same video twice, a job claimed by
 * nobody never renders at all, and neither raises anything.
 */
process.env.QUEUE_DRIVER = 'db';
const db = new PrismaClient();

async function freshQueue() {
  await db.queueMessage.deleteMany({});
  const mod = await import('../src/lib/queue');
  // The factory memoises, so reach past it for a driver per test.
  return mod.queue();
}

beforeEach(async () => { await db.queueMessage.deleteMany({}); });
afterEach(async () => { await db.queueMessage.deleteMany({}); });

describe('db queue', () => {
  it('hands out jobs oldest first', async () => {
    const q = await freshQueue();
    await q.enqueue('pipeline', { n: 1 });
    await q.enqueue('pipeline', { n: 2 });

    const first = await q.reserve(1000);
    const second = await q.reserve(1000);
    expect((first!.payload as { n: number }).n).toBe(1);
    expect((second!.payload as { n: number }).n).toBe(2);
  });

  it('never hands the same job to two workers', async () => {
    // The whole point of the optimistic claim. Ten workers, one job.
    const q = await freshQueue();
    await q.enqueue('pipeline', { n: 1 });

    const claims = await Promise.all(Array.from({ length: 10 }, () => q.reserve(600)));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('a running job is no longer queued', async () => {
    const q = await freshQueue();
    await q.enqueue('pipeline', { n: 1 });
    await q.reserve(1000);
    expect(await q.size()).toBe(0);
  });

  it('requeues a failure and counts the attempt', async () => {
    const q = await freshQueue();
    await q.enqueue('pipeline', { n: 1 });

    const job = await q.reserve(1000);
    await q.fail(job!, new Error('boom'));
    expect(await q.size()).toBe(1);

    const retry = await q.reserve(1000);
    expect(retry!.attempts).toBe(1);
  });

  it('stops retrying at maxAttempts instead of looping forever', async () => {
    const q = await freshQueue();
    await q.enqueue('pipeline', { n: 1 }, { maxAttempts: 2 });

    for (let i = 0; i < 2; i++) {
      const job = await q.reserve(1000);
      expect(job, `attempt ${i}`).not.toBeNull();
      await q.fail(job!, new Error('boom'));
    }
    expect(await q.size()).toBe(0);
    const dead = await db.queueMessage.findMany({ where: { status: 'dead' } });
    expect(dead).toHaveLength(1);
    expect(dead[0].lastError).toBe('boom');
  });

  it('completing removes the row rather than leaving it to accumulate', async () => {
    const q = await freshQueue();
    await q.enqueue('pipeline', { n: 1 });
    await q.complete((await q.reserve(1000))!);
    expect(await db.queueMessage.count()).toBe(0);
  });

  it('returns null when there is nothing to do', async () => {
    const q = await freshQueue();
    expect(await q.reserve(300)).toBeNull();
  });
});
