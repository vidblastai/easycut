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
  /** Signal breakup: the picture's OWN pixels torn apart. Absent means intact. */
  shatter?: Shatter;
  /** Film fog, 0..1. Blacks lifted and contrast crushed, the way a leak does it. */
  fog?: number;
}

/**
 * A frame of signal breakup.
 *
 * Everything here is resolution-independent — `blockX`/`blockY` are per-pixel
 * frequencies derived from the frame's own width, so the shards are the same
 * size relative to the picture whether it is rendered at 1080 or previewed at
 * 320. Getting that wrong is what makes an effect that was tuned in the editor
 * come out as fine static in the export.
 */
export interface Shatter {
  /** How far a shard slides, in pixels. */
  shardPx: number;
  /** Turbulence frequency per pixel, across and down. */
  blockX: number;
  blockY: number;
  /** Re-drawn every frame, so the break never holds still. */
  seed: number;
  /** 0..1 — how much of the frame drops to burnt, colourless data. */
  burn: number;
  /** 0..1 — the single frame of blow-out at the moment of the cut. */
  blowout: number;
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
       * The picture coming apart, not bands painted over it.
       *
       * This is the one that was wrong, and it was wrong in a way no amount of
       * tuning fixes: coloured bars drawn ON TOP of an intact frame read as an
       * overlay, because that is exactly what they are. A real digital break
       * has no extra layer in it. The picture's own pixels are what move —
       * blocks of it slide sideways, regions lose their colour and blow out to
       * flat data, and for one frame the whole thing washes white before the
       * next shot tears its way back.
       *
       * ── The three acts, and why they fall out of one number ─────────────
       *
       * `d` is how broken the frame is: 0 intact, 1 at the moment of the cut.
       * Both ends of a clip run the same curve, so the exit's last frame and
       * the entrance's first frame are the two loudest — which puts the
       * blow-out exactly on the join with nothing coordinating them.
       *
       * The exponents are the asymmetry the reference has. Leaving, the shot
       * holds together and then goes in about four frames; arriving, it comes
       * apart at once and takes twice as long to settle. A symmetric curve
       * reads as a stutter — a thing that broke and unbroke — rather than as
       * one shot failing into the next.
       */
      const d = Math.pow(1 - t, leaving ? 2.2 : 1.05);
      if (d <= 0.005) return { ...still, opacity: 1 };

      /*
       * The wash, and why the window is as wide as it is.
       *
       * The reference blows out for exactly one frame, and one frame is what
       * this has to produce — but `d` is not frames, it is a curve, and at
       * nine frames a side the first one lands at 0.88 and the second at 0.78.
       * A threshold at 0.86 therefore fires on NEITHER of them properly: the
       * first gets a third of the wash and the rest get none, which is how the
       * loudest frame of the effect ended up invisible. Opened to 0.72 so the
       * first frame goes fully white and the second carries a trace of it.
       *
       * Note this flavour has no `t > 0.02` opacity guard, unlike the others.
       * They fade a frame in from nothing so an insert cannot flash before the
       * cut that introduces it; here frame zero IS the blow-out, and hiding it
       * throws away the one frame the whole effect is built around.
       */
      const blowout = smoothstep(0.72, 0.95, d);
      // Two axes, because a purely horizontal jump reads as tracking error.
      const jx = (seeded(`${seed}-jx`, Math.floor(frame)) - 0.5) * width * 0.05 * d;
      const jy = (seeded(`${seed}-jy`, Math.floor(frame)) - 0.5) * height * 0.012 * d;

