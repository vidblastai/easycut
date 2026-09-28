import { describe, expect, it } from 'vitest';
import {
  CAPTION_BAND,
  CAPTION_PLACEMENT_BOUNDS,
  framedPositionX,
  framedPositionY,
  framedWidthRatio,
  CaptionStyleSchema,
} from '@/lib/edl/types';
import { CAPTION_PRESETS } from '@/lib/captions/presets';

/**
 * Dragging the words around on the picture.
 *
 * The thing worth pinning here is the distinction, because it is the whole
 * design and it is easy to collapse back into one number: the caption BAND
 * stops twenty presets drifting away from each other, and a PLACEMENT is a
 * person saying where they want the words on this video. A band that also
 * overrules the second makes a drag look broken; a placement that also governs
 * the first lets the presets drift again.
 */
describe('caption placement', () => {
  const base = CaptionStyleSchema.parse({});
  const placed = (x: number, y: number) => ({ ...base, placement: { x, y } });

  it('leaves every untouched style exactly where the band puts it', () => {
    // No placement means nothing changed, on any preset — this feature must be
    // invisible until somebody uses it.
    for (const preset of CAPTION_PRESETS) {
      expect(preset.style.placement).toBeNull();
      expect(framedPositionX(preset.style)).toBeNull();
      const framed = framedPositionY(preset.style);
      expect(framed).toBeGreaterThanOrEqual(CAPTION_BAND[0]);
      expect(framed).toBeLessThanOrEqual(CAPTION_BAND[1]);
    }
  });

  it('lets a drag out of the band, which is the point of it', () => {
    // 0.28 is nowhere near the band. Clamping it back would mean the only
    // vertical positions the product offers are the six per cent the presets
    // are being held inside, which is what this exists to fix.
    expect(framedPositionY(placed(0.5, 0.28))).toBe(0.28);
    expect(framedPositionY(placed(0.5, 0.9))).toBe(0.9);
  });

  it('will not let the words be dragged off the frame', () => {
    const [lowX, highX] = CAPTION_PLACEMENT_BOUNDS.x;
    const [lowY, highY] = CAPTION_PLACEMENT_BOUNDS.y;
    expect(framedPositionY(placed(0.5, -3))).toBe(lowY);
    expect(framedPositionY(placed(0.5, 9))).toBe(highY);
    expect(framedPositionX(placed(-3, 0.5))).toBe(lowX);
    expect(framedPositionX(placed(9, 0.5))).toBe(highX);
  });

  it('narrows the column near an edge so it still fits', () => {
    /*
     * The anchor is the CENTRE of the text column, so a block placed at 0.12
     * with the default 0.86 width has half of a very wide column to the left
     * of a point that is already near the left edge — most of it off frame.
     * Twice the distance to the nearer edge is the widest it can be.
     */
    // 2 x (0.12 - the 0.035 gutter). A line that exactly fits reads as a line
    // that was cut off: the descenders and the shadow touch the frame edge.
    expect(framedWidthRatio({ ...base, placement: { x: 0.12, y: 0.5 } })).toBeCloseTo(0.17, 5);
    expect(framedWidthRatio({ ...base, placement: { x: 0.88, y: 0.5 } })).toBeCloseTo(0.17, 5);
    // And never WIDER than the look asked for, however central it is.
    expect(framedWidthRatio({ ...base, placement: { x: 0.5, y: 0.5 } })).toBe(base.widthRatio);
    expect(framedWidthRatio(base)).toBe(base.widthRatio);
  });

  it('survives a round trip through the document schema', () => {
    // It is stored on the caption style, which means it rides every rebuild,
    // every export and every re-open. A field the schema drops is a drag that
    // works until you reload the page.
    const parsed = CaptionStyleSchema.parse({ placement: { x: 0.3, y: 0.42 } });
    expect(parsed.placement).toEqual({ x: 0.3, y: 0.42 });
    expect(CaptionStyleSchema.parse({}).placement).toBeNull();
  });
});
