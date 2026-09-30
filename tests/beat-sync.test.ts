import { describe, expect, it } from 'vitest';
import { alignToBeat, alignedTo, beatGrid, nearestBeat, MAX_NUDGE_SEC } from '@/lib/edl/beat-sync';
import { EdlSchema, type Edl } from '@/lib/edl/types';
import { layoutSegments } from '@/lib/timeline/time-mapper';

/**
 * Cuts on the beat.
 *
 * Every track in the music library carries a `bpm`, the asset stage has always
 * copied it onto the document, and nothing ever read it. What follows is the
 * thing it was for — and most of these tests are about what must NOT move,
 * because that is where the damage would be.
 */

const DUR = 60;

function makeEdl(over: {
  bpm?: number | null;
  startAtSec?: number;
  broll?: Array<[number, number]>;
  graphics?: Array<[number, number, string?]>;
} = {}): Edl {
  return EdlSchema.parse({
    version: '1.0', projectId: 't', styleId: 'clean',
    format: { aspect: '16:9', width: 1920, height: 1080, fps: 30, durationSec: DUR },
    source: { assetId: 's', url: 'f', width: 1920, height: 1080, fps: 30, durationSec: DUR, hasAudio: true },
    segments: layoutSegments([{ sourceStartSec: 0, sourceEndSec: DUR }]),
    captions: [], captionStyle: {},
    broll: (over.broll ?? []).map(([a, b], i) => ({
      id: `b-${i}`, outStartSec: a, outEndSec: b, kind: 'stock-video', url: 'u', query: 'q',
    })),
    graphics: (over.graphics ?? []).map(([a, b, type], i) => ({
      id: `g-${i}`, type: type ?? 'stat', outStartSec: a, outEndSec: b, text: '1',
    })),
    music: over.bpm === null ? null : {
      id: 'm', url: '/m.mp3', bpm: over.bpm ?? 120, startAtSec: over.startAtSec ?? 0,
    },
    audio: {}, deliverable: {},
  });
}

describe('the grid a track lays over the video', () => {
  it('is the tempo, in seconds', () => {
    expect(beatGrid(makeEdl({ bpm: 120 }).music)!.beatSec).toBeCloseTo(0.5, 6);
    expect(beatGrid(makeEdl({ bpm: 90 }).music)!.beatSec).toBeCloseTo(0.6667, 3);
  });

  it('starts at zero when the bed starts at its own beginning', () => {
    expect(beatGrid(makeEdl({ bpm: 120, startAtSec: 0 }).music)!.firstSec).toBe(0);
  });

  it('is offset when the bed was entered part-way through a bar', () => {
    /*
     * The bed is trimmed from `startAtSec` and laid at video zero, so a track
     * entered 0.3s into a half-second beat arrives 0.3s into that beat — the
     * first whole beat is 0.2s later. Assuming video zero IS a beat is the
     * obvious mistake and puts every aligned cue a fraction of a beat out,
     * which is worse than not aligning at all.
     */
    expect(beatGrid(makeEdl({ bpm: 120, startAtSec: 0.3 }).music)!.firstSec).toBeCloseTo(0.2, 6);
  });

  it('refuses a tempo that is not one', () => {
    expect(beatGrid(makeEdl({ bpm: 0 }).music)).toBeNull();
    expect(beatGrid(makeEdl({ bpm: 8 }).music)).toBeNull();
    expect(beatGrid(makeEdl({ bpm: 900 }).music)).toBeNull();
    expect(beatGrid(null)).toBeNull();
  });
});

describe('which beat a moment belongs to', () => {
  const grid = { beatSec: 0.5, firstSec: 0 };

  it('rounds to the nearest, before or after', () => {
    expect(nearestBeat(1.4, grid)).toBeCloseTo(1.5, 6);
    expect(nearestBeat(1.6, grid)).toBeCloseTo(1.5, 6);
  });

  it('never returns a beat before the video started', () => {
    expect(nearestBeat(0.05, grid)).toBe(0);
  });
});

