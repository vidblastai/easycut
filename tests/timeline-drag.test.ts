import { describe, expect, it } from 'vitest';
import { resolveDrag, reorderIndexFor, type SnapPoint } from '@/lib/timeline/drag';

/** A clip at 4–6s in a 20s video, with a cut at 10s belonging to someone else. */
const BASE = {
  originStart: 4,
  originEnd: 6,
  draggingId: 'mine',
  toleranceSec: 0.25,
  durationSec: 20,
} as const;

const points = (...at: Array<[number, string | null]>): SnapPoint[] =>
  at.map(([a, ownerId]) => ({ at: a, ownerId }));

/** The clip's own edges, as the snap list really contains them. */
const OWN: SnapPoint[] = points([4, 'mine'], [6, 'mine']);

describe('moving a clip', () => {
  it('keeps its length, whatever the snapping does', () => {
    const g = resolveDrag({
      ...BASE,
      kind: 'move',
      deltaSec: 3.9,
      // 8 is close to where the left edge lands (7.9) but nowhere near the right.
      snapPoints: [...OWN, ...points([8, 'other'])],
    });
    expect(g.end - g.start).toBeCloseTo(2, 9);
    expect(g.start).toBeCloseTo(8, 9);
    expect(g.snappedTo).toBe(8);
  });

  it('snaps on whichever edge is nearer, and moves the whole clip', () => {
    // Dragged to 7.7–9.7. The RIGHT edge is 0.05 from 9.75; the left is 1.7
    // from 6. So the clip should shift right by 0.05, not left by 1.7.
    const g = resolveDrag({
      ...BASE,
      kind: 'move',
      deltaSec: 3.7,
      snapPoints: [...OWN, ...points([9.75, 'other'], [6, 'other2'])],
    });
    expect(g.end).toBeCloseTo(9.75, 9);
    expect(g.start).toBeCloseTo(7.75, 9);
    expect(g.end - g.start).toBeCloseTo(2, 9);
  });

  it('does not snap back onto its own edges', () => {
    // A nudge of a twentieth of a second, well inside the snap tolerance of the
    // clip's own starting position. This is the whole reason somebody opens a
    // timeline, and it used to be impossible.
    const g = resolveDrag({ ...BASE, kind: 'move', deltaSec: 0.05, snapPoints: OWN });
    expect(g.start).toBeCloseTo(4.05, 9);
    expect(g.snappedTo).toBeNull();
  });

  it('still snaps to a neighbour that shares its exact start time', () => {
    // Excluding by value rather than by identity loses this one.
    const g = resolveDrag({
      ...BASE,
      kind: 'move',
      deltaSec: 2.98,
      snapPoints: [...OWN, ...points([7, 'neighbour'], [4, 'neighbour'])],
    });
    expect(g.start).toBeCloseTo(7, 9);
    expect(g.snappedTo).toBe(7);
  });

  it('stops at the end of the video instead of being squashed against it', () => {
    const g = resolveDrag({ ...BASE, kind: 'move', deltaSec: 40, snapPoints: OWN });
    expect(g.start).toBeCloseTo(18, 9);
    expect(g.end).toBeCloseTo(20, 9);
    expect(g.end - g.start).toBeCloseTo(2, 9);
  });

  it('stops at zero the same way', () => {
    const g = resolveDrag({ ...BASE, kind: 'move', deltaSec: -40, snapPoints: OWN });
    expect(g.start).toBe(0);
    expect(g.end).toBeCloseTo(2, 9);
  });

  it('reports no snap when the clamp overrode it', () => {
    // 19.9 is inside tolerance of the right edge's landing spot, but honouring
    // it would push the clip past the end — so it is not where the clip is.
    const g = resolveDrag({
      ...BASE,
      kind: 'move',
      deltaSec: 14.1,
      snapPoints: [...OWN, ...points([20.4, 'other'])],
    });
    expect(g.end).toBeLessThanOrEqual(20);
    expect(g.snappedTo).toBeNull();
  });

  it('lets a held modifier turn snapping off', () => {
    const g = resolveDrag({
      ...BASE,
      kind: 'move',
      deltaSec: 3.98,
      snapPoints: [...OWN, ...points([8, 'other'])],
      disableSnap: true,
    });
    expect(g.start).toBeCloseTo(7.98, 9);
    expect(g.snappedTo).toBeNull();
  });
});

