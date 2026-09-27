'use client';

import React from 'react';
import { clsx } from 'clsx';
import { LOOK_LIST, type LookMeta } from '@/lib/scenes/looks';
import { STYLE_GUIDES } from '@/lib/scenes/style-guides';

/**
 * Choosing the world the animated scenes are drawn in, before they are drawn.
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 *
 * It was decided for you, by the edit style: pick Clean and your inserts came
 * out on a white plinth whether or not that was the video you were making. The
 * only way to see the dark one was to render, not like it, and guess which
 * edit style happened to carry it — a look chosen as a side effect of an
 * unrelated decision.
 *
 * That is the wrong shape for the layer that takes the whole frame. So it sits
 * here, next to the captions, under the toggle that switches the scenes on:
 * tick "animated scenes" and the question "which world" is right there.
 *
 * ── Light or dark, first ────────────────────────────────────────────────
 *
 * The tone leads, because it is the thing anybody actually asks first, and
 * five proper nouns do not answer it. Each tile then shows the real ground,
 * the real palette and the real accent out of the style guide the drawing
 * model is briefed with — so what you pick is what gets described to it,
 * rather than a swatch somebody chose to represent it.
 */
export function ScenePicker({
  value,
  onChange,
  className,
}: {
  /** The chosen look, or null for "whatever the edit style picks". */
  value: string | null;
  onChange: (look: string | null) => void;
  className?: string;
}) {
  const dark = LOOK_LIST.filter((look) => look.tone === 'dark');
  const light = LOOK_LIST.filter((look) => look.tone === 'light');

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-bold">How the animated scenes look</h3>
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

      <Group label="Dark" looks={dark} value={value} onChange={onChange} />
      <Group label="Light" looks={light} value={value} onChange={onChange} />
    </div>
  );
}

function Group({
  label,
  looks,
  value,
  onChange,
}: {
  label: string;
  looks: LookMeta[];
  value: string | null;
  onChange: (look: string | null) => void;
}) {
  if (!looks.length) return null;
  return (
    <>
      <p className="mt-3.5 text-[11px] font-bold uppercase tracking-[0.12em] text-faint">{label}</p>
      <ul className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {looks.map((look) => {
          const on = value === look.id;
          return (
            <li key={look.id}>
              <button
                type="button"
                onClick={() => onChange(on ? null : look.id)}
                aria-pressed={on}
                className={clsx(
                  'w-full overflow-hidden rounded-xl border text-left transition-colors',
                  on ? 'border-violet ring-1 ring-violet/60' : 'border-line hover:border-line2',
                )}
              >
                <LookPlate look={look.id} />
                <span className="block px-3 py-2.5">
                  <span className="block text-[13px] font-bold">{look.name}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">{look.bestFor}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * A beat, in miniature.
 *
 * Painted from the style guide rather than from a screenshot, so it cannot go
 * stale when a guide is edited — and so it shows the three things that
 * actually distinguish these worlds from each other: the ground, the two-tone
 * modelling of an object on it, and where the one accent lands.
 */
function LookPlate({ look }: { look: string }) {
  const guide = STYLE_GUIDES[look as keyof typeof STYLE_GUIDES];
  const hex = (at: number, fallback: string) => guide.palette[at]?.hex ?? fallback;

  const ink = hex(0, '#0D0D10');
  const shadowed = hex(1, '#3A3A46');
  const surface = hex(3, '#E8E8EE');

  return (
    <svg viewBox="0 0 160 110" className="block w-full" role="presentation">
      <rect width="160" height="110" fill={guide.ground} />

      {/* The full-bleed backdrop every drawing is told to carry, so nothing floats. */}
      <rect x="0" y="62" width="160" height="48" fill={shadowed} opacity="0.28" />
      <circle cx="120" cy="30" r="34" fill={surface} opacity="0.18" />

      {/* One object, modelled with a lit face and a shadowed one. */}
      <ellipse cx="66" cy="80" rx="30" ry="6" fill={ink} opacity="0.22" />
      <rect x="44" y="40" width="44" height="40" rx="10" fill={surface} />
      <rect x="44" y="40" width="16" height="40" rx="10" fill={shadowed} opacity="0.75" />

      {/* And the accent, on one element only — which is the rule in every guide. */}
      <circle cx="112" cy="58" r="11" fill={guide.accent} />
      <rect x="100" y="24" width="34" height="5" rx="2.5" fill={ink} opacity="0.35" />
    </svg>
  );
}
