import { describe, expect, it } from 'vitest';
import { applyOperations } from '@/lib/edl/operations';
import { sceneHasText, type AnimatedScene, type Edl } from '@/lib/edl/types';

const scene = (over: Partial<AnimatedScene> = {}): AnimatedScene => ({
  id: 'sc1', outStartSec: 4, outEndSec: 8, kind: 'kinetic-text', backdrop: 'gradient',
  headline: 'You do not need a team', items: [], iconQueries: [], iconSvgs: [],
  accent: '#9B7BFF', reason: '', ...over,
});

const doc = (scenes: AnimatedScene[]) =>
  ({
    format: { durationSec: 30, width: 1080, height: 1920, fps: 30, aspect: '9:16', layout: 'full' },
    segments: [{ id: 'a', sourceStartSec: 0, sourceEndSec: 30, outStartSec: 0, outEndSec: 30, speed: 1, reason: 'keep', text: '' }],
    scenes, captions: [], broll: [], graphics: [], overlays: [], transitions: [],
    punchIns: [], sfx: [], captionStyle: { emphasisColor: '#9B7BFF' }, degraded: [],
  }) as unknown as Edl;

describe('scenes as a track you can edit', () => {
  it('moves like any other clip, keeping its length', () => {
    const out = applyOperations(doc([scene()]), [
      { op: 'clip.move', track: 'scenes', id: 'sc1', outStartSec: 12 },
    ]).edl;
    expect(out.scenes[0].outStartSec).toBeCloseTo(12);
    expect(out.scenes[0].outEndSec).toBeCloseTo(16);
  });

  it('trims from either end', () => {
    const out = applyOperations(doc([scene()]), [
      { op: 'clip.trim', track: 'scenes', id: 'sc1', outEndSec: 6 },
    ]).edl;
    expect(out.scenes[0].outEndSec).toBeCloseTo(6);
  });

  it('deletes', () => {
    const out = applyOperations(doc([scene()]), [
      { op: 'clip.delete', track: 'scenes', id: 'sc1' },
    ]).edl;
    expect(out.scenes).toHaveLength(0);
  });

  it('refuses to stack two on the same moment', () => {
    // Two full-frame animations at once is not a thing that can be drawn.
    const two = doc([scene(), scene({ id: 'sc2', outStartSec: 14, outEndSec: 18 })]);
    const result = applyOperations(two, [
      { op: 'clip.move', track: 'scenes', id: 'sc2', outStartSec: 5 },
    ]);
    expect(result.edl.scenes.find((s) => s.id === 'sc2')!.outStartSec).not.toBeCloseTo(5);
  });

  it('can be added by hand at the playhead', () => {
    const out = applyOperations(doc([]), [
      { op: 'clip.add', track: 'scenes', atSec: 10, durationSec: 3.5, value: 'Try this', id: 'new1' },
    ]).edl;
    expect(out.scenes).toHaveLength(1);
    expect(out.scenes[0].headline).toBe('Try this');
  });
});

describe('who gets to put words on the screen', () => {
  it('a scene with a headline is carrying text', () => {
    expect(sceneHasText(scene())).toBe(true);
  });

  it('a scene with only labels is carrying text', () => {
    expect(sceneHasText(scene({ headline: '', items: ['One', 'Two', 'Three'] }))).toBe(true);
  });

  it('a scene with no words at all is not', () => {
    // Shapes and icons have no quarrel with the caption band.
    expect(sceneHasText(scene({ headline: '', items: [] }))).toBe(false);
    expect(sceneHasText(scene({ headline: '   ', items: ['  '] }))).toBe(false);
  });
});
