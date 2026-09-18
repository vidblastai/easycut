import type { Layout } from '@/lib/edl/types';

/**
 * Where each thing sits, for every layout, as fractions of the frame.
 *
 * One module, read by three places that must never disagree: the Remotion
 * composition that renders the video, the style card that draws a preview of
 * it, and the pipeline that decides whether the B-roll track has to run
 * continuously. Divide that knowledge between them and the picker eventually
 * advertises a shape the renderer does not produce.
 */

export interface Region {
  /** All four are 0..1 of the frame's own width and height. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutPlan {
  /** Where the speaker is when nothing else is on screen. */
  speaker: Region;
  /**
   * Where the speaker goes while a B-roll insert is up. `null` = stays put.
   *
   * This is the one thing that makes a layout MOVE. Every other layout here is
   * a fixed arrangement for the whole video; a reaction cut is a shape that
   * changes — full frame while you are talking, a small box in the corner the
   * moment there is something to look at, and back again when there is not.
   * The renderer interpolates between the two, so this field is also what tells
   * it the speaker has to be drawn ON TOP of the B-roll rather than under it.
   */
  speakerWithBroll: Region | null;
  /**
   * Where B-roll goes, or null when it simply covers the frame.
   *
   * A region here means the slot is permanent — it is on screen for the whole
   * video, so it must never be empty. `alwaysOn` says the same thing to the
   * pipeline, which fills the gaps.
   */
  broll: Region | null;
  alwaysOn: boolean;
  /**
   * Captions' vertical centre, when the layout dictates it.
   *
   * On a split screen they belong on the seam: it is the one band of the frame
   * where they cover neither the speaker's face nor the picture underneath.
   * `null` leaves the caption style's own choice alone.
   */
  captionY: number | null;
}

/**
 * The corner box a reaction cut puts the speaker in.
 *
 * Sized against the frame's SHORT side so it comes out square and roughly the
 * same physical size whichever way up the video is — a fraction of width alone
 * would give a squat letterbox on a 9:16 short and a tall slab on a 16:9 talk.
 *
 * Top-right, because the bottom belongs to the captions and the bottom-left
 * corner is where every platform puts its own chrome.
 */
const INSET_SIDE = 0.3;   // of the short side
const INSET_MARGIN = 0.04;

function reactionInset(width: number, height: number): Region {
  const short = Math.min(width, height);
  const side = short * INSET_SIDE;
  const margin = short * INSET_MARGIN;
  return {
    x: (width - margin - side) / width,
    y: margin / height,
    w: side / width,
    h: side / height,
  };
}

const PLANS: Record<Layout, LayoutPlan> = {
  full: {
    speaker: { x: 0, y: 0, w: 1, h: 1 },
    speakerWithBroll: null,
    broll: null,
    alwaysOn: false,
    captionY: null,
  },

  /*
   * The reaction cut.
   *
   * You are full frame with nothing behind you. A picture comes up, takes the
   * whole frame, and you shrink into the corner — still there, still reacting.
   * The picture goes, and you come back. It is the format the whole of
   * commentary video is built on, and it is the only layout here where the
   * geometry is a function of time rather than a constant.
   *
   * `broll: null` because the insert covers the frame, and `alwaysOn: false`
   * because the switching IS the style: a permanent slot would be a split
   * screen, which is a different thing entirely.
   */
  reaction: {
    speaker: { x: 0, y: 0, w: 1, h: 1 },
    speakerWithBroll: reactionInset(1080, 1920),
    broll: null,
    alwaysOn: false,
    captionY: null,
  },
  /* Slightly more than half to the speaker: a face reads worse cropped than a
     landscape does, and the eye forgives the picture below being shorter. */
  split: {
    speaker: { x: 0, y: 0, w: 1, h: 0.54 },
    speakerWithBroll: null,
    broll: { x: 0, y: 0.54, w: 1, h: 0.46 },
    alwaysOn: true,
    // A shade above the seam, so the block straddles it rather than hanging off
    // it into the picture below. `positionY` is the TOP of the caption.
    captionY: 0.485,
  },
  side: {
    speaker: { x: 0, y: 0, w: 0.5, h: 1 },
    speakerWithBroll: null,
    broll: { x: 0.5, y: 0, w: 0.5, h: 1 },
    alwaysOn: true,
    captionY: 0.88,
  },
};

