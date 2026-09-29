import { CLIP_TRANSITION_MOVES, type ClipTransition } from './types';

/**
 * How long a clip transition lasts, and how far it travels.
 *
 * ── Why this is in `src/` and not with the renderer ─────────────────────
 *
 * Because it stopped being a rendering detail the moment a sound effect had
 * to land on one. A whoosh under a slide has to start when the picture starts
 * MOVING, and the picture starts moving at `outEndSec - clipTransitionSec(…)`
 * — so the builder, which places the sound, needs the same number the
 * composition draws with. Two copies of that number is a sound that drifts
 * away from its transition the first time either is tuned.
 *
 * The renderer re-exports all of it, so nothing that imported these from
 * `clip-transition` had to change.
 */

const MOVE_PX_PER_SEC = 2400;

/** However far it has to go, a move stays inside this. */
const MOVE_SEC_RANGE: readonly [number, number] = [0.42, 0.72];

/** An effect flavour is faster — it is a snap with a flash over it. */
export const CLIP_EFFECT_SEC = 0.22;

/**
 * The exception: a glitch needs longer than a flash does.
 *
 * Measured off a reference cut, frame by frame: the break runs thirteen frames
 * at thirty — about five of the outgoing shot coming apart, ONE frame of
 * blow-out, and seven of the incoming shot tearing its way back to clean. Half
 * of that is nine frames per side, and at 0.22s the effect was six, which is
 * why ours read as a stutter rather than as a signal failing.
 */
export const CLIP_GLITCH_SEC = 0.3;

/** For tests and callers that only need a representative length. */
export const CLIP_MOVE_SEC = MOVE_SEC_RANGE[0];

/**
 * How long this transition takes, in this frame.
 *
 * The frame matters because the distance does. `slide-up` in 9:16 crosses 1920
 * pixels where `slide-left` crosses 1080, and giving both the same number of
 * frames is what made the vertical one judder while the horizontal one looked
 * fine.
 */
export function clipTransitionSec(type: ClipTransition, frame?: { width: number; height: number }): number {
  if (type === 'cut') return 0;
  if (type === 'glitch') return CLIP_GLITCH_SEC;
  if (!CLIP_TRANSITION_MOVES.includes(type)) return CLIP_EFFECT_SEC;

  const travel = travelPx(type, frame);
  const [min, max] = MOVE_SEC_RANGE;
  return Math.min(max, Math.max(min, travel / MOVE_PX_PER_SEC));
}

/** How far the clip actually moves, in pixels. */
export function travelPx(type: ClipTransition, frame?: { width: number; height: number }): number {
  if (!frame) return 1080;
  switch (type) {
    case 'slide-left':
    case 'slide-right':
      return frame.width;
    case 'slide-up':
    case 'slide-down':
      return frame.height;
    case 'zoom':
      // A scale, not a translate: the corners move about a seventh of the
      // diagonal, which is nothing like a full-frame slide.
      return Math.hypot(frame.width, frame.height) * 0.14;
    default:
      return frame.width * 0.34;
  }
}
