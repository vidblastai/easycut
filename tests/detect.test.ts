import { describe, expect, it } from 'vitest';
import { detectFormat } from '@/lib/styles/detect';
import { FORMAT_PRESETS } from '@/lib/styles/presets';

/**
 * The two pipelines, and the one thing that chooses between them.
 *
 * EasyCut does not repurpose. Vertical footage is edited vertical for Reels
 * and Shorts; widescreen footage is edited widescreen for YouTube. The shape
 * of the picture is the whole rule, and these tests exist mostly to stop a
 * length heuristic creeping back in — the old one turned a two-minute
 * widescreen clip into a cropped vertical short, which is somebody's footage
 * reframed into a format they never asked for.
 */
describe('choosing the pipeline from the footage', () => {
  it('sends vertical footage down the short-form pipeline, however long it runs', () => {
    expect(detectFormat({ width: 1080, height: 1920, durationSec: 20 }).mode).toBe('short');
    expect(detectFormat({ width: 1080, height: 1920, durationSec: 3600 }).mode).toBe('short');
  });

  it('sends square footage down the short-form pipeline', () => {
    expect(detectFormat({ width: 1080, height: 1080, durationSec: 600 }).mode).toBe('short');
  });

  it('keeps a brief widescreen clip widescreen instead of cropping it vertical', () => {
    // The regression this file exists for. 47 seconds of landscape used to come
    // back as a 9:16 short with most of the picture thrown away.
    for (const durationSec of [8, 47, 120, 179]) {
      expect(detectFormat({ width: 1920, height: 1080, durationSec }).mode).toBe('long');
    }
  });

  it('sends a long widescreen recording down the long-form pipeline', () => {
    expect(detectFormat({ width: 1920, height: 1080, durationSec: 1800 }).mode).toBe('long');
    expect(detectFormat({ width: 3840, height: 2160, durationSec: 1800 }).mode).toBe('long');
  });

  it('never changes the shape of the picture', () => {
    // The point of the rule: whatever went in, the format it lands in has the
    // same orientation, so nothing is reframed unless somebody asks for it.
    const cases = [
      { width: 1080, height: 1920, durationSec: 40 },
      { width: 1080, height: 1080, durationSec: 40 },
      { width: 1920, height: 1080, durationSec: 40 },
      { width: 1920, height: 1080, durationSec: 4000 },
    ];
    for (const probe of cases) {
      const { aspect } = FORMAT_PRESETS[detectFormat(probe).mode];
      const [w, h] = aspect.split(':').map(Number);
      const sourceIsLandscape = probe.width > probe.height;
      expect(w > h).toBe(sourceIsLandscape);
    }
  });

  it('says why, in words somebody would use', () => {
    expect(detectFormat({ width: 1080, height: 1920, durationSec: 30 }).reason).toMatch(/vertical/);
    expect(detectFormat({ width: 1080, height: 1080, durationSec: 30 }).reason).toMatch(/square/);
    expect(detectFormat({ width: 1920, height: 1080, durationSec: 620 }).reason).toMatch(/10:20/);
  });

  it('promises the shape will not change, in the line it shows', () => {
    expect(detectFormat({ width: 1080, height: 1920, durationSec: 30 }).reason).toMatch(/stays vertical/);
    expect(detectFormat({ width: 1920, height: 1080, durationSec: 620 }).reason).toMatch(/stays widescreen/);
  });

  it('admits when it is guessing', () => {
    expect(detectFormat(null).confident).toBe(false);
    expect(detectFormat({ width: 0, height: 0, durationSec: 0 }).confident).toBe(false);
    expect(detectFormat({ width: 1080, height: 1920, durationSec: 12 }).confident).toBe(true);
    // A widescreen file with an unreadable duration is still confidently
    // widescreen: the length was never what decided it.
    expect(detectFormat({ width: 1920, height: 1080, durationSec: 0 }).confident).toBe(true);
  });

  it('never leaves the format unset', () => {
    for (const probe of [null, { width: 1, height: 1, durationSec: 0 }, { width: 4000, height: 10, durationSec: 1e6 }]) {
      expect(['short', 'long']).toContain(detectFormat(probe).mode);
    }
  });
});
