import { describe, expect, it } from 'vitest';
import {
  brollShapeFor, priceBrollRate, waitForBrollRate, type BrollSourceRate,
} from '@/lib/assets/ai-broll';
import { STYLE_LIST, pacingFor, type FormatMode } from '@/lib/styles/presets';

/**
 * What the B-roll source picker quotes.
 *
 * The tile carries a price, and the claim it makes is that the number on the
 * tile is the number on the invoice. That claim was false for long form: the
 * wizard quoted a fixed four inserts of two and a half seconds — the shape of
 * a typical short — to every video, while a ten-minute commentary edit gets
 * seventy-five inserts. Somebody choosing "AI video" on a long upload was shown
 * a figure a couple of orders of magnitude under what it would bill.
 */

/** Stands in for the configured video model, at Seedance 1.0 Lite's rate. */
const VIDEO: BrollSourceRate = {
  source: 'ai-video', label: 'AI video', body: '', available: true,
  usdPerInsert: 0, usdPerSecond: 0.0225, durations: [5, 10], oneSec: 45,
};

const IMAGE: BrollSourceRate = {
  source: 'ai-image', label: 'AI pictures', body: '', available: true,
  usdPerInsert: 0.03, usdPerSecond: 0, durations: [1], oneSec: 12,
};

const STOCK: BrollSourceRate = {
  source: 'stock', label: 'Stock', body: '', available: true,
  usdPerInsert: 0, usdPerSecond: 0, durations: [1], oneSec: 0,
};

describe('how many inserts a video gets', () => {
  it('reads the count off the style, not off a constant', () => {
    const clean = brollShapeFor(pacingFor(STYLE_LIST.find((s) => s.id === 'clean')!, 'long'), 600);
    const commentary = brollShapeFor(pacingFor(STYLE_LIST.find((s) => s.id === 'commentary')!, 'long'), 600);
    // Same length, same format — the style alone is a 5x spread in what this bills.
    expect(commentary.inserts).toBeGreaterThan(clean.inserts * 4);
  });

  it('scales with the length of the video', () => {
    const pacing = pacingFor(STYLE_LIST.find((s) => s.id === 'documentary')!, 'long');
    expect(brollShapeFor(pacing, 1200).inserts).toBe(brollShapeFor(pacing, 600).inserts * 2);
  });

  it('asks for at least one insert from a video too short for a full interval', () => {
    // Otherwise a 20-second clip prices B-roll at zero and then gets some.
    expect(brollShapeFor({ brollEverySec: 45, brollDurationSec: [3, 5] }, 20).inserts).toBe(1);
  });

  it('asks for none where the style never cuts away', () => {
    expect(brollShapeFor({ brollEverySec: 0, brollDurationSec: [3, 5] }, 600).inserts).toBe(0);
  });
});

describe('what it costs', () => {
  it('charges a picture per picture, however long it is on screen', () => {
    expect(priceBrollRate(IMAGE, 10, 2)).toBeCloseTo(0.3, 5);
    expect(priceBrollRate(IMAGE, 10, 9)).toBeCloseTo(0.3, 5);
  });

  it('charges a clip for the length the provider bills, not the length used', () => {
    // A 4.2s insert is billed as 5s, because 5 is the rung it lands on.
    expect(priceBrollRate(VIDEO, 1, 4.2)).toBeCloseTo(5 * 0.0225, 5);
    expect(priceBrollRate(VIDEO, 1, 6)).toBeCloseTo(10 * 0.0225, 5);
  });

  it('costs nothing for stock, at any size', () => {
    expect(priceBrollRate(STOCK, 200, 9)).toBe(0);
  });

  it('costs nothing when the style places no inserts', () => {
    expect(priceBrollRate(VIDEO, 0, 5)).toBe(0);
  });

  it('is far more for a long edit than the old fixed quote admitted', () => {
    const old = priceBrollRate(VIDEO, 4, 2.5);
    const commentaryLong = brollShapeFor(
      pacingFor(STYLE_LIST.find((s) => s.id === 'commentary')!, 'long'), 600,
    );
    const real = priceBrollRate(VIDEO, commentaryLong.inserts, commentaryLong.secondsEach);
    expect(real).toBeGreaterThan(old * 10);
  });
});

describe('how long it takes', () => {
  it('is flat while the batch fits in one wave, because inserts are made concurrently', () => {
    expect(waitForBrollRate(VIDEO, 1)).toBe(waitForBrollRate(VIDEO, 8));
  });

  it('grows once there are more inserts than can be in flight at once', () => {
    expect(waitForBrollRate(VIDEO, 40)).toBeGreaterThan(waitForBrollRate(VIDEO, 8));
  });

  it('is instant for stock', () => {
    expect(waitForBrollRate(STOCK, 300)).toBe(0);
  });
});

describe('across the catalogue', () => {
  const combos = STYLE_LIST.flatMap((style) =>
    (['short', 'long'] as FormatMode[])
      .filter((m) => style.formats.includes(m))
      .map((mode) => ({ style, mode })),
  );

  it('never quotes a price it cannot explain', () => {
    for (const { style, mode } of combos) {
      const shape = brollShapeFor(pacingFor(style, mode), mode === 'short' ? 60 : 600);
      const cost = priceBrollRate(VIDEO, shape.inserts, shape.secondsEach);
      expect(Number.isFinite(cost), `${style.id}/${mode}`).toBe(true);
      expect(cost, `${style.id}/${mode}`).toBeGreaterThanOrEqual(0);
      // A single video costing three figures means a pacing number is wrong.
      expect(cost, `${style.id}/${mode} quotes $${cost.toFixed(2)}`).toBeLessThan(100);
    }
  });

  it('quotes long form above short form for every style that does both', () => {
    for (const style of STYLE_LIST) {
      if (!style.formats.includes('short') || !style.formats.includes('long')) continue;
      const short = brollShapeFor(pacingFor(style, 'short'), 60);
      const long = brollShapeFor(pacingFor(style, 'long'), 600);
      expect(
        priceBrollRate(VIDEO, long.inserts, long.secondsEach),
        `${style.id}: long must not be cheaper than short`,
      ).toBeGreaterThan(priceBrollRate(VIDEO, short.inserts, short.secondsEach));
    }
  });
});
