import { describe, expect, it } from 'vitest';
import { brollCoverage, layoutPlan, lerpRegion, regionStyle } from '@/lib/styles/layouts';
import { STYLE_LIST, stylesFor, getStyle, leadsWithCards } from '@/lib/styles/presets';
import { LAYOUTS } from '@/lib/edl/types';

/**
 * A style promises a shape. These are the checks that stop the promise and the
 * render drifting apart.
 */

const sameRegion = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

describe('layouts', () => {
  it('has a plan for every layout the schema allows', () => {
    for (const layout of LAYOUTS) expect(layoutPlan(layout)).toBeTruthy();
  });

  /*
   * Two families of layout, and the invariants are different for each.
   *
   * `beside` divides the frame: two pictures, neither over the other, and
   * between them they account for all of it. `over` stacks: the B-roll has
   * the whole frame and the speaker rides on top in a box. The checks below
   * used to assume every layout was the first kind, which was true until a
   * reaction cut and a commentary bubble existed.
   */
  const beside = LAYOUTS.filter((l) => layoutPlan(l).stack === 'beside');
  const over = LAYOUTS.filter((l) => layoutPlan(l).stack === 'over');

  it('has both kinds, so neither set of checks is silently empty', () => {
    expect(beside.length).toBeGreaterThan(0);
    expect(over.length).toBeGreaterThan(0);
  });

  it('gives the speaker the whole frame only when nothing shares it', () => {
    for (const layout of beside) {
      const plan = layoutPlan(layout);
      const whole = plan.speaker.w === 1 && plan.speaker.h === 1;
      // A headline layout has a B-roll region that is the speaker's own frame
      // rather than a second slot beside it, so it is not a division.
      if (plan.broll && sameRegion(plan.broll, plan.speaker)) continue;
      expect(whole, layout).toBe(plan.broll === null);
    }
  });

  it('never overlaps the two halves', () => {
    for (const layout of beside) {
      const { speaker, broll } = layoutPlan(layout);
      if (!broll || sameRegion(broll, speaker)) continue;
      const apart =
        speaker.y + speaker.h <= broll.y + 1e-9 ||
        broll.y + broll.h <= speaker.y + 1e-9 ||
        speaker.x + speaker.w <= broll.x + 1e-9 ||
        broll.x + broll.w <= speaker.x + 1e-9;
      expect(apart, layout).toBe(true);
    }
  });

  it('fills the frame between them', () => {
    for (const layout of beside) {
      const { speaker, broll } = layoutPlan(layout);
      if (broll && sameRegion(broll, speaker)) continue;
      const area = speaker.w * speaker.h + (broll ? broll.w * broll.h : 0);
      expect(area, layout).toBeCloseTo(1, 6);
    }
  });

  it('keeps a stacked speaker inside the frame, and smaller than it', () => {
    for (const layout of over) {
      const plan = layoutPlan(layout, { width: 1080, height: 1920 });
      const box = plan.speakerWithBroll ?? plan.speaker;
      expect(box.x, layout).toBeGreaterThanOrEqual(0);
      expect(box.y, layout).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w, layout).toBeLessThanOrEqual(1);
      expect(box.y + box.h, layout).toBeLessThanOrEqual(1);
      expect(box.w * box.h, layout).toBeLessThan(0.5);
    }
  });

  it('never gives a stacked layout a B-roll region, because it has the frame', () => {
    for (const layout of over) expect(layoutPlan(layout).broll, layout).toBeNull();
  });

  it('only fixes the captions where the layout actually decides', () => {
    expect(layoutPlan('full').captionY).toBeNull();
    // On the seam — a little above it, since the value is the block's top edge.
    const split = layoutPlan('split');
    expect(split.captionY!).toBeLessThan(split.speaker.h);
    expect(split.captionY!).toBeGreaterThan(split.speaker.h - 0.12);
  });

  /*
   * `alwaysOn` is about whether the slot may ever be EMPTY, which is not the
   * same question as whether it has a region — and conflating the two is how
   * a headline layout ended up painting a black panel over its own speaker
   * whenever no insert was playing.
   */
  it('keeps a permanent slot covered, whether that slot is a half or the frame', () => {
    // A division of the frame that is on screen throughout must never be empty.
    expect(layoutPlan('split').alwaysOn).toBe(true);
    expect(layoutPlan('side').alwaysOn).toBe(true);
    // The bubble's slot is the whole frame, and it is just as permanent.
    expect(layoutPlan('bubble').alwaysOn).toBe(true);
  });

  it('lets a slot be empty when the speaker is what is behind it', () => {
    // Full frame and reaction: no insert means the speaker, which is correct.
    expect(layoutPlan('full').alwaysOn).toBe(false);
    expect(layoutPlan('reaction').alwaysOn).toBe(false);
    // A bulletin's inserts drop into the speaker's own frame, so the same.
    expect(layoutPlan('headline').alwaysOn).toBe(false);
  });

  it('rounds the corners only where a picture floats inside the frame', () => {
    for (const layout of LAYOUTS) {
      const plan = layoutPlan(layout);
      const full = plan.speaker.w === 1 && plan.speaker.h === 1;
      // A rounded corner on a full-frame video is a black notch, not a style.
      if (full) expect(plan.frameRadius, layout).toBe(0);
    }
  });

  it('only reserves a headline band where there is a headline to put in it', () => {
    expect(layoutPlan('headline').headline).toBe(true);
    for (const layout of LAYOUTS) {
      if (layout === 'headline') continue;
      expect(layoutPlan(layout).headline, layout).toBe(false);
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

  /*
   * Coverage is NOT what this checks — the gap filler guarantees that, and
   * tests/edl.test.ts proves it. What a cadence buys is VARIETY: a permanent
   * slot filled by replaying two clips for a minute is covered and
   * unwatchable. So the bar is "enough distinct things to show", which is a
   * much looser number than the one that used to be here, and looser in the
   * direction that lets a style deliberately hold a shot for longer.
   */
  it('gives a permanent slot enough different things to show', () => {
    for (const style of STYLE_LIST) {
      if (!layoutPlan(style.layout).alwaysOn) continue;
      for (const [mode, seconds] of [['short', 60], ['long', 600]] as const) {
        if (!style.formats.includes(mode)) continue;
        const distinct = seconds / style[mode].brollEverySec;
        expect(distinct, `${style.name} ${mode}`).toBeGreaterThanOrEqual(5);
      }
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
    // A commentary bubble is also a speaker over B-roll, but it never moves —
    // which is the whole difference between the two formats.
    for (const layout of LAYOUTS) {
      expect(layoutPlan(layout).speakerWithBroll === null, layout).toBe(layout !== 'reaction');
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

/**
 * Two styles that draw the same card are one style with two names.
 *
 * The picker is the whole of the first step, and a card is all anyone has to
 * choose from. Styles that differ only in numbers the card cannot show — a
 * chaptered edit is a full frame with more title cards — have to declare that
 * difference somewhere the card can read it, or the step asks people to pick
 * between two identical pictures.
 */
describe('every style is distinguishable from the picker', () => {
  it('draws a different card from at least one other style', () => {
    const fingerprint = (style: (typeof STYLE_LIST)[number], mode: 'short' | 'long') => {
      const plan = layoutPlan(style.layout, { width: 1080, height: 1920 });
      return [
        style.layout,
        plan.speakerShape,
        plan.headline,
        plan.stack,
        // What the card actually draws beyond the shape.
        leadsWithCards(style, mode),
      ].join('|');
    };

    for (const mode of ['short', 'long'] as const) {
      const seen = new Map<string, string[]>();
      for (const style of STYLE_LIST) {
        if (!style.formats.includes(mode)) continue;
        const key = fingerprint(style, mode);
        seen.set(key, [...(seen.get(key) ?? []), style.name]);
      }
      // Several styles legitimately share a shape — Clean, Punchy, Documentary
      // and the rest are all full-frame, and their difference is genuinely
      // pacing rather than layout. What must not happen is ALL of them
      // collapsing onto one card.
      expect(seen.size, `${mode}: only ${seen.size} distinct previews`).toBeGreaterThanOrEqual(4);
    }
  });

  it('draws a title card for the styles that actually lead with them', () => {
    const withCards = STYLE_LIST.filter((s) => leadsWithCards(s, 'short')).map((s) => s.id);

    // Chaptered is the style built around them, and Explainer puts a graphic
    // up every five seconds, which is more often still — both are honest.
    expect(withCards).toContain('stacked');

    // But it has to stay a SIGNAL. A card drawn on most of the previews
    // distinguishes nothing, which is the failure this whole check is for.
    expect(withCards.length).toBeLessThan(STYLE_LIST.length / 3);
    expect(withCards).not.toContain('clean');
    expect(withCards).not.toContain('documentary');
  });

  it('never offers a style whose layout needs B-roll without B-roll pacing', () => {
    for (const style of STYLE_LIST) {
      if (!layoutPlan(style.layout).alwaysOn) continue;
      for (const mode of ['short', 'long'] as const) {
        if (!style.formats.includes(mode)) continue;
        // A permanent slot and a B-roll cue every half minute is a black half.
        expect(style[mode].brollEverySec, `${style.name} ${mode}`).toBeLessThanOrEqual(12);
      }
    }
  });
});
