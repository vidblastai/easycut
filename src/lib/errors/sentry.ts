import { env } from '@/lib/config/env';
import type { ReportedEvent } from './report';

/**
 * Sentry, over plain HTTP, with no SDK.
 *
 * ── Why not `@sentry/node` ───────────────────────────────────────────────
 *
 * The SDK is the right choice for a team that wants breadcrumbs, tracing and
 * automatic instrumentation. What this product needs is one JSON document
 * posted per failure, and the SDK's cost for that is a dependency that hooks
 * `http`, `fs` and the module loader in both the worker and every Next.js
 * server bundle — a large surface added to a process whose job is to render
 * video, in exchange for a feature set nothing here asks for.
 *
 * Sentry's ingestion endpoint is a documented HTTP API. An envelope is three
 * newline-separated JSON objects. That is the whole integration, it is a
 * dozen lines, and it cannot slow a render down.
 *
 * The trade is real and worth stating: no automatic breadcrumbs, no release
 * health, no source maps. If this product ever wants those, swap this file
 * for the SDK — nothing outside it knows Sentry exists.
 */

interface Dsn {
  envelopeUrl: string;
  publicKey: string;
}

/**
 * Pulls the pieces out of `https://PUBLIC_KEY@oNNN.ingest.sentry.io/PROJECT_ID`.
 *
 * Returns null rather than throwing on a malformed DSN: a typo in an
 * environment variable must not take down the thing that reports typos.
 */
export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\/+/, '');
    if (!url.username || !projectId) return null;
    return {
      publicKey: url.username,
      envelopeUrl: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
    };
  } catch {
    return null;
  }
}

/** Sentry's own level vocabulary. Ours maps straight onto it. */
function level(severity: ReportedEvent['severity']): string {
  return severity;
}

export async function sendToSentry(event: ReportedEvent): Promise<boolean> {
  const dsn = parseDsn(env.errors.sentryDsn);
  if (!dsn) return false;

  const eventId = randomEventId();
  const sentAt = new Date().toISOString();

  const payload = {
    event_id: eventId,
    timestamp: event.at.getTime() / 1000,
    platform: 'node',
    level: level(event.severity),
    logger: event.where,
    environment: env.nodeEnv,
    server_name: env.errors.serverName,
    /*
     * Our fingerprint, not Sentry's.
     *
     * Sentry groups by stack trace, which splits one failure across every
     * project id that hit it. We have already decided what "the same error"
     * means (see fingerprint.ts) and the two must not disagree, or the
     * cooldown in `report.ts` and the issue list in Sentry tell different
     * stories about the same night.
     */
    fingerprint: [event.fingerprint],
    exception: {
      values: [
        {
          type: event.name,
          value: event.message,
          stacktrace: event.stack ? { frames: parseFrames(event.stack) } : undefined,
        },
      ],
    },
    tags: {
      where: event.where,
      fingerprint: event.fingerprint,
    },
    extra: {
      ...event.context,
      occurrences: event.occurrences,
    },
  };

  const envelope =
    JSON.stringify({ event_id: eventId, sent_at: sentAt, dsn: env.errors.sentryDsn }) +
    '\n' +
    JSON.stringify({ type: 'event' }) +
    '\n' +
    JSON.stringify(payload) +
    '\n';

  try {
    const response = await fetch(dsn.envelopeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': [
          'Sentry sentry_version=7',
          `sentry_client=easycut/1.0`,
          `sentry_key=${dsn.publicKey}`,
        ].join(', '),
      },
      body: envelope,
      // Same reasoning as the webhook: this is the failure path of something
      // that already failed, and it must not hold a worker open.
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      console.warn(`[errors] sentry rejected the event: ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`[errors] sentry unreachable: ${(error as Error).message}`);
    return false;
  }
}

/** 32 lowercase hex characters, which is what Sentry wants for an event id. */
function randomEventId(): string {
  let out = '';
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

/**
 * V8 stack lines into Sentry frames.
 *
 * Sentry draws the trace with the crash at the BOTTOM, which is the opposite
 * of the order V8 prints, so the list is reversed. Getting this wrong shows
 * every issue upside down, which is subtle enough to survive a review and
 * annoying enough to matter at 2am.
 */
interface SentryFrame {
  function: string;
  filename: string;
  lineno: number;
  colno: number;
  in_app: boolean;
}

function parseFrames(stack: string): SentryFrame[] {
  const frames = stack
    .split('\n')
    .slice(1, 30)
    .map((line) => {
      const match = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
      if (!match) return null;
      const [, fn, file, lineNo, col] = match;
      return {
        function: fn ?? '<anonymous>',
        filename: file,
        lineno: Number(lineNo),
        colno: Number(col),
        // Ours versus a dependency's: Sentry dims the ones marked out-of-app,
        // which is most of what makes a long trace readable.
        in_app: !file.includes('node_modules'),
      };
    })
    .filter((f): f is SentryFrame => f !== null);

  return frames.reverse();
}
