import type { Edl, PunchIn, ReframeTrack } from '../../src/lib/edl/types';
import { easeInOutQuint, easeOutBack, easeOutCubic, easeOutExpo } from './motion';
import { seeded } from './timing';

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

/**
 * How much extra zoom the active punch-in contributes at this moment.
 *
 * ── One interface, seven moves ──────────────────────────────────────────
 *
 * The caller hands in `ramp(from, to)`, which is the linear 0→1 position of
 * the playhead between two output seconds. Every move below is written as
 * windows into that: where a move puts its TIME is what distinguishes it,
 * far more than how far the camera travels. Which means the two renderers
 * that call this — the export and the editor preview — need no idea the
 * vocabulary grew, and cannot drift apart as it does.
 *
 * ── Every move ends back at 1, and that is not a style choice ───────────
 *
 * A punch-in is a window on a continuous shot. If the scale at `outEndSec`
 * is not 1, the next frame pops back to the un-punched framing and the edit
 * has a visible jump in the middle of a sentence. So even `push`, whose whole
 * character is that it never settles, releases over its last stretch — which
 * is what an operator does anyway when the line lands.
 */
export function punchScaleAt(
  punchIns: PunchIn[],
  outSec: number,
  ramp: (from: number, to: number) => number,
): { scale: number; x: number; y: number } {
  const active = punchIns.find((p) => outSec >= p.outStartSec && outSec <= p.outEndSec);
  if (!active) return { scale: 1, x: 0.5, y: 0.5 };

  const { outStartSec: start, outEndSec: end, move } = active;
  const length = Math.max(0.01, end - start);

  /** The share of the span each move spends arriving and leaving. */
  const window = (inPart: number, outPart: number) => ({
    enter: ramp(start, start + Math.min(inPart, length * 0.8)),
    exit: 1 - ramp(end - Math.min(outPart, length * 0.4), end),
  });

  let amount: number;
  switch (move) {
    /*
     * The creep. Nearly the whole span is the move, so at no point can you
     * see it happening — you only notice afterwards that the shot is tighter.
     */
    case 'push': {
      const { enter, exit } = window(length * 0.86, Math.min(0.6, length * 0.14));
      // Linear, which is the one place in this file an un-eased ramp is
      // right. An ease-out puts two thirds of the travel in the first third
      // of the time, which is a punch-in that then coasts — the opposite of
      // a creep. A constant rate is what makes it impossible to notice.
      amount = Math.min(enter, exit);
      break;
    }

    /*
     * Slow, fast, slow. The fast middle is the emphasis; the slow ends are
     * what let it start and stop without reading as a cut.
     */
    case 'speed-ramp': {
      const { enter, exit } = window(length * 0.72, Math.min(0.45, length * 0.2));
      amount = Math.min(easeInOutQuint(enter), exit);
      break;
    }

    /*
     * A crash zoom: about four frames, which is the number the technique is
     * actually built on. Eased out hard so it lands rather than arriving.
     */
    case 'snap': {
      const { enter, exit } = window(0.13, 0.22);
      amount = Math.min(easeOutExpo(enter), exit);
      break;
    }

    /* Past the mark and back into it. The overshoot is the whole point, so it
       is on the ENTER curve rather than added to the target scale. */
    case 'bounce': {
      const { enter, exit } = window(0.34, 0.26);
      /*
       * Multiplied, where every other move takes the smaller of the two.
       *
       * `min` is right when both curves run 0→1: whichever end is still
       * moving wins. But this curve goes ABOVE 1 — that is the overshoot, and
       * it is the entire move — so `min` against an `exit` sitting at 1
       * through the hold clipped it off exactly, and the bounce rendered as a
       * slightly fast ramp. Nothing about the code looked wrong.
       */
      amount = easeOutBack(enter) * exit;
      break;
    }

    /* A push, plus the drift of somebody holding the camera. See below. */
    case 'handheld': {
      const { enter, exit } = window(length * 0.8, Math.min(0.6, length * 0.18));
      amount = Math.min(enter, exit);
      break;
    }

    /*
     * The reverse: already tight when the shot starts, opening out across it.
     * No enter window at all — an ease-in to a zoom that is meant to be there
     * from frame one would be a push with the ends swapped.
     */
    case 'pull':
      amount = 1 - easeOutCubic(ramp(start, end));
      break;

    /* In, hold, out. The plain one. */
    default: {
      const { enter, exit } = window(length * 0.4, length * 0.4);
      amount = Math.min(easeOutCubic(enter), easeOutCubic(exit));
      break;
    }
  }

  /*
   * The operator's drift.
   *
   * Two sine waves at frequencies that do not divide into each other, so the
   * path never repeats into a figure the eye can lock onto — the same reason
   * the paper tooth is two lattices. Seeded off the punch's own id, so a
   * re-render is identical and two punch-ins in one video do not wobble in
   * unison. The amplitude is deliberately tiny: this is a hand, not a boat.
   */
  const drift =
    move === 'handheld'
      ? {
          x: Math.sin(outSec * 1.7 + seeded(active.id, 0) * 6.28) * 0.012 * amount,
          y: Math.sin(outSec * 2.3 + seeded(active.id, 1) * 6.28) * 0.009 * amount,
        }
      : { x: 0, y: 0 };

  return {
    scale: 1 + (active.scale - 1) * amount,
    x: active.x + drift.x,
    y: active.y + drift.y,
  };
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
