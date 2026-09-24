import { env } from '@/lib/config/env';
import { fingerprint } from './fingerprint';
import { stackFrames } from './frames';
import { redact, redactContext } from './redact';
import { sendToSentry } from './sentry';
import { sendToWebhook } from './webhook';

/**
 * Telling somebody when this breaks.
 *
 * ── The problem ──────────────────────────────────────────────────────────
 *
 * A render fails at 2am. The customer sees "something went wrong", the worker
 * writes one line to a log nobody is tailing, and the first anybody hears of
 * it is a refund request three days later. Every other part of this product
 * degrades honestly when a provider is missing; failure itself was the one
 * thing that stayed silent.
 *
 * ── The shape of the answer ──────────────────────────────────────────────
 *
 * `reportError()` is the single way anything in this codebase says "this
 * broke". It fans out to whichever sinks are configured — always the console,
 * plus a webhook and/or Sentry if the environment has them — and it is
 * deliberately built so that adding a sink later changes nothing at a call
 * site.
 *
 * Three rules it must never break, in order of importance:
 *
 * 1. **It cannot throw.** Reporting a failure must never become a failure.
 *    Every sink is wrapped, every await is guarded, and the function returns
 *    a result rather than rejecting. If the alerting is broken, the render
 *    still finishes.
 *
 * 2. **It cannot flood.** One broken bucket fails every job in the queue
 *    within a minute. Identical failures are folded together by fingerprint
 *    (see `fingerprint.ts`) and a repeat inside the cooldown increments a
 *    counter instead of sending; the next send says how many there were. A
 *    channel that cries wolf four hundred times gets muted, and then the
 *    alerting is worse than none.
 *
 * 3. **It cannot leak.** Everything that goes out is scrubbed by
 *    `redact.ts` — keys, signed URLs, tokens, email addresses. This is the
 *    one place the product talks to a third party with no human in the loop.
 *
 * ── Without any keys ─────────────────────────────────────────────────────
 *
 * The console sink is always on, and it is the reason this is worth having
 * even unconfigured: failures get a consistent, greppable, deduplicated shape
 * instead of nine different `console.error` spellings.
 */

/** How bad it is. `fatal` means the process is going down. */
export type Severity = 'warning' | 'error' | 'fatal';

export interface ErrorContext {
  /** Where it happened: `worker.pipeline`, `api.render`, `billing.webhook`. */
  where: string;
  severity?: Severity;
  /** Anything that helps diagnose it. Redacted before it is sent. */
  [key: string]: unknown;
}

export interface ReportResult {
  /** The grouping id, also printed to the console so logs and alerts match up. */
  fingerprint: string;
  /** False when this was folded into an existing alert rather than sent. */
  alerted: boolean;
  /** Which sinks accepted it. */
  sinks: string[];
  /** Occurrences of this fingerprint since the last alert, including this one. */
  occurrences: number;
}

/* ─────────────────────────────────────────────────── the flood guard ─── */

interface Seen {
  count: number;
  lastAlertAt: number;
  firstSeenAt: number;
}

/**
 * In-process, on purpose.
 *
 * A shared counter across workers would need Redis, and Redis is optional
 * here. Per-process throttling with three workers means at worst three copies
 * of an alert instead of four hundred, which is the difference that matters;
 * a shared one would be a better answer to a problem nobody has yet.
 */
const seen = new Map<string, Seen>();

/** Bounded so a long-running worker with many distinct failures cannot grow. */
const MAX_TRACKED = 500;

/** Alerts sent in the current window, for the global ceiling. */
let windowStartedAt = Date.now();
let windowCount = 0;
let windowSuppressed = 0;

function cooldownMs(): number {
  return Math.max(1, env.errors.cooldownMinutes) * 60_000;
}

/**
 * Decides whether this occurrence earns an alert.
 *
 * Returns the number of occurrences it stands for — 1 for a first sighting,
 * N for "it has happened N times since I last told you" — or `null` to stay
 * quiet.
 */
