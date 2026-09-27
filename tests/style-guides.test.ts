import { describe, expect, it } from 'vitest';
import { SCENE_LOOKS } from '@/lib/edl/types';
import { STYLE_GUIDES, guideAsPrompt, styleGuideFor } from '@/lib/scenes/style-guides';
import { LOOK_META } from '@/lib/scenes/looks';
import { animationCost, billableSeconds, motionPrompt } from '@/lib/director/animate';

/**
 * The style guides are the one description of a visual world, and three
 * readers now depend on them: the model that draws a scene, the model that
 * animates it, and the picker somebody chooses from. Most of what follows
 * guards against the failure that made this file necessary — the same style
 * described twice, slightly differently, in two places.
 */

describe('every look has a usable guide', () => {
  it('covers every look exactly once', () => {
    for (const look of SCENE_LOOKS) expect(STYLE_GUIDES[look]?.id).toBe(look);
    expect(Object.keys(STYLE_GUIDES)).toHaveLength(SCENE_LOOKS.length);
  });

  it('names every colour it lists, and lists enough of them to draw with', () => {
    for (const guide of Object.values(STYLE_GUIDES)) {
      expect(guide.palette.length).toBeGreaterThanOrEqual(4);
      for (const swatch of guide.palette) {
        expect(swatch.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
        // A palette of bare hex values produces a muddy average of itself; a
        // named one produces a drawn object.
        expect(swatch.role.length).toBeGreaterThan(4);
      }
      expect(guide.ground).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(guide.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('writes instructions rather than adjectives', () => {
    // Not a style opinion: a one-word field is a field a model will ignore.
    for (const guide of Object.values(STYLE_GUIDES)) {
      for (const field of [guide.rendering, guide.lighting, guide.ground_rule, guide.motion, guide.camera]) {
        expect(field.split(/\s+/).length).toBeGreaterThan(6);
      }
      expect(guide.never.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('agrees with the look the renderer draws', () => {
    // The drift this file exists to stop: the drawing prompt's idea of a
    // world and the renderer's, diverging one edit at a time.
    for (const look of SCENE_LOOKS) {
      expect(STYLE_GUIDES[look].accent.toUpperCase()).toBe(LOOK_META[look].swatch.toUpperCase());
    }
  });

  it('falls back rather than throwing on a look it has never heard of', () => {
    expect(styleGuideFor('cyberpunk' as never).id).toBe('studio');
  });
});

describe('the guide as prompt text', () => {
  it('carries the ground, every colour and the negatives', () => {
    const text = guideAsPrompt(STYLE_GUIDES.neon);
    expect(text).toContain('#05060F');
    for (const swatch of STYLE_GUIDES.neon.palette) expect(text).toContain(swatch.hex);
    expect(text).toContain('Never:');
  });

  it('leaves out the fields the reader has no use for', () => {
    // An SVG has no camera; including one is noise in a prompt that is
    // already long, and noise is what gets ignored first.
    const drawing = guideAsPrompt(STYLE_GUIDES.archive, ['palette', 'rendering']);
    expect(drawing).not.toContain('Camera:');
    expect(guideAsPrompt(STYLE_GUIDES.archive, ['camera'])).toContain('Camera:');
  });
});

describe('the motion prompt', () => {
  const base = { plate: 'data:image/png;base64,AA', look: 'neon' as const, seconds: 4 };

  it('leads with what changes, not with what the picture is', () => {
    // An image-to-video model can already see the subject. Restating it is
    // what made Seedance draw a second figure beside ours in testing.
    const prompt = motionPrompt({ ...base, motion: 'The glow pulses and the dashed silhouettes fade away' });
    expect(prompt.split('\n')[0]).toContain('The glow pulses');
  });

  it('punctuates the motion line however it arrived', () => {
    expect(motionPrompt({ ...base, motion: 'The hands sweep forward' })).toContain('The hands sweep forward.');
    expect(motionPrompt({ ...base, motion: 'The hands sweep forward.' })).not.toContain('forward..');
  });

  it('carries the world it belongs to, not a generic one', () => {
    const neon = motionPrompt({ ...base, motion: 'x' });
    const archive = motionPrompt({ ...base, look: 'archive', motion: 'x' });
    expect(neon).toContain('glow');
    expect(archive).toContain('embers');
    expect(neon).not.toBe(archive);
  });

  it('names the failures these models actually have', () => {
    const prompt = motionPrompt({ ...base, motion: 'x' });
    // Every one of these is something that happened in testing and cost a clip.
    expect(prompt).toContain('no text');
    expect(prompt).toContain('do not add any new object');
    expect(prompt).toContain('one continuous shot');
  });
});

describe('what a second of animation costs', () => {
  it('buys whole five-second blocks, because that is how it bills', () => {
    expect(billableSeconds(2.4)).toBe(5);
    expect(billableSeconds(5)).toBe(5);
    expect(billableSeconds(5.1)).toBe(10);
  });

  it('prices a short insert as the block it really costs', () => {
    // $0.20 a second at 720p — the catalogue's number is the 480p base, and
    // quoting that is how a four-scene video is budgeted at half its price.
    expect(animationCost(3)).toBeCloseTo(1, 5);
    expect(animationCost(6)).toBeCloseTo(2, 5);
  });
});
