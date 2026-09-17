import { describe, expect, it } from 'vitest';
import { layoutPlan, regionStyle } from '@/lib/styles/layouts';
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
