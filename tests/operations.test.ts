import { describe, expect, it } from 'vitest';
import { applyOperations, type EdlOperation } from '@/lib/edl/operations';
import { EdlSchema, type Edl } from '@/lib/edl/types';
import { layoutSegments } from '@/lib/timeline/time-mapper';

/**
 * Manual timeline edits.
 *
 * The dangerous operation is any change to the cut, because everything laid on
 * top is anchored in output time and has to move with it. A caption that drifts
 * 400 ms after a trim is the single most visible way this product can break, so
 * most of what follows is about exactly that.
 */

function makeEdl(): Edl {
  // Three contiguous-in-output segments drawn from spread-out source ranges.
  const segments = layoutSegments([
    { sourceStartSec: 10, sourceEndSec: 14 }, // out 0–4
    { sourceStartSec: 30, sourceEndSec: 34 }, // out 4–8
    { sourceStartSec: 50, sourceEndSec: 54 }, // out 8–12
  ]);

  return EdlSchema.parse({
    version: '1.0',
    projectId: 'test',
    styleId: 'punchy',
    format: { aspect: '9:16', width: 1080, height: 1920, fps: 30, durationSec: 12 },
    source: {
      assetId: 'src', url: 'file://x.mp4', width: 1920, height: 1080,
      fps: 30, durationSec: 60, hasAudio: true,
    },
    segments,
    captions: [
      { id: 'cue-0', startSec: 0.5, endSec: 1.5, words: [
        { text: 'first', startSec: 0.5, endSec: 1.0, emphasis: false },
        { text: 'clip', startSec: 1.0, endSec: 1.5, emphasis: false },
      ] },
      // Sits inside the THIRD segment; it must follow any upstream edit exactly.
      { id: 'cue-1', startSec: 9.0, endSec: 10.0, words: [
        { text: 'third', startSec: 9.0, endSec: 9.5, emphasis: false },
        { text: 'clip', startSec: 9.5, endSec: 10.0, emphasis: true },
      ] },
    ],
    captionStyle: {},
    broll: [
      { id: 'broll-0', outStartSec: 5, outEndSec: 7, kind: 'stock-video', url: 'u', query: 'q' },
      { id: 'broll-1', outStartSec: 9.5, outEndSec: 11, kind: 'stock-video', url: 'u', query: 'q2' },
    ],
    graphics: [{ id: 'graphic-0', type: 'stat', outStartSec: 9.2, outEndSec: 11, text: '3' }],
    overlays: [{ id: 'overlay-progress', type: 'progress-bar', outStartSec: 0, outEndSec: 12 }],
    transitions: [
      { id: 'transition-0', atSec: 4, type: 'whip-pan', durationSec: 0.24 },
      { id: 'transition-1', atSec: 8, type: 'flash', durationSec: 0.24 },
    ],
    punchIns: [{ id: 'punch-0', outStartSec: 1, outEndSec: 3, scale: 1.2 }],
    reframe: { method: 'saliency', keyframes: [
      { outSec: 0, cx: .4, cy: .4, w: .5 },
      { outSec: 6, cx: .5, cy: .4, w: .5 },
      { outSec: 11, cx: .6, cy: .4, w: .5 },
    ] },
    sfx: [{ id: 'sfx-0', atSec: 4, sound: 'whoosh' }, { id: 'sfx-1', atSec: 9.2, sound: 'pop' }],
    music: { id: 'm', url: '/m.mp3' },
    audio: {},
    deliverable: { thumbnailAtSec: 9.5 },
  });
}

const run = (edl: Edl, ...ops: EdlOperation[]) => applyOperations(edl, ops);

