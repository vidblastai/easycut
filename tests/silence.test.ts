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
