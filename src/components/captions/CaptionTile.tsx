'use client';

import React, { useState } from 'react';
import type { CAPTION_PRESETS } from '@/lib/captions/presets';
import { CaptionBand } from './CaptionPreview';

/**
 * A tile is a picture, not a caption.
 *
 * It used to be the real thing: the same component the editor draws with,
 * laid out at the video's full pixel size and scaled down — twenty of them,
 * each a block of gradient-filled text under a chain of drop-shadows. Every
 * hover and every click repainted the lot, which on a laptop is enough to
 * stutter the whole machine, for a grid whose only job is to let somebody
 * point at a look they like.
 *
 * So the pictures are rendered once, by the real renderer, and committed —
 * see scripts/caption-thumbs.ts. They are exactly what the export produces,
 * they cost the browser nothing, and the picker now behaves the same on every
 * machine instead of depending on the one it is opened on.
 *
 * If a tile is ever missing, the live version takes over for that one tile —
 * a preset added without re-running the script still shows what it does.
 */
export function CaptionTile({
  preset,
  style,
  frame,
  mode,
}: {
  preset: string;
  style: (typeof CAPTION_PRESETS)[number]['style'];
  frame: { w: number; h: number };
  mode: 'short' | 'long';
}) {
  const [missing, setMissing] = useState(false);

  if (missing) {
    return (
      <CaptionBand
        style={style}
        text="Captions that look good"
        frameWidth={frame.w}
        frameHeight={frame.h}
        aspect="4 / 3"
        emphasisWord="last"
        className="w-full bg-ink"
      />
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={`/captions/${preset}-${mode}.png`}
      alt=""
      width={640}
      height={480}
      loading="lazy"
      decoding="async"
      onError={() => setMissing(true)}
      className="w-full bg-ink"
      style={{ aspectRatio: '4 / 3' }}
    />
  );
}
