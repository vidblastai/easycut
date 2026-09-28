import type React from 'react';
import { describe, expect, it } from 'vitest';
import { clipMotion, clipPhase, clipTransitionSec, CLIP_MOVE_SEC, CLIP_EFFECT_SEC } from '../remotion/lib/clip-transition';
import { CLIP_TRANSITIONS, CLIP_TRANSITION_MOVES, type ClipTransition } from '../src/lib/edl/types';

/**
 * How a full-frame clip arrives and leaves.
 *
 * The failure this replaces was not a crash: a B-roll insert cross-faded in
 * over four frames, which looks less like an edit than like a dropped frame.
 * So the things worth pinning down are the ones that decide whether it reads
 * as deliberate — that it starts fully out and ends fully placed, that the
 * exit continues the movement instead of reversing it, and that an effect
 * flavour snaps rather than fades.
 */

/** The horizontal or vertical travel a transform describes, in per cent. */
function travel(style: React.CSSProperties): { x: number; y: number } {
  // The `%` is optional on a zero component: `translate3d(100%, 0, 0)` is what
  // the browser is given, and a regex that demands both reads every horizontal
  // move as no move at all.
  const match = /translate3d\(([-\d.]+)%?, ([-\d.]+)%?/.exec(String(style.transform ?? ''));
  return match ? { x: Number(match[1]), y: Number(match[2]) } : { x: 0, y: 0 };
}

describe('the shape of a transition', () => {
  it('starts fully out of frame and finishes exactly in place', () => {
    for (const type of CLIP_TRANSITION_MOVES) {
      const out = clipMotion(type, 0, false);
      const placed = clipMotion(type, 1, false);

      if (type === 'zoom') {
        expect(out.opacity).toBe(0);
      } else {
        expect(Math.abs(travel(out).x) + Math.abs(travel(out).y)).toBeCloseTo(100, 4);
      }
      // Landed means landed: a residual half a per cent is a picture that
      // never quite settles.
      expect(travel(placed)).toEqual({ x: 0, y: 0 });
      expect(placed.opacity ?? 1).toBe(1);
    }
  });

  it('travels the way it is named, and keeps going on the way out', () => {
    // `slide-left` TRAVELS left: in from the right edge, out past the left.
    // Reversing on the exit is the tell-tale sign of an animation played
    // backwards, and it is what makes a sequence of inserts read as a
    // slideshow instead of an edit.
    expect(travel(clipMotion('slide-left', 0, false)).x).toBeGreaterThan(0);
    expect(travel(clipMotion('slide-left', 0, true)).x).toBeLessThan(0);

    expect(travel(clipMotion('slide-right', 0, false)).x).toBeLessThan(0);
    expect(travel(clipMotion('slide-right', 0, true)).x).toBeGreaterThan(0);

    expect(travel(clipMotion('slide-up', 0, false)).y).toBeGreaterThan(0);
    expect(travel(clipMotion('slide-up', 0, true)).y).toBeLessThan(0);

    expect(travel(clipMotion('slide-down', 0, false)).y).toBeLessThan(0);
    expect(travel(clipMotion('slide-down', 0, true)).y).toBeGreaterThan(0);
  });

  it('decelerates into place', () => {
    const half = Math.abs(travel(clipMotion('slide-left', 0.5, false)).x);
    // Eased out: half the time means most of the distance already covered.
    expect(half).toBeLessThan(50);
  });

  it('keeps an effect flavour fully opaque while its effect plays', () => {
    // A glitch over a half-faded picture looks like a rendering fault, which
    // is the one thing a glitch effect must not look like.
    for (const type of ['glitch', 'film-burn', 'light-leak', 'flash'] as ClipTransition[]) {
      expect(clipMotion(type, 0.5, false).opacity).toBe(1);
      expect(clipMotion(type, 1, false).opacity).toBe(1);
      // And nothing at all before it begins, so it cannot show a frame early.
      expect(clipMotion(type, 0, false).opacity).toBe(0);
    }
  });

  it('does nothing at all for a cut', () => {
    expect(clipMotion('cut', 0, false)).toEqual({});
    expect(clipTransitionSec('cut')).toBe(0);
  });

  it('gives a move longer than an effect', () => {
    // A move has to be readable; an effect is a snap with a flash over it.
    expect(clipTransitionSec('slide-left')).toBe(CLIP_MOVE_SEC);
    expect(clipTransitionSec('glitch')).toBe(CLIP_EFFECT_SEC);
    expect(CLIP_EFFECT_SEC).toBeLessThan(CLIP_MOVE_SEC);
  });

  it('has a duration for every transition the schema allows', () => {
    // A type with no duration renders as an instant cut, silently.
    for (const type of CLIP_TRANSITIONS) {
      expect(Number.isFinite(clipTransitionSec(type))).toBe(true);
      expect(() => clipMotion(type, 0.5, false)).not.toThrow();
    }
  });
});

describe('measuring both ends', () => {
  it('reads each end from its own edge', () => {
    const { entering, leaving } = clipPhase(0, 90, 10, 10);
    expect(entering).toBe(0);
    expect(leaving).toBe(1);

    const end = clipPhase(90, 90, 10, 10);
    expect(end.entering).toBe(1);
    expect(end.leaving).toBe(0);
  });

  it('degrades rather than jumping when a clip is shorter than its transitions', () => {
    // 12 frames of clip, 10 in and 10 out: the two overlap. Both curves still
    // stay inside 0..1, so the renderer multiplies two partial opacities
    // instead of producing a value that pops.
    for (let frame = 0; frame <= 12; frame++) {
      const { entering, leaving } = clipPhase(frame, 12, 10, 10);
      expect(entering).toBeGreaterThanOrEqual(0);
      expect(entering).toBeLessThanOrEqual(1);
      expect(leaving).toBeGreaterThanOrEqual(0);
      expect(leaving).toBeLessThanOrEqual(1);
    }
  });

  it('treats a zero-length transition as already finished', () => {
    const { entering, leaving } = clipPhase(0, 60, 0, 0);
    expect(entering).toBe(1);
    expect(leaving).toBe(1);
  });
});
