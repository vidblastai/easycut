import type React from 'react';
import { describe, expect, it } from 'vitest';
import {
  CLIP_EFFECT_SEC,
  clipFrameStyle,
  clipPhase,
  clipTransitionSec,
  MOVE_EASE,
  cubicBezier,
  fitTransitions,
  type ClipFrameStyle,
} from '../remotion/lib/clip-transition';
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

const FRAME = { width: 1080, height: 1920 };

/** One frame of a transition, with everything but the position held steady. */
function at(type: Parameters<typeof clipFrameStyle>[0], progress: number, leaving = false, frame = 0): ClipFrameStyle {
  return clipFrameStyle(type, { ...FRAME, progress, leaving, fps: 30, frame, seed: 'test', cheap: false });
}

/** The horizontal or vertical travel a transform describes, in per cent. */
function travel(style: { transform?: string }): { x: number; y: number } {
  // The `%` is optional on a zero component: `translate3d(100%, 0, 0)` is what
  // the browser is given, and a regex that demands both reads every horizontal
  // move as no move at all.
  const match = /translate3d\(([-\d.]+)%?, ([-\d.]+)%?/.exec(String(style.transform ?? ''));
  return match ? { x: Number(match[1]), y: Number(match[2]) } : { x: 0, y: 0 };
}

describe('the shape of a transition', () => {
  it('starts fully out of frame and finishes exactly in place', () => {
    for (const type of CLIP_TRANSITION_MOVES) {
      const out = at(type, 0);
      const placed = at(type, 1);

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
    expect(travel(at('slide-left', 0)).x).toBeGreaterThan(0);
    expect(travel(at('slide-left', 0, true)).x).toBeLessThan(0);

    expect(travel(at('slide-right', 0)).x).toBeLessThan(0);
    expect(travel(at('slide-right', 0, true)).x).toBeGreaterThan(0);

    expect(travel(at('slide-up', 0)).y).toBeGreaterThan(0);
    expect(travel(at('slide-up', 0, true)).y).toBeLessThan(0);

    expect(travel(at('slide-down', 0)).y).toBeLessThan(0);
    expect(travel(at('slide-down', 0, true)).y).toBeGreaterThan(0);
  });

  it('decelerates into place', () => {
    const half = Math.abs(travel(at('slide-left', 0.5)).x);
    // Eased out: half the time means most of the distance already covered.
    expect(half).toBeLessThan(50);
  });

  it('never jumps more than a sixth of its travel in one frame', () => {
    /*
     * The thing that made these look broken. At ten frames and `easeOutCubic`
     * the first frame of a slide covered 27% of its travel — 520 pixels for a
     * vertical slide in 9:16, in one frame, with nothing in between. The eye
     * reads that as strobing, and no amount of blur rescues it.
     */
    for (const type of ['slide-left', 'slide-up'] as const) {
      const frames = Math.round(30 * clipTransitionSec(type, FRAME));
      let worst = 0;
      for (let f = 1; f <= frames; f++) {
        const a = travel(at(type, (f - 1) / frames));
        const b = travel(at(type, f / frames));
        worst = Math.max(worst, Math.abs(a.x - b.x) + Math.abs(a.y - b.y));
      }
      expect(worst).toBeLessThan(17);
    }
  });

  it('keeps an effect flavour fully opaque while its effect plays', () => {
    // A glitch over a half-faded picture looks like a rendering fault, which
    // is the one thing a glitch effect must not look like.
    for (const type of ['glitch', 'film-burn', 'light-leak', 'flash'] as ClipTransition[]) {
      expect(at(type, 0.5).opacity).toBe(1);
      expect(at(type, 1).opacity).toBe(1);
    }
    // And nothing at all before they begin, so they cannot show a frame early.
    for (const type of ['film-burn', 'light-leak', 'flash'] as ClipTransition[]) {
      expect(at(type, 0).opacity).toBe(0);
    }
    // The glitch is the exception, and deliberately: its first frame is the
    // blow-out. Fading it in from nothing hides the loudest frame the effect
    // has, which is what made the rebuilt version look like it did nothing.
    expect(at('glitch', 0).opacity).toBe(1);
    expect(at('glitch', 0).shatter!.blowout).toBeGreaterThan(0.9);
  });

  it('does nothing at all for a cut', () => {
    expect(at('cut', 0)).toEqual({ blur: { x: 0, y: 0 }, brightness: 1 });
    expect(clipTransitionSec('cut', FRAME)).toBe(0);
  });

  it('gives a move longer than an effect', () => {
    // A move has to be readable; an effect is a snap with a flash over it.
    expect(clipTransitionSec('slide-left', FRAME)).toBeGreaterThan(CLIP_EFFECT_SEC);
    expect(clipTransitionSec('flash', FRAME)).toBe(CLIP_EFFECT_SEC);
    expect(clipTransitionSec('film-burn', FRAME)).toBe(CLIP_EFFECT_SEC);
  });

  it('gives the glitch longer than the other effects, and still less than a move', () => {
    /*
     * Measured, not guessed. The reference cut this was rebuilt from runs
     * thirteen frames at thirty — five of the outgoing shot breaking up, one
     * of blow-out, seven of the incoming shot settling — and half of that is
     * nine frames a side. At the old 0.22s it got six, which is why it read as
     * a stutter: not enough frames for anything to come apart IN.
     */
    expect(clipTransitionSec('glitch', FRAME)).toBeGreaterThan(CLIP_EFFECT_SEC);
    expect(clipTransitionSec('glitch', FRAME)).toBeLessThan(clipTransitionSec('slide-left', FRAME));
  });

  it('tears the clip\'s own pixels rather than painting bands over them', () => {
    /*
     * The bug this replaced was not a value out by a bit. Coloured bars drawn
     * on top of an INTACT picture read as an overlay however they are tuned,
     * because that is what they are, so the thing worth pinning is that the
     * frame itself is damaged: a displacement, growing as the cut approaches,
     * and a blow-out that exists only at the join.
     */
    const far = at('glitch', 0.9);
    const near = at('glitch', 0.1);
    expect(far.shatter).toBeDefined();
    expect(near.shatter).toBeDefined();
    expect(near.shatter!.shardPx).toBeGreaterThan(far.shatter!.shardPx * 4);
    expect(near.shatter!.blowout).toBeGreaterThan(0);
    expect(far.shatter!.blowout).toBe(0);
    // Settled means settled: no filter left running over a clip that has
    // arrived, which would cost a filter pass on every frame of its life.
    expect(at('glitch', 1).shatter).toBeUndefined();
  });

  it('breaks late on the way out and settles slowly on the way in', () => {
    // The asymmetry the reference has: a shot holds together and then goes,
    // where the one arriving is already broken and takes twice as long to
    // clean up. Symmetric, it reads as a thing that broke and unbroke.
    const out = at('glitch', 0.5, true).shatter!.shardPx;
    const into = at('glitch', 0.5).shatter!.shardPx;
    expect(into).toBeGreaterThan(out * 1.5);
  });

  it('puts the leak in the picture, not on top of it', () => {
    // Stray light exposes film, it does not tint it: the black point comes up
    // and the contrast falls away. Without that the gradient is a sticker.
    expect(at('light-leak', 0.5).fog).toBeGreaterThan(0);
    expect(at('film-burn', 0.5).fog).toBeGreaterThan(0);
    // And it is gone once the transition is over.
    expect(at('light-leak', 1).fog).toBe(0);
  });

  it('gives a longer move more time, so both travel at the same speed', () => {
    // A vertical slide in 9:16 crosses 1.78x the distance of a horizontal one.
    // Equal frame counts are what made `slide-up` the one that looked worst.
    const across = clipTransitionSec('slide-left', FRAME);
    const up = clipTransitionSec('slide-up', FRAME);
    expect(up).toBeGreaterThan(across);

    // And in a wide frame it is the other way round.
    const wide = { width: 1920, height: 1080 };
    expect(clipTransitionSec('slide-left', wide)).toBeGreaterThan(clipTransitionSec('slide-up', wide));
  });

  it('has a duration for every transition the schema allows', () => {
    // A type with no duration renders as an instant cut, silently.
    for (const type of CLIP_TRANSITIONS) {
      expect(Number.isFinite(clipTransitionSec(type, FRAME))).toBe(true);
      expect(() => at(type, 0.5)).not.toThrow();
    }
  });
});

describe('the smear', () => {
  it('blurs along the axis the clip travels, and only that axis', () => {
    // CSS `blur()` is isotropic, and a horizontal slide blurred equally in
    // both axes reads as out of focus rather than as moving.
    const across = at('slide-left', 0.1).blur;
    expect(across.x).toBeGreaterThan(0);
    expect(across.y).toBe(0);

    const up = at('slide-up', 0.1).blur;
    expect(up.y).toBeGreaterThan(0);
    expect(up.x).toBe(0);
  });

  it('tracks how fast the clip is actually moving', () => {
    // Heaviest where the curve is steepest, gone once it has settled — a
    // constant blur would leave the held frames permanently soft.
    const early = at('slide-left', 0.08).blur.x;
    const late = at('slide-left', 0.95).blur.x;
    expect(early).toBeGreaterThan(late);
    expect(at('slide-left', 1).blur.x).toBe(0);
  });

  it('never smears so far it reads as a fault rather than as speed', () => {
    for (const type of ['slide-left', 'slide-up', 'whip'] as const) {
      for (let p = 0; p <= 1; p += 0.05) {
        expect(at(type, p).blur.x + at(type, p).blur.y).toBeLessThanOrEqual(48);
      }
    }
  });

  it('is off in the editor, where a preview has to keep time', () => {
    const preview = clipFrameStyle('slide-up', {
      ...FRAME, progress: 0.1, leaving: false, fps: 30, frame: 2, seed: 'x', cheap: true,
    });
    expect(preview.blur).toEqual({ x: 0, y: 0 });
  });

  it('lifts the exposure under a burn instead of only painting over it', () => {
    // Without it the gradient sits ON the picture rather than in it.
    expect(at('film-burn', 0.5).brightness).toBeGreaterThan(1);
    expect(at('light-leak', 0.5).brightness).toBeGreaterThan(1);
    expect(at('slide-left', 0.5).brightness).toBe(1);
  });
});

describe('the curve', () => {
  // The renderer's own, not a copy of its control points: a test that rebuilds
  // the curve passes happily while the one on screen is something else.
  const ease = MOVE_EASE;

  it('runs from nothing to one, monotonically', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let previous = 0;
    for (let t = 0.05; t <= 1; t += 0.05) {
      const value = ease(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('front-loads the journey without the jump a cubic ease-out takes', () => {
    // Past halfway by the time a third of the time has gone…
    expect(ease(0.33)).toBeGreaterThan(0.5);
    // …but nothing like `easeOutCubic`, which is at 0.70 by then.
    expect(ease(0.33)).toBeLessThan(1 - Math.pow(1 - 0.33, 3));
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

describe('fitting two transitions into a short clip', () => {
  it('leaves a clip with room to spare alone', () => {
    // 90 frames, 22 in and 22 out: that is half the clip, and half is fine.
    expect(fitTransitions(90, 22, 22)).toEqual({ enterFrames: 22, exitFrames: 22 });
  });

  it('shrinks both when the pair would eat the clip', () => {
    // A 1.5s insert is 45 frames. A full pair of vertical slides is 44 of
    // them, which leaves one frame of stillness in the middle — arriving and
    // immediately leaving, which reads as a wobble rather than an insert.
    const fitted = fitTransitions(45, 22, 22);
    expect(fitted.enterFrames + fitted.exitFrames).toBeLessThanOrEqual(45 * 0.6 + 1);
    expect(fitted.enterFrames).toBeGreaterThan(0);
  });

  it('keeps the two in proportion to each other', () => {
    // A slow way in and a quick way out stays a slow way in.
    const fitted = fitTransitions(30, 20, 10);
    expect(fitted.enterFrames / fitted.exitFrames).toBeCloseTo(2, 0);
  });

  it('only ever shrinks', () => {
    const fitted = fitTransitions(300, 12, 12);
    expect(fitted).toEqual({ enterFrames: 12, exitFrames: 12 });
  });

  it('never shrinks a transition out of existence', () => {
    const fitted = fitTransitions(4, 22, 22);
    expect(fitted.enterFrames).toBeGreaterThanOrEqual(1);
    expect(fitted.exitFrames).toBeGreaterThanOrEqual(1);
  });
});