      /*
       * The preview gets the real thing, `cheap` or not.
       *
       * It used to get a jump and an exposure lift instead, on the theory that
       * a filter chain rebuilt thirty times a second was too much for a
       * browser. That was a bad trade and it cost a round of "you didn't ship
       * it": what the editor showed was not a lighter version of the effect,
       * it was a DIFFERENT effect, so the only way to find out what a glitch
       * actually looked like was to export and watch the file.
       *
       * Measured rather than assumed: the chain costs ~45ms a frame at a full
       * 1080x1920 with no GPU at all, and the preview draws the composition
       * scaled to a few hundred pixels, where it is a fraction of that. Even
       * at the worst number it is nine frames at each end of an insert. A
       * third of a second of dropped frames is a far smaller problem than a
       * preview that lies.
       *
       * `cheap` still governs the motion blur, which is what it was built for:
       * a full-frame gaussian on EVERY frame of every move is a different
       * order of cost from a filter on the two ends of an insert.
       */
      return {
        ...still,
        opacity: 1,
        transform: `translate3d(${jx}px, ${jy}px, 0)`,
        shatter: {
          // Eased hard: at half-broken the shards should already be travelling
          // a long way, or the middle of the effect looks like a wobble.
          shardPx: width * 0.55 * Math.pow(d, 1.3),
          // Wide and short — the blocks a failing codec drops are bands, not
          // squares, and a frequency equal in both axes gives cloud, not data.
          blockX: 1.1 / width,
          blockY: 8 / width,
          seed: Math.floor(frame) * 7 + 1,
          burn: d,
          blowout,
        },
      };
    }

    case 'film-burn':
    case 'light-leak': {
      /*
       * What a leak actually does to the stock.
       *
       * The old version was a warm gradient at 85% opacity, and the reason it
       * looked stuck on is that light does not tint a photograph — it exposes
       * it. Stray light hitting film raises the floor: the blacks go milky,
       * the contrast collapses, and the highlights clip. That is a curve with
       * a lifted intercept and a shallower slope, which is what `fog` is, and
       * it is the half of the effect that was missing. The gradient on top is
       * only the shape of the leak; this is the leak being IN the picture.
       */
      const peak = 1 - Math.abs(t * 2 - 1);
      const strength = type === 'film-burn' ? 1 : 0.82;
      return {
        ...still,
        opacity: t > 0.02 ? 1 : 0,
        brightness: 1 + peak * 0.22 * strength,
        fog: peak * strength,
      };
    }

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
 * Everything this frame needs doing to its own pixels, as one SVG filter.
 *
 * SVG rather than CSS because none of the three things here exist in CSS. A
 * CSS `blur()` is isotropic — blur a horizontal slide equally in both axes and
 * it reads as out of focus rather than as moving, where `feGaussianBlur` takes
 * a standard deviation per axis and points somewhere. There is no CSS at all
 * for displacing a picture by a noise field, and none for lifting the black
 * point, which is what fog is.
 *
 * `sRGB` interpolation is not a detail. The default is linearRGB, which
 * lightens every blurred edge and turns a smear into a glow.
 */
export const ClipFrameFilter: React.FC<{ id: string; style: ClipFrameStyle }> = ({ id, style }) => {
  /*
   * A blur has to paint outside the element it came from, so it needs room.
   * Shatter must NOT: it only ever pulls pixels inward, and a region wider
   * than the picture would let a shard land on the footage either side of the
   * insert — a glitch bleeding past the clip that caused it.
   */
  const wide = style.blur.x > 0 || style.blur.y > 0;
  const region = wide
    ? { x: '-25%', y: '-25%', width: '150%', height: '150%' }
    : { x: '0%', y: '0%', width: '100%', height: '100%' };

  return (
    <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true">
      <defs>
        <filter id={id} {...region} colorInterpolationFilters="sRGB">
          {wide ? <feGaussianBlur stdDeviation={`${style.blur.x} ${style.blur.y}`} /> : null}
          {style.shatter ? <ShatterChain shatter={style.shatter} /> : null}
          {style.fog ? <FogChain fog={style.fog} /> : null}
        </filter>
      </defs>
    </svg>
  );
};

/** Kept under its old name for the callers that only ever wanted the smear. */
export const MotionBlurFilter: React.FC<{ id: string; blur: { x: number; y: number } }> = ({ id, blur }) => (
  <ClipFrameFilter id={id} style={{ blur, brightness: 1 }} />
);

/** True when this frame has anything for a filter to do. */
export function clipNeedsFilter(style: ClipFrameStyle): boolean {
  return style.blur.x > 0 || style.blur.y > 0 || style.shatter !== undefined || (style.fog ?? 0) > 0;
}

/** The `filter` value for a clip, or undefined when it needs none. */
export function clipFilter(style: ClipFrameStyle, blurId: string): string | undefined {
  const parts: string[] = [];
  if (clipNeedsFilter(style)) parts.push(`url(#${blurId})`);
  if (style.brightness !== 1) parts.push(`brightness(${style.brightness.toFixed(3)})`);
  return parts.length ? parts.join(' ') : undefined;
}

/**
 * The break, in five primitives.
 *
 *  1. `feTurbulence` — a smooth noise field. On its own it would displace the
 *     picture in curves, which is water, not data.
 *  2. `feComponentTransfer type="discrete"` — this is the whole trick. It
 *     quantises the noise into flat steps, and a displacement map made of flat
 *     steps moves whole REGIONS by the same amount. Hard edges, rectangular
 *     shards, a dropped macroblock. Without this one primitive the effect is
 *     a heat haze.
 *  3. `feDisplacementMap` — slides each region by its step. Pixels pulled from
 *     beyond the frame come back empty, which is exactly the torn gap a real
 *     break leaves.
 *  4. The burnt patches. The same quantised noise is thresholded into a mask
 *     (`feFuncB`, whose table is the only thing that grows with the damage),
 *     and where it bites, the picture is replaced by a colourless, blown-out
 *     copy of itself. Not a colour drawn in — the picture's own luminance,
 *     stripped of chroma and pushed past white. That is what makes the damage
 *     look like it belongs to this shot.
 *  5. The blow-out, one frame wide at the join: saturation pulled out and the
 *     transfer curve lifted bodily, so the frame washes rather than brightens.
 */
