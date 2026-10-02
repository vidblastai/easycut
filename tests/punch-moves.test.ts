import { describe, expect, it } from 'vitest';
import { PUNCH_MOVES, PunchInSchema, type PunchMove } from '@/lib/edl/types';
import { punchScaleAt } from '../remotion/lib/reframe';
import { applyOperations } from '@/lib/edl/operations';
import { STYLE_LIST } from '@/lib/styles/presets';
import { SAMPLE_EDL } from '../remotion/sample-edl';
import { EdlSchema, type Edl } from '@/lib/edl/types';

const punch = (move: PunchMove, over: Record<string, unknown> = {}) =>
  PunchInSchema.parse({ id: 'p1', outStartSec: 2, outEndSec: 7, scale: 1.2, x: 0.5, y: 0.42, move, ...over });

/** The linear playhead position between two output seconds, as the renderers pass it. */
const ramp = (at: number) => (from: number, to: number) =>
  Math.min(1, Math.max(0, (at - from) / (to - from || 1)));

const scaleAt = (move: PunchMove, at: number, over: Record<string, unknown> = {}) =>
  punchScaleAt([punch(move, over)], at, ramp(at)).scale;

const samples = (move: PunchMove, steps = 60) =>
  Array.from({ length: steps + 1 }, (_, i) => scaleAt(move, 2 + (5 * i) / steps));

describe('every camera move', () => {
  it('starts and ends on the un-punched framing', () => {
    // Not a style choice: a punch-in is a window on a continuous shot, so a
    // scale that is not 1 at the boundary pops on the very next frame.
    for (const move of PUNCH_MOVES) {
      expect(scaleAt(move, 2), `${move} at its start`).toBeCloseTo(move === 'pull' ? 1.2 : 1, 2);
      expect(scaleAt(move, 7), `${move} at its end`).toBeCloseTo(1, 2);
    }
  });

  it('never overshoots the target by more than a bounce should', () => {
    for (const move of PUNCH_MOVES) {
      const peak = Math.max(...samples(move));
      expect(peak, `${move}`).toBeLessThanOrEqual(move === 'bounce' ? 1.26 : 1.201);
      expect(peak, `${move} never arrives`).toBeGreaterThan(1.1);
    }
  });

  it('leaves the frame alone outside its own window', () => {
    for (const move of PUNCH_MOVES) {
      expect(scaleAt(move, 1.9)).toBe(1);
      expect(scaleAt(move, 7.1)).toBe(1);
    }
  });

  it('is a pure function of the time, so a resumed render matches', () => {
    for (const move of PUNCH_MOVES) {
      expect(samples(move)).toEqual(samples(move));
    }
  });
});

describe('what makes the moves different from each other', () => {
  const peakAt = (move: PunchMove) => {
    const s = samples(move, 100);
    return s.indexOf(Math.max(...s)) / 100;
  };

  it('spends a push’s whole span arriving, and a snap’s first moment', () => {
    // A quarter of the way in, the snap has landed and the push has barely left.
    const quarter = (move: PunchMove) => (scaleAt(move, 3.25) - 1) / 0.2;
    expect(quarter('snap')).toBeGreaterThan(0.95);
    expect(quarter('push')).toBeLessThan(0.45);
  });

  it('makes the speed-ramp’s middle faster than its ends', () => {
    const at = (t: number) => scaleAt('speed-ramp', 2 + t * 5);
    const early = at(0.18) - at(0.06);
    const middle = at(0.42) - at(0.30);
    const late = at(0.66) - at(0.54);
    expect(middle).toBeGreaterThan(early * 2);
    expect(middle).toBeGreaterThan(late * 2);
  });

  it('runs the pull backwards: tight at the top, open at the end', () => {
    expect(scaleAt('pull', 2.2)).toBeGreaterThan(scaleAt('pull', 5));
    expect(scaleAt('pull', 5)).toBeGreaterThan(scaleAt('pull', 6.8));
  });

  it('holds the bounce’s peak past the target and settles back', () => {
    expect(Math.max(...samples('bounce'))).toBeGreaterThan(1.2);
    expect(peakAt('bounce')).toBeLessThan(0.2);
  });
});

