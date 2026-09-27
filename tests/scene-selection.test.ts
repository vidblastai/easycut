import { describe, expect, it } from 'vitest';
import { sanitiseScenes, sceneBudget, type PlannedScene } from '@/lib/director/scenes';

/**
 * A scene takes the speaker off the screen, so every rule here is one a model
 * breaks occasionally and a viewer notices every time. The prompt asks for all
 * of them; this is where they are actually enforced.
 */
const scene = (over: Partial<PlannedScene> = {}): PlannedScene => ({
  startSec: 10,
  endSec: 14,
  kind: 'kinetic-text',
  backdrop: 'gradient',
  headline: 'You do not need a team',
  items: [],
  iconQueries: [],
  reason: '',
  ...over,
});

describe('keeping a scene plan honest', () => {
  it('leaves the hook alone', () => {
    // The opening seconds are the speaker earning attention.
    const [out] = sanitiseScenes([scene({ startSec: 0, endSec: 6 })], 60);
    expect(out.startSec).toBeGreaterThanOrEqual(2.5);
  });

  it('drops a scene too short to read', () => {
    expect(sanitiseScenes([scene({ startSec: 10, endSec: 11.2 })], 60)).toHaveLength(0);
  });

  it('caps one that would run too long', () => {
    const [out] = sanitiseScenes([scene({ startSec: 10, endSec: 40 })], 60);
    expect(out.endSec - out.startSec).toBeLessThanOrEqual(6.5);
  });

  it('never leaves two back to back', () => {
    const out = sanitiseScenes(
      [scene({ startSec: 10, endSec: 14 }), scene({ startSec: 15, endSec: 19 })],
      60,
    );
    expect(out).toHaveLength(1);
  });

  it('keeps two that are properly spaced', () => {
    const out = sanitiseScenes(
      [scene({ startSec: 10, endSec: 14 }), scene({ startSec: 22, endSec: 26 })],
      60,
    );
    expect(out).toHaveLength(2);
  });

  it('never runs past the end of the video', () => {
    const [out] = sanitiseScenes([scene({ startSec: 50, endSec: 70 })], 56);
    expect(out.endSec).toBeLessThanOrEqual(56);
  });

  it('falls back to the words when a compare has only one side', () => {
    // Half a comparison drawn as a comparison is a scene with a hole in it.
    const [out] = sanitiseScenes([scene({ kind: 'compare', items: ['Before'] })], 60);
    expect(out.kind).toBe('kinetic-text');
  });

  it('keeps a compare that has both sides', () => {
    const [out] = sanitiseScenes([scene({ kind: 'compare', items: ['Before', 'After'] })], 60);
    expect(out.kind).toBe('compare');
  });

  it('falls back when a big-number has no number in it', () => {
    const [out] = sanitiseScenes([scene({ kind: 'big-number', headline: 'a lot faster' })], 60);
    expect(out.kind).toBe('kinetic-text');
  });

  it('drops empty labels rather than drawing a blank step', () => {
    const [out] = sanitiseScenes([scene({ kind: 'journey', items: ['One', '  ', 'Two'] })], 60);
    expect(out.items).toEqual(['One', 'Two']);
  });

  it('clamps against the FOOTAGE length, not the finished length', () => {
    /*
     * The bug that hid the whole feature.
     *
     * Timestamps come back in source time. The pipeline has the post-cut
     * length closest to hand, and passing that here clamped every scene in the
     * back half of a video down to nothing — on a product whose job is cutting
     * silence out, that was most of them, silently, with no error anywhere.
     */
    const source = 60;
    const [out] = sanitiseScenes([scene({ startSec: 42, endSec: 47 })], source);
    expect(out).toBeDefined();
    expect(out.startSec).toBeCloseTo(42);
    expect(out.endSec).toBeCloseTo(47);

    // And the shape of the mistake, so it cannot come back unnoticed: the same
    // scene measured against the finished length simply vanishes.
    const finished = 38;
    expect(sanitiseScenes([scene({ startSec: 42, endSec: 47 })], finished)).toHaveLength(0);
  });

  it('budgets roughly one scene per half minute, capped', () => {
    expect(sceneBudget(20)).toBe(1);
    expect(sceneBudget(60)).toBe(2);
    expect(sceneBudget(600)).toBe(6);
  });
});
