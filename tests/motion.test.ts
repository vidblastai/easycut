import { describe, expect, it } from 'vitest';
import {
  countUp,
  drawOn,
  drift,
  easeOutExpo,
  ghosts,
  kf,
  kfMany,
  popIn,
  revealed,
  riseIn,
  slideIn,
  stagger,
  transformOf,
} from '../remotion/lib/motion';

/**
 * The motion engine's guarantees, as opposed to its taste.
 *
 * Nothing here asserts that a curve looks good — that is what the still sheet
 * is for. What it does assert is the handful of properties the scene renderer
 * silently depends on, every one of which has a matching bug in this file's
 * history: a transform that clamps at rest, a table that holds its last pose
 * instead of drifting past it, a `none` that is never concatenated, and a
 * counter that keeps its unit while it counts.
 */

describe('keyframe tables', () => {
  it('holds the first value before the table starts', () => {
    expect(kf(-40, [[0, 0], [10, 1]])).toBe(0);
    expect(kf(-40, [[5, 0.3], [10, 1]])).toBe(0.3);
  });

  it('holds the last value forever after, rather than extrapolating', () => {
    // A scene that ran past its table and kept moving would drift out of frame
    // on a long hold. Clamping is the whole contract.
    expect(kf(9999, [[0, 0], [10, 1]])).toBe(1);
  });

  it('is monotonic between two rising keys', () => {
    let previous = -Infinity;
    for (let frame = 0; frame <= 20; frame++) {
      const value = kf(frame, [[0, 0], [20, 100]]);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('covers most of the distance early — ease-out, not ease-in-out', () => {
    // The measured signature of every move in the references: ~80% of the
    // travel inside the first third. An in-out curve is barely past 15% there.
    expect(kf(10, [[0, 0], [30, 1]])).toBeGreaterThan(0.8);
  });

  it('reads every channel off one table', () => {
    const at = kfMany(5, [[0, [0, 100]], [10, [50, 0]]], easeOutExpo);
    expect(at).toHaveLength(2);
    expect(at[0]).toBeGreaterThan(0);
    expect(at[1]).toBeLessThan(100);
  });

  it('survives a zero-length span without dividing by it', () => {
    // Two keys on the same frame is a degenerate table, but it is one a
    // generated beat list can produce, and NaN here would blank a whole scene.
    expect(kf(5, [[5, 2], [5, 9]])).toBe(2);
    expect(kf(6, [[5, 2], [5, 9]])).toBe(9);
    expect(Number.isNaN(kf(5, [[5, 2], [5, 9]]))).toBe(false);
  });
});

describe('transforms', () => {
  it('is the string "none" at rest, never an empty one', () => {
    // `transform: ''` is ignored, which is harmless, but `translate(...) none`
    // is INVALID and throws the whole declaration away — which is how a
    // centred graphic silently lost its centring and rendered off-frame.
    expect(transformOf({ opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 })).toBe('none');
  });

  it('never concatenates "none" with anything', () => {
    const moving = transformOf({ opacity: 1, x: 10, y: 0, scale: 1, rotate: 0 });
    expect(moving).not.toContain('none');
    expect(moving).toContain('translate3d');
  });

  it('appends an extra transform after its own', () => {
    expect(transformOf({ opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 }, 'rotateX(10deg)')).toBe('rotateX(10deg)');
  });
});

describe('entries', () => {
  it('starts invisible and ends at rest', () => {
    for (const entry of [riseIn(0, 0), popIn(0, 0), slideIn(0, 0)]) {
      expect(entry.opacity).toBeCloseTo(0, 5);
    }
    const landed = riseIn(60, 0);
    expect(landed.opacity).toBe(1);
    expect(landed.y).toBeCloseTo(0, 5);
  });

  it('has not started before its delay', () => {
    expect(riseIn(3, 10).opacity).toBe(0);
  });

  it('pops from small, not from nothing', () => {
    // Scaling from 0 reads as a magic trick; from 0.6 it reads as a UI.
    expect(popIn(0, 0, 10, 0.6).scale).toBeCloseTo(0.6, 3);
  });

  it('staggers four frames apart by default', () => {
    expect(stagger(0)).toBe(0);
    expect(stagger(3)).toBe(12);
    expect(stagger(2, 6, 10)).toBe(22);
  });
});

describe('ghost motion blur', () => {
  it('draws nothing while the element is at rest', () => {
    // The 90% of a scene that is holding still must not pay for five extra
    // copies of everything.
    expect(ghosts(0)).toEqual([]);
    expect(ghosts(3)).toEqual([]);
  });

  it('trails back along the direction of travel, fading', () => {
    const trail = ghosts(400);
    expect(trail.length).toBe(5);
    expect(trail[0].x).toBeGreaterThan(0);
    expect(trail[4].x).toBeGreaterThan(trail[0].x);
    expect(trail[4].opacity).toBeLessThan(trail[0].opacity);
    expect(Math.max(...trail.map((g) => g.opacity))).toBeLessThan(1);
  });

  it('trails the other way when travel is negative', () => {
    expect(ghosts(-400)[0].x).toBeLessThan(0);
  });
});

describe('countUp', () => {
  it('keeps the unit pinned while the figure climbs', () => {
    expect(countUp(0, 0, 20, '95%')).toBe('0%');
    expect(countUp(200, 0, 20, '95%')).toBe('95%');
  });

  it('keeps a prefix and a magnitude suffix', () => {
    expect(countUp(200, 0, 20, '$1.2M')).toBe('$1.2M');
    expect(countUp(0, 0, 20, '$1.2M')).toBe('$0.0M');
  });

  it('keeps the decimal places the target was written with', () => {
    expect(countUp(200, 0, 10, '3.50x')).toBe('3.50x');
  });

  it('returns a figureless string untouched', () => {
    expect(countUp(5, 0, 10, 'most of them')).toBe('most of them');
  });
});

describe('reveals', () => {
  it('shows nothing before it starts and everything after', () => {
    expect(revealed(-1, 0, 5, 3)).toBe(0);
    expect(revealed(0, 0, 5, 3)).toBe(1);
    expect(revealed(999, 0, 5, 3)).toBe(3);
  });

  it('draws a stroke from nothing to its full length', () => {
    expect(drawOn(0, 0, 10, 400)).toBe(400);
    expect(drawOn(100, 0, 10, 400)).toBeCloseTo(0, 5);
  });
});

describe('drift', () => {
  it('never stops', () => {
    // A documentary insert that settles reads instantly as a still with text
    // on it. That it has no keyframes is the point, so assert it.
    expect(drift(300)).toBeGreaterThan(drift(299));
    expect(drift(9000)).toBeGreaterThan(drift(8999));
  });
});
