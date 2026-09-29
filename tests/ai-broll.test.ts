import { describe, expect, it } from 'vitest';
import {
  BROLL_SOURCES,
  isBrollSource,
  moveForStill,
} from '@/lib/assets/ai-broll';
import { KIE_IMAGE_COST_USD, KIE_VIDEO_MODELS, kieVideoModel } from '@/lib/assets/kie';

/**
 * B-roll that is made rather than found.
 *
 * The thing worth pinning is the economics, because they are the whole reason
 * this is a choice and not a default: a generated still and a generated clip
 * are not two flavours of one feature, they are three cents against dollars
 * and seconds against minutes.
 */
describe('AI B-roll', () => {
  it('keeps a still an order of magnitude cheaper than a clip', () => {
    // Four inserts of stills is twelve cents, inside a one-dollar short four
    // times over. Four clips from the best model is $2.48 — over budget on its
    // own, before a single frame is rendered. That gap is the design.
    const stills = 4 * KIE_IMAGE_COST_USD;
    const best = KIE_VIDEO_MODELS.find((m) => m.id === 'bytedance/seedance-2-fast')!;
    const clips = 4 * 5 * best.usdPerSec;

    expect(stills).toBeCloseTo(0.12, 5);
    expect(clips).toBeGreaterThan(2);
    expect(clips / stills).toBeGreaterThan(10);
  });

  it('prices every video model per second, and orders them by what they cost', () => {
    // The picker quotes these and the ledger charges them, so a number that
    // drifts here is a budget that silently stops meaning anything.
    for (const model of KIE_VIDEO_MODELS) {
      expect(model.usdPerSec).toBeGreaterThan(0);
      expect(model.durations.length).toBeGreaterThan(0);
      expect(model.typicalSec).toBeGreaterThan(0);
    }
    const costs = KIE_VIDEO_MODELS.map((m) => m.usdPerSec);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
    // And the dearest is also the slowest, which is why it cannot be a default.
    expect(KIE_VIDEO_MODELS.at(-1)!.typicalSec).toBe(Math.max(...KIE_VIDEO_MODELS.map((m) => m.typicalSec)));
  });

  it('falls back to a known model rather than throwing on a stale id', () => {
    // A model name in a months-old deployment's env should cost a preference,
    // not every render that deployment attempts.
    expect(kieVideoModel('bytedance/does-not-exist').id).toBeTruthy();
    expect(kieVideoModel('bytedance/v1-lite-text-to-video').label).toBe('Seedance 1.0 Lite');
  });

  it('never gives two consecutive stills the same move', () => {
    /*
     * Four stills all pushing in at the same rate is its own kind of static —
     * it reads as a slideshow with a zoom effect on it rather than as B-roll.
     * By index rather than at random, because the rest of the pipeline is
     * deterministic and a generated insert must not be the one thing that is
     * not: the same footage has to cut the same way twice.
     */
    const moves = [0, 1, 2, 3, 4, 5].map(moveForStill);
    for (let i = 1; i < moves.length; i++) expect(moves[i]).not.toBe(moves[i - 1]);
    expect(moveForStill(0)).toBe(moveForStill(4));
    // And none of them is "none" — a generated still that holds still is the
    // thing this exists to avoid.
    expect(moves).not.toContain('none');
  });

  it('only accepts a source it knows', () => {
    expect(BROLL_SOURCES).toEqual(['stock', 'ai-image', 'ai-video']);
    expect(isBrollSource('ai-image')).toBe(true);
    expect(isBrollSource('ai-everything')).toBe(false);
    expect(isBrollSource(undefined)).toBe(false);
  });
});
