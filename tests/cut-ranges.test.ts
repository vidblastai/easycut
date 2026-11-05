import { describe, expect, it } from 'vitest';
import { applyOperations } from '@/lib/edl/operations';
import { cutOperations } from '@/lib/edl/cut-ranges';
import { EdlSchema, type Edl } from '@/lib/edl/types';
import { layoutSegments } from '@/lib/timeline/time-mapper';

function makeEdl(): Edl {
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
    source: { assetId: 'src', url: 'file://x.mp4', width: 1920, height: 1080, fps: 30, durationSec: 60, hasAudio: true },
    segments,
    captions: [
      { id: 'cue-0', startSec: 0.5, endSec: 1.5, words: [{ text: 'first', startSec: 0.5, endSec: 1.5, emphasis: false }] },
      { id: 'cue-1', startSec: 9.0, endSec: 10.0, words: [{ text: 'third', startSec: 9.0, endSec: 10.0, emphasis: false }] },
    ],
    captionStyle: {},
    reframe: { method: 'saliency', keyframes: [{ outSec: 0, cx: .5, cy: .4, w: .5 }] },
    music: { id: 'm', url: '/m.mp3' },
    audio: {},
    deliverable: { thumbnailAtSec: 2 },
  });
}

const cut = (edl: Edl, ranges: Array<[number, number]>) => {
  const ops = cutOperations(edl, ranges.map(([startSec, endSec]) => ({ startSec, endSec })));
  const result = applyOperations(edl, ops);
  expect(result.rejected).toEqual([]);
  return result.edl;
};

describe('cutting parts out of an edit', () => {
  it('takes a stretch out of the middle of one clip', () => {
    const after = cut(makeEdl(), [[5, 6.5]]);
    expect(after.format.durationSec).toBeCloseTo(10.5, 2);
    // What came after the cut moved back by exactly what was removed.
    expect(after.captions.find((c) => c.id === 'cue-1')?.startSec).toBeCloseTo(7.5, 2);
  });

  it('cuts across clip boundaries, and several stretches at once in the times the caller saw', () => {
    const after = cut(makeEdl(), [[0, 1], [3, 9]]);
    expect(after.format.durationSec).toBeCloseTo(5, 2);
    const kept = after.segments.map((s) => [s.sourceStartSec, s.sourceEndSec]);
    expect(kept[0][0]).toBeCloseTo(11, 2);
    expect(kept.at(-1)![0]).toBeCloseTo(51, 2);
  });

  it('refuses cuts that overlap, fall outside the video, or remove all of it', () => {
    expect(() => cutOperations(makeEdl(), [{ startSec: 1, endSec: 3 }, { startSec: 2, endSec: 4 }])).toThrow(/overlap/);
    expect(() => cutOperations(makeEdl(), [{ startSec: 11, endSec: 20 }])).toThrow(/outside/);
    expect(() => cutOperations(makeEdl(), [{ startSec: 0, endSec: 11.8 }])).toThrow(/whole video/);
  });
});

describe('captions across a cut that lands inside a word', () => {
  it('keeps the word where its surviving end is, never at 0:00', () => {
    const edl = makeEdl();
    // A word whose start is in the stretch being cut and whose end is after it.
    edl.captions.push({ id: 'cue-x', startSec: 6.9, endSec: 7.6, words: [{ text: 'Now', startSec: 6.9, endSec: 7.6, emphasis: false }] });
    const after = cut(edl, [[5, 7]]);
    const cue = after.captions.find((c) => c.id === 'cue-x');
    expect(cue).toBeDefined();
    expect(cue!.startSec).toBeGreaterThan(4.5);
    // …and the first caption of the video is still there.
    expect(after.captions.find((c) => c.id === 'cue-0')?.startSec).toBeCloseTo(0.5, 2);
  });
});
