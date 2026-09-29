'use client';

import React from 'react';
import { clsx } from 'clsx';
import { OVERLAY_COPY, OVERLAY_GROUPS } from '@/lib/edl/overlay-copy';
import type { BrollOverlay } from '@/lib/edl/types';

/**
 * What every insert in this video wears.
 *
 * ── Grouped by how loud it is, not alphabetically ───────────────────────
 *
 * Because that is the only distinction that helps somebody choose. The subtle
 * ones make a video look better without anybody noticing a filter was applied;
 * the loud ones are a statement and the viewer is meant to see them. Twelve
 * names in one row makes those two decisions look like one.
 *
 * ── Each tile shows its own treatment ───────────────────────────────────
 *
 * Over the same photograph, so the row is a comparison rather than twelve
 * separate demos. Nobody can tell "prism" from "halftone" from the word, and
 * the failure mode of a list like this is picking something you have never
 * seen and finding out after a render.
 *
 * The tiles are CSS approximations of the renderer, not the renderer — the
 * real ones are drawn per frame in Remotion and several of them only exist in
 * motion. They are right about the one thing a choice needs: how loud it is
 * and what colour it makes the picture.
 */
export function OverlayPicker({
  value,
  onChange,
  styleDefault,
  className,
}: {
  /** The chosen treatment, or null for "whatever this edit style does". */
  value: BrollOverlay | null;
  onChange: (overlay: BrollOverlay | null) => void;
  /** What the style would pick, shown on the tile so "let the style choose" means something. */
  styleDefault: BrollOverlay;
  className?: string;
}) {
  return (
    <div className={className}>
      <style>{TILE_CSS}</style>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-bold">What the inserts wear</h3>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[12px] text-muted underline decoration-line underline-offset-4 hover:text-chalk"
          >
            Let the style choose
          </button>
        ) : (
          <span className="text-[12px] text-faint">
            The style&rsquo;s own pick &mdash; {OVERLAY_COPY[styleDefault].label.toLowerCase()}
          </span>
        )}
      </div>

      {OVERLAY_GROUPS.map((group) => (
        <React.Fragment key={group.label}>
          <p className="mt-3.5 text-[11px] font-bold uppercase tracking-[0.12em] text-faint">
            {group.label} <span className="font-normal normal-case tracking-normal">· {group.note}</span>
          </p>
          <ul className="mt-2 grid grid-cols-3 gap-2.5 sm:grid-cols-4">
            {group.types.map((type) => {
              const on = value === type;
              return (
                <li key={type}>
                  <button
                    type="button"
                    onClick={() => onChange(on ? null : type)}
                    aria-pressed={on}
                    title={OVERLAY_COPY[type].note}
                    className={clsx(
                      'w-full overflow-hidden rounded-xl border text-left transition-colors',
                      on ? 'border-violet ring-1 ring-violet/60' : 'border-line hover:border-line2',
                    )}
                  >
                    <span className="ov-plate">
                      <span className="ov-shot" />
                      <span className={clsx('ov-fx', `ov-${type}`)} />
                    </span>
                    <span className="block px-2.5 py-1.5 text-[11.5px] font-bold">
                      {OVERLAY_COPY[type].label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </React.Fragment>
      ))}
    </div>
  );
}

/**
 * The tiles.
 *
 * `ov-shot` is a painted stand-in for a photograph — a sky, a ground and a
 * dark shape — rather than an image file, so the picker ships no assets and
 * cannot show a broken thumbnail. It only has to be something with a light
 * half and a dark half, which is all any of these need to read against.
 */
const TILE_CSS = `
.ov-plate{position:relative;display:block;width:100%;aspect-ratio:4/3;overflow:hidden;background:#0D0D10}
.ov-shot{position:absolute;inset:0;background:
  radial-gradient(circle at 30% 78%, #2A2A36 0 22%, transparent 23%),
  linear-gradient(180deg,#9FC7E8 0%,#D7E6F2 42%,#8C9A74 43%,#5C6B4A 100%)}
.ov-fx{position:absolute;inset:0;pointer-events:none}

.ov-none{display:none}

.ov-dust{background-image:
  radial-gradient(circle,rgba(255,255,255,.9) 1px,transparent 1.6px),
  radial-gradient(circle,rgba(255,255,255,.55) 1.5px,transparent 2.2px);
  background-size:27px 31px,43px 37px;background-position:4px 6px,19px 21px}

.ov-grain{opacity:.55;background-image:
  radial-gradient(circle,rgba(255,255,255,.85) .4px,transparent .7px),
  radial-gradient(circle,rgba(0,0,0,.7) .4px,transparent .7px);
  background-size:2.6px 2.6px,3.1px 3.1px;background-position:0 0,1px 1.4px;
  mix-blend-mode:overlay}

.ov-light-leak{background:radial-gradient(ellipse 55% 130% at 18% 44%,
  rgba(255,214,158,.9) 0%,rgba(255,158,74,.45) 38%,transparent 74%);mix-blend-mode:screen}

.ov-scanlines{background:repeating-linear-gradient(180deg,rgba(0,0,0,.55) 0 1.5px,transparent 1.5px 3px),
  linear-gradient(180deg,rgba(90,255,210,.22),rgba(80,190,255,.16))}

.ov-prism{background:
  radial-gradient(ellipse at 53% center,transparent 72%,rgba(255,40,90,.7) 92%,rgba(255,40,90,.9) 100%),
  radial-gradient(ellipse at 47% center,transparent 74%,rgba(40,150,255,.7) 93%,rgba(40,150,255,.9) 100%),
  radial-gradient(ellipse at center,transparent 44%,rgba(0,0,0,.6) 100%)}

.ov-vignette{background:radial-gradient(ellipse at center,transparent 38%,rgba(0,0,0,.62) 100%)}

.ov-bokeh{background:
  radial-gradient(circle at 22% 30%,hsla(190,95%,72%,.85) 0 9%,transparent 11%),
  radial-gradient(circle at 63% 22%,hsla(320,95%,74%,.8) 0 12%,transparent 14%),
  radial-gradient(circle at 80% 62%,hsla(90,90%,70%,.75) 0 10%,transparent 12%),
  radial-gradient(circle at 38% 74%,hsla(45,95%,72%,.7) 0 8%,transparent 10%);
  filter:blur(3px);mix-blend-mode:screen}

.ov-vhs{background:
  linear-gradient(90deg,rgba(255,0,110,.35),transparent 40%),
  linear-gradient(270deg,rgba(0,200,255,.35),transparent 40%),
  repeating-linear-gradient(180deg,rgba(0,0,0,.6) 0 1.5px,transparent 1.5px 3px)}
.ov-vhs::after{content:'';position:absolute;left:-6%;right:-6%;top:34%;height:5%;
  background:rgba(255,255,255,.6);transform:translateX(7%)}

.ov-datamosh{background:
  linear-gradient(90deg,transparent 0 12%,rgba(120,255,160,.95) 12% 88%,transparent 88%) 0 22%/100% 9% no-repeat,
  linear-gradient(90deg,transparent 0 30%,rgba(255,90,210,.95) 30% 100%) 0 48%/100% 6% no-repeat,
  linear-gradient(90deg,rgba(255,255,255,.95) 0 62%,transparent 62%) 0 70%/100% 11% no-repeat}

.ov-duotone{background:linear-gradient(155deg,#0B0A1E 0%,#9B7BFF 58%,#FFE9C2 100%);mix-blend-mode:color}

.ov-halftone{background-image:radial-gradient(circle at center,rgba(0,0,0,.92) .9px,transparent 1.6px);
  background-size:3.2px 3.2px;mix-blend-mode:multiply}

@media (prefers-reduced-motion:reduce){.ov-fx{animation:none!important}}
`;
