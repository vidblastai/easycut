import React from 'react';
import { seeded } from './timing';
import { CLIP_TRANSITION_MOVES, type ClipTransition } from '../../src/lib/edl/types';

/**
 * How a full-frame clip arrives and leaves.
 *
 * ── Why this is not the `Transitions` layer ─────────────────────────────
 *
 * That one decorates a CUT between two shots of the speaker: an effect painted
 * over a moment, with nothing underneath it moving. This one moves the clip.
 * The difference matters because the failure it fixes is specific — a B-roll
 * insert that simply appears and disappears reads as a dropped frame, and no
 * amount of effect painted over that moment fixes it. The picture has to
 * travel.
 *
 * ── Named by where it goes, not where it comes from ─────────────────────
 *
 * `slide-left` TRAVELS left: in from the right edge, out past the left one. So
 * an insert given one move for both ends crosses the frame in a single
 * continuous direction over its whole life, which is what makes a sequence of
 * them feel like an edit rather than a slideshow.
 *
 * ── The thing that made them look broken ────────────────────────────────
 *
 * A slide covers the whole frame in the time it is given. At the first
 * duration this shipped with — ten frames — that is 293 pixels of horizontal
 * travel in ONE frame, and 520 vertical, which is why `slide-up` was the one
 * that looked worst. Nothing about that is a bug in the maths: it is what a
 * hard cut between two positions 520px apart looks like, thirty times a
 * second, with nothing in between. The eye reads it as strobing.
 *
 * Two fixes, and they are the two things a camera does for free:
 *
 *  1. **Time proportional to distance.** A vertical slide in a 9:16 frame
 *     travels 1.78× as far as a horizontal one, so it gets 1.78× as long —
 *     `clipTransitionSec` reads the frame, and both end up moving at roughly
 *     the same pixels per second rather than the same per cent per second.
 *  2. **Motion blur.** A real shutter is open for half the frame, so a moving
 *     subject smears across half its per-frame displacement. That is modelled
 *     exactly: the blur is directional, it follows the travel axis, and its
 *     width is derived from the actual distance covered between this frame and
 *     the last rather than from a constant. Fast frames smear, the settle is
 *     sharp, and the transition stops looking like a slideshow advancing.
 */

/** Pixels per second a move aims for. Distance then decides its duration. */
const MOVE_PX_PER_SEC = 2400;

/** However far it has to go, a move stays inside this. */
const MOVE_SEC_RANGE: readonly [number, number] = [0.42, 0.72];

/** An effect flavour is faster — it is a snap with a flash over it. */
export const CLIP_EFFECT_SEC = 0.22;

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
  if (!CLIP_TRANSITION_MOVES.includes(type)) return CLIP_EFFECT_SEC;

  const travel = travelPx(type, frame);
  const [min, max] = MOVE_SEC_RANGE;
  return Math.min(max, Math.max(min, travel / MOVE_PX_PER_SEC));
}

