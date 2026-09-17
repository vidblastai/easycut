import { env } from '@/lib/config/env';

/**
 * Transactional email.
 *
 * One message matters: your video is ready. Long-form takes about five minutes
 * and the whole promise of this product is that you do not sit and watch it
 * happen — so the tab gets closed, and without an email the work finishes into
 * an empty room.
 *
 * ── Why it degrades instead of failing ───────────────────────────────────
 *
 * With no `RESEND_API_KEY` the sender logs what it would have sent and reports
 * success. That is deliberate: a clone with no email provider must still render
 * videos, and a render that succeeds must never be marked failed because a
 * notification did not go out. Email is the last thing that happens and the
 * least important thing that happens.
 */

export interface Mail {
  to: string;
  subject: string;
  /** Rendered HTML body. */
  html: string;
  /** Plain-text alternative. Not optional — a mail with no text part is spam. */
  text: string;
}

export interface SendResult {
  sent: boolean;
  /** Why not, when `sent` is false. Empty on success. */
  reason: string;
}

export async function sendMail(mail: Mail): Promise<SendResult> {
  if (!env.email.resendKey) {
    console.log(`[email] would send "${mail.subject}" to ${mail.to} (no RESEND_API_KEY)`);
    return { sent: false, reason: 'no email provider configured' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.email.resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.email.from,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
      // A hung mail provider must not hold a worker thread open indefinitely.
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { sent: false, reason: `${response.status} ${body.slice(0, 200)}` };
    }
    return { sent: true, reason: '' };
  } catch (error) {
    return { sent: false, reason: (error as Error).message };
  }
}

/* ------------------------------------------------------------- the email */

export interface ReadyMailInput {
  to: string;
  /** What to call them. Falls back to nothing rather than "Hi null". */
  name?: string | null;
  projectTitle: string;
  projectUrl: string;
  mode: 'short' | 'long';
  durationSec: number;
  /** Counts for the one line that says what was done. */
  cuts: number;
  captions: number;
  brollCount: number;
  /** When the finished video will be deleted. Null = kept while subscribed. */
  expiresAt: Date | null;
  /** When the footage stops being re-editable. */
  sourceExpiresAt: Date | null;
}

const BRAND = {
  ink: '#0D0D10',
  charcoal: '#19191F',
  line: '#2C2C36',
  violet: '#9B7BFF',
  chalk: '#F5F5F7',
  muted: '#A5A5B3',
} as const;

/**
 * Builds the "ready" email.
 *
 * Table-based and inline-styled, because email clients are not browsers: Gmail
 * strips `<style>` blocks, Outlook renders with Word, and flexbox does not
 * exist in either. Dark by default to match the app, with an explicit light
 * background on the outer table so a client that ignores the colours still
 * produces readable dark-on-light rather than white-on-white.
 */
export function readyMail(input: ReadyMailInput): Mail {
  const greeting = input.name ? `${input.name}, your` : 'Your';
  const length = formatClock(input.durationSec);
  const shape = input.mode === 'short' ? 'short' : 'long-form video';

  const did = [
    input.cuts > 0 ? `${input.cuts} cut${input.cuts === 1 ? '' : 's'}` : '',
    input.captions > 0 ? `${input.captions} caption card${input.captions === 1 ? '' : 's'}` : '',
    input.brollCount > 0 ? `${input.brollCount} B-roll insert${input.brollCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ');

  const keepLine = input.expiresAt
    ? `We'll keep it until ${formatDate(input.expiresAt)}.`
    : `We'll keep it for as long as you're subscribed.`;

  const editLine = input.sourceExpiresAt
    ? `You can re-cut it from your original footage until ${formatDate(input.sourceExpiresAt)}.`
    : '';

  const text = [
    `${greeting} ${shape} is ready.`,
    '',
    `${input.projectTitle} — ${length}${did ? ` — ${did}` : ''}`,
    '',
    `Watch and download it: ${input.projectUrl}`,
    '',
    keepLine,
    editLine,
  ].filter((line) => line !== undefined).join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:${BRAND.ink};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.ink};padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${BRAND.charcoal};border:1px solid ${BRAND.line};border-radius:18px;">
      <tr><td style="padding:28px 28px 0;">
        <p style="margin:0;font:700 17px/1.2 'Plus Jakarta Sans',Helvetica,Arial,sans-serif;color:${BRAND.violet};letter-spacing:-.02em;">EasyCut</p>
      </td></tr>

      <tr><td style="padding:18px 28px 0;">
        <h1 style="margin:0;font:800 26px/1.2 'Plus Jakarta Sans',Helvetica,Arial,sans-serif;color:${BRAND.chalk};letter-spacing:-.03em;">
          ${escapeHtml(greeting)} ${escapeHtml(shape)} is ready.
        </h1>
        <p style="margin:10px 0 0;font:400 14px/1.6 Helvetica,Arial,sans-serif;color:${BRAND.muted};">
          <strong style="color:${BRAND.chalk};">${escapeHtml(input.projectTitle)}</strong> — ${escapeHtml(length)}${did ? ` — ${escapeHtml(did)}` : ''}
        </p>
      </td></tr>

      <tr><td style="padding:24px 28px 0;">
        <a href="${escapeAttr(input.projectUrl)}"
           style="display:inline-block;background:${BRAND.violet};color:${BRAND.ink};text-decoration:none;
                  font:700 15px/1 'Plus Jakarta Sans',Helvetica,Arial,sans-serif;padding:14px 22px;border-radius:12px;">
          Watch it
        </a>
      </td></tr>

      <tr><td style="padding:22px 28px 28px;">
        <p style="margin:0;font:400 12.5px/1.6 Helvetica,Arial,sans-serif;color:${BRAND.muted};">
          ${escapeHtml(keepLine)}${editLine ? `<br>${escapeHtml(editLine)}` : ''}
        </p>
      </td></tr>
    </table>

    <p style="margin:16px 0 0;font:400 11.5px/1.5 Helvetica,Arial,sans-serif;color:#6E6E7C;max-width:520px;">
      You're getting this because you made a video with EasyCut.
    </p>
  </td></tr>
</table>
</body></html>`;

  return {
    to: input.to,
    subject: `${input.projectTitle} is ready`,
    html,
    text,
  };
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return m ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Titles come from ASR, so they are user content and are escaped as such. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
