/**
 * The parts of the frame you cannot put anything in.
 *
 * Two different things, and they are worth keeping apart because only one of
 * them is about the video.
 *
 * ── Title safe ──────────────────────────────────────────────────────────
 *
 * The broadcast convention: anything that has to be READ stays inside the
 * middle 80%, and anything that matters visually inside the middle 90%. It
 * comes from CRT overscan eating the edges, which no flat panel does any more,
 * and it survives because every delivery spec still enforces it and because a
 * line of type hard against the edge looks wrong regardless of the reason.
 *
 * ── Player chrome ───────────────────────────────────────────────────────
 *
 * This one is not a convention, it is where the controls are. A long-form
 * video is watched inside the YouTube player, and the player draws its scrubber
 * and its buttons OVER the bottom of the picture. Anything down there is
 * covered every time somebody moves the mouse, and the scrubber itself sits on
 * top of whatever is in the last few per cent.
 *
 * A vertical short has no such band at the bottom — the feed apps put their UI
 * over the sides and the lower corners instead, in a shape that varies per app
 * — so this is claimed only where it is known.
 */

/** Text stays inside the middle 80% of the frame. */
export const TITLE_SAFE_INSET = 0.1;

/** Anything that matters visually stays inside the middle 90%. */
export const ACTION_SAFE_INSET = 0.05;

/**
 * How much of the bottom the YouTube player covers with its own controls.
 *
 * The scrubber alone is a couple of per cent; the control bar with it is about
 * eight, and it appears over the picture on every hover.
 */
export const PLAYER_CHROME_INSET = 0.08;

export interface SafeArea {
  /** Fractions of the frame that are out of bounds on each edge. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Whether this frame is watched inside a player that draws over the bottom.
 *
 * Read off the SHAPE rather than off the format, like everything else here: a
 * widescreen video is a video somebody scrubs through, and a vertical one is a
 * video in a feed.
 */
export function hasPlayerChrome(width: number, height: number): boolean {
  return width > height;
}

/** Where things that have to be read may go. */
export function titleSafe(width: number, height: number): SafeArea {
  return {
    top: TITLE_SAFE_INSET,
    bottom: Math.max(TITLE_SAFE_INSET, hasPlayerChrome(width, height) ? PLAYER_CHROME_INSET : 0),
    left: TITLE_SAFE_INSET,
    right: TITLE_SAFE_INSET,
  };
}

/** The lowest a thing may reach, as a fraction of the frame height. */
export function floorFor(width: number, height: number, ownMargin: number): number {
  const chrome = hasPlayerChrome(width, height) ? PLAYER_CHROME_INSET : 0;
  return 1 - Math.max(ownMargin, chrome);
}

/** Clamps a normalised point into the title-safe box. */
export function clampToSafe(
  point: { x: number; y: number },
  width: number,
  height: number,
): { x: number; y: number } {
  const safe = titleSafe(width, height);
  return {
    x: Math.min(1 - safe.right, Math.max(safe.left, point.x)),
    y: Math.min(1 - safe.bottom, Math.max(safe.top, point.y)),
  };
}