/** How far the clip actually moves, in pixels. */
function travelPx(type: ClipTransition, frame?: { width: number; height: number }): number {
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

/**
 * The curve.
 *
 * A firm ease-out, but not the steepest one available, and the difference is
 * the whole point: `easeOutCubic` puts 27% of the journey into the first frame
 * of a ten-frame move. This one peaks near 15% over a move of its own length,
 * which is 163 pixels across a 1080-wide frame instead of 293 — and it is
 * still three quarters of the way home by 40% of the time, so it has lost none
 * of the snap.
 */
export const MOVE_EASE = cubicBezier(0.4, 0.6, 0.3, 1);

export interface ClipFrameStyle {
  transform?: string;
  opacity?: number;
  /** Directional motion blur, as a gaussian standard deviation in pixels. */
  blur: { x: number; y: number };
  /** Exposure lift, for the flavours that burn the frame. */
  brightness: number;
}

export interface ClipFrameInput {
  /** 0 = entirely absent, 1 = fully placed. */
  progress: number;
  /** True for the end of the clip's life, so the movement continues. */
  leaving: boolean;
  width: number;
  height: number;
  fps: number;
  /** The frame inside the clip, for effects that need to change every frame. */
  frame: number;
  seed: string;
  /** The editor. Motion blur is an SVG filter and a preview cannot keep time. */
  cheap: boolean;
}

/**
 * Everything the clip itself does on this frame.
 *
 * One function rather than three, because the transform and the blur have to
 * be derived from the SAME position on the curve — computing them separately
 * is how a smear ends up pointing the wrong way on the frame the direction
 * reverses.
 */
export function clipFrameStyle(type: ClipTransition, input: ClipFrameInput): ClipFrameStyle {
  const { progress, leaving, width, height, fps, frame, seed, cheap } = input;
  const t = clamp01(progress);
  const eased = leaving ? 1 - MOVE_EASE(1 - t) : MOVE_EASE(t);
  const away = 1 - eased;
  // Leaving reverses the travel direction, so the movement continues.
  const sign = leaving ? -1 : 1;

  const still: ClipFrameStyle = { blur: { x: 0, y: 0 }, brightness: 1 };

  /** Pixels covered between the previous frame and this one. */
  const stepPx = () => {
    const seconds = clipTransitionSec(type, { width, height });
    const perFrame = 1 / Math.max(1, seconds * fps);
    const before = clamp01(t - perFrame);
    const easedBefore = leaving ? 1 - MOVE_EASE(1 - before) : MOVE_EASE(before);
    return Math.abs(eased - easedBefore) * travelPx(type, { width, height });
  };

  switch (type) {
    case 'slide-left':
      return { ...still, transform: `translate3d(${sign * away * 100}%, 0, 0)`, blur: smear(stepPx(), 'x', cheap) };
    case 'slide-right':
      return { ...still, transform: `translate3d(${sign * away * -100}%, 0, 0)`, blur: smear(stepPx(), 'x', cheap) };
    case 'slide-up':
      return { ...still, transform: `translate3d(0, ${sign * away * 100}%, 0)`, blur: smear(stepPx(), 'y', cheap) };
    case 'slide-down':
      return { ...still, transform: `translate3d(0, ${sign * away * -100}%, 0)`, blur: smear(stepPx(), 'y', cheap) };

    case 'zoom': {
      // Scale and fade together: a zoom with no fade reads as the frame
      // shaking rather than as something arriving. The blur is even here —
      // the movement is radial, so there is no axis to favour.
      const both = smear(stepPx(), 'x', cheap).x;
      return {
        ...still,
        transform: `scale(${1 + away * (leaving ? 0.14 : -0.14)})`,
        opacity: eased,
        blur: { x: both, y: both },
      };
    }

    case 'whip':
      /*
       * A whip pan IS the blur. The shove is only there to give it a
       * direction, which is why this one asks for more smear than its
       * displacement alone would earn.
       */
      return {
        ...still,
        transform: `translate3d(${sign * away * 34}%, 0, 0)`,
        opacity: Math.min(1, eased * 2.5),
        blur: smear(stepPx() * 2.2, 'x', cheap),
      };

    case 'glitch': {
      /*
       * A snap plus a tear.
       *
       * The clip is fully there — a glitch over a half-faded picture looks
       * like a rendering fault, which is the one thing a glitch must not look
       * like — but it jumps sideways a few pixels per frame while the effect
       * plays. That jitter is what sells it as a broken signal rather than as
       * coloured bands drawn on top of a still picture.
       */
      const shake = (seeded(`${seed}-tear`, Math.floor(frame)) - 0.5) * width * 0.035 * (1 - Math.abs(t * 2 - 1));
      return { ...still, opacity: t > 0.02 ? 1 : 0, transform: `translate3d(${shake}px, 0, 0)` };
    }

    case 'film-burn':
    case 'light-leak':
      // The overlay paints the flare; this is the exposure lifting under it.
      // Without it the gradient sits ON the picture instead of in it.
      return { ...still, opacity: t > 0.02 ? 1 : 0, brightness: 1 + (1 - Math.abs(t * 2 - 1)) * 0.22 };

    case 'flash':
      return { ...still, opacity: t > 0.02 ? 1 : 0 };

    case 'fade':
      // A hair of scale, so a dissolve is not a dead one. Too small to read as
      // a zoom, big enough that the frame is doing something while it arrives.
      return { ...still, opacity: eased, transform: `scale(${1 + away * (leaving ? 0.025 : -0.025)})` };

    case 'cut':
    default:
      return still;
  }
}

/**
 * The smear a shutter would leave.
 *
 * A film camera's shutter is open for about half the frame, so a subject
 * moving `step` pixels between frames is exposed across half of that. A
 * gaussian approximating a box of length L wants a standard deviation near
 * L/3.5, hence the seventh.
 *
 * Capped, because past a point the blur stops reading as speed and starts
 * reading as a fault; and floored at nothing, so the settled frames are sharp
 * rather than permanently soft.
 */
function smear(stepPx: number, axis: 'x' | 'y', cheap: boolean): { x: number; y: number } {
  if (cheap) return { x: 0, y: 0 };
  const sigma = Math.min(48, stepPx / 7);
  if (sigma < 0.6) return { x: 0, y: 0 };
  return axis === 'x' ? { x: sigma, y: 0 } : { x: 0, y: sigma };
}

/**
 * The SVG filter the blur is drawn with.
 *
 * SVG rather than CSS `filter: blur()` because CSS blur is isotropic: a
 * horizontal slide blurred equally in both axes reads as out of focus, not as
 * moving. `feGaussianBlur` takes a standard deviation per axis, which is the
 * only way to get a smear that points somewhere.
 *
 * `sRGB` interpolation is not a detail — the default is linearRGB, which
 * lightens every blurred edge and makes the smear look like a glow.
 */
export const MotionBlurFilter: React.FC<{ id: string; blur: { x: number; y: number } }> = ({ id, blur }) => (
  <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
    <defs>
      <filter id={id} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
        <feGaussianBlur stdDeviation={`${blur.x} ${blur.y}`} />
      </filter>
    </defs>
  </svg>
);

/** The `filter` value for a clip, or undefined when it needs none. */
export function clipFilter(style: ClipFrameStyle, blurId: string): string | undefined {
  const parts: string[] = [];
  if (style.blur.x > 0 || style.blur.y > 0) parts.push(`url(#${blurId})`);
  if (style.brightness !== 1) parts.push(`brightness(${style.brightness.toFixed(3)})`);
  return parts.length ? parts.join(' ') : undefined;
}

/**
 * The effect painted over the moment of arrival or departure.
 *
 * Returns null for the moves, which need nothing on top. `intensity` peaks at
 * the midpoint of the transition and is zero at both ends, so the effect never
 * lingers over a settled clip.
 */
export function ClipTransitionEffect({
  type,
  progress,
  leaving,
  seed,
  frame,
  width,
  height,
  cheap,
}: {
  type: ClipTransition;
  progress: number;
  leaving: boolean;
  seed: string;
  frame: number;
  width: number;
  height: number;
  cheap: boolean;
}): React.ReactElement | null {
  const t = clamp01(progress);
  // Strongest where the clip is half-placed, gone once it has settled.
  const intensity = 1 - Math.abs(t * 2 - 1);
  if (intensity <= 0.01) return null;

  const direction = leaving ? -1 : 1;

  switch (type) {
    case 'flash':
      return <div style={{ ...COVER, background: '#FFFFFF', opacity: intensity * 0.5 }} />;

    case 'film-burn':
      return (
        <div
          style={{
            ...COVER,
            opacity: intensity * 0.75,
            background:
              'radial-gradient(circle at 68% 42%, rgba(255,176,90,0.9) 0%, rgba(255,110,40,0.45) 32%, rgba(0,0,0,0) 66%)',
            ...(cheap ? null : { mixBlendMode: 'screen' as const }),
          }}
        />
      );

    case 'light-leak':
      return (
        <div
          style={{
            ...COVER,
            opacity: intensity * 0.85,
            background:
              'linear-gradient(105deg, rgba(0,0,0,0) 28%, rgba(255,196,120,0.8) 47%, rgba(255,120,60,0.5) 56%, rgba(0,0,0,0) 74%)',
            transform: `translateX(${(t * 2 - 1) * direction * width * 0.9}px)`,
            ...(cheap ? null : { mixBlendMode: 'screen' as const }),
          }}
        />
      );

    case 'whip':
      return (
        <div
          style={{
            ...COVER,
            opacity: intensity,
            background: `linear-gradient(${direction > 0 ? 90 : 270}deg, rgba(13,13,16,0.9) 0%, rgba(13,13,16,0) 55%)`,
          }}
        />
      );

    case 'glitch':
      return <Glitch intensity={intensity} seed={seed} frame={frame} width={width} height={height} cheap={cheap} />;

    default:
      return null;
  }
}

/**
 * Torn bands, offset sideways.
 *
 * The bands' positions are fixed for the life of the clip and only their
 * horizontal offset changes per frame. Re-seeding the `top` and `height` every
 * frame — the obvious way to write this — is a layout pass thirty times a
 * second for movement nobody can follow at this speed.
 */
const Glitch: React.FC<{
  intensity: number;
  seed: string;
  frame: number;
  width: number;
  height: number;
  cheap: boolean;
}> = ({ intensity, seed, frame, width, height, cheap }) => {
  const bands = React.useMemo(() => Array.from({ length: 8 }, (_, i) => seeded(`clip-glitch-${seed}`, i)), [seed]);

  return (
    <div style={{ ...COVER, opacity: intensity }}>
      {bands.map((band, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: band * height,
            height: height * (0.008 + band * 0.028),
            background: i % 2 === 0 ? 'rgba(155,123,255,0.55)' : 'rgba(245,245,247,0.25)',
            transform: `translateX(${(seeded(`clip-glitch-${seed}-${Math.floor(frame)}`, i) - 0.5) * width * 0.14}px)`,
            ...(cheap ? null : { mixBlendMode: 'screen' as const }),
          }}
        />
      ))}
    </div>
  );
};

