import { describe, expect, it } from 'vitest';
import { placePanel } from '@/lib/edl/panel';
import type { PanelScene } from '@/lib/edl/types';

/**
 * Placing the panel on a timeline the director reordered.
 *
 * The segments below are the real ones from `out/user/IMG_4836.MOV`: the
 * director found its hook in the last sentence and put it first, so output
 * time does not rise with source time. Mapping a scene's two endpoints
 * through a time mapper, which is what this module used to do, gave a span
 * seventeen seconds long across that seam — and the pass that closed the
 * gaps then dropped every exhibit inside it. Twenty exhibits became five.
 */
const SEGMENTS = [
  { sourceStartSec: 36.2, sourceEndSec: 39.6, outStartSec: 0, outEndSec: 3.4 },
  { sourceStartSec: 0.75, sourceEndSec: 3.2, outStartSec: 3.4, outEndSec: 5.85 },
  { sourceStartSec: 4.03, sourceEndSec: 17.89, outStartSec: 5.85, outEndSec: 19.71 },
  { sourceStartSec: 18.88, sourceEndSec: 22.6, outStartSec: 19.71, outEndSec: 23.44 },
  { sourceStartSec: 30.36, sourceEndSec: 33.43, outStartSec: 23.44, outEndSec: 26.51 },
];
const DURATION = 26.51;

function scene(id: string, startSec: number, endSec: number): PanelScene {
  return {
    id,
    outStartSec: startSec,
    outEndSec: endSec,
    kind: 'list-panel',
    eyebrow: ['A', 'B'],
    headline: null,
    figure: null,
    items: ['one', 'two'],
    icons: [],
    imageUrl: null,
    reason: 'test',
  } as unknown as PanelScene;
}

/** Every exhibit, in order, with no gap and no overlap. */
function assertContinuous(placed: PanelScene[], durationSec: number) {
  expect(placed.length).toBeGreaterThan(0);
  expect(placed[0].outStartSec).toBeCloseTo(0, 2);
  expect(placed[placed.length - 1].outEndSec).toBeCloseTo(durationSec, 2);
  for (let i = 0; i < placed.length - 1; i++) {
    expect(placed[i].outEndSec, `gap after ${placed[i].id}`).toBeCloseTo(placed[i + 1].outStartSec, 2);
  }
  for (const p of placed) expect(p.outEndSec, p.id).toBeGreaterThan(p.outStartSec);
}

describe('placing the panel', () => {
  // One exhibit every two seconds across the whole 40s of footage, which is
  // the cadence the reference edits keep.
  const written = Array.from({ length: 20 }, (_, i) => scene(`s${i}`, i * 2, i * 2 + 2));

  it('keeps the exhibits when the director moved the hook to the front', () => {
    const placed = placePanel(written, SEGMENTS, DURATION);
    assertContinuous(placed, DURATION);
    // Not five. Every source second that survived the cut brings its own
    // exhibit, so the count should be close to the kept footage ÷ 2s.
    expect(placed.length).toBeGreaterThanOrEqual(10);
  });

  it('never holds one exhibit for a quarter of the video', () => {
    const placed = placePanel(written, SEGMENTS, DURATION);
    const longest = Math.max(...placed.map((p) => p.outEndSec - p.outStartSec));
    expect(longest).toBeLessThan(DURATION / 4);
  });

  it('puts each exhibit where its own sentence ended up', () => {
    // Source 36.2–39.6 is the hook, now at output 0–3.4. The exhibit written
    // for source 36–38 belongs at the START of the finished video.
    const placed = placePanel([scene('hook', 36, 38), scene('open', 1, 3)], SEGMENTS, DURATION);
    expect(placed[0].id.startsWith('hook')).toBe(true);
    expect(placed[0].outStartSec).toBeCloseTo(0, 2);
  });

  it('drops an exhibit whose speech was cut out of the video', () => {
    // Source 23–29 is not in any segment.
    const placed = placePanel([scene('gone', 23, 29), scene('kept', 5, 7)], SEGMENTS, DURATION);
    expect(placed.map((p) => p.id.split('@')[0])).toEqual(['kept']);
    assertContinuous(placed, DURATION);
  });

  it('shows an exhibit twice when the edit shows its footage twice', () => {
    const repeated = [
      ...SEGMENTS,
      { sourceStartSec: 36.2, sourceEndSec: 39.6, outStartSec: 26.51, outEndSec: 29.91 },
    ];
    const placed = placePanel([scene('hook', 36.2, 39.6)], repeated, 29.91);
    expect(placed).toHaveLength(2);
    // Distinct ids, or the renderer keys two sequences the same.
    expect(new Set(placed.map((p) => p.id)).size).toBe(2);
  });

  it('scales into a retimed segment', () => {
    // Half speed: two source seconds take four output seconds, so the seam
    // between two exhibits written a second apart lands at output 2, not 1.
    const slow = [{ sourceStartSec: 0, sourceEndSec: 2, outStartSec: 0, outEndSec: 4 }];
    const placed = placePanel([scene('a', 0, 1), scene('b', 1, 2)], slow, 4);
    expect(placed).toHaveLength(2);
    expect(placed[0].outEndSec).toBeCloseTo(2, 2);
    assertContinuous(placed, 4);
  });

  it('gives up and returns nothing rather than half a panel', () => {
    expect(placePanel([], SEGMENTS, DURATION)).toEqual([]);
    expect(placePanel(written, [], DURATION)).toEqual([]);
  });
});
