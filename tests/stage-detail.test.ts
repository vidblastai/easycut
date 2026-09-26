import { describe, expect, it } from 'vitest';
import { stageDetail } from '@/lib/pipeline/detail';
import type { PipelineContext } from '@/lib/pipeline/types';

/**
 * The line under each finished stage on the progress screen.
 *
 * The rule these all test is the same one: it reports what the stage FOUND,
 * read off the context after it ran. A stage that produced nothing has to say
 * so plainly or say nothing — never invent a figure, because this screen only
 * works if the numbers on it can be believed.
 */

const ctx = (over: Partial<PipelineContext>): PipelineContext =>
  ({ degraded: [], log: [], ledger: { totalUsd: 0 }, ...over }) as unknown as PipelineContext;

describe('what each stage reports', () => {
  it('reads the shape and length off the file it ingested', () => {
    const c = ctx({ media: { width: 1080, height: 1920, durationSec: 47.04, hasAudio: true } as never });
    expect(stageDetail('ingest', c)).toBe('1080×1920 · 47.0s · audio extracted');
  });

  it('says so when the footage had no audio, rather than claiming an extraction', () => {
    const c = ctx({ media: { width: 1920, height: 1080, durationSec: 12, hasAudio: false } as never });
    expect(stageDetail('ingest', c)).toContain('no audio track');
  });

  it('names the transcription provider alongside the word count', () => {
    const c = ctx({ transcript: { words: new Array(118), provider: 'deepgram nova-3' } as never });
    expect(stageDetail('transcribe', c)).toBe('118 words · deepgram nova-3');
  });

  it('admits a missing transcript instead of reporting zero words', () => {
    const c = ctx({ transcript: { words: [], provider: 'none', degraded: true } as never });
    expect(stageDetail('transcribe', c)).toBe('no provider — edited without a transcript');
  });

  it('adds the dead air up rather than counting the gaps alone', () => {
    const c = ctx({
      silenceRemovals: [
        { startSec: 1, endSec: 3.5 },
        { startSec: 10, endSec: 11.8 },
      ] as never,
    });
    expect(stageDetail('silence', c)).toBe('2 gaps · 4.3s of dead air');
  });

  it('says there was nothing to cut rather than "0 gaps"', () => {
    expect(stageDetail('silence', ctx({ silenceRemovals: [] }))).toBe('no dead air worth cutting');
  });

  it('breaks the cleanup down by what kind of thing it removed', () => {
    const c = ctx({
      cleanupFindings: [
        { kind: 'filler' }, { kind: 'filler' }, { kind: 'filler' }, { kind: 'retake' },
      ] as never,
    });
    expect(stageDetail('cleanup', c)).toBe('3 fillers · 1 retake');
  });

  it('counts a single item without an s on it', () => {
    const c = ctx({ silenceRemovals: [{ startSec: 0, endSec: 1 }] as never });
    expect(stageDetail('silence', c)).toBe('1 gap · 1.0s of dead air');
  });

  it('lists only the things the director actually planned', () => {
    const c = ctx({
      plan: { hook: { atSec: 4 }, broll: [1, 2], graphics: [], chapters: [] } as never,
    });
    expect(stageDetail('direct', c)).toBe('hook found · 2 B-roll');
  });

  it('says the footage was kept as filmed when the director added nothing', () => {
    const c = ctx({ plan: { hook: null, broll: [], graphics: [], chapters: [] } as never });
    expect(stageDetail('direct', c)).toBe('kept the footage as filmed');
  });

  it('names how the reframe was derived, not just that one happened', () => {
    const c = ctx({ edl: { reframe: { method: 'face-track', keyframes: new Array(41) } } as never });
    expect(stageDetail('reframe', c)).toBe('subject tracked · 41 keyframes');
  });

  it('says the framing was left alone when there is no reframe track', () => {
    expect(stageDetail('reframe', ctx({ edl: { reframe: null } as never }))).toBe('kept the original framing');
  });

  it('reports the assets that landed on the timeline', () => {
    const c = ctx({ edl: { broll: [1, 2, 3, 4], sfx: [1], music: { url: 'm' } } as never });
    expect(stageDetail('assets', c)).toBe('4 B-roll · 1 sound effect · music bed');
  });

  it('totals the layers and the spend once the edit is assembled', () => {
    const c = ctx({
      ledger: { totalUsd: 0.1234 } as never,
      edl: { captions: new Array(22), broll: new Array(4), graphics: [], punchIns: [], sfx: new Array(3) } as never,
    });
    expect(stageDetail('edl', c)).toBe('29 layers · $0.12 so far');
  });

  it('stays silent for a stage whose work happens elsewhere', () => {
    expect(stageDetail('deliver', ctx({}))).toBe('');
  });

  it('stays silent rather than guessing when the stage left nothing behind', () => {
    expect(stageDetail('ingest', ctx({}))).toBe('');
    expect(stageDetail('transcribe', ctx({}))).toBe('');
    expect(stageDetail('timeline', ctx({}))).toBe('');
  });
});
