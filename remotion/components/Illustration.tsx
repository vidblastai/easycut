import React from 'react';
import { useCurrentFrame } from 'remotion';
import { kf, easeOutSoftBack, easeOutCubic, stagger } from '../lib/motion';

/**
 * The drawing, arriving in pieces.
 *
 * The model returns its illustration as top-level groups — the desk, then the
 * laptop, then the chart on its screen — and this brings them in one at a time
 * rather than fading the whole picture up. That is the entire reason the art
 * is asked for in parts: a flat drawing that appears is a slide, and a drawing
 * that assembles is a motion graphic, and the difference is about six frames
 * of stagger.
 *
 * Two constraints shape how it is done:
 *
 *   **The markup is inlined, not loaded.** `dangerouslySetInnerHTML` per part,
 *   on markup already stripped of script, filters, images and event handlers
 *   in `assets/illustration.ts`. Remotion's `<Img>` cannot decode an SVG in
 *   headless Chromium, and an illustration that renders in the editor and not
 *   in the export is the worst possible failure for this layer.
 *
 *   **Each part is transformed, never filtered.** The wrapper `<g>` gets an
 *   opacity and a transform and nothing else. A drop-shadow on a moving group
 *   is a per-frame re-rasterise of the whole drawing, which is the mistake
 *   this renderer has already paid ten frames a second for once.
 */

export interface Art {
  viewBox: string;
  parts: string[];
}

/** Frames between one piece landing and the next starting. */
const PART_STAGGER = 5;

export const Illustration: React.FC<{
  art: Art;
  /** Frame the first part arrives on, relative to the scene. */
  at: number;
  /** Rendered width and height, in pixels. */
  size: number;
}> = ({ art, at, size }) => {
  const frame = useCurrentFrame();

  /*
   * The drawing's own centre, read off the viewBox.
   *
   * Parts are scaled about it so a piece grows into place rather than growing
   * out of the drawing's top-left corner, which is what an unqualified
   * `scale()` on an SVG group does and which looks like a bug every time.
   */
  const [minX, minY, width, height] = parseViewBox(art.viewBox);
  const cx = minX + width / 2;
  const cy = minY + height / 2;

  return (
    <svg
      viewBox={art.viewBox}
      width={size}
      height={size}
      style={{ overflow: 'visible', display: 'block' }}
    >
      {art.parts.map((part, i) => {
        const startsAt = at + stagger(i, PART_STAGGER);
        const scale = kf(frame, [[startsAt, 0.82], [startsAt + 11, 1]], easeOutSoftBack);
        const opacity = kf(frame, [[startsAt, 0], [startsAt + 6, 1]], easeOutCubic);
        const rise = kf(frame, [[startsAt, height * 0.03], [startsAt + 11, 0]]);

        return (
          <g
            key={i}
            opacity={opacity}
            transform={`translate(${cx} ${cy + rise}) scale(${scale.toFixed(4)}) translate(${-cx} ${-cy})`}
            dangerouslySetInnerHTML={{ __html: part }}
          />
        );
      })}
    </svg>
  );
};

/** When it has done assembling, so the caller knows where its own beats start. */
export function artSettlesAt(art: Art, at: number): number {
  return at + stagger(Math.max(0, art.parts.length - 1), PART_STAGGER) + 11;
}

function parseViewBox(viewBox: string): [number, number, number, number] {
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  // A malformed viewBox would otherwise put NaN into every transform below and
  // the whole drawing would silently vanish.
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return [0, 0, 1000, 1000];
  return parts as [number, number, number, number];
}
