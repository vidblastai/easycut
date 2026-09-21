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
  /**
   * Whether the B-roll slot must never be empty.
   *
   * Deliberately separate from `broll` having a region. The region says WHERE
   * the picture goes; this says whether the pipeline has to keep something
   * there for the whole video. A split screen needs both — a permanent slot
   * with nothing in it is a black half. A headline layout has a region and
   * does not: B-roll drops into the speaker's own frame when there is
   * something to show and the speaker is back when there is not.
   */
  alwaysOn: boolean;
  /**
   * Whether the speaker is drawn OVER the B-roll or BESIDE it.
   *
   * `beside` is a division of the frame: two pictures, neither on top of the
   * other, and between them they account for all of it. `over` is a stack: the
   * B-roll has the whole frame and the speaker rides on it in a box. The
   * renderer needs to know which because it decides the draw order, and the
   * style card needs to know because it draws the same thing.
   */
  stack: 'beside' | 'over';
  /** A circular speaker box, for the webcam-bubble layouts. */
  speakerShape: 'rect' | 'circle';
  /**
   * Corner radius of a framed layout, as a percentage of the frame's width.
   *
   * 0 for anything that runs to the edges — a rounded corner on a full-frame
   * video is a black notch, not a style. It is only meaningful where the
   * layout deliberately floats a picture inside the frame.
   */
  frameRadius: number;
  /**
   * Whether the layout reserves a band at the top for the video's headline.
   *
   * The text is `deliverable.title` — the line the director already wrote for
   * the post — so a headline layout costs no extra work from the customer and
   * cannot end up empty.
   */
  headline: boolean;
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

/**
 * The circle a commentary clip puts the speaker in.
 *
 * Bigger than a reaction cut's corner box, because this one is on screen for
 * the whole video rather than for the few seconds a picture is up — at 30% of
 * the short side a face is a thumbnail, and you cannot read an expression off
 * a thumbnail for four minutes.
 *
 * Bottom-LEFT, which is the opposite corner to the reaction inset and is
 * deliberate: a permanent bubble belongs where the eye rests between glances
 * at the picture, and the top-right of a vertical video is where the platform
 * chrome and the "following" tab sit.
 */
const BUBBLE_SIDE = 0.42;
const BUBBLE_MARGIN = 0.05;
/**
 * Where the bubble's BOTTOM edge sits, as a fraction of height.
 *
 * Pinned to the bottom rather than measured down from the top, because what
 * matters is the gap to the captions underneath it: the caption block's top
 * edge is around 0.74, and a bubble that runs into it covers the words on the
 * one format where the picture already has the viewer's eye.
 */
const BUBBLE_BOTTOM = 0.7;

function bubbleInset(width: number, height: number): Region {
  const short = Math.min(width, height);
  const side = short * BUBBLE_SIDE;
  const margin = short * BUBBLE_MARGIN;
  const h = side / height;
  return {
    x: margin / width,
    // Clamped, so a wide frame — where the circle is a large share of the
    // height — cannot push it off the top.
    y: Math.max(margin / height, BUBBLE_BOTTOM - h),
    w: side / width,
    h,
  };
}

/**
 * The framed box a headline layout puts the video in.
 *
 * A band of headline above, a margin all round, and the picture inside it.
 * The frame is the format: it is what makes a phone video read as a bulletin
 * rather than as somebody talking, and it is why the text can be trusted to
 * be the first thing read.
 */
const HEADLINE_BAND = 0.2;

function headlineFrame(): Region {
  return { x: 0.05, y: HEADLINE_BAND, w: 0.9, h: 0.58 };
}

const PLANS: Record<Layout, LayoutPlan> = {
  full: {
    speaker: { x: 0, y: 0, w: 1, h: 1 },
    speakerWithBroll: null,
    broll: null,
    alwaysOn: false,
    stack: 'beside',
    speakerShape: 'rect',
    frameRadius: 0,
    headline: false,
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
    stack: 'over',
    speakerShape: 'rect',
    frameRadius: 0,
    headline: false,
    captionY: null,
  },

  /*
   * The commentary bubble.
   *
   * The picture has the frame and you are in a circle in the corner of it, for
   * the whole video. It is the format every reaction channel, every podcast
   * clip and every screen-recorded walkthrough uses, and it is a different
   * thing from a reaction cut: there the switching IS the edit, here the
   * arrangement never changes and the picture is the point.
   *
   * `alwaysOn` therefore, with `stack: 'over'`: the slot is the whole frame
   * and it must never be empty, because an empty one is a circle of face on
   * black.
   */
  bubble: {
    speaker: bubbleInset(1080, 1920),
    speakerWithBroll: null,
    broll: null,
    alwaysOn: true,
    stack: 'over',
    speakerShape: 'circle',
    frameRadius: 0,
    headline: false,
    captionY: null,
  },

  /*
   * The bulletin.
   *
   * A headline across the top, the video framed below it, captions under that.
   * The shape of every news short on every platform, and the one layout here
   * where the first thing read is text rather than a face — which is the whole
   * point: it works on mute, in a feed, before anybody has decided to watch.
   *
   * B-roll drops into the video's own frame rather than covering the screen,
   * so the headline stays legible through an insert. `alwaysOn: false`,
   * because the speaker is what is in that frame the rest of the time.
   */
  headline: {
    speaker: headlineFrame(),
    speakerWithBroll: null,
    broll: headlineFrame(),
    alwaysOn: false,
    stack: 'beside',
    speakerShape: 'rect',
    frameRadius: 3.2,
    headline: true,
    // Under the frame, in the band the layout leaves for them.
    captionY: 0.8,
  },
  /* Slightly more than half to the speaker: a face reads worse cropped than a
     landscape does, and the eye forgives the picture below being shorter. */
  split: {
    speaker: { x: 0, y: 0, w: 1, h: 0.54 },
    speakerWithBroll: null,
    broll: { x: 0, y: 0.54, w: 1, h: 0.46 },
    alwaysOn: true,
    stack: 'beside',
    speakerShape: 'rect',
    frameRadius: 0,
    headline: false,
    // A shade above the seam, so the block straddles it rather than hanging off
    // it into the picture below. `positionY` is the TOP of the caption.
    captionY: 0.485,
  },
  side: {
    speaker: { x: 0, y: 0, w: 0.5, h: 1 },
    speakerWithBroll: null,
    broll: { x: 0.5, y: 0, w: 0.5, h: 1 },
    alwaysOn: true,
    stack: 'beside',
    speakerShape: 'rect',
    frameRadius: 0,
    headline: false,
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
  if (!frame || !frame.width || !frame.height) return plan;

  // Only the two round-cornered insets care what shape the frame is; every
  // other region here is a fraction that holds at any aspect.
  if (plan.speakerWithBroll) {
    return { ...plan, speakerWithBroll: reactionInset(frame.width, frame.height) };
  }
  if (plan.speakerShape === 'circle') {
    return { ...plan, speaker: bubbleInset(frame.width, frame.height) };
  }
  return plan;
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
