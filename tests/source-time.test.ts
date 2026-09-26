import { describe, expect, it } from 'vitest';
import { sourceTimeAt } from '@/lib/timeline/source-time';
import type { Edl } from '@/lib/edl/types';

/**
 * The editor plays the whole edit through ONE video element — see
 * PreviewVideoTrack — so this is the map it follows: output time in, source
 * time out. Get it wrong and the preview plays the wrong part of the footage,
 * which is worse than the stutter it was written to remove.
 */
const segments = [
  { id: 'a', outStartSec: 0, outEndSec: 2, sourceStartSec: 4, sourceEndSec: 6, speed: 1 },
  { id: 'b', outStartSec: 2, outEndSec: 5, sourceStartSec: 10, sourceEndSec: 13, speed: 1 },
  { id: 'c', outStartSec: 5, outEndSec: 6, sourceStartSec: 20, sourceEndSec: 22, speed: 2 },
] as unknown as Edl['segments'];

describe('output time to source time', () => {
  it('walks into the segment the moment falls in', () => {
    expect(sourceTimeAt(segments, 0.5).sourceSec).toBeCloseTo(4.5);
    expect(sourceTimeAt(segments, 3).sourceSec).toBeCloseTo(11);
  });

  it('jumps the gap at a cut', () => {
    // The last instant of the first clip and the first of the second are
    // 1.99s apart on screen and four seconds apart in the file. That jump IS
    // the cut, and it is the only moment the element has to seek.
    expect(sourceTimeAt(segments, 1.99).sourceSec).toBeCloseTo(5.99);
    expect(sourceTimeAt(segments, 2).sourceSec).toBeCloseTo(10);
  });

  it('runs a sped-up segment through the file faster', () => {
    expect(sourceTimeAt(segments, 5.5).sourceSec).toBeCloseTo(21);
  });

  it('never runs past the end of its own segment', () => {
    expect(sourceTimeAt(segments, 5.99).sourceSec).toBeLessThanOrEqual(22);
  });

  it('clamps outside the edit rather than showing nothing', () => {
    const early = [{ ...segments[0], outStartSec: 4, outEndSec: 6 }] as unknown as Edl['segments'];
    expect(sourceTimeAt(early, 0).segment?.id).toBe('a');
    expect(sourceTimeAt(segments, 99).segment?.id).toBe('c');
  });

  it('answers something sensible for an edit with no segments at all', () => {
    expect(sourceTimeAt([] as unknown as Edl['segments'], 3)).toEqual({ segment: null, sourceSec: 3 });
  });
});