describe('the handheld drift', () => {
  const focus = (at: number, move: PunchMove = 'handheld') =>
    punchScaleAt([punch(move, { id: 'drift-1' })], at, ramp(at));

  it('moves the focal point, where every other move holds it still', () => {
    const xs = Array.from({ length: 40 }, (_, i) => focus(2.5 + i * 0.1).x);
    expect(new Set(xs).size).toBeGreaterThan(30);
    expect(new Set(Array.from({ length: 40 }, (_, i) => focus(2.5 + i * 0.1, 'push').x)).size).toBe(1);
  });

  it('stays small enough to be a hand and not a boat', () => {
    for (let at = 2; at <= 7; at += 0.05) {
      expect(Math.abs(focus(at).x - 0.5)).toBeLessThan(0.02);
      expect(Math.abs(focus(at).y - 0.42)).toBeLessThan(0.02);
    }
  });

  it('gives two punch-ins in one video different phases', () => {
    const a = punchScaleAt([punch('handheld', { id: 'a' })], 4, ramp(4)).x;
    const b = punchScaleAt([punch('handheld', { id: 'b' })], 4, ramp(4)).x;
    expect(a).not.toBe(b);
  });
});

describe('reading a punch-in off a stored document', () => {
  it('carries a document written before the field was renamed', () => {
    // `easing` was the key when there were two curves and both were easings.
    const old = PunchInSchema.parse({ id: 'p', outStartSec: 1, outEndSec: 3, easing: 'snap' });
    expect(old.move).toBe('snap');
  });

  it('prefers the new key when a document somehow has both', () => {
    const both = PunchInSchema.parse({ id: 'p', outStartSec: 1, outEndSec: 3, easing: 'snap', move: 'push' });
    expect(both.move).toBe('push');
  });

  it('falls back to the plain move rather than failing on one it has never heard of', () => {
    expect(PunchInSchema.parse({ id: 'p', outStartSec: 1, outEndSec: 3, move: 'dolly-vertigo' }).move).toBe('ramp');
    expect(PunchInSchema.parse({ id: 'p', outStartSec: 1, outEndSec: 3 }).move).toBe('ramp');
  });
});

describe('adding one from the timeline', () => {
  const base = EdlSchema.parse({ ...SAMPLE_EDL, punchIns: [] }) as Edl;
  const added = (value: string) =>
    applyOperations(base, [
      { op: 'clip.add', track: 'punchIns', atSec: 5, durationSec: 2, value, id: 'new-1' },
    ]).edl.punchIns.at(-1)!;

  it('takes the move from the menu item that was clicked', () => {
    expect(added('push').move).toBe('push');
    expect(added('speed-ramp').move).toBe('speed-ramp');
  });

  it('defaults to the one somebody opens a menu to ask for', () => {
    // Not `push`: the builder already scatters those, and nobody reaches for
    // a control to add a move they are not meant to notice.
    expect(added('').move).toBe('speed-ramp');
    expect(added('not-a-move').move).toBe('speed-ramp');
  });

  it('gives a slow push less travel than a quick zoom', () => {
    expect(added('push').scale).toBeLessThan(added('speed-ramp').scale);
  });

  it('can be changed afterwards, which means the field is on the whitelist', () => {
    // A field left off it is dropped in silence, so the control looks like it
    // worked and the camera does the old thing.
    const { edl } = applyOperations(base, [
      { op: 'clip.add', track: 'punchIns', atSec: 5, durationSec: 2, value: 'snap', id: 'new-1' },
      { op: 'clip.update', track: 'punchIns', id: 'new-1', patch: { move: 'bounce' } },
    ]);
    expect(edl.punchIns.at(-1)!.move).toBe('bounce');
  });
});

describe('the moves a style uses', () => {
  it('gives every profile a vocabulary rather than one curve', () => {
    for (const style of STYLE_LIST) {
      for (const [format, pacing] of [['short', style.short], ['long', style.long]] as const) {
        expect(pacing.punchMoves.length, `${style.id} ${format}`).toBeGreaterThan(1);
        for (const move of pacing.punchMoves) expect(PUNCH_MOVES).toContain(move);
      }
    }
  });

  it('leans long form on the move you cannot see and short form on the ones you can', () => {
    for (const style of STYLE_LIST) {
      const slow = (moves: readonly PunchMove[]) => moves.filter((m) => m === 'push' || m === 'handheld').length;
      expect(slow(style.long.punchMoves), `${style.id}`).toBeGreaterThan(slow(style.short.punchMoves));
    }
  });
});