describe('trimming a clip', () => {
  it('shortens the video and pulls everything after it back by the same amount', () => {
    const before = makeEdl();
    // Take 1s off the front of the FIRST segment: everything downstream moves −1s.
    const { edl, rejected } = run(before, {
      op: 'segment.trim', id: 'seg-0', sourceStartSec: 11,
    });

    expect(rejected).toEqual([]);
    expect(edl.format.durationSec).toBeCloseTo(11, 5);

    // The caption anchored in segment 3 was at 9.0s; it must now be at 8.0s.
    const cue = edl.captions.find((c) => c.id === 'cue-1')!;
    expect(cue.startSec).toBeCloseTo(8.0, 5);
    expect(cue.endSec).toBeCloseTo(9.0, 5);
    // Its words move with it, keeping their internal rhythm.
    expect(cue.words[0].startSec).toBeCloseTo(8.0, 5);
    expect(cue.words[1].endSec).toBeCloseTo(9.0, 5);

    // And so does everything else anchored downstream.
    expect(edl.broll[0].outStartSec).toBeCloseTo(4, 5);
    expect(edl.graphics[0].outStartSec).toBeCloseTo(8.2, 5);
    expect(edl.sfx.find((s) => s.id === 'sfx-1')!.atSec).toBeCloseTo(8.2, 5);
    expect(edl.deliverable.thumbnailAtSec).toBeCloseTo(8.5, 5);
  });

  it('leaves everything BEFORE the edit exactly where it was', () => {
    const { edl } = run(makeEdl(), { op: 'segment.trim', id: 'seg-2', sourceEndSec: 53 });

    const cue = edl.captions.find((c) => c.id === 'cue-0')!;
    expect(cue.startSec).toBeCloseTo(0.5, 5);
    expect(edl.punchIns[0].outStartSec).toBeCloseTo(1, 5);
    expect(edl.format.durationSec).toBeCloseTo(11, 5);
  });

  it('refuses a trim that would leave nothing', () => {
    const { rejected } = run(makeEdl(), {
      op: 'segment.trim', id: 'seg-0', sourceStartSec: 13.99, sourceEndSec: 14,
    });
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/80ms/);
  });

  it('refuses a trim past the end of the footage', () => {
    const { rejected } = run(makeEdl(), { op: 'segment.trim', id: 'seg-0', sourceEndSec: 999 });
    expect(rejected[0].reason).toMatch(/past the end/);
  });
});

describe('deleting a clip', () => {
  it('drops the captions that belonged to it and keeps the rest in sync', () => {
    const { edl } = run(makeEdl(), { op: 'segment.delete', id: 'seg-0' });

    expect(edl.segments).toHaveLength(2);
    expect(edl.format.durationSec).toBeCloseTo(8, 5);

    // A caption for words that no longer exist would be a lie, so it goes.
    expect(edl.captions.find((c) => c.id === 'cue-0')).toBeUndefined();

    // The surviving caption was at 9.0s in a 12s cut; the first 4s are gone.
    const cue = edl.captions.find((c) => c.id === 'cue-1')!;
    expect(cue.startSec).toBeCloseTo(5.0, 5);
  });

  it('will not delete the only remaining clip', () => {
    let edl = run(makeEdl(), { op: 'segment.delete', id: 'seg-0' }).edl;
    edl = run(edl, { op: 'segment.delete', id: 'seg-1' }).edl;
    const { rejected } = run(edl, { op: 'segment.delete', id: 'seg-2' });
    expect(rejected[0].reason).toMatch(/last clip/);
  });
});

describe('splitting a clip', () => {
  it('splits at the playhead without changing the total length', () => {
    const { edl, rejected } = run(makeEdl(), { op: 'segment.split', id: 'seg-1', atOutSec: 6 });

    expect(rejected).toEqual([]);
    expect(edl.segments).toHaveLength(4);
    expect(edl.format.durationSec).toBeCloseTo(12, 5);

    // The two halves meet exactly, and cover the original source range.
    const [a, b] = edl.segments.slice(1, 3);
    expect(a.sourceEndSec).toBeCloseTo(32, 5);
    expect(b.sourceStartSec).toBeCloseTo(32, 5);
    expect(a.outEndSec).toBeCloseTo(b.outStartSec, 5);
  });

  it('refuses a split too close to an edge to be useful', () => {
    const { rejected } = run(makeEdl(), { op: 'segment.split', id: 'seg-1', atOutSec: 4.02 });
    expect(rejected[0].reason).toMatch(/close to the edge/);
  });

  it('does not decorate a seam that is invisible', () => {
    // A split leaves two contiguous source ranges, so the new seam is not a
    // visible cut and must not attract a transition.
    const { edl } = run(makeEdl(), { op: 'segment.split', id: 'seg-1', atOutSec: 6 });
    expect(edl.transitions.every((t) => Math.abs(t.atSec - 6) > 0.1)).toBe(true);
    // The two real seams survive.
    expect(edl.transitions).toHaveLength(2);
  });
});

describe('reordering clips', () => {
  it('moves a clip and carries its captions with it', () => {
    const { edl } = run(makeEdl(), { op: 'segment.reorder', id: 'seg-2', toIndex: 0 });

    expect(edl.segments[0].sourceStartSec).toBe(50);
    expect(edl.format.durationSec).toBeCloseTo(12, 5);

    // The third clip's caption now plays at the top of the video.
    const cue = edl.captions.find((c) => c.id === 'cue-1')!;
    expect(cue.startSec).toBeCloseTo(1.0, 5);
  });
});

