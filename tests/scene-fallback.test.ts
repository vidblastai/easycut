import { describe, expect, it } from 'vitest';
import { fallbackScene } from '@/lib/edl/scene-fallback';
import { TimeMapper } from '@/lib/timeline/time-mapper';
import type { Transcript } from '@/lib/transcribe/types';

/**
 * The guarantee: a video never leaves the builder without a scene in it.
 *
 * The model's choice is better when it makes one. It does not always make one,
 * and the result of that was several rounds of shipping a talking head with
 * captions on it — which is the video this product exists to replace.
 */
function speak(lines: string[]) {
  let t = 0;
  const words: Transcript['words'] = [];
  const sentences = lines.map((text) => {
    const startSec = t;
    for (const w of text.split(/\s+/)) {
      words.push({ text: w, startSec: t, endSec: t + 0.3, confidence: 1, speaker: 0, isFiller: false, endsSentence: false });
      t += 0.34;
    }
    t += 0.3;
    return { text, startSec, endSec: t, speaker: 0 };
  });
  const segments = [{
    id: 's0', sourceStartSec: 0, sourceEndSec: t, outStartSec: 0, outEndSec: t,
    speed: 1, reason: 'keep' as const, text: '',
  }];
  return {
    transcript: { words, sentences, language: 'en' } as unknown as Transcript,
    mapper: new TimeMapper(segments as never),
    durationSec: t,
  };
}

const run = (lines: string[], broll: never[] = []) => {
  const { transcript, mapper, durationSec } = speak(lines);
  return fallbackScene(transcript, mapper, durationSec, broll, '#9B7BFF');
};

describe('choosing a scene without asking a model', () => {
  it('reads a trailing frame: the things first, the point last', () => {
    const scene = run([
      'This video was entirely edited by AI.',
      'Captions, the b-roll, the effects, everything you see on the screen was done by AI.',
      'It took about a minute.',
      'This is better than what came before.',
    ]);
    expect(scene?.kind).toBe('orbit');
    expect(scene?.items).toEqual(['Captions', 'the b-roll', 'the effects']);
    // Not "Captions" — the title of an orbit is the idea, not its first part.
    expect(scene?.headline).toContain('everything you see');
  });

  it('reads a leading frame welded to the first thing', () => {
    const scene = run([
      'Most people walk past this plant every day.',
      'You can eat the leaves, the stem, and the flowers.',
      'It tastes a bit like spinach.',
    ]);
    expect(scene?.kind).toBe('orbit');
    expect(scene?.items).toEqual(['the leaves', 'the stem', 'the flowers']);
    expect(scene?.headline).toBe('You can eat');
  });

  it('prefers a figure over a plain line', () => {
    const scene = run([
      'I used to do this by hand.',
      'It took me eleven minutes.',
      'Anyway that is the whole thing.',
    ]);
    expect(scene?.kind).toBe('big-number');
    expect(scene?.headline).toMatch(/11|eleven/i);
  });

  it('still finds something in footage with no shape at all', () => {
    // Rambling is the case that used to produce nothing, three times running.
    const scene = run([
      'So yeah I was thinking about it the other day.',
      'And I do not really know where I landed on it.',
      'It is one of those things.',
    ]);
    expect(scene).not.toBeNull();
    expect(scene?.kind).toBe('kinetic-text');
  });

  it('leaves the hook alone', () => {
    const scene = run([
      'Everything you need is in one place.',
      'The editor, the captions, the scheduler, all of it together.',
      'That is the whole pitch.',
    ]);
    expect(scene!.outStartSec).toBeGreaterThanOrEqual(2.5);
  });

  it('does not sit on top of a B-roll insert', () => {
    const { transcript, mapper, durationSec } = speak([
      'Most people walk past this plant every day.',
      'You can eat the leaves, the stem, and the flowers.',
      'It tastes a bit like spinach and it is free.',
    ]);
    const covering = [{ id: 'b', outStartSec: 0, outEndSec: durationSec }] as never;
    expect(fallbackScene(transcript, mapper, durationSec, covering, '#9B7BFF')).toBeNull();
  });

  it('returns nothing when there is no transcript to read', () => {
    const { mapper } = speak(['anything']);
    const empty = { words: [], sentences: [], language: 'en' } as unknown as Transcript;
    expect(fallbackScene(empty, mapper, 30, [], '#9B7BFF')).toBeNull();
  });
});
