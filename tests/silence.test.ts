import { describe, expect, it } from 'vitest';
import {
  detectRemovableSilence,
  invertIntervals,
  mergeIntervals,
  SILENCE_PRESETS,
  subtractIntervals,
} from '@/lib/timeline/silence';
import { deriveSentences, type Transcript, type TranscriptWord } from '@/lib/transcribe/types';

function word(text: string, startSec: number, endSec: number): TranscriptWord {
  return { text, startSec, endSec, confidence: 1, speaker: 0, isFiller: false, endsSentence: /[.!?]$/.test(text) };
}

function transcriptOf(words: TranscriptWord[], durationSec: number): Transcript {
  return {
    provider: 'test',
    language: 'en',
    durationSec,
    text: words.map((w) => w.text).join(' '),
    words,
    sentences: deriveSentences(words),
  };
}

describe('silence detection', () => {
  const words = [
    word('Hello', 1.0, 1.4),
    word('there.', 1.4, 1.9),
    // A three-second hole.
    word('Now', 4.9, 5.2),
    word('listen.', 5.2, 5.8),
  ];
  const transcript = transcriptOf(words, 8);

  it('finds the head, the gap and the tail', () => {
    const acoustic = [
      { startSec: 0, endSec: 1 },
      { startSec: 1.9, endSec: 4.9 },
      { startSec: 5.8, endSec: 8 },
    ];
    const removals = detectRemovableSilence(transcript, acoustic, SILENCE_PRESETS.balanced);
    expect(removals).toHaveLength(3);
    // Padding leaves a breath on each side of the middle gap.
    expect(removals[1].startSec).toBeCloseTo(1.9 + 0.11, 5);
    expect(removals[1].endSec).toBeCloseTo(4.9 - 0.11, 5);
  });

  it('refuses to cut a gap that contains sound', () => {
    // The gap is real in the transcript, but something audible happens in it —
    // a laugh, a prop, a beat. Cutting it would butcher the delivery.
    const acoustic = [{ startSec: 1.9, endSec: 2.2 }];
    const removals = detectRemovableSilence(transcript, acoustic, SILENCE_PRESETS.balanced);
    expect(removals.some((r) => r.startSec > 1.8 && r.endSec < 5)).toBe(false);
  });

  it('cuts far less in micro mode, for footage the user already edited', () => {
    const acoustic = [{ startSec: 1.9, endSec: 4.9 }];
    const balanced = detectRemovableSilence(transcript, acoustic, SILENCE_PRESETS.balanced);
    const micro = detectRemovableSilence(transcript, acoustic, SILENCE_PRESETS.micro);
    const total = (list: typeof micro) => list.reduce((s, i) => s + (i.endSec - i.startSec), 0);
    expect(total(micro)).toBeLessThan(total(balanced));
  });
});

describe('interval algebra', () => {
  it('merges overlapping and touching intervals', () => {
    expect(
      mergeIntervals([
        { startSec: 0, endSec: 2 },
        { startSec: 1.5, endSec: 3 },
        { startSec: 5, endSec: 6 },
      ]),
    ).toEqual([
      { startSec: 0, endSec: 3 },
      { startSec: 5, endSec: 6 },
    ]);
  });

  it('inverts removals into keeps', () => {
    expect(invertIntervals([{ startSec: 2, endSec: 4 }], 10)).toEqual([
      { startSec: 0, endSec: 2 },
      { startSec: 4, endSec: 10 },
    ]);
  });

  it('subtracts a span from the middle of a range, splitting it', () => {
    expect(subtractIntervals([{ startSec: 0, endSec: 10 }], [{ startSec: 4, endSec: 6 }])).toEqual([
      { startSec: 0, endSec: 4 },
      { startSec: 6, endSec: 10 },
    ]);
  });

  it('keeps everything when there is nothing to remove', () => {
    expect(invertIntervals([], 5)).toEqual([{ startSec: 0, endSec: 5 }]);
  });
});

/**
 * The three pauses a real 40-second take hid from the old detector.
 *
 * Every number here was measured off `out/user/IMG_4836.MOV`, and the point of
 * the file is that the transcript could not see any of them: the ASR runs its
 * word boundaries into the silence, so the GAP is a fraction of the pause and
 * in the worst case there is no gap at all.
 */
