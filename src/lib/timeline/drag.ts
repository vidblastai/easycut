import type { Edl } from '@/lib/edl/types';

/**
 * Where a clip goes while you are dragging it.
 *
 * This is deliberately a pure function rather than a few lines inside the
 * timeline component, because every bug it has ever had was an arithmetic bug
 * that a test would have caught in a second and a person dragging a clip
 * catches only as "that felt wrong":
 *
 *  - A **move** used to snap its two edges independently, so a clip whose left
 *    edge landed near a cut while its right edge did not would change LENGTH as
 *    you dragged it. Worse, only the start was committed on release, so the
 *    thing you dropped was not the thing you had been looking at.
 *  - The snap candidates included **the dragged clip's own edges**, so nudging
 *    a clip a tenth of a second pulled it straight back to where it started.
 *    Small adjustments — the entire reason somebody opens a timeline — were
 *    impossible.
 *  - Each edge was clamped to the video separately, so dragging a clip past the
 *    end squashed it against the boundary instead of stopping it.
 *
 * The rules it implements are the ones every editor shares:
 *
 *  1. A move preserves length. Always. It is one rigid object.
 *  2. A move snaps as a whole: whichever of its two edges is nearest a point of
 *     interest wins, and the entire clip shifts by that gap.
 *  3. A trim moves one edge only, and cannot invert or crush the clip.
 *  4. Nothing leaves the video.
 *  5. What snapped is reported, so the interface can draw the line it landed on.
 *     Snapping you cannot see reads as the timeline jumping on its own.
 */

export type DragKind = 'move' | 'trim-start' | 'trim-end';

/** A time worth landing on exactly, and who it belongs to. */
export interface SnapPoint {
  at: number;
  /**
   * The item whose edge this is, or null for the ruler's own points — the
   * start, the end, the playhead.
   *
   * Carried so a dragged clip can be excluded by identity rather than by value.
   * Excluding by value silently drops a neighbour that happens to share the
   * exact same time, which on a cut-to-cut timeline is most of them.
   */
  ownerId: string | null;
}

export interface DragInput {
  kind: DragKind;
  /** Where the item was when the gesture started. */
  originStart: number;
  originEnd: number;
  /** How far the pointer has travelled, in seconds at the current zoom. */
  deltaSec: number;
  snapPoints: readonly SnapPoint[];
  /** The id of the thing being dragged, so its own edges are not snap targets. */
  draggingId: string;
  /** How close counts as a snap, in seconds. Callers derive it from the zoom. */
  toleranceSec: number;
  durationSec: number;
  /** Shortest a clip may be. Matches the guard in edl/operations.ts. */
  minLengthSec?: number;
  /** Held modifier that turns snapping off for this gesture. */
  disableSnap?: boolean;
}

export interface DragGeometry {
  start: number;
  end: number;
  /** The time it landed on, if it snapped — for drawing the guide. */
  snappedTo: number | null;
}

const MIN_LENGTH = 0.15;

export function resolveDrag(input: DragInput): DragGeometry {
  const {
    kind,
    originStart,
    originEnd,
    deltaSec,
    snapPoints,
    draggingId,
    toleranceSec,
    durationSec,
    minLengthSec = MIN_LENGTH,
    disableSnap = false,
  } = input;

  // An instant — a sound cue — has no length to preserve and no length to
  // protect, so it is allowed to be zero.
  const isInstant = originEnd - originStart < 1e-9;
  const floor = isInstant ? 0 : minLengthSec;

  const candidates = disableSnap
    ? []
    : snapPoints.filter((p) => p.ownerId !== draggingId);

  if (kind === 'move') {
    const length = originEnd - originStart;
    const latest = Math.max(0, durationSec - length);

    let start = clamp(originStart + deltaSec, 0, latest);

    // Snap as one rigid object: try both edges, take the nearest point, shift
    // the whole clip onto it.
    const shift = bestShift([start, start + length], candidates, toleranceSec);
    let snappedTo: number | null = null;
    if (shift) {
      const shifted = clamp(start + shift.by, 0, latest);
      // A snap that had to be clamped back is not a snap. Saying it was would
      // draw a guide line the clip is not actually touching.
      if (Math.abs(shifted - (start + shift.by)) < 1e-9) {
        start = shifted;
        snappedTo = shift.to;
      }
    }

    return { start, end: start + length, snappedTo };
  }

  if (kind === 'trim-start') {
    const end = originEnd;
    const wanted = originStart + deltaSec;
    const snap = nearest(wanted, candidates, toleranceSec);
    const target = snap ?? wanted;
    const start = clamp(target, 0, Math.max(0, end - floor));
    return { start, end, snappedTo: snap !== null && Math.abs(start - snap) < 1e-9 ? snap : null };
  }

  const start = originStart;
  const wanted = originEnd + deltaSec;
  const snap = nearest(wanted, candidates, toleranceSec);
  const target = snap ?? wanted;
  const end = clamp(target, Math.min(durationSec, start + floor), durationSec);
  return { start, end, snappedTo: snap !== null && Math.abs(end - snap) < 1e-9 ? snap : null };
}

