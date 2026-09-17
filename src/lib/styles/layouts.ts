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
  /** Where the speaker is. */
  speaker: Region;
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

const PLANS: Record<Layout, LayoutPlan> = {
  full: {
    speaker: { x: 0, y: 0, w: 1, h: 1 },
    broll: null,
    alwaysOn: false,
    captionY: null,
  },
  /* Slightly more than half to the speaker: a face reads worse cropped than a
     landscape does, and the eye forgives the picture below being shorter. */
  split: {
    speaker: { x: 0, y: 0, w: 1, h: 0.54 },
    broll: { x: 0, y: 0.54, w: 1, h: 0.46 },
    alwaysOn: true,
    // A shade above the seam, so the block straddles it rather than hanging off
    // it into the picture below. `positionY` is the TOP of the caption.
    captionY: 0.485,
  },
  side: {
    speaker: { x: 0, y: 0, w: 0.5, h: 1 },
    broll: { x: 0.5, y: 0, w: 0.5, h: 1 },
    alwaysOn: true,
    captionY: 0.88,
  },
};

export function layoutPlan(layout: Layout): LayoutPlan {
  return PLANS[layout] ?? PLANS.full;
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