describe('trimming a clip', () => {
  it('moves only the edge being dragged', () => {
    const g = resolveDrag({ ...BASE, kind: 'trim-start', deltaSec: 1, snapPoints: OWN });
    expect(g.start).toBeCloseTo(5, 9);
    expect(g.end).toBeCloseTo(6, 9);
  });

  it('cannot be dragged through the other edge', () => {
    const g = resolveDrag({ ...BASE, kind: 'trim-start', deltaSec: 9, snapPoints: OWN });
    expect(g.start).toBeLessThan(g.end);
    expect(g.end - g.start).toBeCloseTo(0.15, 9);
  });

  it('cannot crush a clip from the right either', () => {
    const g = resolveDrag({ ...BASE, kind: 'trim-end', deltaSec: -9, snapPoints: OWN });
    expect(g.start).toBeCloseTo(4, 9);
    expect(g.end - g.start).toBeCloseTo(0.15, 9);
  });

  it('snaps the dragged edge', () => {
    const g = resolveDrag({
      ...BASE,
      kind: 'trim-end',
      deltaSec: 1.9,
      snapPoints: [...OWN, ...points([8, 'other'])],
    });
    expect(g.end).toBe(8);
    expect(g.snappedTo).toBe(8);
  });
});

describe('dragging a sound cue', () => {
  it('has no minimum length to protect', () => {
    const g = resolveDrag({
      ...BASE,
      kind: 'move',
      originStart: 5,
      originEnd: 5,
      deltaSec: 2,
      snapPoints: [],
    });
    expect(g.start).toBeCloseTo(7, 9);
    expect(g.end).toBeCloseTo(7, 9);
  });

  it('can sit on the very last frame', () => {
    const g = resolveDrag({
      ...BASE,
      kind: 'move',
      originStart: 5,
      originEnd: 5,
      deltaSec: 99,
      snapPoints: [],
    });
    expect(g.start).toBe(20);
  });
});

describe('reordering by dragging', () => {
  const segs = [
    { id: 'a', outStartSec: 0, outEndSec: 2 },
    { id: 'b', outStartSec: 2, outEndSec: 4 },
    { id: 'c', outStartSec: 4, outEndSec: 6 },
  ];

  it('is a no-op when a clip is nudged inside its own slot', () => {
    expect(reorderIndexFor(segs, 'a', 0.4)).toBe(0);
  });

  it('counts the clips it passed, not the slots it crossed', () => {
    // Moving `a` to the far right. Naively this lands at index 1 because `a` is
    // still sitting in the list while the neighbours are counted.
    expect(reorderIndexFor(segs, 'a', 5.5)).toBe(2);
  });

  it('moves left correctly too', () => {
    expect(reorderIndexFor(segs, 'c', 0.5)).toBe(0);
    expect(reorderIndexFor(segs, 'c', 2.5)).toBe(1);
  });
});

/* ── the placement rules, exercised through the real reducer ─────────────── */

import { applyOperations } from '@/lib/edl/operations';
import type { Edl } from '@/lib/edl/types';

/** A 20-second edit with two B-roll inserts and nothing else in the way. */
function edlWith(broll: Array<{ id: string; a: number; b: number }>): Edl {
  return {
    version: 1,
    format: { aspect: '9:16', width: 1080, height: 1920, fps: 30, durationSec: 20 },
    source: { url: '', durationSec: 20, width: 1920, height: 1080, fps: 30 },
    segments: [{
      id: 'seg-0', sourceStartSec: 0, sourceEndSec: 20, outStartSec: 0, outEndSec: 20,
      speed: 1, reason: 'keep', text: '',
    }],
    captions: [], graphics: [], overlays: [], punchIns: [], transitions: [], sfx: [],
    broll: broll.map((c) => ({
      id: c.id, outStartSec: c.a, outEndSec: c.b, kind: 'stock-video', url: '',
      clipStartSec: 0, scale: 1, kenBurns: 'in', audioGainDb: -60, opacity: 1,
      intent: '', query: '', attribution: undefined,
    })),
    captionStyle: { emphasisColor: '#fff' },
    audio: { targetLufs: -14 },
    music: null, reframe: null, deliverable: { thumbnailAtSec: 0, title: '', hashtags: [] },
    degraded: [],
  } as unknown as Edl;
}

const brollOf = (edl: Edl) =>
  edl.broll.map((c) => [+c.outStartSec.toFixed(3), +c.outEndSec.toFixed(3)] as const);

