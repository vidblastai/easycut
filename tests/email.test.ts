import { describe, expect, it } from 'vitest';
import { readyMail } from '@/lib/email';

const base = {
  to: 'someone@example.com',
  name: 'Carl',
  projectTitle: 'Most people get pricing backwards',
  projectUrl: 'https://easycut.ai/projects/abc-123',
  mode: 'short' as const,
  durationSec: 74,
  cuts: 2,
  captions: 13,
  brollCount: 1,
  expiresAt: new Date('2026-10-17T00:00:00Z'),
  sourceExpiresAt: new Date('2026-09-24T00:00:00Z'),
};

describe('the ready email', () => {
  it('leads with the video, not with us', () => {
    const mail = readyMail(base);
    expect(mail.subject).toBe('Most people get pricing backwards is ready');
    expect(mail.html).toContain('Carl, your short is ready.');
  });

  it('always carries a text part', () => {
    // A mail with no plain-text alternative is a mail that scores as spam.
    const mail = readyMail(base);
    expect(mail.text.length).toBeGreaterThan(40);
    expect(mail.text).toContain(base.projectUrl);
  });

  it('links straight to the video', () => {
    expect(readyMail(base).html).toContain(`href="${base.projectUrl}"`);
  });

  it('says what was done in one line', () => {
    const html = readyMail(base).html;
    expect(html).toContain('2 cuts');
    expect(html).toContain('13 caption cards');
    expect(html).toContain('1 B-roll insert');
  });

  it('leaves out the layers that were not used', () => {
    const html = readyMail({ ...base, brollCount: 0, captions: 0 }).html;
    expect(html).not.toContain('B-roll');
    expect(html).not.toContain('caption card');
  });

  it('gets the singulars right', () => {
    const html = readyMail({ ...base, cuts: 1, captions: 1, brollCount: 1 }).html;
    expect(html).toContain('1 cut ');
    expect(html).toContain('1 caption card');
    expect(html).not.toContain('1 cuts');
  });

  it('tells them when it will be deleted', () => {
    expect(readyMail(base).html).toContain('17 October 2026');
    expect(readyMail(base).html).toContain('24 September 2026');
  });

  it('and says so differently when it is kept indefinitely', () => {
    const html = readyMail({ ...base, expiresAt: null }).html;
    expect(html).toMatch(/as long as you.{0,3}re subscribed/i);
  });

  it('survives a missing name without greeting nobody', () => {
    const mail = readyMail({ ...base, name: null });
    expect(mail.html).toContain('Your short is ready.');
    expect(mail.html).not.toContain('null');
  });

  it('escapes the title, which comes from speech recognition', () => {
    // The title is generated from what somebody said, so it is user content
    // and an injected tag would run in whatever renders this.
    const mail = readyMail({ ...base, projectTitle: '<script>alert(1)</script> & "quotes"' });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('&amp;');
  });

  it('calls a long-form video what it is', () => {
    expect(readyMail({ ...base, mode: 'long' }).html).toContain('long-form video is ready');
  });

  it('formats the length as a clock, not as seconds', () => {
    expect(readyMail(base).html).toContain('1:14');
    expect(readyMail({ ...base, durationSec: 42 }).html).toContain('42s');
  });
});
