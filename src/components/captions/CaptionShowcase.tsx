'use client';

import { useEffect, useMemo, useState } from 'react';
import { CAPTION_PRESETS, findCaptionPreset } from '@/lib/captions/presets';
import { preloadCaptionFonts } from '@/lib/captions/web-fonts';
import { CaptionBand } from './CaptionPreview';

/**
 * The captions, on the marketing page, drawn by the renderer's own paint code.
 *
 * A landing page for a video editor that only describes what the captions look
 * like is asking people to take the most important thing on trust. These are
 * the real presets at their real scale — the same module the video renderer
 * uses — cycling so you can see that "sixteen looks" means sixteen different
 * things rather than sixteen colours of the same one.
 *
 * It starts on a visible frame rather than animating in from nothing, because
 * the first still of this page is what a shared link and a skimming reader both
 * get.
 */

const SHOWN = ['bold-pop', 'neon', 'highlight-box', 'editorial', 'impact', 'clean-plate'];
// Three words, because a real cue is three to five and the preview truncates
// to whatever this preset's own `maxWordsPerCue` is. A longer marketing line
// came out as "Captions that carry the" — a sentence cut off mid-thought,
// which reads as a bug rather than as an honest cue length.
const LINE = 'Watched on mute';
const HOLD_MS = 2600;

export function CaptionShowcase() {
  const presets = useMemo(
    () => SHOWN.map((id) => findCaptionPreset(id)).filter(Boolean).slice(0, 6) as typeof CAPTION_PRESETS,
    [],
  );
  const [at, setAt] = useState(0);

  useEffect(() => {
    preloadCaptionFonts(presets.map((p) => p.style.fontFamily));
  }, [presets]);

  useEffect(() => {
    // One timer, and it stops when the tab is hidden — a marketing page that
    // keeps a render loop alive in a background tab is a battery complaint.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || presets.length < 2) return;

    let timer = 0;
    const tick = () => {
      if (!document.hidden) setAt((n) => (n + 1) % presets.length);
      timer = window.setTimeout(tick, HOLD_MS);
    };
    timer = window.setTimeout(tick, HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [presets.length]);

  if (!presets.length) return null;
  const preset = presets[at];

  return (
    <div className="mx-auto w-full max-w-[560px]">
      <div className="overflow-hidden rounded-[18px] border border-line bg-[#101015]">
        <CaptionBand
          style={preset.style}
          text={LINE}
          frameWidth={1080}
          frameHeight={1920}
          aspect="16 / 7"
          backdrop={
            <span
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(120% 140% at 24% 10%, #4a4a63 0%, #26263a 44%, #121218 100%)',
              }}
              aria-hidden
            />
          }
        />
      </div>

      <div className="mt-3 flex items-center justify-center gap-1.5">
        {presets.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setAt(i)}
            aria-label={p.name}
            aria-current={i === at}
            className={
              i === at
                ? 'h-1.5 w-6 rounded-full bg-violet transition-all'
                : 'h-1.5 w-1.5 rounded-full bg-line transition-all hover:bg-muted'
            }
            style={{ transitionDuration: '0.32s' }}
          />
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-faint">
        {preset.name} &middot; one of sixteen, all editable
      </p>
    </div>
  );
}
