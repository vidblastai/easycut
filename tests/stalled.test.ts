import { afterEach, describe, expect, it } from 'vitest';
import { stalledJob } from '@/lib/pipeline/stalled';

/**
 * Noticing that nothing is working on a job.
 *
 * The thresholds are the whole design here, in both directions. Too eager and
 * the screen cries wolf during an ordinary long render, people learn to ignore
 * it, and it is worth nothing when it is finally right. Too slow and it is a
 * spinner with no explanation, which is what it was replacing.
 */
const NOW = new Date('2026-09-21T12:00:00Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const job = (over: Partial<Parameters<typeof stalledJob>[0]> = {}) => ({
  status: 'running',
  queuedAt: ago(1),
  startedAt: ago(1),
  updatedAt: ago(1),
  ...over,
});

afterEach(() => {
  delete process.env.QUEUE_DRIVER;
  delete process.env.STORAGE_DRIVER;
});

describe('while everything is normal', () => {
  it('says nothing about a job that just started', () => {
    expect(stalledJob(job(), NOW)).toBeNull();
  });

  it('says nothing about a job that is reporting progress', () => {
    expect(stalledJob(job({ startedAt: ago(40), updatedAt: ago(1) }), NOW)).toBeNull();
  });

  it('does not cry wolf during a long render', () => {
    // Half an hour in, still moving. This is a ten-minute video rendering
    // normally, and a warning here would train people to ignore the next one.
    expect(stalledJob(job({ startedAt: ago(30), updatedAt: ago(2) }), NOW)).toBeNull();
  });

  it('tolerates a silent transcription of several minutes', () => {
    // One network call with no intermediate progress. Real, and not stuck.
    expect(stalledJob(job({ startedAt: ago(20), updatedAt: ago(8) }), NOW)).toBeNull();
  });

  it('never reports a job that is already over', () => {
    for (const status of ['succeeded', 'failed', 'cancelled']) {
      expect(stalledJob(job({ status, updatedAt: ago(600) }), NOW), status).toBeNull();
    }
  });
});

describe('when nothing ever picked it up', () => {
  it('stays quiet for the first couple of minutes', () => {
    expect(stalledJob(job({ status: 'queued', startedAt: null, queuedAt: ago(2) }), NOW)).toBeNull();
  });

  it('reports it once the wait is unreasonable', () => {
    const out = stalledJob(job({ status: 'queued', startedAt: null, queuedAt: ago(10) }), NOW);
    expect(out?.reason).toBe('never-started');
    expect(out?.forSec).toBe(600);
  });

  it('reports a job marked running that never actually started', () => {
    // The row says running and there is no start time — a half-written claim.
    const out = stalledJob(job({ startedAt: null, queuedAt: ago(30) }), NOW);
    expect(out?.reason).toBe('never-started');
  });
});

describe('when the worker died mid-job', () => {
  it('reports a row that has stopped moving', () => {
    const out = stalledJob(job({ startedAt: ago(40), updatedAt: ago(20) }), NOW);
    expect(out?.reason).toBe('no-progress');
    expect(out?.forSec).toBe(1200);
  });

  it('measures from the last update, not from the start', () => {
    // A job that ran happily for an hour and died a minute ago is not stuck.
    expect(stalledJob(job({ startedAt: ago(60), updatedAt: ago(1) }), NOW)).toBeNull();
  });
});

describe('who is being told', () => {
  it('treats a local-disk deployment as one the reader can fix', () => {
    process.env.STORAGE_DRIVER = 'local';
    expect(stalledJob(job({ status: 'queued', startedAt: null, queuedAt: ago(10) }), NOW)?.selfHosted).toBe(true);
  });
});
