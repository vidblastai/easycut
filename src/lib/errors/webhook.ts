import { env } from '@/lib/config/env';
import { stackFrames } from './frames';
import type { ReportedEvent } from './report';

/**
 * The cheapest useful alert: an HTTP POST to a URL you paste in.
 *
 * ── Why a webhook and not just Sentry ────────────────────────────────────
 *
 * Sentry is the right tool for triaging a hundred errors a day. For a product
 * with no customers yet, the thing that actually matters is that a human sees
 * the FIRST failure, and the place a human already looks is Slack or Discord.
 * A webhook is thirty seconds of setup with no account, no SDK and no bundle
 * cost, so it is the one most likely to be switched on — which makes it the
 * one most likely to work at 2am.
 *
 * ── One body, three receivers ────────────────────────────────────────────
 *
 * Slack reads `text`, Discord reads `content`, and both ignore keys they do
 * not recognise. So a single payload carrying `text`, `content` AND the
 * structured fields works against Slack, Discord, and any generic endpoint
 * that wants JSON — with nothing to configure beyond the URL.
 */
export async function sendToWebhook(event: ReportedEvent): Promise<boolean> {
  const url = env.errors.webhookUrl;
  if (!url) return false;

  const summary = format(event);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // For Slack.
        text: summary,
        // For Discord.
        content: summary.slice(0, 1900),
        // For anything that would rather have the pieces.
        event: {
          fingerprint: event.fingerprint,
          severity: event.severity,
          where: event.where,
          name: event.name,
          message: event.message,
          occurrences: event.occurrences,
          context: event.context,
          at: event.at.toISOString(),
          environment: env.nodeEnv,
        },
      }),
      /*
       * Short, and shorter than the mail sender's fifteen seconds.
       *
       * This runs on the failure path of a job that has already failed. A
       * hung alerting endpoint holding a worker thread open would turn a
       * broken render into a stuck queue, which is a far worse outcome than
       * a missed message.
       */
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      console.warn(`[errors] webhook rejected the alert: ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    // Deliberately not reported through `reportError` — an alerting failure
    // that alerts would be a loop.
    console.warn(`[errors] webhook unreachable: ${(error as Error).message}`);
    return false;
  }
}

/**
 * The message a human reads on their phone.
 *
 * Written to be understood without opening anything: what broke, where, how
 * many times, and the one or two facts needed to find it again.
 */
function format(event: ReportedEvent): string {
  const icon = event.severity === 'fatal' ? '🔥' : event.severity === 'warning' ? '⚠️' : '❌';
  const times = event.occurrences > 1 ? ` — ${event.occurrences}× since the last alert` : '';
  const where = env.nodeEnv === 'production' ? event.where : `${event.where} (${env.nodeEnv})`;

  const lines = [
    `${icon} *${event.name}* in \`${where}\`${times}`,
    event.message,
  ];

  const facts = Object.entries(event.context)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .slice(0, 8)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  if (facts.length) lines.push(facts.join(' · '));

  // Two frames. Enough to know which function, short enough to read in a
  // notification — the full trace is in the logs under this fingerprint.
  const frames = stackFrames(event.stack, 2);
  if (frames.length) lines.push('```' + frames.join('\n') + '```');

  lines.push(`id: ${event.fingerprint}`);
  return lines.join('\n');
}
