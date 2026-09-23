import { ASPECT_DIMENSIONS, type Aspect } from '@/lib/edl/types';

/**
 * How many pixels an export is drawn at, and who is allowed to ask.
 *
 * ── Why 4K is opt-in per export, and not a plan default ──────────────────
 *
 * Every composition in `remotion/` is laid out at a 1080 base, and Remotion's
 * `scale` multiplies the output without touching that layout — so 4K costs no
 * design work at all. What it costs is TIME: roughly four times the pixels,
 * and in practice between three and four times the wall clock. A ten-minute
 * video that renders in about twenty-seven minutes on four cores becomes an
 * hour and a half. On Lambda the same multiple arrives as money instead.
 *
 * Almost nobody needs it. A vertical short is watched on a phone at a fraction
 * of 1080, and the platforms re-encode it on the way in regardless. The people
 * who genuinely want 4K want it for a specific video — something going on a
 * television, or footage a client will crop into. Making it the default would
 * charge every customer that multiple so that a minority could have it, which
 * is the wrong trade in both directions: slower for everyone, and it eats the
 * margin the plan was priced on.
 *
 * So it is a per-export choice, on the plans that include it, with the wait
 * stated on the control. The multiple is then paid only on the videos that
 * need it.
 *
 * ── Why "height" is measured on the short side ───────────────────────────
 *
 * The "p" in 1080p has always meant the short side of the frame. A vertical
 * short at 1080p is 1080×1920 — its HEIGHT is 1920, which is already past any
 * naive 1080 cap. Every comparison in this file therefore runs against
 * `shortSide`, so a vertical video is judged the same way a widescreen one is.
 */

export const RENDER_QUALITIES = ['hd', '4k'] as const;
export type RenderQuality = (typeof RENDER_QUALITIES)[number];

export const DEFAULT_QUALITY: RenderQuality = 'hd';

/** What each quality multiplies the composition's own dimensions by. */
export const QUALITY_SCALE: Record<RenderQuality, number> = { hd: 1, '4k': 2 };

/** The resolution class each quality lands in, on the short side. */
export const QUALITY_SHORT_SIDE: Record<RenderQuality, number> = { hd: 1080, '4k': 2160 };

/**
 * How much longer a quality takes than HD, as a round number for the UI.
 *
 * Deliberately the pessimistic end of the measured 3–4× range: somebody who
 * was told four and waited three is pleased, and the reverse is a support
 * email. Not used for any decision the software makes — only for the sentence
 * on the button.
 */
export const QUALITY_SLOWDOWN: Record<RenderQuality, number> = { hd: 1, '4k': 4 };

export function scaleFor(quality: RenderQuality): number {
  return QUALITY_SCALE[quality];
}

/** `1080p` / `4K`, for a label. */
export function qualityLabel(quality: RenderQuality): string {
  return quality === '4k' ? '4K' : '1080p';
}

/** The real pixel dimensions an export lands at — `3840×2160`, `2160×3840`. */
export function dimensionsFor(aspect: Aspect, quality: RenderQuality): { width: number; height: number } {
  const base = ASPECT_DIMENSIONS[aspect];
  const scale = scaleFor(quality);
  return { width: base.width * scale, height: base.height * scale };
}

/**
 * Whether a plan's ceiling admits this quality.
 *
 * `maxRenderHeight` is the plan's resolution class on the short side, so this
 * is a straight comparison — no aspect ratio involved, which is the point.
 */
export function allowsQuality(maxRenderHeight: number, quality: RenderQuality): boolean {
  return QUALITY_SHORT_SIDE[quality] <= maxRenderHeight;
}

/** The best quality a plan may ask for, for defaulting a control. */
export function bestQualityFor(maxRenderHeight: number): RenderQuality {
  return allowsQuality(maxRenderHeight, '4k') ? '4k' : 'hd';
}

/**
 * The quality a finished render turned out to be, read back from its pixels.
 *
 * Renders are stored with their real dimensions rather than a quality flag, so
 * a row written before this existed still describes itself correctly and a
 * label can never disagree with the file it names.
 */
export function qualityOfRender(width: number, height: number): RenderQuality {
  return Math.min(width, height) >= QUALITY_SHORT_SIDE['4k'] ? '4k' : 'hd';
}

/** Anything that is not exactly the 4K string is HD. Never guess upwards. */
export function readQuality(value: unknown): RenderQuality {
  return value === '4k' ? '4k' : 'hd';
}
