import { describe, expect, it } from 'vitest';
import { planPreviewFrame } from '@/lib/timeline/preview-plan';
import type { Edl } from '@/lib/edl/types';

/**
 * The editor's two video elements, one frame at a time.
 *
 * The whole point of the pair is that a cut costs nothing: the next clip is
 * already decoded and parked when the cut arrives, so the swap is a style
 * change rather than a seek. A mistake here puts the seek back — which is the
 * stutter — or shows the wrong part of the footage, which is worse.
 */
const segments = [
  { id: 'a', outStartSec: 0, outEndSec: 4, sourceStartSec: 2, sourceEndSec: 6, speed: 1 },
  { id: 'b', outStartSec: 4, outEndSec: 7, sourceStartSec: 20, sourceEndSec: 23, speed: 1 },
  { id: 'c', outStartSec: 7, outEndSec: 9, sourceStartSec: 40, sourceEndSec: 42, speed: 1 },
] as unknown as Edl['segments'];

const base = {
  segments,
  liveSegmentId: 'a' as string | null,
  readySegmentId: null as string | null,
  playing: true,
};

describe('a frame of the editor preview', () => {
  it('seeks once on the first frame, because nothing is live yet', () => {
    const plan = planPreviewFrame({ ...base, liveSegmentId: null, outSec: 0, liveTime: 0 });
    expect(plan.changed).toBe(true);
    expect(plan.swap).toBe(false);
    expect(plan.seekTo).toBeCloseTo(2);
  });

  it('leaves the element alone mid-clip: it is the clock', () => {
    const plan = planPreviewFrame({ ...base, outSec: 2, liveTime: 4.02 });
    expect(plan.seekTo).toBeNull();
    expect(plan.swap).toBe(false);
  });

  it('prepares the standby as soon as the clip is live, not just before the cut', () => {
    // The seek that parks the standby is the expensive thing here, and paying
    // it a beat before the cut is what read as the edit stopping before every
    // new clip. It belongs at the far end of the segment, out of sight.
    const early = planPreviewFrame({ ...base, outSec: 0.2, liveTime: 2.2 });
    expect(early.prepare).toEqual({ id: 'b', at: 20, speed: 1 });

    const near = planPreviewFrame({ ...base, outSec: 3.5, liveTime: 5.5 });
    expect(near.prepare).toEqual({ id: 'b', at: 20, speed: 1 });

    // Already parked — asking again would seek an element that is ready.
    const again = planPreviewFrame({ ...base, outSec: 3.6, liveTime: 5.6, readySegmentId: 'b' });
    expect(again.prepare).toBeNull();
  });

  it('prepares the clip after next in the same frame as the swap', () => {
    const plan = planPreviewFrame({ ...base, outSec: 4.01, liveTime: 6.01, readySegmentId: 'b' });
    expect(plan.swap).toBe(true);
    // The element that just left the screen is now the standby, and it gets
    // its instruction immediately — the cut is covering the seek.
    expect(plan.prepare).toEqual({ id: 'c', at: 40, speed: 1 });
  });

  it('does not park the standby on a frame that is already scrubbing', () => {
    // A drag lands in a different segment with nothing parked: the visible
    // element needs the decoder for the frame under the cursor.
    const jump = planPreviewFrame({ ...base, outSec: 7.5, liveTime: 6, readySegmentId: null });
    expect(jump.changed).toBe(true);
    expect(jump.swap).toBe(false);
    expect(jump.seekTo).toBeCloseTo(40.5);
    expect(jump.prepare).toBeNull();
  });

  it('swaps at the cut when the standby is parked, and never seeks', () => {
    const plan = planPreviewFrame({ ...base, outSec: 4.01, liveTime: 6.01, readySegmentId: 'b' });
    expect(plan.swap).toBe(true);
    expect(plan.seekTo).toBeNull();
    expect(plan.segmentId).toBe('b');
  });

  it('falls back to a seek at the cut when preparation did not happen', () => {
    const plan = planPreviewFrame({ ...base, outSec: 4.01, liveTime: 6.01, readySegmentId: null });
    expect(plan.swap).toBe(false);
    expect(plan.seekTo).toBeCloseTo(20.01);
  });

  it('prepares the clip after the one it just swapped to', () => {
    // Straight after a swap the standby holds the clip that just ended, so its
    // old parking must not be mistaken for being ready.
    const plan = planPreviewFrame({ ...base, outSec: 6.2, liveTime: 22.2, liveSegmentId: 'a', readySegmentId: 'b' });
    expect(plan.swap).toBe(true);
    expect(plan.prepare).toEqual({ id: 'c', at: 40, speed: 1 });
  });

  it('resyncs when somebody scrubs', () => {
    const plan = planPreviewFrame({ ...base, outSec: 1, liveTime: 5.5 });
    expect(plan.seekTo).toBeCloseTo(3);
  });

  it('lands exactly on the frame when paused', () => {
    const drifting = planPreviewFrame({ ...base, outSec: 1, liveTime: 3.1, playing: false });
    expect(drifting.seekTo).toBeCloseTo(3);

    const settled = planPreviewFrame({ ...base, outSec: 1, liveTime: 3.01, playing: false });
    expect(settled.seekTo).toBeNull();
  });

  it('says nothing useful, safely, for an edit with no segments', () => {
    const plan = planPreviewFrame({ ...base, segments: [] as unknown as Edl['segments'], outSec: 1, liveTime: 0 });
    expect(plan.segmentId).toBeNull();
    expect(plan.seekTo).toBeNull();
    expect(plan.prepare).toBeNull();
  });
});
