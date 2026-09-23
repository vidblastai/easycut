import { describe, expect, it } from 'vitest';
import { formatForShape } from '@/lib/styles/detect';
import { FORMAT_PRESETS } from '@/lib/styles/presets';

/**
 * The format is settled from the file, not from the request.
 *
 * `stageIngest` sets `ctx.mode` from ffprobe's dimensions and every stage after
 * it reads that, so the `mode` on a create request is only ever a provisional
 * claim. These tests pin the rule that decision uses — including the case that
 * actually bites, which is phone footage.
 */
describe('the shape rule the pipeline settles on', () => {
  it('calls portrait and square footage short form', () => {
    expect(formatForShape(1080, 1920)).toBe('short');
    expect(formatForShape(1080, 1080)).toBe('short');
  });

  it('calls landscape footage long form at any length', () => {
    expect(formatForShape(1920, 1080)).toBe('long');
    expect(formatForShape(3840, 2160)).toBe('long');
  });

  it('takes DISPLAYED dimensions, which is what probe() hands it', () => {
    /*
     * The bug this guards. A phone films vertical and stores the frame
     * 1920×1080 with a 90° rotation tag; `probe()` transposes for that before
     * returning, so the pipeline sees 1080×1920 and calls it a short. Feeding
     * the raw stream dimensions instead would send every rotated phone video
     * down the widescreen pipeline and crop the person out of their own video.
     */
    const stored = { width: 1920, height: 1080 };
    const displayed = { width: stored.height, height: stored.width }; // rotation 90
    expect(formatForShape(displayed.width, displayed.height)).toBe('short');
    expect(formatForShape(stored.width, stored.height)).toBe('long');
  });

  it('never yields a format whose aspect flips the footage', () => {
    for (const [w, h] of [[1080, 1920], [1080, 1080], [1920, 1080], [720, 1280], [4096, 2160]]) {
      const { aspect } = FORMAT_PRESETS[formatForShape(w, h)];
      const [aw, ah] = aspect.split(':').map(Number);
      // Landscape in, landscape out. Anything else is a crop nobody asked for.
      expect(aw > ah).toBe(w > h);
    }
  });

  it('is total — every shape lands somewhere', () => {
    for (const [w, h] of [[0, 0], [1, 10000], [10000, 1], [1, 1]]) {
      expect(['short', 'long']).toContain(formatForShape(w, h));
    }
  });
});
