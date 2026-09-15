'use client';

import { useEffect, useState } from 'react';
import type { CaptionStyle } from '@/lib/edl/types';
import { CAPTION_PRESETS, findCaptionPreset } from '@/lib/captions/presets';
import { CaptionStudio } from './CaptionStudio';
import { readDefaultCaptionPreset, writeDefaultCaptionPreset } from '@/lib/captions/default-preset';

/**
 * Browsing the caption looks, and setting the one new uploads start from.
 *
 * The default lives in the browser rather than the database because it is a
 * preference, not a fact about a video: it applies to uploads made from this
 * machine, it costs nothing to be wrong, and putting it on the User row would
 * mean the app needs accounts before it can remember anything. The value it
 * chooses is sent with the next upload and stored on that project, which is
 * where it does have to be durable.
 */
export function CaptionGallery() {
  const [style, setStyle] = useState<CaptionStyle>(CAPTION_PRESETS[0].style);
  const [mode, setMode] = useState<'short' | 'long'>('short');
  const [saved, setSaved] = useState(false);

  // Read on mount, not during render: localStorage is unavailable on the
  // server and can throw in a private window, and a hydration mismatch here
  // would flash the wrong look on every load.
  useEffect(() => {
    const preset = findCaptionPreset(readDefaultCaptionPreset() ?? '');
    if (preset) setStyle(preset.style);
  }, []);

  function saveDefault() {
    writeDefaultCaptionPreset(style.preset);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2400);
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl bg-charcoal p-1">
          {(['short', 'long'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={
                mode === m
                  ? 'rounded-lg bg-violet px-3 py-1.5 text-[12px] font-semibold text-ink'
                  : 'rounded-lg px-3 py-1.5 text-[12px] font-semibold text-muted transition-colors hover:text-chalk'
              }
            >
              {m === 'short' ? 'Short · 9:16' : 'Long · 16:9'}
            </button>
          ))}
        </div>

        <button type="button" onClick={saveDefault} className="btn-primary ml-auto">
          {saved ? 'Saved as your default' : 'Use this for new videos'}
        </button>
      </div>

      <CaptionStudio style={style} onChange={setStyle} mode={mode} />
    </div>
  );
}