describe('moving and trimming clips on the upper tracks', () => {
  it('moves a B-roll insert to where it was dropped', () => {
    const { edl } = run(makeEdl(), { op: 'clip.move', track: 'broll', id: 'broll-0', outStartSec: 2 });
    expect(edl.broll[0].outStartSec).toBeCloseTo(2, 5);
    // Length is preserved by a move.
    expect(edl.broll[0].outEndSec - edl.broll[0].outStartSec).toBeCloseTo(2, 5);
  });

  it('stops a clip at the end of the video rather than past it', () => {
    const { edl } = run(makeEdl(), { op: 'clip.move', track: 'broll', id: 'broll-0', outStartSec: 11.5 });
    expect(edl.broll[0].outEndSec).toBeLessThanOrEqual(12.001);
  });

  it('collides with a neighbour on the same track instead of overlapping it', () => {
    // Two B-roll inserts on screen at once is incoherent, so dragging one onto
    // the other stops it at the edge — the way any NLE behaves.
    const { edl } = run(makeEdl(), { op: 'clip.move', track: 'broll', id: 'broll-0', outStartSec: 9 });

    const [a, b] = [...edl.broll].sort((x, y) => x.outStartSec - y.outStartSec);
    expect(a.outEndSec).toBeLessThanOrEqual(b.outStartSec + 0.001);
    // The move still happened — it just stopped short.
    expect(a.outStartSec).toBeGreaterThan(5);
  });

  it('allows a graphic over B-roll, because a person asked for it', () => {
    // The AI avoids this unattended (two focal points usually fight), but a
    // label deliberately placed over a stock shot is ordinary editing. Manual
    // mode does not overrule the person doing the editing.
    const { edl, rejected } = run(makeEdl(), {
      op: 'clip.move', track: 'graphics', id: 'graphic-0', outStartSec: 5.5,
    });

    expect(rejected).toEqual([]);
    expect(edl.graphics[0].outStartSec).toBeCloseTo(5.5, 5);
    const b = edl.broll.find((x) => x.id === 'broll-0')!;
    expect(edl.graphics[0].outStartSec).toBeLessThan(b.outEndSec);
  });

  it('refuses a trim that leaves a clip too short to see', () => {
    const { rejected } = run(makeEdl(), {
      op: 'clip.trim', track: 'broll', id: 'broll-0', outStartSec: 5, outEndSec: 5.05,
    });
    expect(rejected[0].reason).toMatch(/too short/i);
  });

  it('deletes a sound effect', () => {
    const { edl } = run(makeEdl(), { op: 'clip.delete', track: 'sfx', id: 'sfx-0' });
    expect(edl.sfx.map((s) => s.id)).toEqual(['sfx-1']);
  });

  it('ignores an attempt to write time through the content patch', () => {
    const { edl } = run(makeEdl(), {
      op: 'clip.update', track: 'broll', id: 'broll-0',
      patch: { query: 'new query', outStartSec: 0 },
    });
    expect(edl.broll[0].query).toBe('new query');
    // Time only moves through move/trim, where the collision rules apply.
    expect(edl.broll[0].outStartSec).toBeCloseTo(5, 5);
  });
});

describe('editing captions', () => {
  it('rewrites the words and keeps the card in place', () => {
    const { edl } = run(makeEdl(), { op: 'caption.text', id: 'cue-0', text: 'completely different words' });
    const cue = edl.captions[0];

    expect(cue.words.map((w) => w.text)).toEqual(['completely', 'different', 'words']);
    expect(cue.words[0].startSec).toBeCloseTo(0.5, 5);
    expect(cue.words[2].endSec).toBeCloseTo(1.5, 5);
    // Longer words get more time than short ones.
    const spans = cue.words.map((w) => w.endSec - w.startSec);
    expect(spans[0]).toBeGreaterThan(spans[2]);
  });

  it('retimes a card and scales its words with it', () => {
    const { edl } = run(makeEdl(), { op: 'caption.time', id: 'cue-0', startSec: 2, endSec: 4 });
    const cue = edl.captions.find((c) => c.id === 'cue-0')!;

    expect(cue.startSec).toBeCloseTo(2, 5);
    expect(cue.words[0].startSec).toBeCloseTo(2, 5);
    expect(cue.words[1].endSec).toBeCloseTo(4, 5);
  });

  it('toggles emphasis on one word', () => {
    const { edl } = run(makeEdl(), { op: 'caption.emphasis', id: 'cue-0', wordIndex: 1, emphasis: true });
    expect(edl.captions[0].words[1].emphasis).toBe(true);
    expect(edl.captions[0].words[0].emphasis).toBe(false);
  });
});

