import { describe, expect, it } from 'vitest';
import { applyOperations } from '@/lib/edl/operations';
import { SCENE_LOOKS, type AnimatedScene, type Edl } from '@/lib/edl/types';
import { LOOK_LIST, LOOK_META } from '@/lib/scenes/looks';
import { STYLE_LIST } from '@/lib/styles/presets';
import { splitFigure } from '../remotion/components/Scenes';

const scene = (over: Partial<AnimatedScene> = {}): AnimatedScene => ({
  id: 'sc1', outStartSec: 4, outEndSec: 8, kind: 'kinetic-text', look: 'studio', backdrop: 'gradient',
  headline: 'You do not need a team', items: [], iconQueries: [], iconSvgs: [], art: null,
  accent: '#9B7BFF', reason: '', ...over,
});

const edl = (scenes: AnimatedScene[]) =>
  ({
    format: { durationSec: 30, width: 1080, height: 1920, fps: 30, aspect: '9:16', layout: 'full' },
    segments: [{ id: 'a', sourceStartSec: 0, sourceEndSec: 30, outStartSec: 0, outEndSec: 30, speed: 1, reason: 'keep', text: '' }],
    scenes, captions: [], broll: [], graphics: [], overlays: [], transitions: [],
    punchIns: [], sfx: [], captionStyle: { emphasisColor: '#9B7BFF' }, degraded: [],
  }) as unknown as Edl;

