'use client';

import { clsx } from 'clsx';
import { CAPTION_PRESETS } from '@/lib/captions/presets';
import { CaptionBand } from './CaptionPreview';

/**
 * Choosing the caption look BEFORE the edit is made.
 *
 * ── Why this is not "just move the picker" ──────────────────────────────
 *
 * It used to be chosen for you: the edit style named a caption look, and the
 * only way to get a different one was to let the video render, open the
 * editor, change it, and re-render. For the layer people look at most, on a
 * product whose whole claim is that captions ARE the video, that is the wrong
 * order — you were being shown a decision that had already been made.
 *
 * So it sits inside the captions toggle, on the step where you say what goes
 * in the video. Tick captions on and the question "which ones" is right there,
 * which is where somebody is already thinking about it.
 *
 * ── Drawn, not named ────────────────────────────────────────────────────
 *
 * Every tile is the real thing: the same `CaptionPreview` the editor uses,
 * reading the same style object the renderer executes. "Neon" and "Slab" carry
 * exactly the same amount of information until you have seen one, and a list
 * of sixteen words would be a worse version of the problem this replaces.
 */
export function CaptionPicker({
  value,
  onChange,
  mode,
  className,
}: {
  /** The chosen preset id, or null for "whatever the edit style picks". */
  value: string | null;
  onChange: (presetId: string | null) => void;
  mode: 'short' | 'long';
  className?: string;
}) {
  // A style is only offered where it works: a ticker built for a widescreen
  // lower third is not a short-form caption, and offering it there is offering
  // something that will look wrong.
  const shown = CAPTION_PRESETS.filter((p) => p.bestFor === 'both' || p.bestFor === mode);
  const frame = mode === 'short' ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 };

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-bold">Which captions</h3>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[12px] text-muted underline decoration-line underline-offset-4 hover:text-chalk"
          >
            Let the style choose
          </button>
        ) : (
          <span className="text-[12px] text-faint">The style&rsquo;s own pick, unless you say otherwise</span>
        )}
      </div>

      <ul className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((preset) => {
          const on = value === preset.id;
          return (
            <li key={preset.id}>
              <button
                type="button"
                onClick={() => onChange(on ? null : preset.id)}
                aria-pressed={on}
                title={preset.blurb}
                data-caption-preset={preset.id}
                className={clsx(
                  'flex w-full flex-col overflow-hidden rounded-xl border text-left transition-colors',
                  on ? 'border-violet bg-violet-dim' : 'border-line bg-charcoal hover:border-violet/50',
                )}
              >
                {/*
                  * A BAND, not the whole frame.
                  *
                  * Scaling a 9:16 frame into a short tile puts the caption
                  * wherever its `positionY` happens to land — presets that sit
                  * at 0.7 fell out of the bottom of the tile and presets at
                  * 0.5 sat centred, so a row of tiles was comparing vertical
                  * placement instead of type. `CaptionBand` centres each one
                  * in its own window, which makes the comparison the only
                  * thing that varies: the look.
                  *
                  * On a dark plate rather than on footage, for the same
                  * reason — a different still behind each tile would be
                  * comparing backgrounds.
                  */}
                <CaptionBand
                  style={preset.style}
                  text="Captions that look good"
                  frameWidth={frame.w}
                  frameHeight={frame.h}
                  aspect="4 / 3"
                  className="w-full bg-ink"
                />
                <span className="flex items-center justify-between gap-1 px-2.5 py-2">
                  <span className="truncate text-[12px] font-bold">{preset.name}</span>
                  {on ? <span aria-hidden className="text-[11px] text-violet">✓</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
