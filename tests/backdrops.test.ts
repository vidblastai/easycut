import { describe, expect, it } from 'vitest';
import { SCENE_BACKDROPS, SCENE_LOOKS, AnimatedSceneSchema } from '@/lib/edl/types';
import { PlannedSceneSchema, SCENE_SYSTEM_PROMPT } from '@/lib/director/scenes';
import { styleGuideFor } from '@/lib/scenes/style-guides';
import { isDark, surfaceTone } from '../remotion/looks/surface';

const scene = (backdrop: unknown) => ({
  id: 'sc1', outStartSec: 0, outEndSec: 4, kind: 'kinetic-text',
  look: 'studio', backdrop, headline: 'A line', items: [],
  iconQueries: [], iconSvgs: [], photoUrls: [], art: null,
  accent: '#9B7BFF', reason: '',
});

describe('the backdrop list', () => {
  it('offers the paper and grid surfaces the scenes are printed on', () => {
    expect(SCENE_BACKDROPS).toContain('paper');
    expect(SCENE_BACKDROPS).toContain('paper-grid');
    expect(SCENE_BACKDROPS).toContain('grid');
  });

  it('defaults to the look’s own ground rather than a surface', () => {
    const parsed = AnimatedSceneSchema.parse({ ...scene(undefined) });
    expect(parsed.backdrop).toBe('auto');
    expect(PlannedSceneSchema.parse({ startSec: 0, endSec: 4, kind: 'kinetic-text' }).backdrop).toBe('auto');
  });

  it('falls back to auto rather than throwing on a surface it has never heard of', () => {
    expect(AnimatedSceneSchema.parse(scene('corrugated-iron')).backdrop).toBe('auto');
  });

  it('tells the director about every surface it is allowed to pick', () => {
    for (const backdrop of SCENE_BACKDROPS) {
      expect(SCENE_SYSTEM_PROMPT, `${backdrop} is pickable but undocumented`).toContain(backdrop);
    }
  });
});

describe('a surface takes its tone from the look', () => {
  it('never picks its own ground', () => {
    for (const look of SCENE_LOOKS) {
      expect(surfaceTone(look).ground).toBe(styleGuideFor(look).ground);
    }
  });

  it('marks a dark ground with light and a light ground with ink', () => {
    for (const look of SCENE_LOOKS) {
      const tone = surfaceTone(look);
      expect(tone.mark).toBe(tone.dark ? 'rgba(255,255,255,' : 'rgba(13,13,16,');
    }
  });

  it('presses the texture more softly on a light ground, where it reads harder', () => {
    const light = { ground: '#FFFFFF', dark: false };
    for (const look of SCENE_LOOKS) {
      const tone = surfaceTone(look);
      if (!tone.dark) expect(tone.tooth).toBeGreaterThan(0.04);
      else expect(tone.tooth).toBeLessThan(0.04);
    }
    expect(isDark(light.ground)).toBe(false);
  });

  it('closes into a usable rgba() when an alpha is appended', () => {
    for (const look of SCENE_LOOKS) {
      const tone = surfaceTone(look);
      expect(`${tone.mark}${tone.rule})`).toMatch(/^rgba\(\d+,\d+,\d+,0\.\d+\)$/);
    }
  });
});

describe('reading a ground as dark or light', () => {
  it('weights green the way the eye does, so a saturated blue stays dark', () => {
    expect(isDark('#0D0D10')).toBe(true);
    expect(isDark('#0000FF')).toBe(true);
    expect(isDark('#00FF00')).toBe(false);
    expect(isDark('#F5F5F7')).toBe(false);
  });

  it('treats a colour it cannot read as light, which is the safe guess', () => {
    // Light is safe because the looks' inks are dark: marks stay visible.
    expect(isDark('#fff')).toBe(false);
    expect(isDark('not a colour')).toBe(false);
  });
});
