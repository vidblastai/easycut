import { applyOperations, type EdlOperation } from '@/lib/edl/operations';
import type { Edl } from '@/lib/edl/types';

/** A stretch of the finished video to take out, in its current output time. */
export interface CutRange {
  startSec: number;
  endSec: number;
}

/** Splits closer than this to a clip's edge are refused by `segment.split`. */
const EDGE = 0.08;

/**
 * The timeline operations that remove `ranges` from the edit: a split at each
 * end, then a delete of every clip between. This is what "cut the intro" or
 * "take out my retake" turns into — the same operations the timeline editor
 * sends when a person does it by hand.
 *
 * Ranges are read in the edit as it stands, so each later one is moved back by
 * what the earlier ones removed. They are worked through from the start: a
 * split names its new right-hand clip `<id>-b`, and going left to right means
 * a name is never minted twice.
 */
export function cutOperations(edl: Edl, ranges: CutRange[]): EdlOperation[] {
  const sorted = [...ranges].sort((a, b) => a.startSec - b.startSec);
  const duration = edl.format.durationSec;
  sorted.forEach((range, i) => {
    if (!(range.endSec - range.startSec >= 0.1)) throw new Error(`Cut ${i + 1} is shorter than 0.1 s.`);
    if (range.startSec < 0 || range.endSec > duration + 0.05) throw new Error(`Cut ${i + 1} is outside the video (0–${duration.toFixed(1)} s).`);
    if (i > 0 && range.startSec < sorted[i - 1].endSec) throw new Error('Cuts overlap — merge them into one.');
  });
  const removing = sorted.reduce((total, r) => total + (Math.min(r.endSec, duration) - r.startSec), 0);
  if (duration - removing < 1) throw new Error('That would cut the whole video.');

  let working = edl;
  let shift = 0;
  const ops: EdlOperation[] = [];
  const apply = (op: EdlOperation) => {
    const result = applyOperations(working, [op]);
    if (result.rejected.length) throw new Error(result.rejected[0].reason);
    working = result.edl;
    ops.push(op);
  };
  const splitAt = (at: number) => {
    const target = working.segments.find((s) => at > s.outStartSec + EDGE && at < s.outEndSec - EDGE);
    if (target) apply({ op: 'segment.split', id: target.id, atOutSec: at });
  };

  for (const range of sorted) {
    const start = range.startSec - shift;
    const end = Math.min(range.endSec, duration) - shift;
    splitAt(start);
    splitAt(end);
    const inside = working.segments.filter((s) => s.outStartSec >= start - EDGE && s.outEndSec <= end + EDGE);
    for (const segment of inside) apply({ op: 'segment.delete', id: segment.id });
    shift += end - start;
  }
  return ops;
}
