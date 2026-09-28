import { describe, expect, it } from 'vitest';
import { iconRowPlacement } from '../src/lib/edl/types';
import { iconMarkup, riseProgress } from '../remotion/components/IconCards';
import { snapToWord } from '../src/lib/edl/builder';
import type { Transcript } from '../src/lib/transcribe/types';

/**
 * The icon that rises on the word.
 *
 * Almost everything about this effect is timing and geometry, and both fail
 * quietly: a card that lands a few frames off the word reads as lag rather
 * than as a bug, and a card that sits a few percent too low reads as a design
 * choice until you notice the captions running through it. So the numbers get
 * tests even though nothing here can throw.
 */

function word(text: string, startSec: number) {
  return { text, startSec, endSec: startSec + 0.3, confidence: 1, speaker: 0, isFiller: false, endsSentence: false };
}

function transcriptOf(...words: Array<ReturnType<typeof word>>): Transcript {
  return {
    provider: 'test',
    language: 'en',
    durationSec: 30,
    text: words.map((w) => w.text).join(' '),
    words,
    sentences: [],
  };
}

describe('the rise', () => {
  it('starts at nothing and finishes exactly at one', () => {
    expect(riseProgress(0, 19)).toBe(0);
    expect(riseProgress(19, 19)).toBe(1);
    expect(riseProgress(40, 19)).toBe(1);
    // Before the card is due, it has not moved — not a negative offset that
    // would park it above where it lands.
    expect(riseProgress(-5, 19)).toBe(0);
  });

  it('decelerates, and never overshoots', () => {
    const steps = Array.from({ length: 19 }, (_, i) => riseProgress(i + 1, 19) - riseProgress(i, 19));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeLessThan(steps[i - 1]);
    }
    // A spring would exceed 1 partway through and settle back. This is the
    // difference between a thing rising into view and a thing landing.
    for (let f = 0; f <= 19; f++) expect(riseProgress(f, 19)).toBeLessThanOrEqual(1);
  });

  it('matches the reference clip frame for frame', () => {
    /*
     * Measured off the reference at 1080x1920, 30fps: the card is 298px tall,
     * travels 602px (2.02 card-heights) and settles over 19 frames. These are
     * its top-edge positions, and they are what the quadratic ease was chosen
     * to reproduce — a cubic misses them by 60px in the middle.
     */
    const REST_TOP = 1318;
    const TRAVEL = 602;
    const reference: Array<[number, number]> = [
      [1, 1865], [6, 1594], [7, 1549], [13, 1368], [16, 1330], [19, 1318],
    ];

    for (const [frame, expected] of reference) {
      const top = REST_TOP + TRAVEL * (1 - riseProgress(frame, 19));
      expect(Math.abs(top - expected)).toBeLessThan(26);
    }
  });
});

describe('where the row sits', () => {
  const captions = {
    positionY: 0.74, fontSizeRatio: 0.058, maxLines: 2, emphasisOwnLine: false, splitLines: false,
  };
  const FRAME = { w: 1080, h: 1920 };

  function band(c: typeof captions, count = 1) {
    const { y, card } = iconRowPlacement(c, count, FRAME.w, FRAME.h);
    return { top: y - card / FRAME.h / 2, bottom: y + card / FRAME.h / 2, y, card };
  }

  it('sits below the captions, not above them', () => {
    // Above is where the room is, and it is the wrong place: in a vertical
    // frame the speaker's face is in the upper half, and that is exactly what
    // the first version put a card on.
    expect(band(captions).top).toBeGreaterThan(captions.positionY);
  });

  it('stays inside the frame', () => {
    expect(band(captions).bottom).toBeLessThanOrEqual(1);
    for (const positionY of [0.5, 0.62, 0.74, 0.8, 0.86]) {
      expect(band({ ...captions, positionY }).bottom).toBeLessThanOrEqual(1.0001);
    }
  });

  it('shrinks the card rather than letting it hang off the bottom', () => {
    // A preset with its words low leaves less room underneath. The card gets
    // smaller; it does not move back up over the face, and it does not
    // overflow.
    const roomy = band({ ...captions, positionY: 0.55 });
    const tight = band({ ...captions, positionY: 0.86 });
    expect(tight.card).toBeLessThan(roomy.card);
    expect(tight.bottom).toBeLessThanOrEqual(1.0001);
  });

  it('never shrinks below the size an icon stops reading at', () => {
    const { card } = iconRowPlacement({ ...captions, positionY: 0.99 }, 1, FRAME.w, FRAME.h);
    expect(card).toBeGreaterThanOrEqual(1080 * 0.15);
  });

  it('allows for the ways a caption block gets taller than its line height', () => {
    // An emphasised word set on its own line adds a line `maxLines` does not
    // count. Ignoring that is what put the first line of the captions through
    // the bottom of the cards.
    const plain = band(captions);
    const ownLine = band({ ...captions, emphasisOwnLine: true });
    expect(ownLine.top).toBeGreaterThan(plain.top);
  });

  it('caps the reference size, and never exceeds it', () => {
    // 0.30 of the short edge is what the reference clip measured. More room
    // does not mean a bigger card.
    const { card } = iconRowPlacement({ ...captions, positionY: 0.3 }, 1, FRAME.w, FRAME.h);
    expect(card).toBeCloseTo(1080 * 0.3, 0);
  });
});

