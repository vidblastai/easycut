import type { Edl, PunchIn, ReframeTrack } from '../../src/lib/edl/types';

/**
 * Resolves the camera for a given output time: where the crop window sits, and
 * how far we're punched in.
 *
 * Both effects are expressed as one transform on the video element rather than
 * as nested scaled containers — nesting scales compounds rounding error and
 * produces a visible 1px shimmer on slow pans.
 */

export interface CameraFrame {
  /** Pixel size to render the source at. */
  width: number;
  height: number;
  /** Pixel offset of the source's top-left corner within the output frame. */
  left: number;
  top: number;
}

export function sampleTrack(track: ReframeTrack | null, outSec: number) {
  if (!track || !track.keyframes.length) return { cx: 0.5, cy: 0.5, w: 1 };
  const kf = track.keyframes;
  if (outSec <= kf[0].outSec) return kf[0];
  if (outSec >= kf[kf.length - 1].outSec) return kf[kf.length - 1];

  for (let i = 1; i < kf.length; i++) {
    if (outSec <= kf[i].outSec) {
      const a = kf[i - 1];
      const b = kf[i];
      const t = (outSec - a.outSec) / (b.outSec - a.outSec || 1);
      // Smoothstep: a linear ramp shows a corner at each keyframe.
      const e = t * t * (3 - 2 * t);
      return { cx: a.cx + (b.cx - a.cx) * e, cy: a.cy + (b.cy - a.cy) * e, w: a.w + (b.w - a.w) * e };
    }
  }
  return kf[kf.length - 1];
}

/** How much extra zoom the active punch-in contributes at this moment. */
export function punchScaleAt(punchIns: PunchIn[], outSec: number, ramp: (from: number, to: number) => number): { scale: number; x: number; y: number } {
  const active = punchIns.find((p) => outSec >= p.outStartSec && outSec <= p.outEndSec);
  if (!active) return { scale: 1, x: 0.5, y: 0.5 };

  const length = active.outEndSec - active.outStartSec;
  // Snap: in fast, hold, out fast. Ramp: a slow creep across the whole hold.
  const inSec = active.easing === 'snap' ? 0.18 : length * 0.45;
  const outSecLen = active.easing === 'snap' ? 0.22 : length * 0.45;

  const enter = ramp(active.outStartSec, active.outStartSec + inSec);
  const exit = 1 - ramp(active.outEndSec - outSecLen, active.outEndSec);
  const amount = Math.min(enter, exit);

  return { scale: 1 + (active.scale - 1) * amount, x: active.x, y: active.y };
}

/**
 * Combines the reframe crop and the punch-in into concrete pixel geometry.
 *
 * `w` is the crop width as a fraction of the source. Rendering the source at
 * `outputWidth / (sourceWidth * w)` makes that crop window exactly fill the
 * frame; the offsets then slide the chosen centre to the middle of the output.
 */
export function cameraFrame(
  edl: Edl,
  crop: { cx: number; cy: number; w: number },
  punch: { scale: number; x: number; y: number },
  /**
   * The box the picture has to fill, when it is not the whole frame.
   *
   * A split screen gives the speaker a little over half the height, which is a
   * different shape from the output — and a crop computed against the output's
   * shape leaves a black bar down one side of the half it is actually in.
   */
  viewport?: { width: number; height: number },
): CameraFrame {
  const { width: outW, height: outH } = viewport ?? edl.format;
  const { width: srcW, height: srcH } = edl.source;

  const cropWidthPx = srcW * crop.w;
  // Never smaller than the box it has to fill. Scaling to the width alone
  // assumes the crop window is at least as tall as the viewport, which is true
  // for a narrow vertical crop of a landscape source and false the moment a
  // layout hands the picture a squarer box — and the failure is a black band
  // down one edge, the most obvious rendering bug there is.
  const baseScale = Math.max(outW / cropWidthPx, outH / srcH);
  const scale = baseScale * punch.scale;

  const renderedW = srcW * scale;
  const renderedH = srcH * scale;

  // Blend the punch-in's focal point in proportion to how far we're zoomed.
  const zoomBlend = punch.scale > 1 ? Math.min(1, (punch.scale - 1) / 0.3) : 0;
  const focusX = crop.cx + (punch.x - crop.cx) * zoomBlend * 0.6;
  const focusY = crop.cy + (punch.y - crop.cy) * zoomBlend * 0.6;

  let left = outW / 2 - focusX * renderedW;
  let top = outH / 2 - focusY * renderedH;

  // Never let the crop run off the edge of the source — a black bar down one
  // side is the most obvious possible rendering bug.
  left = Math.min(0, Math.max(outW - renderedW, left));
  top = Math.min(0, Math.max(outH - renderedH, top));

  return { width: renderedW, height: renderedH, left, top };
}
