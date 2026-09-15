import { describe, expect, it } from 'vitest';
import { CaptionStyleSchema } from '../src/lib/edl/types';
import { CAPTION_PRESETS, captionPresetFor, findCaptionPreset } from '../src/lib/captions/presets';
import { CAPTION_FONTS, findCaptionFont, fontStackFor } from '../src/lib/captions/fonts';
import { STYLE_LIST } from '../src/lib/styles/presets';

describe('caption fonts', () => {
  it('has no duplicate ids or modules', () => {
    const ids = CAPTION_FONTS.map((f) => f.id);
    const modules = CAPTION_FONTS.map((f) => f.module);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(modules).size).toBe(modules.length);
  });

  it('declares at least one weight for every family', () => {
    for (const font of CAPTION_FONTS) {
      expect(font.weights.length, font.id).toBeGreaterThan(0);
    }
  });

  it('falls back to a serif stack for serif faces and a sans stack otherwise', () => {
    expect(fontStackFor('Playfair Display')).toContain('Georgia');
    expect(fontStackFor('Poppins')).toContain('system-ui');
  });

  it('still produces a usable stack for a family it does not ship', () => {
    // An EDL naming a font we removed must not take the render down with it.
    expect(findCaptionFont('Comic Sans MS')).toBeUndefined();
    expect(fontStackFor('Comic Sans MS')).toContain('system-ui');
  });
});

describe('caption presets', () => {
  it('every preset is a complete, valid CaptionStyle', () => {
    for (const preset of CAPTION_PRESETS) {
      const parsed = CaptionStyleSchema.safeParse(preset.style);
      expect(parsed.success, `${preset.id}: ${parsed.success ? '' : parsed.error.message}`).toBe(true);
    }
  });

  it('every preset names a font we actually ship', () => {
    for (const preset of CAPTION_PRESETS) {
      expect(findCaptionFont(preset.style.fontFamily), preset.id).toBeDefined();
    }
  });

  it('every preset carries its own id, so the editor can name it', () => {
    for (const preset of CAPTION_PRESETS) {
      expect(preset.style.preset).toBe(preset.id);
    }
  });

  it('every preset asks for a weight its font has', () => {
    for (const preset of CAPTION_PRESETS) {
      const font = findCaptionFont(preset.style.fontFamily)!;
      expect(font.weights, `${preset.id} wants ${preset.style.fontWeight} of ${font.id}`)
        .toContain(String(preset.style.fontWeight));
    }
  });

  it('caps-only faces are only used with uppercase on', () => {
    // Otherwise the editor offers a Sentence case toggle that does nothing.
    for (const preset of CAPTION_PRESETS) {
      const font = findCaptionFont(preset.style.fontFamily)!;
      if (font.capsOnly) expect(preset.style.uppercase, preset.id).toBe(true);
    }
  });

  it('word-box presets define the box they animate', () => {
    for (const preset of CAPTION_PRESETS) {
      if (preset.style.animation === 'word-box') expect(preset.style.wordBox, preset.id).not.toBeNull();
    }
  });

  it('keeps captions inside the frame', () => {
    for (const preset of CAPTION_PRESETS) {
      const { positionY, widthRatio, fontSizeRatio, maxLines } = preset.style;
      expect(widthRatio, preset.id).toBeLessThanOrEqual(0.95);
      // Anchored at the vertical centre of the block, so half of it hangs below.
      const halfBlock = (fontSizeRatio * maxLines * 1.35) / 2;
      expect(positionY + halfBlock, preset.id).toBeLessThan(1);
      expect(positionY - halfBlock, preset.id).toBeGreaterThan(0);
    }
  });

  it('no two presets are the same look under different names', () => {
    const seen = new Map<string, string>();
    for (const preset of CAPTION_PRESETS) {
      const shape = JSON.stringify({ ...preset.style, preset: '' });
      expect(seen.get(shape), `${preset.id} duplicates ${seen.get(shape)}`).toBeUndefined();
      seen.set(shape, preset.id);
    }
  });
});

describe('preset provenance', () => {
  it('reports the preset an untouched style came from', () => {
    const impact = findCaptionPreset('impact')!;
    expect(captionPresetFor(impact.style)?.id).toBe('impact');
  });

  it('reports nothing once the style has been edited', () => {
    // An editor that still says "Impact" over type the user has recoloured is
    // lying, and the next person to open the project cannot tell which to trust.
    const impact = findCaptionPreset('impact')!;
    expect(captionPresetFor({ ...impact.style, color: '#FF0000' })).toBeNull();
  });
});

describe('edit styles and caption presets are separate choices', () => {
  it('every edit style resolves to a real caption preset', () => {
    for (const style of STYLE_LIST) {
      expect(findCaptionPreset(style.captionPreset), style.id).toBeDefined();
      expect(style.captionStyle.preset).toBe(style.captionPreset);
    }
  });

  it('a style holds a copy, so editing one project cannot change the preset', () => {
    const style = STYLE_LIST[0];
    const preset = findCaptionPreset(style.captionPreset)!;
    style.captionStyle.color = '#123456';
    expect(preset.style.color).not.toBe('#123456');
    style.captionStyle.color = preset.style.color; // put it back for other tests
  });
});
