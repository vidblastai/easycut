import { describe, expect, it } from 'vitest';
import { brollCoverage, layoutPlan, lerpRegion, regionStyle } from '@/lib/styles/layouts';
import { STYLE_LIST, stylesFor, getStyle } from '@/lib/styles/presets';
import { LAYOUTS } from '@/lib/edl/types';

/**
 * A style promises a shape. These are the checks that stop the promise and the
 * render drifting apart.
 */

describe('layouts', () => {
  it('has a plan for every layout the schema allows', () => {
    for (const layout of LAYOUTS) expect(layoutPlan(layout)).toBeTruthy();
  });

  it('gives the speaker the whole frame only when nothing shares it', () => {
    for (const layout of LAYOUTS) {
      const plan = layoutPlan(layout);
      const whole = plan.speaker.w === 1 && plan.speaker.h === 1;
      expect(whole).toBe(plan.broll === null);
    }
  });

  it('never overlaps the two halves', () => {
    for (const layout of LAYOUTS) {
      const { speaker, broll } = layoutPlan(layout);
      if (!broll) continue;
      const apart =
        speaker.y + speaker.h <= broll.y + 1e-9 ||
        broll.y + broll.h <= speaker.y + 1e-9 ||
        speaker.x + speaker.w <= broll.x + 1e-9 ||
        broll.x + broll.w <= speaker.x + 1e-9;
      expect(apart).toBe(true);
    }
  });

  it('fills the frame between them', () => {
    for (const layout of LAYOUTS) {
      const { speaker, broll } = layoutPlan(layout);
      const area = speaker.w * speaker.h + (broll ? broll.w * broll.h : 0);
      expect(area).toBeCloseTo(broll ? 1 : 1, 6);
    }
  });

  it('only fixes the captions where the layout actually decides', () => {
    expect(layoutPlan('full').captionY).toBeNull();
    // On the seam — a little above it, since the value is the block's top edge.
    const split = layoutPlan('split');
    expect(split.captionY!).toBeLessThan(split.speaker.h);
    expect(split.captionY!).toBeGreaterThan(split.speaker.h - 0.12);
  });

  it('asks the pipeline to keep a permanent slot covered', () => {
    for (const layout of LAYOUTS) {
      expect(layoutPlan(layout).alwaysOn).toBe(layoutPlan(layout).broll !== null);
    }
  });

  it('writes a region as percentages', () => {
    expect(regionStyle({ x: 0, y: 0.54, w: 1, h: 0.46 })).toEqual({
      left: '0%',
      top: '54%',
      width: '100%',
      height: '46%',
    });
  });
});

describe('styles', () => {
  it('offers every style to at least one format', () => {
    for (const style of STYLE_LIST) expect(style.formats.length).toBeGreaterThan(0);
  });

  it('gives both formats something to choose from', () => {
    expect(stylesFor('short').length).toBeGreaterThan(2);
    expect(stylesFor('long').length).toBeGreaterThan(2);
  });

  it('keeps a split screen out of widescreen and a side-by-side out of vertical', () => {
    expect(stylesFor('long').some((s) => s.layout === 'split')).toBe(false);
    expect(stylesFor('short').some((s) => s.layout === 'side')).toBe(false);
  });

  it('names a layout the renderer knows', () => {
    for (const style of STYLE_LIST) expect(LAYOUTS).toContain(style.layout);
  });

  it('gives a permanent slot enough B-roll to fill it', () => {
    for (const style of STYLE_LIST) {
      if (!layoutPlan(style.layout).alwaysOn) continue;
      // One insert every few seconds, not every dozen: the slot is the video.
      expect(style.short.brollEverySec).toBeLessThanOrEqual(6);
      expect(style.long.brollEverySec).toBeLessThanOrEqual(12);
    }
  });

  it('falls back rather than crashing on an unknown id', () => {
    expect(getStyle('nope').id).toBe('clean');
  });
});

/**
 * The reaction cut is the only layout whose geometry moves, so it is the only
 * one where the arithmetic can be wrong in a way a static check would miss.
 */