const ShatterChain: React.FC<{ shatter: Shatter }> = ({ shatter }) => {
  const { shardPx, blockX, blockY, seed, burn, blowout } = shatter;
  const lit = 1 + blowout * 2.6;
  const floor = blowout * 0.26;

  return (
    <>
      <feTurbulence
        type="fractalNoise"
        baseFrequency={`${blockX.toFixed(6)} ${blockY.toFixed(6)}`}
        numOctaves={1}
        seed={seed}
        result="glitchNoise"
      />
      <feComponentTransfer in="glitchNoise" result="glitchBlocks">
        <feFuncR type="discrete" tableValues="0 0.28 0.44 0.56 0.72 1" />
        {/* Barely a step: vertical displacement should nudge a band, not
            scatter it, or the picture stops being readable as a picture. */}
        <feFuncG type="discrete" tableValues="0.48 0.5 0.52" />
        <feFuncB type="discrete" tableValues={burnTable(burn)} />
      </feComponentTransfer>

      <feDisplacementMap
        in="SourceGraphic"
        in2="glitchBlocks"
        scale={shardPx.toFixed(1)}
        xChannelSelector="R"
        yChannelSelector="G"
        result="glitchTorn"
      />

      <feColorMatrix in="glitchTorn" type="saturate" values="0" result="glitchGrey" />
      <feComponentTransfer in="glitchGrey" result="glitchBurnt">
        <feFuncR type="linear" slope="2.2" intercept="-0.1" />
        <feFuncG type="linear" slope="2.2" intercept="-0.1" />
        <feFuncB type="linear" slope="2.2" intercept="-0.1" />
      </feComponentTransfer>
      {/* Blue channel of the quantised noise → alpha, white everywhere else.
          A mask shaped by the same field that did the tearing, so the burnt
          regions line up with the shards instead of floating over them. */}
      <feColorMatrix
        in="glitchBlocks"
        type="matrix"
        values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 0"
        result="glitchMask"
      />
      <feComposite in="glitchBurnt" in2="glitchMask" operator="in" result="glitchPatches" />
      <feMerge result="glitchBroken">
        <feMergeNode in="glitchTorn" />
        <feMergeNode in="glitchPatches" />
      </feMerge>

      <feColorMatrix type="saturate" values={(1 - blowout * 0.92).toFixed(3)} result="glitchCool" />
      <feComponentTransfer in="glitchCool">
        <feFuncR type="linear" slope={lit.toFixed(3)} intercept={floor.toFixed(3)} />
        <feFuncG type="linear" slope={lit.toFixed(3)} intercept={floor.toFixed(3)} />
        <feFuncB type="linear" slope={lit.toFixed(3)} intercept={floor.toFixed(3)} />
      </feComponentTransfer>
    </>
  );
};

/**
 * How much of the frame drops out, as a discrete table.
 *
 * Eight slots, of which the last few are lit. The count is what rises with the
 * damage — the THRESHOLD staying put is deliberate, because a threshold that
 * slides makes existing patches grow and shrink, and patches that breathe look
 * like an animation. Patches that appear and vanish look like data arriving
 * broken.
 */
function burnTable(burn: number): string {
  const slots = 8;
  const lit = Math.round(clamp01(burn) * 3.4);
  return Array.from({ length: slots }, (_, i) => (i >= slots - lit ? '1' : '0')).join(' ');
}

/**
 * Light in the gate.
 *
 * Stray light does not tint a photograph, it exposes it: the black point comes
 * up, the contrast falls away, and the highlights clip. One transfer curve
 * with a lifted intercept and a shallower slope is the whole of it, and it is
 * the difference between a leak that is in the picture and a gradient that is
 * on top of it. Warmed very slightly, because the light in a leak has come
 * through the back of the film.
 */
const FogChain: React.FC<{ fog: number }> = ({ fog }) => {
  const f = clamp01(fog);
  const slope = 1 - f * 0.4;
  const base = f * 0.34;
  return (
    <feComponentTransfer>
      <feFuncR type="linear" slope={slope.toFixed(3)} intercept={(base * 1.08).toFixed(3)} />
      <feFuncG type="linear" slope={slope.toFixed(3)} intercept={(base * 0.94).toFixed(3)} />
      <feFuncB type="linear" slope={slope.toFixed(3)} intercept={(base * 0.78).toFixed(3)} />
    </feComponentTransfer>
  );
};

