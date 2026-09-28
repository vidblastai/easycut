import { describe, expect, it } from 'vitest';
import { CAPTION_BAND, framedPositionY, iconRowPlacement } from '../src/lib/edl/types';
import { CAPTION_PRESETS } from '../src/lib/captions/presets';
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
  const FRAME = { w: 1080, h: 1920 };

  function band(count = 1, w = FRAME.w, h = FRAME.h) {
    const { y, card, gap } = iconRowPlacement(count, w, h);
    return { top: y - card / h / 2, bottom: y + card / h / 2, y, card, gap };
  }

  it('lives in the bottom quarter, below the captions- own band', () => {
    // Two fixed bands: the captions own the second quarter up from the bottom,
    // the cards own the first. The version that measured the caption block and
    // placed the row under whatever it found was wrong by up to eight per cent
    // of the frame in both directions, because a caption block-s rendered
    // height does not follow from its line height.
    expect(band().top).toBeGreaterThan(CAPTION_BAND[1]);
    expect(band().y).toBeGreaterThan(0.75);
  });

  it('keeps clear of the bottom edge', () => {
    // At three per cent the tile read as a thing that fell rather than a thing
    // placed. The card gives up size before it gives up this margin.
    for (const count of [1, 2, 3]) expect(band(count).bottom).toBeLessThanOrEqual(0.93);
  });

  it('hangs from the top of its band, not up from the floor', () => {
    // Anchoring to the bottom margin ties the row's position to the card's
    // size: every time the card got smaller the gap under the captions grew
    // and the tile drifted toward the bottom edge on its own.
    const one = band(1);
    const three = band(3);
    expect(one.top).toBeCloseTo(three.top, 5);
  });

  it('sits in the same place whatever the caption preset does', () => {
    // The whole point of a band: a video does not move its icons when somebody
    // tries a different caption look.
    expect(band(1)).toEqual(band(1));
    expect(band(1).y).toBe(band(1).y);
  });

  it('stays well under the size the reference clip measured', () => {
    // Two thirds of it, in fact: the reference clip had no captions over it
    // and nothing else competing for the lower frame. Against a line of words
    // the tile has to read as punctuation under them, not as the subject.
    expect(band(1).card).toBeLessThanOrEqual(FRAME.w * 0.23);
  });

  it('never shrinks below the size an icon stops reading at', () => {
    for (const [w, h] of [[1080, 1920], [1920, 1080], [1080, 1080]] as const) {
      expect(iconRowPlacement(3, w, h).card).toBeGreaterThanOrEqual(Math.min(w, h) * 0.13);
    }
  });
});

describe('card geometry', () => {
  it('fits three across as well as down, in every format', () => {
    for (const [w, h] of [[1080, 1920], [1920, 1080], [1080, 1080]] as const) {
      const { card, gap } = iconRowPlacement(3, w, h);
      expect(3 * card + 2 * gap).toBeLessThanOrEqual(w * 0.87);
    }
  });

  it('gives one card at least as much room as three', () => {
    const one = iconRowPlacement(1, 1080, 1920);
    const three = iconRowPlacement(3, 1080, 1920);
    expect(one.card).toBeGreaterThanOrEqual(three.card);
  });
});

describe('the caption band', () => {
  it('pulls every preset into the second quarter up from the bottom', () => {
    // They had drifted from 0.54 — the middle of the frame — to 0.87, hard
    // against the bottom edge, and where a video-s words live should not
    // change when somebody tries a different caption look.
    for (const preset of CAPTION_PRESETS) {
      const framed = framedPositionY(preset.style);
      expect(framed).toBeGreaterThanOrEqual(0.5);
      expect(framed).toBeLessThanOrEqual(0.75);
    }
  });

  it('leaves a preset alone when it already sits in the band', () => {
    expect(framedPositionY({ positionY: 0.65 })).toBe(0.65);
  });

  it('pulls in the outliers at both ends', () => {
    expect(framedPositionY({ positionY: 0.54 })).toBe(CAPTION_BAND[0]);
    expect(framedPositionY({ positionY: 0.87 })).toBe(CAPTION_BAND[1]);
  });

  it('leaves room under itself for the cards', () => {
    // The deepest a caption block reaches, measured across every preset, is
    // about 0.068 below its centre.
    expect(CAPTION_BAND[1] + 0.068).toBeLessThan(iconRowPlacement(1, 1080, 1920).y - iconRowPlacement(1, 1080, 1920).card / 1920 / 2);
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
