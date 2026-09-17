import { db } from '@/lib/db';
import { getPlan, type Plan } from './plans';

/**
 * The meter.
 *
 * One number per account — minutes of footage used this period — and one rule
 * for when that number goes back to zero.
 *
 * ── Why the period rolls lazily ──────────────────────────────────────────
 *
 * There is no cron resetting everybody at midnight. The period is a date on the
 * row, and the first thing that reads it after it has expired moves it forward
 * and zeroes the counter. That means no scheduled job to forget to deploy, no
 * thundering herd at 00:00, and no window where two workers disagree about
 * which month it is. It also means a dormant account costs nothing to keep
 * metered: its period simply catches up whenever it wakes.
 *
 * ── Why the check happens twice ──────────────────────────────────────────
 *
 * The browser knows how long the footage is before it uploads it — it probes
 * the file to work out short vs long form anyway — so the wizard can refuse a
 * job that will not fit BEFORE a gigabyte goes over the wire. That figure is
 * a claim from a client, though, so it is re-checked against ffprobe's answer
 * when the pipeline ingests the file, and the meter is only advanced by the
 * number the server measured.
 */

export interface Usage {
  plan: Plan;
  minutesUsed: number;
  minutesRemaining: number;
  periodStart: Date;
  periodEnd: Date;
}

const MONTH_MS = 30 * 86_400_000;

/** How many whole periods have elapsed, so a dormant account catches up at once. */
function periodsElapsed(start: Date, now: Date): number {
  return Math.floor((now.getTime() - start.getTime()) / MONTH_MS);
}

/**
 * Reads the meter, rolling the period forward first if it has run out.
 *
 * Safe to call on every request: it only writes when the period has actually
 * expired, which is once a month per account.
 */
export async function usageFor(userId: string, now = new Date()): Promise<Usage | null> {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { plan: true, periodStart: true, minutesUsed: true },
  });
  if (!row) return null;

  const plan = getPlan(row.plan);
  let periodStart = row.periodStart;
  let minutesUsed = row.minutesUsed;

  const elapsed = periodsElapsed(periodStart, now);
  if (elapsed >= 1) {
    // Forward by whole periods rather than to `now`, so the billing day stays
    // the billing day however long the account was idle.
    periodStart = new Date(periodStart.getTime() + elapsed * MONTH_MS);
    minutesUsed = 0;
    await db.user.update({ where: { id: userId }, data: { periodStart, minutesUsed } });
  }

  return {
    plan,
    minutesUsed,
    minutesRemaining: Math.max(0, plan.footageMinutes - minutesUsed),
    periodStart,
    periodEnd: new Date(periodStart.getTime() + MONTH_MS),
  };
}

export interface QuotaVerdict {
  ok: boolean;
  /** Why not, in words a person can act on. Empty when ok. */
  reason: string;
  usage: Usage | null;
}

/**
 * May this account start a job on this much footage?
 *
 * Three separate refusals, because they need three different answers: too long
 * a single file is a "split it up", an exhausted allowance is an "upgrade or
 * wait until the 4th", and too many jobs at once is a "hang on a minute".
 */
export async function checkQuota(
  userId: string | null,
  minutes: number,
  now = new Date(),
): Promise<QuotaVerdict> {
  // No auth configured means no accounts to meter. A self-hosted clone is not
  // a tenant of ours and metering it would be nonsense.
  if (!userId) return { ok: true, reason: '', usage: null };

  const usage = await usageFor(userId, now);
  if (!usage) return { ok: true, reason: '', usage: null };
  const { plan } = usage;

  if (minutes > plan.maxMinutesPerUpload) {
    return {
      ok: false,
      usage,
      reason:
        `That file is ${formatMinutes(minutes)} long. ${plan.name} takes up to ` +
        `${formatMinutes(plan.maxMinutesPerUpload)} in one go — split it, or move up a plan.`,
    };
  }

  if (minutes > usage.minutesRemaining) {
    const used = formatMinutes(usage.minutesUsed);
    const total = formatMinutes(plan.footageMinutes);
    return {
      ok: false,
      usage,
      reason:
        `You have ${formatMinutes(usage.minutesRemaining)} of footage left this month ` +
        `(${used} of ${total} used), and this file is ${formatMinutes(minutes)}. ` +
        `Your allowance resets on ${usage.periodEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.`,
    };
  }

  const running = await db.job.count({
    where: { status: { in: ['queued', 'running'] }, project: { userId } },
  });
  if (running >= plan.concurrentJobs) {
    return {
      ok: false,
      usage,
      reason:
        plan.concurrentJobs === 1
          ? 'One video is already being made. It will be ready shortly — then start the next one.'
          : `${plan.name} runs ${plan.concurrentJobs} videos at once, and all ${plan.concurrentJobs} are busy.`,
    };
  }

  return { ok: true, reason: '', usage };
}

/**
 * Advances the meter by what the server actually measured.
 *
 * Called once, from the pipeline, with ffprobe's duration rather than the
 * browser's — the browser's figure is good enough to refuse an upload early,
 * not good enough to bill against.
 */
export async function recordUsage(userId: string | null, minutes: number): Promise<void> {
  if (!userId || !(minutes > 0)) return;
  await db.user.update({
    where: { id: userId },
    data: { minutesUsed: { increment: minutes } },
  });
}

/** "90 minutes" is worse than "1 hour 30" for anything over an hour. */
export function formatMinutes(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  if (whole < 60) return `${whole} minute${whole === 1 ? '' : 's'}`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  const h = `${hours} hour${hours === 1 ? '' : 's'}`;
  return rest ? `${h} ${rest} min` : h;
}