describe('card geometry', () => {
  const captions = {
    positionY: 0.6, fontSizeRatio: 0.05, maxLines: 1, emphasisOwnLine: false, splitLines: false,
  };

  it('sizes off the short edge, so a card is the same object in either format', () => {
    // Not off the width: a third of a 16:9 frame's width is a poster.
    const portrait = iconRowPlacement(captions, 1, 1080, 1920);
    const landscape = iconRowPlacement(captions, 1, 1920, 1080);
    expect(landscape.card).toBeLessThanOrEqual(portrait.card);
    expect(landscape.card).toBeGreaterThan(1080 * 0.14);
  });

  it('keeps three cards inside the frame, across as well as down', () => {
    for (const [w, h] of [[1080, 1920], [1920, 1080], [1080, 1080]] as const) {
      const { card, gap } = iconRowPlacement(captions, 3, w, h);
      expect(3 * card + 2 * gap).toBeLessThanOrEqual(w * 0.87);
    }
  });
});

describe('snapping to the word', () => {
  const transcript = transcriptOf(
    word('the', 1), word('best', 1.3), word('two', 1.6), word('fruits', 1.9),
    word('are', 2.2), word('bananas', 2.5), word('and', 3), word('apples', 3.3),
  );

  it('takes the transcript-s timing over the director-s guess', () => {
    expect(snapToWord(transcript, 'bananas', 2.42)).toBe(2.5);
  });

  it('matches across a plural, in either direction', () => {
    expect(snapToWord(transcript, 'banana', 2.45)).toBe(2.5);
    expect(snapToWord(transcript, 'apples', 3.2)).toBe(3.3);
  });

  it('ignores a match too far away to be the one meant', () => {
    // A common word said six times would otherwise snap to the first one,
    // which is a card in the wrong sentence — worse than the small error it
    // was fixing.
    expect(snapToWord(transcript, 'bananas', 20)).toBe(20);
  });

  it('keeps the guess when the word is not in the transcript at all', () => {
    expect(snapToWord(transcript, 'mango', 2.5)).toBe(2.5);
    expect(snapToWord(transcript, '', 2.5)).toBe(2.5);
  });
});

describe('inlining the icon', () => {
  it('drops the set-s own size so the icon fills its box', () => {
    const out = iconMarkup('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 128 128"><path d="M0 0"/></svg>');
    expect(out).toContain('width="100%"');
    expect(out).toContain('height="100%"');
    expect(out).toContain('viewBox="0 0 128 128"');
    // Exactly one of each: a leftover 200 would win over the container.
    expect(out.match(/width=/g)).toHaveLength(1);
  });

  it('keeps a non-square icon in proportion', () => {
    const out = iconMarkup('<svg viewBox="0 0 64 128"><path d="M0 0"/></svg>');
    expect(out).toContain('preserveAspectRatio="xMidYMid meet"');
  });
});