function claimAlert(id: string, now: number): number | null {
  // The global ceiling, checked first: a storm of DISTINCT failures floods
  // just as effectively as a storm of identical ones, and the per-fingerprint
  // guard cannot see it.
  if (now - windowStartedAt > 60 * 60_000) {
    windowStartedAt = now;
    windowCount = 0;
    windowSuppressed = 0;
  }

  const record = seen.get(id);

  if (!record) {
    if (seen.size >= MAX_TRACKED) {
      // Drop the oldest. Map preserves insertion order, so the first key is it.
      const oldest = seen.keys().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    if (windowCount >= env.errors.maxPerHour) {
      windowSuppressed++;
      seen.set(id, { count: 1, lastAlertAt: 0, firstSeenAt: now });
      return null;
    }
    seen.set(id, { count: 1, lastAlertAt: now, firstSeenAt: now });
    windowCount++;
    return 1;
  }

  record.count++;
  if (now - record.lastAlertAt < cooldownMs()) return null;
  if (windowCount >= env.errors.maxPerHour) {
    windowSuppressed++;
    return null;
  }

  const stood = record.count;
  record.count = 0;
  record.lastAlertAt = now;
  windowCount++;
  return stood;
}

/** Test seam: the throttle is module state, and a test needs it back. */
export function resetErrorThrottle(): void {
  seen.clear();
  windowStartedAt = Date.now();
  windowCount = 0;
  windowSuppressed = 0;
}

/** How many alerts the ceiling has swallowed this hour. Surfaced in `/health`. */
export function suppressedThisHour(): number {
  return windowSuppressed;
}

/* ──────────────────────────────────────────────────────── reporting ─── */

/** The normalised, scrubbed thing every sink receives. */
export interface ReportedEvent {
  fingerprint: string;
  name: string;
  message: string;
  stack?: string;
  where: string;
  severity: Severity;
  occurrences: number;
  context: Record<string, unknown>;
  at: Date;
}

/**
 * One line, however the message arrived.
 *
 * Some errors carry a whole pretty-printed JSON document as their `message` —
 * Zod is the one that turned up here, and a validation failure in an API route
 * is among the likeliest things this will ever report. Left alone, the alert's
 * headline becomes `[` and its second line `{`, which tells a person at 2am
 * nothing at all.
 *
 * So whitespace is collapsed and the message is capped. Nothing is lost that
 * matters: the console keeps the original, and the whole point of the headline
 * is to be readable on a phone.
 */
function oneLine(message: string): string {
  const flat = message.replace(/\s+/g, ' ').trim();
  return flat.length > 400 ? `${flat.slice(0, 400)}…` : flat;
}

function toError(thrown: unknown): { name: string; message: string; stack?: string } {
  if (thrown instanceof Error) {
    return { name: thrown.name || 'Error', message: oneLine(thrown.message), stack: thrown.stack };
  }
  // A thrown string, a rejected object, an undefined from a bad await. Worth
  // reporting rather than dropping — those are usually the interesting bugs.
  return {
    name: 'Thrown',
    message: oneLine(typeof thrown === 'string' ? thrown : JSON.stringify(thrown) ?? String(thrown)),
  };
}

/**
 * Report a failure. Never throws, never rejects.
 *
 * Await it where you can, and do not where the caller is latency-sensitive —
 * every sink already has its own timeout, so a forgotten await leaks nothing.
 */
export async function reportError(thrown: unknown, context: ErrorContext): Promise<ReportResult> {
  const { where, severity = 'error', ...extra } = context;

  try {
    const base = toError(thrown);
    const id = fingerprint({ name: base.name, message: base.message, where });
    const occurrences = claimAlert(id, Date.now());

    const event: ReportedEvent = {
      fingerprint: id,
      name: base.name,
      message: redact(base.message),
      stack: base.stack ? redact(base.stack) : undefined,
      where,
      severity,
      occurrences: occurrences ?? 0,
      context: redactContext(extra) as Record<string, unknown>,
      at: new Date(),
    };

    // The console always gets it, alert or not: the log is the record, the
    // alert is the interruption, and folding a repeat out of the LOG would
    // hide the very thing that shows a failure is in a loop.
    logToConsole(event, occurrences !== null);

    if (occurrences === null) {
      return { fingerprint: id, alerted: false, sinks: [], occurrences: 0 };
    }

    const accepted = await Promise.all([
      sendToWebhook(event).then((ok): string | null => (ok ? 'webhook' : null)),
      sendToSentry(event).then((ok): string | null => (ok ? 'sentry' : null)),
    ]);

    return {
      fingerprint: id,
      alerted: true,
      sinks: accepted.filter((s): s is string => s !== null),
      occurrences,
    };
  } catch (selfInflicted) {
    // Rule 1. Whatever just went wrong in here, the caller's failure is the
    // important one and the caller must not learn about this.
    console.error('[errors] reporter itself failed:', (selfInflicted as Error)?.message);
    return { fingerprint: 'unreported', alerted: false, sinks: [], occurrences: 0 };
  }
}

/** One line, in a shape that greps: `[!] where fingerprint — message`. */
function logToConsole(event: ReportedEvent, alerted: boolean): void {
  const mark = event.severity === 'warning' ? '[warn]' : event.severity === 'fatal' ? '[FATAL]' : '[error]';
  const repeat = !alerted ? ' (repeat, alert suppressed)' : event.occurrences > 1 ? ` (×${event.occurrences} since last alert)` : '';
  const keys = Object.entries(event.context)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' ');

  const line = `${mark} ${event.where} ${event.fingerprint} — ${event.name}: ${event.message}${repeat}${keys ? ` | ${keys}` : ''}`;
  if (event.severity === 'warning') console.warn(line);
  else console.error(line);

  // The stack only on a first sighting: by the third repeat it is noise, and
  // the fingerprint on every line is enough to find the first one.
  if (alerted && event.severity !== 'warning') {
    const frames = stackFrames(event.stack, 5);
    if (frames.length) console.error(frames.map((f) => `    ${f}`).join('\n'));
  }
}

/** Whether anything beyond the console is listening. Read by `capabilities()`. */
export function alertingConfigured(): boolean {
  return Boolean(env.errors.webhookUrl || env.errors.sentryDsn);
}
