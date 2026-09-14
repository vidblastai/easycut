import { describe, expect, it } from 'vitest';
import { layoutSegments, TimeMapper } from '@/lib/timeline/time-mapper';

/**
 * Time mapping is the most safety-critical arithmetic in the product. Every
 * caption word, B-roll insert and sound effect is authored against source time
 * and consumed in output time; a one-frame error here shows up as captions
 * drifting out of sync, which is the most visible possible failure.
 */
describe('TimeMapper', () => {
  // 0–5s kept, 5–8s cut, 8–12s kept.
  const segments = layoutSegments([
    { sourceStartSec: 0, sourceEndSec: 5 },
    { sourceStartSec: 8, sourceEndSec: 12 },
  ]);

  it('lays segments out back to back in output time', () => {
    expect(segments).toHaveLength(2);
    expect(segments[0].outStartSec).toBe(0);
    expect(segments[0].outEndSec).toBe(5);
    expect(segments[1].outStartSec).toBe(5);
    expect(segments[1].outEndSec).toBe(9);
  });

  it('maps source time onto output time across a cut', () => {
    const mapper = new TimeMapper(segments);
    expect(mapper.toOutput(2)).toBe(2);
    // 9s in the source is 1s into the second kept range, which starts at 5s out.
    expect(mapper.toOutput(9)).toBe(6);
  });

  it('returns null for a timestamp inside a removed region', () => {
    const mapper = new TimeMapper(segments);
    expect(mapper.toOutput(6.5)).toBeNull();
  });

  it('clamps a cut-away timestamp to the nearest surviving frame', () => {
    const mapper = new TimeMapper(segments);
    // 5.2s is just past the end of segment 0, so it snaps to that boundary.
    expect(mapper.toOutputClamped(5.2)).toBe(5);
    // 7.8s is nearly at the start of segment 1, which also lands at 5s out.
    expect(mapper.toOutputClamped(7.8)).toBe(5);
  });

  it('round-trips output time back to source time', () => {
    const mapper = new TimeMapper(segments);
    for (const outSec of [0, 1.5, 4.9, 5, 6, 8.9]) {
      const source = mapper.toSource(outSec);
      expect(mapper.toOutput(source)).toBeCloseTo(outSec, 5);
    }
  });

  it('splits an interval that spans a cut into one piece per segment', () => {
    const mapper = new TimeMapper(segments);
    // A sentence running 4s–9s in the source straddles the 5–8s removal. The
    // two pieces touch in output time, but staying separate is the point: the
    // caller learns a cut fell inside its span.
    const parts = mapper.mapInterval(4, 9);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ startSec: 4, endSec: 5 });
    expect(parts[1]).toEqual({ startSec: 5, endSec: 6 });
  });

  it('returns a single piece for an interval wholly inside one segment', () => {
    const mapper = new TimeMapper(segments);
    expect(mapper.mapInterval(1, 3)).toEqual([{ startSec: 1, endSec: 3 }]);
  });

  it('reports only cuts that are actually visible', () => {
    const mapper = new TimeMapper(segments);
    expect(mapper.cutPoints()).toEqual([5]);

    // Two contiguous source ranges produce no visible seam, so decorating it
    // would be a transition on continuous footage.
    const contiguous = new TimeMapper(
      layoutSegments([
        { sourceStartSec: 0, sourceEndSec: 5 },
        { sourceStartSec: 5, sourceEndSec: 9 },
      ]),
    );
    expect(contiguous.cutPoints()).toEqual([]);
  });

  it('accounts for speed changes in both directions', () => {
    const fast = new TimeMapper(layoutSegments([{ sourceStartSec: 0, sourceEndSec: 10, speed: 2 }]));
    expect(fast.outputDuration).toBe(5);
    expect(fast.toOutput(10)).toBe(5);
    expect(fast.toSource(2.5)).toBe(5);
  });

  it('handles an empty segment list without throwing', () => {
    const empty = new TimeMapper([]);
    expect(empty.outputDuration).toBe(0);
    expect(empty.toOutput(3)).toBeNull();
    expect(empty.toOutputClamped(3)).toBe(0);
  });
});
