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
 * ── One curve, both ends ────────────────────────────────────────────────
 *
 * `progress` is 0 when the clip is entirely absent and 1 when it is fully
 * placed, whichever end is being animated. The caller decides the direction;
 * everything here reads a single number, which is why the enter and the exit
 * of the same clip cannot drift apart.
 */

/** Seconds a move takes. Short: this is punctuation, not a set piece. */
export const CLIP_MOVE_SEC = 0.34;

/** An effect flavour is faster still — it is a snap with a flash over it. */
export const CLIP_EFFECT_SEC = 0.22;

export function clipTransitionSec(type: ClipTransition): number {
  if (type === 'cut') return 0;
  return CLIP_TRANSITION_MOVES.includes(type) ? CLIP_MOVE_SEC : CLIP_EFFECT_SEC;
}

/**
 * The clip's own transform, for one end of its life.
 *
 * `leaving` mirrors the travel so the clip continues in the direction it came
 * from rather than reversing back out the way it entered — reversing is the
 * tell-tale sign of an animation played backwards.
 */
export function clipMotion(
  type: ClipTransition,
  progress: number,
  leaving: boolean,
): React.CSSProperties {
  const t = clamp01(progress);
  // Eased so the clip decelerates into place and accelerates out of frame.
  const eased = leaving ? 1 - easeInCubic(1 - t) : easeOutCubic(t);
  const away = 1 - eased;
  // Leaving reverses the travel direction, so the movement continues.
  const sign = leaving ? -1 : 1;

  switch (type) {
    case 'slide-left':
      return { transform: `translate3d(${sign * away * 100}%, 0, 0)` };
    case 'slide-right':
      return { transform: `translate3d(${sign * away * -100}%, 0, 0)` };
    case 'slide-up':
      return { transform: `translate3d(0, ${sign * away * 100}%, 0)` };
    case 'slide-down':
      return { transform: `translate3d(0, ${sign * away * -100}%, 0)` };

    case 'zoom':
      // Scale and fade together: a zoom with no fade reads as the frame
      // shaking rather than as something arriving.
      return { transform: `scale(${1 + away * (leaving ? 0.14 : -0.14)})`, opacity: eased };

    case 'whip':
      // A hard shove with a blur-like smear, the read of a whip pan without
      // the full-frame filter that costs a repaint on every frame of it.
      return { transform: `translate3d(${sign * away * 34}%, 0, 0) scaleX(${1 + away * 0.3})`, opacity: Math.min(1, eased * 2.5) };

    case 'fade':
      return { opacity: eased };

    case 'glitch':
    case 'film-burn':
    case 'light-leak':
    case 'flash':
      /*
       * A snap, not a fade.
       *
       * These are carried by the overlay below, and the clip underneath has to
       * be fully there while the effect plays — a glitch over a half-faded
       * picture looks like a rendering fault, which is the one thing a glitch
       * effect must not look like.
       */
      return { opacity: t > 0.02 ? 1 : 0 };

    case 'cut':
    default:
      return {};
  }
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
      return (
        <div style={{ ...COVER, background: '#FFFFFF', opacity: intensity * 0.5 }} />
      );

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

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number): number {
  return t * t * t;
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