describe('how far a cue may travel', () => {
  const grid = { beatSec: 0.5, firstSec: 0 };

  it('moves onto a beat that is already nearly underneath it', () => {
    expect(alignedTo(1.46, grid)).toBeCloseTo(1.5, 6);
  });

  it('leaves a cue alone when the beat is too far to reach', () => {
    // 1.7 is 0.2 from the nearest beat — further than a quarter of this beat.
    expect(alignedTo(1.7, grid)).toBe(1.7);
  });

  it('never moves more than a quarter beat, however generous the cap', () => {
    const slow = { beatSec: 2, firstSec: 0 };
    for (const at of [1.3, 1.6, 2.4, 3.1]) {
      expect(Math.abs(alignedTo(at, slow, 10) - at), `from ${at}`).toBeLessThanOrEqual(0.5);
    }
  });

  it('is imperceptible as a timing change at a slow tempo', () => {
    // A quarter of a 2s beat is half a second, which is not a nudge. The
    // absolute cap is what stops that.
    const slow = { beatSec: 2, firstSec: 0 };
    for (const at of [1.9, 2.1, 4.12]) {
      expect(Math.abs(alignedTo(at, slow) - at), `from ${at}`).toBeLessThanOrEqual(MAX_NUDGE_SEC);
    }
  });
});

describe('what moves', () => {
  it('slides an insert onto the beat, keeping its length', () => {
    const before = makeEdl({ bpm: 120, broll: [[3.04, 6.04]] });
    const after = alignToBeat(before);
    expect(after.broll[0].outStartSec).toBeCloseTo(3, 6);
    // The whole clip slides. Stretching it to reach a beat would change how
    // long the viewer looks at it, which is a different decision.
    expect(after.broll[0].outEndSec - after.broll[0].outStartSec).toBeCloseTo(3, 6);
  });

  it('moves a graphic too', () => {
    const after = alignToBeat(makeEdl({ bpm: 120, graphics: [[2.06, 5.06]] }));
    expect(after.graphics[0].outStartSec).toBeCloseTo(2, 6);
  });
});

describe('what must not move', () => {
  it('leaves everything alone when the track has no tempo', () => {
    const before = makeEdl({ bpm: 0, broll: [[3.04, 6.04]] });
    expect(alignToBeat(before).broll[0].outStartSec).toBe(3.04);
  });

  it('leaves everything alone when there is no music at all', () => {
    const before = makeEdl({ bpm: null, broll: [[3.04, 6.04]] });
    expect(alignToBeat(before).broll[0].outStartSec).toBe(3.04);
  });

  it('leaves a title card pinned to frame zero', () => {
    // It is at zero on purpose; a beat would unpin it.
    const before = makeEdl({ bpm: 120, graphics: [[0.06, 3.06, 'title-card']] });
    expect(alignToBeat(before).graphics[0].outStartSec).toBe(0.06);
  });

  it('does not touch the cut, the captions or the icon cards', () => {
    // Those are tied to syllables. The whole effect is that they land on a
    // word, and a grid would break exactly that.
    const before = makeEdl({ bpm: 120, broll: [[3.04, 6.04]] });
    const after = alignToBeat(before);
    expect(after.segments).toEqual(before.segments);
    expect(after.captions).toEqual(before.captions);
    expect(after.icons).toEqual(before.icons);
    expect(after.sfx).toEqual(before.sfx);
  });

  it('abandons a move that would collide with the next insert', () => {
    // Nudging the first one forward would put it inside the second.
    const before = makeEdl({ bpm: 120, broll: [[2.96, 5.98], [6.0, 9.0]] });
    const after = alignToBeat(before);
    expect(after.broll[0].outEndSec).toBeLessThanOrEqual(after.broll[1].outStartSec);
  });

  it('abandons a move that would run past the end of the video', () => {
    const before = makeEdl({ bpm: 120, broll: [[DUR - 3.04, DUR - 0.04]] });
    const after = alignToBeat(before);
    expect(after.broll[0].outEndSec).toBeLessThanOrEqual(DUR);
  });

  it('never leaves two inserts overlapping, whatever it moved', () => {
    /*
     * Neighbours nudging TOWARD each other is the case that matters: each one
     * is checked against where the other still is, not where it is going, so
     * neither can step into a gap the other is about to vacate.
     */
    const before = makeEdl({
      bpm: 120,
      broll: [[2.04, 5.04], [5.06, 8.06], [8.08, 11.08], [12.96, 15.96]],
    });
    const after = alignToBeat(before);
    const sorted = [...after.broll].sort((a, b) => a.outStartSec - b.outStartSec);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].outStartSec, `insert ${i} overlaps ${i - 1}`).toBeGreaterThanOrEqual(sorted[i - 1].outEndSec);
    }
  });
});