describe('placing a clip on a one-at-a-time track', () => {
  it('leaves it where you dropped it when the spot is free', () => {
    const { edl } = applyOperations(edlWith([{ id: 'a', a: 0, b: 2 }]), [
      { op: 'clip.move', track: 'broll', id: 'a', outStartSec: 9 },
    ]);
    expect(brollOf(edl)).toEqual([[9, 11]]);
  });

  it('pushes it clear rather than letting two overlap', () => {
    const { edl } = applyOperations(edlWith([{ id: 'a', a: 0, b: 2 }, { id: 'b', a: 5, b: 7 }]), [
      { op: 'clip.move', track: 'broll', id: 'a', outStartSec: 5.5 },
    ]);
    const [first, second] = brollOf(edl).sort((x, y) => x[0] - y[0]);
    expect(first[1]).toBeLessThanOrEqual(second[0] + 1e-6);
  });

  it('finds the gap when there is no room in the direction it was heading', () => {
    // `a` is dropped at the very end, where `b` already sits with no space
    // behind it. The old push-loop gave up after four passes and returned an
    // overlapping position; the only real answer is the gap in front of `b`.
    const { edl } = applyOperations(edlWith([{ id: 'a', a: 0, b: 2 }, { id: 'b', a: 18, b: 20 }]), [
      { op: 'clip.move', track: 'broll', id: 'a', outStartSec: 19 },
    ]);
    const slots = brollOf(edl).sort((x, y) => x[0] - y[0]);
    expect(slots[0][1]).toBeLessThanOrEqual(slots[1][0] + 1e-6);
    expect(slots.find((s) => s[0] === 16)).toBeTruthy();
  });

  it('falls back to the only slot that fits, even if that is where it started', () => {
    // Everything from 2s on is taken. The single place a 2-second insert fits
    // is 0–2, which is where it already is — so the move is a no-op rather than
    // an error, because there is a correct answer and that is it.
    const { edl, rejected } = applyOperations(
      edlWith([{ id: 'a', a: 0, b: 2 }, { id: 'b', a: 2, b: 11 }, { id: 'c', a: 11, b: 20 }]),
      [{ op: 'clip.move', track: 'broll', id: 'a', outStartSec: 6 }],
    );
    expect(rejected).toHaveLength(0);
    expect(brollOf(edl)).toContainEqual([0, 2]);
  });

  it('refuses when nothing fits anywhere, rather than overlapping', () => {
    const { edl, rejected } = applyOperations(
      edlWith([{ id: 'a', a: 0, b: 2 }, { id: 'b', a: 0, b: 20 }]),
      [{ op: 'clip.move', track: 'broll', id: 'a', outStartSec: 6 }],
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/no room/i);
    // And the document is untouched — a refused edit must not half-apply.
    expect(brollOf(edl)).toContainEqual([0, 2]);
  });

  it('places an ADDED clip clear of what is already there', () => {
    const { edl } = applyOperations(edlWith([{ id: 'a', a: 4, b: 6 }]), [
      { op: 'clip.add', track: 'broll', atSec: 4.5, durationSec: 2, value: '', id: 'new' },
    ]);
    const slots = brollOf(edl).sort((x, y) => x[0] - y[0]);
    expect(slots).toHaveLength(2);
    expect(slots[0][1]).toBeLessThanOrEqual(slots[1][0] + 1e-6);
  });

  it('gives an added clip the id the operation carried', () => {
    // Without this, re-applying the stack renames the clip and every later
    // operation against it fails with "Not found on this track".
    const ops = [{ op: 'clip.add' as const, track: 'broll' as const, atSec: 8, durationSec: 2, value: '', id: 'stable' }];
    const first = applyOperations(edlWith([]), ops).edl.broll[0].id;
    const second = applyOperations(edlWith([]), ops).edl.broll[0].id;
    expect(first).toBe('stable');
    expect(second).toBe('stable');
  });

  it('can move a clip it has just added', () => {
    const { edl, rejected } = applyOperations(edlWith([]), [
      { op: 'clip.add', track: 'broll', atSec: 2, durationSec: 2, value: '', id: 'fresh' },
      { op: 'clip.move', track: 'broll', id: 'fresh', outStartSec: 9 },
    ]);
    expect(rejected).toHaveLength(0);
    expect(brollOf(edl)).toEqual([[9, 11]]);
  });
});