describe('global edits', () => {
  it('restretches full-length overlays but re-anchors timed ones', () => {
    const { edl } = run(makeEdl(), { op: 'segment.delete', id: 'seg-0' });
    const progress = edl.overlays.find((o) => o.id === 'overlay-progress')!;
    expect(progress.outStartSec).toBe(0);
    expect(progress.outEndSec).toBeCloseTo(edl.format.durationSec, 5);
  });

  it('keeps the reframe track aligned with the new cut', () => {
    const { edl } = run(makeEdl(), { op: 'segment.trim', id: 'seg-0', sourceStartSec: 11 });
    // The keyframe at 11s was inside the last segment; it shifts back by 1s.
    const last = edl.reframe!.keyframes[edl.reframe!.keyframes.length - 1];
    expect(last.outSec).toBeCloseTo(10, 5);
    expect(last.outSec).toBeLessThanOrEqual(edl.format.durationSec);
  });

  it('applies a run of operations in order and reports only the bad ones', () => {
    const { edl, rejected } = run(
      makeEdl(),
      { op: 'clip.move', track: 'broll', id: 'broll-0', outStartSec: 1 },
      { op: 'clip.delete', track: 'sfx', id: 'nope' },
      { op: 'caption.emphasis', id: 'cue-0', wordIndex: 0, emphasis: true },
      { op: 'music.remove' },
    );

    expect(edl.broll[0].outStartSec).toBeCloseTo(1, 5);
    expect(edl.captions[0].words[0].emphasis).toBe(true);
    expect(edl.music).toBeNull();
    expect(rejected).toHaveLength(0); // deleting a missing sfx is a no-op, not an error
  });

  it('always produces a document that still validates', () => {
    const { edl } = run(
      makeEdl(),
      { op: 'segment.split', id: 'seg-1', atOutSec: 6 },
      { op: 'segment.delete', id: 'seg-0' },
      { op: 'clip.move', track: 'graphics', id: 'graphic-0', outStartSec: 1 },
      { op: 'caption.text', id: 'cue-1', text: 'rewritten' },
    );
    expect(() => EdlSchema.parse(edl)).not.toThrow();
  });
});

describe('adding clips', () => {
  it('inserts a B-roll slot at the playhead', () => {
    const { edl, rejected } = run(makeEdl(), {
      op: 'clip.add', track: 'broll', atSec: 2, durationSec: 1.5, value: 'airplane window clouds',
    });

    expect(rejected).toEqual([]);
    const added = edl.broll.find((b) => b.query === 'airplane window clouds')!;
    expect(added).toBeDefined();
    expect(added.outStartSec).toBeCloseTo(2, 5);
    expect(added.outEndSec).toBeCloseTo(3.5, 5);
    // No URL yet — the asset stage resolves the query on the next render.
    expect(added.url).toBe('');
  });

  it('inserts a sound effect as an instant, not a span', () => {
    const { edl } = run(makeEdl(), { op: 'clip.add', track: 'sfx', atSec: 6.25, value: 'impact' });
    const added = edl.sfx.find((s) => s.sound === 'impact')!;
    expect(added.atSec).toBeCloseTo(6.25, 5);
    expect(added.url).toBe('/audio/sfx/impact.wav');
  });

  it('inserts a stat card with the requested type', () => {
    const { edl } = run(makeEdl(), {
      op: 'clip.add', track: 'graphics', atSec: 1, durationSec: 2, value: '42', graphicType: 'stat',
    });
    const added = edl.graphics.find((g) => g.text === '42')!;
    expect(added.type).toBe('stat');
  });

  it('never adds a clip that runs past the end of the video', () => {
    const { edl } = run(makeEdl(), {
      op: 'clip.add', track: 'broll', atSec: 11.8, durationSec: 5, value: 'x',
    });
    const added = edl.broll.find((b) => b.query === 'x')!;
    expect(added.outEndSec).toBeLessThanOrEqual(edl.format.durationSec + 1e-6);
  });

  it('carries an added clip through a later re-timing', () => {
    // Add, then trim upstream: the new clip has to move like any other.
    let edl = run(makeEdl(), {
      op: 'clip.add', track: 'graphics', atSec: 9, durationSec: 1, value: 'new', graphicType: 'icon',
    }).edl;
    const before = edl.graphics.find((g) => g.text === 'new')!.outStartSec;

    edl = run(edl, { op: 'segment.trim', id: 'seg-0', sourceStartSec: 11 }).edl;
    const after = edl.graphics.find((g) => g.text === 'new')!.outStartSec;

    expect(after).toBeCloseTo(before - 1, 5);
  });
});
