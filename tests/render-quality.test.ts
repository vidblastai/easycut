import { describe, expect, it } from 'vitest';
import {
  allowsQuality,
  bestQualityFor,
  DEFAULT_QUALITY,
  dimensionsFor,
  qualityLabel,
  qualityOfRender,
  QUALITY_SCALE,
  QUALITY_SHORT_SIDE,
  readQuality,
  RENDER_QUALITIES,
  scaleFor,
} from '@/lib/render/quality';
import { ASPECT_DIMENSIONS, ASPECTS } from '@/lib/edl/types';
import { PLANS } from '@/lib/billing/plans';

/**
 * 4K is opt-in, and every default in this file has to fall the cheap way.
 *
 * The expensive mistake is not refusing somebody who paid — they complain and
 * it gets fixed. It is silently rendering four times the pixels for a request
 * that never asked for them, on every video, for everybody.
 */
describe('choosing a render quality', () => {
  it('defaults to HD, and an absent or unknown value stays HD', () => {
    expect(DEFAULT_QUALITY).toBe('hd');
    expect(readQuality(undefined)).toBe('hd');
    expect(readQuality(null)).toBe('hd');
    expect(readQuality('')).toBe('hd');
    expect(readQuality('4K')).toBe('hd'); // case matters; only the exact token counts
    expect(readQuality('ultra')).toBe('hd');
    expect(readQuality(true)).toBe('hd');
    expect(readQuality('4k')).toBe('4k');
  });

  it('scales HD by one, so an HD render is byte-for-byte what it always was', () => {
    expect(scaleFor('hd')).toBe(1);
    expect(QUALITY_SCALE.hd).toBe(1);
  });

  it('doubles each side for 4K, which is four times the pixels', () => {
    expect(scaleFor('4k')).toBe(2);
    for (const aspect of ASPECTS) {
      const base = ASPECT_DIMENSIONS[aspect];
      const big = dimensionsFor(aspect, '4k');
      expect(big.width).toBe(base.width * 2);
      expect(big.height).toBe(base.height * 2);
      // h264 cannot encode an odd dimension. Doubling an even base keeps it
      // even, but the assertion is cheap and the failure mode is a dead render.
      expect(big.width % 2).toBe(0);
      expect(big.height % 2).toBe(0);
    }
  });

  it('puts widescreen 4K at 3840×2160 and a vertical short at 2160×3840', () => {
    expect(dimensionsFor('16:9', '4k')).toEqual({ width: 3840, height: 2160 });
    expect(dimensionsFor('9:16', '4k')).toEqual({ width: 2160, height: 3840 });
  });

  it('judges a vertical video on its short side, like the "p" in 1080p', () => {
    // The trap: a 1080p vertical short is 1080×1920. Comparing its HEIGHT
    // against a 1080 ceiling would refuse every vertical export on Starter.
    expect(qualityOfRender(1080, 1920)).toBe('hd');
    expect(qualityOfRender(1920, 1080)).toBe('hd');
    expect(qualityOfRender(2160, 3840)).toBe('4k');
    expect(qualityOfRender(3840, 2160)).toBe('4k');
  });

  it('lets a render row from before 4K existed describe itself correctly', () => {
    // Rows carry pixels, not a flag, so nothing needed backfilling.
    expect(qualityOfRender(1080, 1350)).toBe('hd'); // 4:5
    expect(qualityOfRender(1080, 1080)).toBe('hd'); // 1:1
  });

  it('admits 4K only on plans whose ceiling reaches it', () => {
    expect(allowsQuality(PLANS.free.maxRenderHeight, '4k')).toBe(false);
    expect(allowsQuality(PLANS.starter.maxRenderHeight, '4k')).toBe(false);
    expect(allowsQuality(PLANS.creator.maxRenderHeight, '4k')).toBe(true);
    expect(allowsQuality(PLANS.studio.maxRenderHeight, '4k')).toBe(true);
  });

  it('admits HD on every plan, including free', () => {
    for (const plan of Object.values(PLANS)) {
      expect(allowsQuality(plan.maxRenderHeight, 'hd')).toBe(true);
    }
  });

  it('offers the best quality a plan has, for defaulting a control', () => {
    expect(bestQualityFor(PLANS.starter.maxRenderHeight)).toBe('hd');
    expect(bestQualityFor(PLANS.creator.maxRenderHeight)).toBe('4k');
  });

  it('labels each quality the way the pricing page does', () => {
    expect(qualityLabel('hd')).toBe('1080p');
    expect(qualityLabel('4k')).toBe('4K');
  });

  it('keeps the scale table and the short-side table in step', () => {
    for (const quality of RENDER_QUALITIES) {
      // Every aspect's short side, scaled, has to land on the advertised class.
      for (const aspect of ASPECTS) {
        const { width, height } = dimensionsFor(aspect, quality);
        expect(Math.min(width, height)).toBe(QUALITY_SHORT_SIDE[quality]);
      }
    }
  });
});

/**
 * The splice hazard.
 *
 * An incremental render copies frames out of the previous file and draws only
 * the stretch that changed. If the previous file is 1080 and the new chunk is
 * 4K, the result is a video that changes size halfway through — so
 * `planIncremental` compares the stored dimensions against the SCALED ones.
 * This reproduces that comparison rather than the whole worker.
 */
describe('incremental renders across a quality change', () => {
  const matches = (previous: { width: number; height: number }, base: { width: number; height: number }, scale: number) =>
    previous.width === base.width * scale && previous.height === base.height * scale;

  const base = ASPECT_DIMENSIONS['9:16']; // 1080×1920
  const hdRender = { width: 1080, height: 1920 };
  const fourKRender = { width: 2160, height: 3840 };

  it('refuses to splice an HD file when 4K was asked for', () => {
    expect(matches(hdRender, base, scaleFor('4k'))).toBe(false);
  });

  it('refuses to splice a 4K file when HD was asked for', () => {
    expect(matches(fourKRender, base, scaleFor('hd'))).toBe(false);
  });

  it('still splices when the quality has not changed', () => {
    // The cheap path has to survive where it is correct, or every 4K re-export
    // becomes a full render for no reason.
    expect(matches(hdRender, base, scaleFor('hd'))).toBe(true);
    expect(matches(fourKRender, base, scaleFor('4k'))).toBe(true);
  });
});
