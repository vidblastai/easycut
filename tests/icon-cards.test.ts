import { describe, expect, it } from 'vitest';
import { iconCardGeometry, iconRowY } from '../src/lib/edl/types';
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
  const captions = { positionY: 0.74, fontSizeRatio: 0.058, lineHeight: 1.12, maxLines: 2 };

  it('clears the caption block, whatever the preset does with it', () => {
    const y = iconRowY(captions, 1, 1080, 1920);
    const { card } = iconCardGeometry(1, 1080, 1920);
    const rowBottom = y + card / 1920 / 2;
    expect(rowBottom).toBeLessThan(captions.positionY - (2 * 0.058 * 1.12) / 2);
  });

  it('moves up when the captions do', () => {
    const low = iconRowY({ ...captions, positionY: 0.86 }, 1, 1080, 1920);
    const high = iconRowY({ ...captions, positionY: 0.55 }, 1, 1080, 1920);
    expect(high).toBeLessThan(low);
  });

  it('never climbs onto the speaker or falls out of the frame', () => {
    // A preset that puts its captions near the top would otherwise push the
    // row off the top of the picture.
    expect(iconRowY({ ...captions, positionY: 0.2 }, 1, 1080, 1920)).toBeGreaterThanOrEqual(0.24);
    expect(iconRowY({ ...captions, positionY: 0.99 }, 1, 1080, 1920)).toBeLessThanOrEqual(0.62);
  });

  it('allows for a caption block taller than its nominal line height', () => {
    // The browser's line box for a display face is bigger than `lineHeight`
    // says, and a slide-up preset lifts the block as it arrives. Modelling
    // only the nominal height is what put the words through the cards.
    const nominal = captions.positionY - (2 * 0.058 * 1.12) / 2;
    const y = iconRowY(captions, 1, 1080, 1920);
    const { card } = iconCardGeometry(1, 1080, 1920);
    expect(y + card / 1920 / 2).toBeLessThan(nominal - 0.05);
  });
});

describe('card geometry', () => {
  it('sizes off the short edge, so a card is the same object in either format', () => {
    const portrait = iconCardGeometry(1, 1080, 1920);
    const landscape = iconCardGeometry(1, 1920, 1080);
    expect(portrait.card).toBe(landscape.card);
  });

  it('matches the reference: a third of the short edge for one card', () => {
    expect(iconCardGeometry(1, 1080, 1920).card).toBeCloseTo(324, 0);
  });

  it('shrinks as the row fills, so three still fit across', () => {
    const one = iconCardGeometry(1, 1080, 1920);
    const three = iconCardGeometry(3, 1080, 1920);
    expect(three.card).toBeLessThan(one.card);
    expect(3 * three.card + 2 * three.gap).toBeLessThan(1080 * 0.9);
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
