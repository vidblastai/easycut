import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * The meter.
 *
 * Every failure here is a money failure in one direction or the other: a period
 * that never rolls locks a paying customer out for ever, and one that rolls too
 * eagerly hands out a second month's allowance for free. Neither raises
 * anything, so both need tests.
 *
 * Against a throwaway database, for the same reason the queue tests use one: a
 * development worker polling dev.db would otherwise be a second writer.
 */
const dir = mkdtempSync(join(tmpdir(), 'easycut-usage-'));
const url = `file:${join(dir, 'usage-test.db')}`;
process.env.DATABASE_URL = url;

execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
  env: { ...process.env, DATABASE_URL: url },
  stdio: 'ignore',
});

const db = new PrismaClient({ datasources: { db: { url } } });
const { checkQuota, formatMinutes, recordUsage, usageFor } = await import('../src/lib/billing/usage');

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const JAN = new Date('2026-01-01T00:00:00Z');
const DAY = 86_400_000;

async function user(plan: string, opts: { used?: number; periodStart?: Date } = {}) {
  const id = `u-${Math.random().toString(36).slice(2)}`;
  await db.user.create({
    data: {
      id,
      email: `${id}@example.com`,
      plan,
      minutesUsed: opts.used ?? 0,
      periodStart: opts.periodStart ?? JAN,
    },
  });
  return id;
}

beforeEach(async () => {
  await db.job.deleteMany({});
  await db.project.deleteMany({});
  await db.user.deleteMany({});
});

describe('the billing period', () => {
  it('does not roll before it is due', async () => {
    const id = await user('starter', { used: 40 });
    const usage = await usageFor(id, new Date(JAN.getTime() + 20 * DAY));
    expect(usage?.minutesUsed).toBe(40);
    expect(usage?.periodStart.toISOString()).toBe(JAN.toISOString());
  });

  it('rolls once it is, and zeroes the counter', async () => {
    const id = await user('starter', { used: 55 });
    const usage = await usageFor(id, new Date(JAN.getTime() + 31 * DAY));
    expect(usage?.minutesUsed).toBe(0);
    expect(usage?.minutesRemaining).toBe(60);
  });

  it('catches a dormant account up in one step', async () => {
    // Eight months idle must not need eight visits to become usable again.
    const id = await user('starter', { used: 60 });
    const usage = await usageFor(id, new Date(JAN.getTime() + 245 * DAY));
    expect(usage?.minutesUsed).toBe(0);
    // Forward by whole periods, so the billing day stays the billing day.
    const months = Math.floor(245 / 30);
    expect(usage?.periodStart.toISOString()).toBe(
      new Date(JAN.getTime() + months * 30 * DAY).toISOString(),
    );
  });

  it('persists the roll rather than recomputing it every read', async () => {
    const id = await user('starter', { used: 55 });
    await usageFor(id, new Date(JAN.getTime() + 31 * DAY));
    const row = await db.user.findUnique({ where: { id } });
    expect(row?.minutesUsed).toBe(0);
  });
});

describe('the allowance', () => {
  it('lets a job through when it fits', async () => {
    const id = await user('starter', { used: 10 });
    expect((await checkQuota(id, 20, JAN)).ok).toBe(true);
  });

  it('refuses one that does not, and says when it resets', async () => {
    const id = await user('starter', { used: 50 });
    const verdict = await checkQuota(id, 20, JAN);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('10 minutes of footage left');
    expect(verdict.reason).toMatch(/resets on 31 January/);
  });

  it('refuses a single file longer than the per-upload cap first', async () => {
    // Starter allows 60 minutes a month but only 30 in one go. A 45-minute file
    // fits the allowance and must still be refused — with the right reason.
    const id = await user('starter');
    const verdict = await checkQuota(id, 45, JAN);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('in one go');
  });

  it('counts jobs already in flight', async () => {
    const id = await user('starter');
    const project = await db.project.create({ data: { userId: id, mode: 'short' } });
    await db.job.create({ data: { projectId: project.id, type: 'pipeline', status: 'running' } });

    const verdict = await checkQuota(id, 5, JAN);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/already being made/i);
  });

  it('lets a bigger plan run several at once', async () => {
    const id = await user('creator');
    const project = await db.project.create({ data: { userId: id, mode: 'short' } });
    await db.job.create({ data: { projectId: project.id, type: 'pipeline', status: 'running' } });
    expect((await checkQuota(id, 5, JAN)).ok).toBe(true);
  });

  it('meters nothing when there are no accounts to meter', async () => {
    // A self-hosted clone with no auth is not a tenant of ours.
    expect((await checkQuota(null, 9999, JAN)).ok).toBe(true);
  });

  it('does not lock out an account whose row predates plans', async () => {
    const id = await user('');
    const verdict = await checkQuota(id, 5, JAN);
    expect(verdict.usage?.plan.id).toBe('free');
    expect(verdict.ok).toBe(true);
  });
});

describe('recording usage', () => {
  it('adds what the server measured', async () => {
    const id = await user('starter', { used: 10 });
    await recordUsage(id, 12.5);
    expect((await usageFor(id, JAN))?.minutesUsed).toBe(22.5);
  });

  it('ignores a zero or negative duration rather than corrupting the meter', async () => {
    const id = await user('starter', { used: 10 });
    await recordUsage(id, 0);
    await recordUsage(id, -5);
    expect((await usageFor(id, JAN))?.minutesUsed).toBe(10);
  });

  it('is a no-op with no user', async () => {
    await expect(recordUsage(null, 30)).resolves.toBeUndefined();
  });
});

describe('formatMinutes', () => {
  it('reads like a person wrote it', () => {
    expect(formatMinutes(1)).toBe('1 minute');
    expect(formatMinutes(45)).toBe('45 minutes');
    expect(formatMinutes(60)).toBe('1 hour');
    expect(formatMinutes(90)).toBe('1 hour 30 min');
    expect(formatMinutes(500)).toBe('8 hours 20 min');
  });

  it('never shows a negative', () => {
    expect(formatMinutes(-5)).toBe('0 minutes');
  });
});