/** Hermite ramp — zero below `a`, one above `b`, and smooth at both ends. */
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a || 1));
  return t * t * (3 - 2 * t);
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
      return <Burn intensity={intensity} t={t} cheap={cheap} />;

    case 'light-leak':
      return <Leak intensity={intensity} t={t} direction={direction} cheap={cheap} />;

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
      /*
       * Nothing. The clip's own pixels are what tear.
       *
       * The bands this used to paint were the bug, and they outlived the fix
       * by one release: they were kept for the editor, which meant the preview
       * went on showing the exact effect that had just been thrown away. What
       * you saw while editing and what came out of the export were two
       * different transitions, so the only way to see the real one was to
       * render the file and watch it. See `clipFrameStyle`.
       */
      return null;

    default:
      return null;
  }
}

/**
 * A leak sweeping through the gate.
 *
 * Three passes rather than one gradient, because a single warm band is the
 * thing that read as a sticker. Real stray light arrives as a broad fog with a
 * brighter core somewhere inside it, and the two do not travel together — the
 * core is a reflection off something closer, so it crosses faster. Giving the
 * two layers different speeds is most of what makes this read as light in a
 * lens rather than a shape sliding over a picture.
 *
 * The third pass is the fringe. Light bent by the edge of a lens element
 * splits, and the warm side leads: an amber core with a magenta tail behind
 * it. Tiny, and the only reason it matters is that its absence is what makes
 * a digital flare look digital.
 */
const Leak: React.FC<{ intensity: number; t: number; direction: number; cheap: boolean }> = ({
  intensity,
  t,
  direction,
  cheap,
}) => {
  // -25%..125%, so it is off-frame at both ends rather than parked in view.
  const sweep = (t * 1.5 - 0.25) * direction + (direction < 0 ? 1 : 0);
  const core = sweep * 100;
  const fog = 18 + sweep * 64;
  const screen = cheap ? null : { mixBlendMode: 'screen' as const };

  return (
    <>
      <div
        style={{
          ...COVER,
          opacity: intensity * 0.6,
          background: `radial-gradient(ellipse 62% 130% at ${fog.toFixed(1)}% 46%, rgba(255,214,158,0.85) 0%, rgba(255,158,74,0.38) 38%, rgba(0,0,0,0) 74%)`,
          ...screen,
        }}
      />
      <div
        style={{
          ...COVER,
          opacity: intensity * 0.9,
          background: `radial-gradient(ellipse 18% 84% at ${core.toFixed(1)}% 52%, rgba(255,248,232,0.95) 0%, rgba(255,186,96,0.55) 34%, rgba(0,0,0,0) 72%)`,
          ...screen,
        }}
      />
      <div
        style={{
          ...COVER,
          opacity: intensity * 0.42,
          background: `radial-gradient(ellipse 12% 70% at ${(core - direction * 9).toFixed(1)}% 58%, rgba(255,120,190,0.7) 0%, rgba(0,0,0,0) 70%)`,
          ...screen,
        }}
      />
    </>
  );
};

/**
 * The frame burning through.
 *
 * A burn is not a leak that stayed still. It starts as a hot point and EATS
 * outward — so the thing that has to animate is the size of the hole, not its
 * position, and the giveaway is the rim: film going is brightest just inside
 * the edge that is still curling, not at the centre, which has already gone.
 * Hence two stops close together at the boundary and a near-white middle.
 */
const Burn: React.FC<{ intensity: number; t: number; cheap: boolean }> = ({ intensity, t, cheap }) => {
  // Grows through the effect rather than peaking with it: the hole opens and
  // keeps opening while the picture underneath is already changing.
  const r = 6 + t * 52;
  const screen = cheap ? null : { mixBlendMode: 'screen' as const };

  return (
    <>
      <div
        style={{
          ...COVER,
          opacity: intensity * 0.55,
          background: `radial-gradient(circle at 66% 40%, rgba(255,236,196,0.5) 0%, rgba(255,150,54,0.42) ${(r * 1.6).toFixed(1)}%, rgba(0,0,0,0) ${(r * 2.9).toFixed(1)}%)`,
          ...screen,
        }}
      />
      <div
        style={{
          ...COVER,
          opacity: intensity,
          background: `radial-gradient(circle at 66% 40%, rgba(255,252,244,0.96) 0%, rgba(255,246,222,0.9) ${(r * 0.62).toFixed(1)}%, rgba(255,164,58,0.85) ${(r * 0.92).toFixed(1)}%, rgba(190,62,10,0.3) ${(r * 1.12).toFixed(1)}%, rgba(0,0,0,0) ${(r * 1.5).toFixed(1)}%)`,
          ...screen,
        }}
      />
    </>
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