describe('the reaction cut', () => {
  const short = layoutPlan('reaction', { width: 1080, height: 1920 });
  const wide = layoutPlan('reaction', { width: 1920, height: 1080 });

  it('is the only layout that moves', () => {
    for (const layout of LAYOUTS) {
      expect(layoutPlan(layout).speakerWithBroll === null).toBe(layout !== 'reaction');
    }
  });

  it('starts and ends on a full frame', () => {
    expect(short.speaker).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('puts the speaker in a square box whichever way up the video is', () => {
    const box = (plan: typeof short, frame: { width: number; height: number }) => ({
      w: plan.speakerWithBroll!.w * frame.width,
      h: plan.speakerWithBroll!.h * frame.height,
    });
    const tall = box(short, { width: 1080, height: 1920 });
    const flat = box(wide, { width: 1920, height: 1080 });
    expect(tall.w).toBeCloseTo(tall.h, 6);
    expect(flat.w).toBeCloseTo(flat.h, 6);
    // And the same physical size: a fraction of width alone would not be.
    expect(tall.w).toBeCloseTo(flat.w, 6);
  });

  it('keeps the box inside the frame, top-right, clear of the captions', () => {
    for (const plan of [short, wide]) {
      const b = plan.speakerWithBroll!;
      expect(b.x).toBeGreaterThan(0.5);
      expect(b.x + b.w).toBeLessThan(1);
      expect(b.y).toBeGreaterThan(0);
      expect(b.y + b.h).toBeLessThan(0.7);
    }
  });

  it('leaves the plan alone when nobody says how big the frame is', () => {
    expect(layoutPlan('reaction').speakerWithBroll).toEqual(
      layoutPlan('reaction', { width: 0, height: 0 }).speakerWithBroll,
    );
  });
});

describe('moving between two shapes', () => {
  const a = { x: 0, y: 0, w: 1, h: 1 };
  const b = { x: 0.6, y: 0.04, w: 0.3, h: 0.17 };

  it('ends where it was told to', () => {
    expect(lerpRegion(a, b, 0)).toEqual(a);
    expect(lerpRegion(a, b, 1)).toEqual(b);
  });

  it('is half way at half way', () => {
    expect(lerpRegion(a, b, 0.5)).toEqual({ x: 0.3, y: 0.02, w: 0.65, h: 0.585 });
  });

  it('never overshoots, however wrong the caller is', () => {
    expect(lerpRegion(a, b, -3)).toEqual(a);
    expect(lerpRegion(a, b, 9)).toEqual(b);
  });
});

describe('how much of the frame an insert has', () => {
  const clips = [
    { outStartSec: 3, outEndSec: 7 },
    { outStartSec: 12, outEndSec: 16 },
  ];

  it('is nothing when there is nothing on screen', () => {
    expect(brollCoverage(clips, 0)).toBe(0);
    expect(brollCoverage(clips, 9.5)).toBe(0);
    expect(brollCoverage(clips, 30)).toBe(0);
    expect(brollCoverage([], 5)).toBe(0);
  });

  it('is everything in the middle of one', () => {
    expect(brollCoverage(clips, 5)).toBe(1);
    expect(brollCoverage(clips, 14)).toBe(1);
  });

  it('ramps in before the picture and out after it', () => {
    // Half way up the run-in, which starts `easeSec` BEFORE the clip does, so
    // the speaker is already moving when the picture arrives.
    expect(brollCoverage(clips, 3 - 0.11, 0.22)).toBeCloseTo(0.5, 6);
    expect(brollCoverage(clips, 3, 0.22)).toBeCloseTo(1, 6);
    expect(brollCoverage(clips, 7 + 0.11, 0.22)).toBeCloseTo(0.5, 6);
  });

  it('never throws the speaker into the corner for a flash', () => {
    // Both ramps sit outside the clip, so a clip shorter than the two of them
    // is capped: the speaker glances over rather than travelling a full second
    // for a tenth of a second of picture.
    const blink = [{ outStartSec: 5, outEndSec: 5.1 }];
    const peak = Math.max(
      ...Array.from({ length: 200 }, (_, i) => brollCoverage(blink, 4.5 + i * 0.005, 0.6)),
    );
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(1);
  });

  it('takes the nearest insert when two of them touch', () => {
    const back2back = [
      { outStartSec: 3, outEndSec: 7 },
      { outStartSec: 7, outEndSec: 11 },
    ];
    // The speaker should not bob back out to full frame in the one frame
    // between two adjacent inserts.
    expect(brollCoverage(back2back, 7)).toBeCloseTo(1, 9);
  });
});
