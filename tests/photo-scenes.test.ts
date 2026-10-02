import { describe, expect, it } from 'vitest';
import {
  PHOTO_GRID_MAX,
  PHOTO_ROW_MAX,
  SCENE_KINDS,
  photoSlotsFor,
  sceneIsDrawn,
  type AnimatedScene,
  type SceneKind,
} from '@/lib/edl/types';
import { sanitiseScenes, SCENE_SYSTEM_PROMPT, type PlannedScene } from '@/lib/director/scenes';
import { photoOrientationFor } from '@/lib/pipeline/assets';

const scene = (over: Partial<AnimatedScene> = {}): AnimatedScene => ({
  id: 'sc1', outStartSec: 4, outEndSec: 9, kind: 'photo-row', look: 'studio', backdrop: 'auto',
  headline: '', items: ['hiking boots', 'water bottle', 'paper map'],
  iconQueries: [], iconSvgs: [], photoUrls: [], art: null,
  accent: '#9B7BFF', reason: '', enter: null, exit: null, ...over,
} as unknown as AnimatedScene);

const planned = (over: Partial<PlannedScene> = {}): PlannedScene => ({
  startSec: 10, endSec: 15, kind: 'photo-row', backdrop: 'auto',
  headline: 'Three things to pack', items: ['hiking boots', 'water bottle', 'paper map'],
  iconQueries: [], reason: '', ...over,
});

const drawing = { parts: [{ markup: '<g/>', depth: 0.5 }], viewBox: '0 0 1000 1778' };

describe('how many photographs a kind wants', () => {
  it('asks for one per thing named, inside the kind’s own range', () => {
    expect(photoSlotsFor({ kind: 'photo-point', items: ['golden hour'] })).toBe(1);
    expect(photoSlotsFor({ kind: 'photo-hero', items: ['motogp rider cornering'] })).toBe(1);
    expect(photoSlotsFor({ kind: 'photo-row', items: ['a', 'b'] })).toBe(2);
    expect(photoSlotsFor({ kind: 'photo-row', items: ['a', 'b', 'c'] })).toBe(3);
    expect(photoSlotsFor({ kind: 'transform', items: ['seedling', 'tree'] })).toBe(2);
    expect(photoSlotsFor({ kind: 'photo-grid', items: ['a', 'b', 'c', 'd', 'e'] })).toBe(5);
  });

  it('never searches for more pictures than the layout can hold', () => {
    const many = Array.from({ length: 12 }, (_, i) => `thing ${i}`);
    expect(photoSlotsFor({ kind: 'photo-row', items: many })).toBe(PHOTO_ROW_MAX);
    expect(photoSlotsFor({ kind: 'photo-grid', items: many })).toBe(PHOTO_GRID_MAX);
  });

  it('fills the layout’s minimum even when the words ran out', () => {
    // The plates are drawn either way; an empty one names nothing rather than
    // leaving a hole where the third picture was meant to be.
    expect(photoSlotsFor({ kind: 'photo-row', items: ['alone'] })).toBe(2);
    expect(photoSlotsFor({ kind: 'photo-grid', items: ['a', 'b'] })).toBe(4);
  });

  it('asks for none at all on the kinds that draw an idea', () => {
    for (const kind of ['kinetic-text', 'journey', 'compare', 'orbit', 'stack', 'big-number'] as SceneKind[]) {
      expect(photoSlotsFor({ kind, items: ['a', 'b', 'c'] })).toBe(0);
    }
  });
});

describe('a photo scene is never replaced by a drawing', () => {
  it('ignores art handed to it, because the illustrator never saw the pictures', () => {
    for (const kind of SCENE_KINDS) {
      const s = scene({ kind, art: drawing as never });
      expect(sceneIsDrawn(s), kind).toBe(photoSlotsFor(s) === 0);
    }
  });

  it('still lets the idea kinds be drawn', () => {
    expect(sceneIsDrawn(scene({ kind: 'orbit', art: drawing as never }))).toBe(true);
  });
});

describe('the count is what makes a photo kind usable', () => {
  const kinds = (scenes: PlannedScene[]) => sanitiseScenes(scenes, 600).map((s) => s.kind);

  it('keeps a row of two or three and a grid of four to six', () => {
    expect(kinds([planned({ items: ['a', 'b'] })])).toEqual(['photo-row']);
    expect(kinds([planned({ kind: 'photo-grid', items: ['a', 'b', 'c', 'd'] })])).toEqual(['photo-grid']);
  });

  it('falls back to the words rather than drawing a row with a hole in it', () => {
    // One picture in a layout built for three, and a grid missing half its
    // cells, are not quieter versions of themselves — they are broken ones.
    expect(kinds([planned({ items: ['alone'] })])).toEqual(['kinetic-text']);
    expect(kinds([planned({ kind: 'photo-grid', items: ['a', 'b'] })])).toEqual(['kinetic-text']);
    expect(kinds([planned({ items: ['a', 'b', 'c', 'd', 'e'] })])).toEqual(['kinetic-text']);
  });

  it('keeps a photo-hero on one thing and no line at all', () => {
    // The picture is the whole scene here, so there is nothing else to need.
    expect(kinds([planned({ kind: 'photo-hero', items: ['motogp rider'], headline: '' })])).toEqual(['photo-hero']);
    expect(kinds([planned({ kind: 'photo-hero', items: [], headline: 'nothing to show' })])).toEqual(['kinetic-text']);
  });

  it('refuses a photo-point with no line, since the line is half the layout', () => {
    expect(kinds([planned({ kind: 'photo-point', items: ['golden hour'], headline: '' })])).toEqual(['kinetic-text']);
    expect(kinds([planned({ kind: 'photo-point', items: ['golden hour'] })])).toEqual(['photo-point']);
  });
});

describe('the frame a photograph is searched in', () => {
  it('matches the plate it will be cropped into, not always the video', () => {
    expect(photoOrientationFor('photo-row', 'landscape')).toBe('portrait');
    expect(photoOrientationFor('transform', 'landscape')).toBe('portrait');
    expect(photoOrientationFor('photo-grid', 'portrait')).toBe('square');
  });

  it('follows the video where the plate follows the video', () => {
    expect(photoOrientationFor('photo-point', 'landscape')).toBe('landscape');
    expect(photoOrientationFor('photo-point', 'portrait')).toBe('portrait');
    // The hero card is the frame's own shape, so the search is too.
    expect(photoOrientationFor('photo-hero', 'landscape')).toBe('landscape');
    expect(photoOrientationFor('photo-hero', 'portrait')).toBe('portrait');
  });
});

describe('the director is told about every kind it may pick', () => {
  it('names every one of them in the brief', () => {
    for (const kind of SCENE_KINDS) {
      expect(SCENE_SYSTEM_PROMPT, `${kind} is pickable but undocumented`).toContain(kind);
    }
  });

  it('says out loud that the things have to be photographable', () => {
    expect(SCENE_SYSTEM_PROMPT).toMatch(/point a camera at/i);
  });
});