describe('look metadata', () => {
  it('describes every look exactly once', () => {
    expect(LOOK_LIST).toHaveLength(SCENE_LOOKS.length);
    expect(new Set(LOOK_LIST.map((l) => l.id)).size).toBe(SCENE_LOOKS.length);
    for (const id of SCENE_LOOKS) expect(LOOK_META[id].id).toBe(id);
  });

  it('gives every look a name, a blurb and a swatch the picker can draw', () => {
    for (const look of LOOK_LIST) {
      expect(look.name.length).toBeGreaterThan(2);
      expect(look.bestFor.length).toBeGreaterThan(10);
      expect(look.swatch).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('keeps most looks on a hard cut', () => {
    // If this ever flips to mostly-fade, the scenes will have quietly stopped
    // reading as edited — a dissolve eats a quarter of a two-second insert.
    expect(LOOK_LIST.filter((l) => l.entry === 'cut').length).toBeGreaterThan(LOOK_LIST.length / 2);
  });
});

describe('styles name a look', () => {
  it('every style picks one that exists', () => {
    for (const style of STYLE_LIST) {
      expect(SCENE_LOOKS).toContain(style.sceneLook);
    }
  });

  it('the styles between them use more than one world', () => {
    // A single look across fourteen styles would mean the axis is decorative.
    expect(new Set(STYLE_LIST.map((s) => s.sceneLook)).size).toBeGreaterThan(1);
  });
});

describe('scene.look', () => {
  it('changes every scene at once, not just the selected one', () => {
    const before = edl([scene({ id: 'a' }), scene({ id: 'b' }), scene({ id: 'c' })]);
    const after = applyOperations(before, [{ op: 'scene.look', look: 'archive' }]).edl;
    expect(after.scenes.map((s) => s.look)).toEqual(['archive', 'archive', 'archive']);
  });

  it('is one undo step for what the user did once', () => {
    const before = edl([scene({ id: 'a' }), scene({ id: 'b' })]);
    const after = applyOperations(before, [{ op: 'scene.look', look: 'neon' }]).edl;
    // Same document identity rules as any other op: the change is applied
    // immutably, so the previous state is intact for the undo stack.
    expect(before.scenes.every((s) => s.look === 'studio')).toBe(true);
    expect(after.scenes.every((s) => s.look === 'neon')).toBe(true);
  });

  it('does nothing harmful on a video with no scenes', () => {
    expect(applyOperations(edl([]), [{ op: 'scene.look', look: 'gallery' }]).edl.scenes).toEqual([]);
  });
});

describe('a hand-added scene joins the world already on screen', () => {
  it('takes the look of the scenes beside it', () => {
    const before = edl([scene({ id: 'a', look: 'archive' })]);
    const after = applyOperations(before, [
      { op: 'clip.add', track: 'scenes', atSec: 20, durationSec: 3, value: 'A new line', id: 'sc-new' },
    ]).edl;
    expect(after.scenes.find((s) => s.id === 'sc-new')?.look).toBe('archive');
  });
});

describe('splitFigure', () => {
  it('pulls a percentage off its sentence', () => {
    expect(splitFigure('95% of your ideas', '')).toEqual({ value: '95%', label: 'of your ideas' });
  });

  it('keeps a magnitude suffix with the figure', () => {
    expect(splitFigure('63K followers', '').value).toBe('63K');
  });

  it('falls back to the scene item when the headline is only a figure', () => {
    expect(splitFigure('12', 'hours a day')).toEqual({ value: '12', label: 'hours a day' });
  });

  it('leaves a figureless headline alone', () => {
    expect(splitFigure('most of them', 'never post').value).toBe('most of them');
  });
});

/**
 * Picking the world the scenes are drawn in, instead of inheriting it.
 *
 * This used to arrive as a side effect: the edit style named a look, so
 * choosing "Clean" because of how it crops a talking head also decided that
 * every full-screen insert would be white. The override is the fix, and these
 * are the properties that make it safe to expose in the picker.
 */
describe('choosing a scene look', () => {
  it('overrides the edit style, and leaves everything else alone', async () => {
    const { styleFor, getStyle } = await import('../src/lib/styles/presets');
    const base = getStyle('clean');
    expect(base.sceneLook).toBe('studio');

    const dark = styleFor('clean', null, 'archive');
    expect(dark.sceneLook).toBe('archive');
    expect(dark.layout).toBe(base.layout);
    expect(dark.accent).toBe(base.accent);
  });

  it('takes the style-s own look when nothing was chosen', async () => {
    const { styleFor, getStyle } = await import('../src/lib/styles/presets');
    expect(styleFor('punchy').sceneLook).toBe(getStyle('punchy').sceneLook);
    expect(styleFor('punchy', null, null).sceneLook).toBe(getStyle('punchy').sceneLook);
  });

  it('ignores a look that no longer exists rather than failing the render', async () => {
    // A months-old project holding a retired id should cost the user a
    // preference, not the video.
    const { styleFor, getStyle } = await import('../src/lib/styles/presets');
    expect(styleFor('clean', null, 'vaporwave').sceneLook).toBe(getStyle('clean').sceneLook);
  });

  it('carries both overrides at once', async () => {
    const { styleFor } = await import('../src/lib/styles/presets');
    const both = styleFor('clean', 'impact', 'neon');
    expect(both.sceneLook).toBe('neon');
    expect(both.captionStyle.preset).toBe('impact');
  });

  it('sorts every look into light or dark, from the ground it draws on', async () => {
    const { LOOK_LIST } = await import('../src/lib/scenes/looks');
    const { STYLE_GUIDES } = await import('../src/lib/scenes/style-guides');

    // The picker groups by this, so a wrong answer sends somebody looking for
    // the dark style under "Light".
    for (const look of LOOK_LIST) {
      expect(['light', 'dark']).toContain(look.tone);
    }
    expect(LOOK_LIST.find((l) => l.id === 'neon')?.tone).toBe('dark');
    expect(LOOK_LIST.find((l) => l.id === 'archive')?.tone).toBe('dark');
    expect(LOOK_LIST.find((l) => l.id === 'editorial')?.tone).toBe('dark');
    expect(LOOK_LIST.find((l) => l.id === 'gallery')?.tone).toBe('light');
    expect(LOOK_LIST.find((l) => l.id === 'studio')?.tone).toBe('light');

    // And both groups have something in them, or the control is a lie.
    expect(LOOK_LIST.some((l) => l.tone === 'dark')).toBe(true);
    expect(LOOK_LIST.some((l) => l.tone === 'light')).toBe(true);
    expect(STYLE_GUIDES.neon.ground).toBeTruthy();
  });
});