const COVER: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * A cubic-bezier timing function, the way a design tool means it.
 *
 * The x axis is solved by bisection rather than Newton: it runs a fixed 24
 * times, which is exact enough for a curve sampled at thirty frames a second
 * and cannot fail to converge on the flat sections where Newton stalls.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a: number, b: number, t: number) =>
    3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let low = 0;
    let high = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2;
      if (at(x1, x2, mid) < x) low = mid;
      else high = mid;
    }
    return at(y1, y2, (low + high) / 2);
  };
}

/**
 * The two transitions, shrunk to fit a clip that cannot hold both.
 *
 * A vertical slide wants 22 frames at each end. A 1.5-second insert has 45
 * frames in total, so a full pair would leave it one frame of stillness in the
 * middle — arriving and immediately leaving, which reads as a wobble rather
 * than as an insert. Scaled down together so the ratio between them survives,
 * and only ever down.
 */
export function fitTransitions(
  durationInFrames: number,
  enterFrames: number,
  exitFrames: number,
  /** The most of the clip the two may spend between them. */
  budget = 0.6,
): { enterFrames: number; exitFrames: number } {
  const total = enterFrames + exitFrames;
  if (total <= 0) return { enterFrames, exitFrames };

  const allowed = durationInFrames * budget;
  if (total <= allowed) return { enterFrames, exitFrames };

  const scale = allowed / total;
  return {
    enterFrames: Math.max(1, Math.round(enterFrames * scale)),
    exitFrames: Math.max(1, Math.round(exitFrames * scale)),
  };
}

/**
 * How far through its entrance and its exit a clip is, on a given frame.
 *
 * Both as 0..1, and both independent: a clip shorter than its two transitions
 * put together would otherwise have them fight, so each is measured from its
 * own end and the renderer multiplies the two opacities.
 */
export function clipPhase(
  frame: number,
  durationInFrames: number,
  enterFrames: number,
  exitFrames: number,
): { entering: number; leaving: number } {
  const entering = enterFrames <= 0 ? 1 : clamp01(frame / enterFrames);
  const leaving = exitFrames <= 0 ? 1 : clamp01((durationInFrames - frame) / exitFrames);
  return { entering, leaving };
}