describe('the pauses the transcript cannot see', () => {
  const PRESET = SILENCE_PRESETS.aggressive;

  function cut(words: TranscriptWord[], acoustic: { startSec: number; endSec: number }[], durationSec: number) {
    return detectRemovableSilence(transcriptOf(words, durationSec), acoustic, PRESET);
  }

  it('cuts a pause whose transcript gap is too short to qualify', () => {
    // "not…" is timed to 3.92; the last audible sound is at 3.65. The gap is
    // 0.16s, under the 0.22s floor, and the pause is 0.57s.
    const words = [word('but', 3.2, 3.36), word('not...', 3.36, 3.92), word('Because', 4.08, 4.48)];
    const [removal] = cut(words, [{ startSec: 3.65, endSec: 4.21 }], 5);
    // Into "not…"'s tail only as far as a three-letter word can spare, and
    // not one frame into "Because"'s onset.
    expect(removal.startSec).toBeCloseTo(3.765, 2);
    expect(removal.endSec).toBeCloseTo(4.03, 2);
    expect(removal.endSec).toBeLessThanOrEqual(4.08);
  });

  it('never takes a word\u2019s onset, however much the word can spare', () => {
    // "So" is credited 0.8s for two letters, so it has time to spare — but
    // the spare is at the far end. Clipping an onset turns "So" into "o";
    // clipping a tail removes sound that has already decayed.
    const words = [word('really...', 23.16, 23.8), word('So', 24.29, 25.09), word('yes.', 25.09, 25.5)];
    const [removal] = cut(words, [{ startSec: 23.86, endSec: 24.46 }], 26);
    expect(removal.endSec).toBeLessThanOrEqual(24.29);
  });

  it('takes a pause out of a word the ASR over-credited', () => {
    // 0.64s for "and" is a word with a pause welded onto it. The pause is
    // cuttable; the 0.36s the word could plausibly have taken is not.
    const words = [word('it', 33.51, 33.75), word('and', 33.75, 34.39), word('it', 34.47, 34.63)];
    const [removal] = cut(words, [{ startSec: 34.15, endSec: 34.4 }], 36);
    expect(removal).toBeDefined();
    expect(removal.startSec).toBeGreaterThanOrEqual(34.15);
  });

  it('leaves a pause alone when the word it sits in could have taken that long', () => {
    // Same shape, but 0.4s of silence inside a five-letter word: either the
    // detector is wrong or the word is, and nothing is cut on a guess.
    const words = [word('it', 1.0, 1.2), word('speak', 1.2, 1.75), word('it', 1.8, 2.0)];
    expect(cut(words, [{ startSec: 1.3, endSec: 1.7 }], 2.2)).toEqual([]);
  });

  it('cuts a pause that sits inside a single word', () => {
    // One word, "and", given a 0.64s span because the speaker paused halfway
    // through saying it. There is no gap here at all.
    const words = [word('it', 33.51, 33.75), word('and', 33.75, 34.39), word('it', 34.47, 34.63)];
    const [removal] = cut(words, [{ startSec: 34.15, endSec: 34.4 }], 36);
    expect(removal.startSec).toBeCloseTo(34.2, 2);
    expect(removal.endSec).toBeCloseTo(34.35, 2);
  });

  it('never proposes a cut that would delete a word', () => {
    // ffmpeg says silent, the ASR says there is a word in the middle of it.
    // On a disagreement nothing is cut: a dropped word is a worse edit than a
    // kept pause, and `wordsOutsideRemovals` judges by the same midpoint.
    const words = [word('one', 1, 1.3), word('quiet', 2, 2.6), word('three', 3.4, 3.8)];
    const removals = cut(words, [{ startSec: 1.4, endSec: 3.3 }], 5);
    // The tail after "three" is still fair game; the disputed stretch is not.
    expect(removals.filter((r) => r.startSec < 3.8)).toEqual([]);
  });

  it('cuts a trailing pause all the way to the end of the file', () => {
    // `silencedetect` never closes an interval that runs to EOF, so the tail
    // is the one stretch that stays transcript-driven — and it gets no
    // padding at the far end, because there is nothing after it to breathe.
    const words = [word('done.', 1, 1.5)];
    const [, tail] = cut(words, [{ startSec: 0, endSec: 1 }], 4);
    expect(tail.startSec).toBeCloseTo(1.55, 2);
    expect(tail.endSec).toBeCloseTo(4, 2);
  });

  it('still cuts on the transcript alone when there is no acoustic data', () => {
    const words = [word('Hello', 1, 1.4), word('again.', 4, 4.5)];
    const [head, gap] = cut(words, [], 5);
    expect(head.startSec).toBeCloseTo(0.05, 2);
    expect(gap.startSec).toBeCloseTo(1.45, 2);
    expect(gap.endSec).toBeCloseTo(3.95, 2);
  });

  it('leaves a laugh alone, because a laugh is not silent', () => {
    const words = [word('Hello', 1, 1.4), word('again.', 4, 4.5)];
    // A 2.6s hole between the words, of which only the first 0.2s is silent.
    // The old detector asked whether 60% of the GAP was quiet and cut the
    // whole thing when it was; this one cuts the quiet part and only if there
    // is enough of it. 0.2s does not clear the 0.22s floor, so nothing goes.
    const removals = cut(words, [{ startSec: 1.4, endSec: 1.6 }], 5);
    expect(removals.filter((r) => r.startSec < 4.5)).toEqual([]);
  });
});
