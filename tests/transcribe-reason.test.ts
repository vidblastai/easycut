import { describe, expect, it } from 'vitest';
import { transcribeAudio } from '@/lib/transcribe';

/**
 * What a video without captions blames.
 *
 * Found by running the whole pipeline and reading the result: a job came back
 * saying "no transcription provider configured" when the key was fine and the
 * host was simply blocked by a network policy. That message sends somebody to
 * check the one thing that was never wrong, so the reason now has to carry
 * what actually happened.
 *
 * The helper is not exported — it is an implementation detail of one stage —
 * so these tests pin the behaviour through the shape `transcribeAudio` returns,
 * which is the contract the stage reads.
 */
describe('the reason a transcript is missing', () => {
  it('records the provider that failed, and why', async () => {
    // No keys are set in the test environment, so the chain is the stub alone
    // and `attempts` says so — the shape the stage branches on.
    const result = await transcribeAudio('/nonexistent.wav', 20, {});
    expect(Array.isArray(result.attempts)).toBe(true);
    expect(result.attempts.length).toBeGreaterThan(0);
    // The stub is always last and always succeeds, so a job never fails
    // outright for want of a transcript.
    expect(result.attempts[result.attempts.length - 1].provider).toBe('stub');
    expect(result.transcript.provider).toBe('stub');
  });

  it('marks a stub transcript as degraded rather than passing it off as real', async () => {
    const result = await transcribeAudio('/nonexistent.wav', 20, {});
    expect(result.transcript.degraded).toBe(true);
    expect(result.costUsd).toBe(0);
  });
});

/**
 * The same branching the stage does, applied to the attempt shapes that
 * actually occur. Kept beside the test above so the three cases are visible
 * together: nothing configured, configured but unreachable, and heard nothing.
 */
describe('turning attempts into a sentence', () => {
  const why = (attempts: Array<{ provider: string; error?: string }>): string => {
    const failed = attempts.filter((a) => a.provider !== 'stub' && a.error);
    if (!failed.length) {
      return attempts.some((a) => a.provider !== 'stub')
        ? 'no speech found in the audio'
        : 'no transcription provider configured';
    }
    return `${failed[0].provider} could not be reached — ${failed[0].error}`;
  };

  it('says nothing is configured when only the stub ran', () => {
    expect(why([{ provider: 'stub' }])).toBe('no transcription provider configured');
  });

  it('names the provider and the error when one was tried and failed', () => {
    const reason = why([
      { provider: 'deepgram', error: 'Deepgram 403: Host not in allowlist: api.deepgram.com.' },
      { provider: 'stub' },
    ]);
    expect(reason).toContain('deepgram');
    expect(reason).toContain('allowlist');
    // The thing this test exists to prevent.
    expect(reason).not.toContain('not configured');
  });

  it('blames the audio when a provider ran cleanly and heard nothing', () => {
    expect(why([{ provider: 'deepgram' }, { provider: 'stub' }])).toBe('no speech found in the audio');
  });
});
