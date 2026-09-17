import { describe, expect, it } from 'vitest';
import { explainFailure } from '@/lib/ui/failure';

describe('explainFailure', () => {
  it('never hands raw machine text back as the headline', () => {
    const raw =
      '/home/user/easycut/node_modules/ffprobe-static/bin/linux/x64/ffprobe exited 1: ' +
      '[mov,mp4,m4a,3gp,3g2,mj2 @ 0x1cb40380] moov atom not found';
    const { headline, advice } = explainFailure(raw);
    expect(headline).not.toContain('ffprobe');
    expect(headline).not.toContain('/home/');
    expect(advice.length).toBeGreaterThan(0);
  });

  it('reads a truncated file as an upload problem, not a footage problem', () => {
    // The distinction that matters: this used to tell people their own video
    // was broken when the upload had cut it in half.
    const { headline, retryable } = explainFailure('moov atom not found');
    expect(headline).toMatch(/read the whole video/i);
    expect(retryable).toBe(true);
  });

  it('keeps a message that already speaks to a person', () => {
    // The pipeline's own wording beats any paraphrase of it, and an earlier
    // version of this file replaced exactly this sentence with something vaguer.
    const own = 'This file has no audio track. EasyCut edits talking-head footage — it needs a voice to work from.';
    const { headline, advice, retryable } = explainFailure(own);
    expect(headline).toBe(own);
    expect(advice).toBe('');
    expect(retryable).toBe(false);
  });

  it('passes our own upload check through as itself', () => {
    const own = 'The upload was cut short — 10,485,760 of 30,695,389 bytes arrived. Please try again.';
    const { headline, retryable } = explainFailure(own);
    expect(headline).toBe(own);
    expect(retryable).toBe(true);
  });

  it('does not mistake machine noise for a sentence', () => {
    for (const raw of [
      '/home/user/easycut/node_modules/ffprobe-static/bin/linux/x64/ffprobe exited 1.',
      '[mov,mp4,m4a,3gp,3g2,mj2 @ 0x1cb40380] moov atom not found.',
      'write ENOSPC: no space left on device.',
      'kaboom',
    ]) {
      expect(explainFailure(raw).headline, raw).not.toBe(raw);
    }
  });

  it('does not offer a retry for something a retry cannot fix', () => {
    expect(explainFailure('Unknown encoder "hevc_videotoolbox"').retryable).toBe(false);
    expect(explainFailure('could not find any stream in the file').retryable).toBe(false);
  });

  it('does offer one for the failures that genuinely pass next time', () => {
    for (const message of [
      'connect ETIMEDOUT 10.0.0.1:443',
      'socket hang up',
      'write ENOSPC: no space left on device',
      'HTTP 429 rate limit exceeded',
    ]) {
      expect(explainFailure(message).retryable, message).toBe(true);
    }
  });

  it('has something to say about a message it has never seen', () => {
    const { headline, advice, retryable } = explainFailure('kaboom');
    expect(headline).toMatch(/something went wrong/i);
    expect(advice).toMatch(/again/i);
    expect(retryable).toBe(true);
  });

  it('survives a missing message', () => {
    expect(() => explainFailure(null)).not.toThrow();
    expect(explainFailure(undefined).headline.length).toBeGreaterThan(0);
  });

  it('checks the specific rules before the catch-all', () => {
    // "fetch failed" also contains "failed"; the connection rule has to win.
    expect(explainFailure('fetch failed').headline).toMatch(/connection dropped/i);
  });
});