/**
 * The plan for a layout, shaped to the frame it will be rendered in.
 *
 * `frame` only matters to layouts with an inset — everything else is expressed
 * in fractions that hold at any aspect. Callers that are only asking "does this
 * layout need a permanent B-roll slot?" can leave it out.
 */
export function layoutPlan(layout: Layout, frame?: { width: number; height: number }): LayoutPlan {
  const plan = PLANS[layout] ?? PLANS.full;
  if (!frame || !plan.speakerWithBroll || !frame.width || !frame.height) return plan;
  return { ...plan, speakerWithBroll: reactionInset(frame.width, frame.height) };
}

/**
 * A region part-way between two others.
 *
 * `t` runs 0 (the first) to 1 (the second). Used by the renderer to move the
 * speaker between full frame and the corner rather than snapping, because a
 * hard jump between two sizes reads as a glitch where a quick slide reads as
 * an edit.
 */
export function lerpRegion(a: Region, b: Region, t: number): Region {
  const clamped = Math.max(0, Math.min(1, t));
  // (1-t)·from + t·to rather than from + (to-from)·t: the second form does not
  // land exactly on `to` at t=1 in binary floating point, which is how a width
  // of 30.000000000000004% ends up in the DOM at the end of every move.
  const mix = (from: number, to: number) => (1 - clamped) * from + clamped * to;
  return {
    x: mix(a.x, b.x),
    y: mix(a.y, b.y),
    w: mix(a.w, b.w),
    h: mix(a.h, b.h),
  };
}

/**
 * How much of the frame a B-roll insert is claiming at this moment, 0..1.
 *
 * Ramped at both ends over `easeSec`, so the speaker slides into the corner as
 * the picture arrives rather than after it. The ramps are deliberately shorter
 * than the B-roll's own cross-fade: the movement should finish first, or the
 * eye watches the box travelling instead of the thing it is travelling for.
 */
export function brollCoverage(
  clips: ReadonlyArray<{ outStartSec: number; outEndSec: number }>,
  outSec: number,
  easeSec = 0.22,
): number {
  let best = 0;
  for (const clip of clips) {
    const { outStartSec: a, outEndSec: b } = clip;
    if (outSec <= a - easeSec || outSec >= b + easeSec) continue;

    // Rise into the clip, hold, fall out of it.
    const rising = (outSec - (a - easeSec)) / easeSec;
    const falling = ((b + easeSec) - outSec) / easeSec;

    // How far a clip this long is allowed to commit the speaker. Both ramps sit
    // OUTSIDE the clip, so without this a tenth-of-a-second flash would throw
    // the speaker all the way into the corner and drag it back — a whole second
    // of travel for a frame of picture. Short clips get a proportionally
    // smaller move instead, which reads as a glance rather than a lurch.
    const commit = Math.min(1, (b - a) / (2 * easeSec));

    const here = Math.max(0, Math.min(commit, rising, falling));
    if (here > best) best = here;
  }
  return best;
}

/** A region as CSS, in percentages, for both the renderer and the pickers. */
export function regionStyle(region: Region): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  // Rounded, because 0.46 × 100 is 46.00000000000001 in binary floating point
  // and that string ends up in the DOM.
  const pct = (n: number) => `${Number((n * 100).toFixed(4))}%`;
  return {
    left: pct(region.x),
    top: pct(region.y),
    width: pct(region.w),
    height: pct(region.h),
  };
}
