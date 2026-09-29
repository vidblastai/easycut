'use client';

import React from 'react';
import { clsx } from 'clsx';
import { OVERLAY_COPY, OVERLAY_GROUPS } from '@/lib/edl/overlay-copy';
import type { BrollOverlay } from '@/lib/edl/types';

/**
 * One overlay, shown rather than named.
 *
 * ── Why a swatch and not a word ─────────────────────────────────────────
 *
 * Nobody can tell "prism" from "bloom" from the word, and the failure mode of
 * a list like this is picking something you have never seen and finding out
 * after a render. Eleven names in a row is not a choice; eleven pictures is.
 *
 * ── One copy, two pickers ───────────────────────────────────────────────
 *
 * The upload wizard and the timeline editor both ask this question, and they
 * used to answer it differently — grouped tiles up front, a flat row of chips
 * in the editor. Same twelve options, two different things to learn. This is
 * the shared piece, so a treatment added to the list appears in both places
 * with the same picture and no further work.
 *
 * ── What the tile actually is ───────────────────────────────────────────
 *
 * A CSS approximation of the renderer, not the renderer. `ov-shot` is a
 * painted stand-in for a photograph — a sky, a ground and a dark shape —
 * rather than an image file, so the picker ships no assets and cannot show a
 * broken thumbnail. It only has to be something with a light half and a dark
 * half, which is all any of these need to read against. The real overlays are
 * drawn per frame in Remotion and several of them only exist in motion; the
 * tile is right about the one thing a choice needs, which is how loud it is
 * and what it does to the colour.
 */
export function OverlaySwatch({ type, className }: { type: BrollOverlay; className?: string }) {
  return (
    <span className={clsx('ov-plate', className)}>
      <span className="ov-shot" />
      <span className={clsx('ov-fx', `ov-${type}`)} />
    </span>
  );
}

/**
 * The grid, grouped by how visible each treatment is.
 *
 * Grouped rather than alphabetical because that is the only distinction that
 * helps somebody choose: the subtle ones make a video look better without
 * anybody noticing a filter was applied, and the strong ones are seen. Both
 * groups are things a person would pick on purpose.
 */
export function OverlayGrid({
  value,
  onPick,
  columns = 'sm:grid-cols-4',
  compact = false,
}: {
  value: BrollOverlay | null;
  /** Null when the chosen tile is clicked again — "back to the default". */
  onPick: (overlay: BrollOverlay | null) => void;
  columns?: string;
  /** The editor's panel is narrow; the wizard's column is not. */
  compact?: boolean;
}) {
  return (
    <>
      <style>{TILE_CSS}</style>
      {OVERLAY_GROUPS.map((group) => (
        <React.Fragment key={group.label}>
          <p className={clsx('text-[11px] font-bold uppercase tracking-[0.12em] text-faint', compact ? 'mt-2.5' : 'mt-3.5')}>
            {group.label}{' '}
            <span className="font-normal normal-case tracking-normal">· {group.note}</span>
          </p>
          <ul className={clsx('mt-2 grid gap-2', compact ? 'grid-cols-3' : 'grid-cols-3', columns)}>
            {group.types.map((type) => {
              const on = value === type;
              return (
                <li key={type}>
                  <button
                    type="button"
                    onClick={() => onPick(on ? null : type)}
                    aria-pressed={on}
                    title={OVERLAY_COPY[type].note}
                    className={clsx(
                      'w-full overflow-hidden rounded-lg border text-left transition-colors',
                      on ? 'border-violet ring-1 ring-violet/60' : 'border-line hover:border-line2',
                    )}
                  >
                    <OverlaySwatch type={type} />
                    <span
                      className={clsx(
                        'block truncate px-2 py-1 font-bold',
                        compact ? 'text-[10.5px]' : 'text-[11.5px]',
                      )}
                    >
                      {OVERLAY_COPY[type].label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </React.Fragment>
      ))}
    </>
  );
}

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
  linear-gradient(90deg,rgba(255,0,110,.3),transparent 38%),
  linear-gradient(270deg,rgba(0,200,255,.3),transparent 38%),
  repeating-linear-gradient(180deg,rgba(0,0,0,.55) 0 1.5px,transparent 1.5px 3px)}
/* The head-switching hash along the bottom, which is the single most
   recognisable thing about the format and the one everybody forgets. */
.ov-vhs::after{content:'';position:absolute;left:0;right:0;bottom:0;height:5%;
  background:repeating-linear-gradient(90deg,rgba(255,255,255,.7) 0 2px,rgba(0,0,0,.8) 2px 4px)}

.ov-bloom{backdrop-filter:blur(2.5px) brightness(1.3);opacity:.5}

.ov-crt{background:
  repeating-linear-gradient(90deg,rgba(255,60,60,.25) 0 1px,rgba(60,255,120,.25) 1px 2px,rgba(80,120,255,.25) 2px 3px),
  repeating-linear-gradient(180deg,rgba(0,0,0,.55) 0 1.5px,transparent 1.5px 3px),
  radial-gradient(ellipse at center,rgba(0,0,0,0) 40%,rgba(0,0,0,.55) 100%)}
/* The tube is not rectangular: its corners are radiused and the picture stops
   short of them. One mask does more for this look than any amount of lines. */
.ov-crt::after{content:'';position:absolute;inset:0;border-radius:14px;box-shadow:0 0 0 18px #000}

.ov-super8{background:
  linear-gradient(150deg,rgba(255,183,77,.55) 0%,rgba(255,138,61,.5) 45%,rgba(185,104,63,.55) 100%),
  radial-gradient(ellipse at center,transparent 28%,rgba(48,22,8,.78) 100%)}

@media (prefers-reduced-motion:reduce){.ov-fx{animation:none!important}}
`;