/** The nearest snap point to one value, or null if nothing is close enough. */
function nearest(value: number, points: readonly SnapPoint[], tolerance: number): number | null {
  let best: number | null = null;
  let bestGap = tolerance;
  for (const point of points) {
    const gap = Math.abs(point.at - value);
    if (gap < bestGap) { bestGap = gap; best = point.at; }
  }
  return best;
}

/** The smallest shift that puts EITHER edge onto a snap point. */
function bestShift(
  edges: readonly number[],
  points: readonly SnapPoint[],
  tolerance: number,
): { by: number; to: number } | null {
  let best: { by: number; to: number } | null = null;
  let bestGap = tolerance;
  for (const edge of edges) {
    for (const point of points) {
      const gap = Math.abs(point.at - edge);
      if (gap < bestGap) { bestGap = gap; best = { by: point.at - edge, to: point.at }; }
    }
  }
  return best;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Everything on the timeline worth landing on, tagged with its owner.
 *
 * Captions are included because a B-roll insert that starts mid-word looks like
 * a mistake, and cuts because that is where an insert belongs. The playhead is
 * added by the caller rather than here — it changes thirty times a second
 * during playback, and rebuilding this list at that rate on a ten-minute video
 * is ~760 insertions and a sort per frame.
 */
export function snapPointsFor(edl: Edl): SnapPoint[] {
  const points: SnapPoint[] = [
    { at: 0, ownerId: null },
    { at: edl.format.durationSec, ownerId: null },
  ];

  for (const s of edl.segments) {
    points.push({ at: s.outStartSec, ownerId: s.id }, { at: s.outEndSec, ownerId: s.id });
  }
  for (const c of edl.captions) {
    points.push({ at: c.startSec, ownerId: c.id }, { at: c.endSec, ownerId: c.id });
  }
  for (const b of edl.broll) {
    points.push({ at: b.outStartSec, ownerId: b.id }, { at: b.outEndSec, ownerId: b.id });
  }
  for (const g of edl.graphics) {
    points.push({ at: g.outStartSec, ownerId: g.id }, { at: g.outEndSec, ownerId: g.id });
  }
  for (const p of edl.punchIns) {
    points.push({ at: p.outStartSec, ownerId: p.id }, { at: p.outEndSec, ownerId: p.id });
  }
  // Instants count too. A whoosh and the transition it sells belong on the same
  // frame, and lining the second one up by eye at 32px/s is a 30ms guess.
  for (const c of edl.sfx) {
    points.push({ at: c.atSec, ownerId: c.id });
  }
  for (const t of edl.transitions) {
    points.push({ at: t.atSec, ownerId: t.id }, { at: t.atSec + t.durationSec, ownerId: t.id });
  }

  return points;
}

/**
 * Where a segment dragged sideways should end up in the running order.
 *
 * Reordering by index has an off-by-one that only shows up when moving an item
 * to the RIGHT: the naive answer counts the neighbours the item is passing
 * while the item itself is still occupying a slot among them, so it lands one
 * short every time. Counting the items it has genuinely passed — and ignoring
 * itself — gives the index the list will have after the splice.
 */
export function reorderIndexFor(
  segments: readonly { id: string; outStartSec: number; outEndSec: number }[],
  id: string,
  droppedAtSec: number,
): number {
  const others = segments.filter((s) => s.id !== id);
  const midpoint = droppedAtSec;
  let index = 0;
  for (const other of others) {
    if (midpoint > (other.outStartSec + other.outEndSec) / 2) index += 1;
    else break;
  }
  return index;
}
