import { describe, expect, it } from 'vitest';
import { styleFor, STYLE_PRESETS } from '@/lib/styles/presets';
import { CAPTION_PRESETS, findCaptionPreset } from '@/lib/captions/presets';

/**
 * Choosing the caption look before the edit runs.
 *
 * The chain was already there — the API validates the id, stores it, and the
 * pipeline resolves it — but nothing in the product ever sent one, so it was
 * never exercised. These pin the two ends of it.
 */

describe('an explicitly chosen caption look', () => {
  it('overrides the one the edit style would have picked', () => {
    const punchy = STYLE_PRESETS.punchy;
    const chosen = styleFor('punchy', 'neon');
    expect(punchy.captionPreset).not.toBe('neon');
    expect(chosen.captionStyle.preset).toBe('neon');
  });

  it('falls back to the edit style’s own when nothing is chosen', () => {
    const resolved = styleFor('punchy', null);
    expect(resolved.captionStyle.preset).toBe(STYLE_PRESETS.punchy.captionPreset);
  });

  it('ignores an id that is not a real preset rather than rendering nothing', () => {
    const resolved = styleFor('punchy', 'not-a-preset');
    expect(resolved.captionStyle.preset).toBe(STYLE_PRESETS.punchy.captionPreset);
  });

  it('resolves every preset the picker can offer', () => {
    // The picker lists CAPTION_PRESETS; if one of them did not resolve, it
    // would be an option that silently does nothing.
    for (const preset of CAPTION_PRESETS) {
      expect(findCaptionPreset(preset.id)).toBeTruthy();
      expect(styleFor('clean', preset.id).captionStyle.preset).toBe(preset.id);
    }
  });

  it('offers the script-highlight preset for short form', () => {
    const spotlight = CAPTION_PRESETS.find((p) => p.id === 'spotlight');
    expect(spotlight).toBeTruthy();
    expect(['short', 'both']).toContain(spotlight!.bestFor);
  });
});
