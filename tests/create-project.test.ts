import { describe, expect, it } from 'vitest';
import { CreateProjectSchema } from '@/app/api/projects/schema';
import { BROLL_SOURCES } from '@/lib/assets/ai-broll';
import { BROLL_OVERLAYS, CLIP_TRANSITIONS, SCENE_LOOKS } from '@/lib/edl/types';
import { CAPTION_PRESETS } from '@/lib/captions/presets';
import { STYLE_PRESETS } from '@/lib/styles/presets';

/**
 * Everything the picker can produce, the upload has to accept.
 *
 * This exists because it did not. The B-roll source list grew a fourth entry
 * — "Mixed", the one that chooses per insert — and the upload route's own
 * copy of that list stayed at three. Picking it failed with "Invalid
 * request", a message that named no field, on the last step of the wizard
 * after the file had already been chosen.
 *
 * The lesson is not "remember to update both". It is that a second copy of a
 * list is a bug with a delay on it, so each case below walks the REAL
 * catalogue rather than a list written out here.
 */

const base = {
  mode: 'short' as const,
  styleId: 'clean',
  inputMode: 'raw' as const,
  layers: {},
  filename: 'clip.mp4',
  contentType: 'video/mp4',
  sizeBytes: 1024,
};

const why = (input: unknown) => {
  const parsed = CreateProjectSchema.safeParse(input);
  return parsed.success ? null : JSON.stringify(parsed.error.flatten().fieldErrors);
};

describe('what the upload wizard can send', () => {
  it('accepts every B-roll source the picker offers', () => {
    for (const source of BROLL_SOURCES) {
      expect(why({ ...base, brollSource: source }), source).toBeNull();
    }
  });

  it('accepts every insert treatment', () => {
    for (const overlay of BROLL_OVERLAYS) {
      expect(why({ ...base, brollOverlay: overlay }), overlay).toBeNull();
    }
  });

  it('accepts the whole transition vocabulary at once', () => {
    expect(why({ ...base, clipTransitions: [...CLIP_TRANSITIONS] })).toBeNull();
  });

  it('accepts every style, scene look and caption preset', () => {
    for (const style of Object.values(STYLE_PRESETS)) {
      expect(why({ ...base, styleId: style.id }), style.id).toBeNull();
      expect(why({ ...base, captionPreset: style.captionPreset }), style.captionPreset).toBeNull();
    }
    for (const look of SCENE_LOOKS) expect(why({ ...base, sceneLook: look }), look).toBeNull();
    for (const preset of CAPTION_PRESETS) {
      expect(why({ ...base, captionPreset: preset.id }), preset.id).toBeNull();
    }
  });

  it('accepts a note as long as the box lets somebody type', () => {
    // The input caps at 200; the schema allowing less than the UI accepts is
    // the same class of bug as the source list.
    expect(why({ ...base, userNote: 'x'.repeat(200) })).toBeNull();
  });

  it('names the field when something really is wrong', () => {
    const parsed = CreateProjectSchema.safeParse({ ...base, mode: undefined });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(Object.keys(parsed.error.flatten().fieldErrors)).toContain('mode');
  });
});
