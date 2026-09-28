'use client';

import React from 'react';
import { clsx } from 'clsx';
import { TRANSITION_COPY, TRANSITION_GROUPS } from '@/lib/edl/transition-copy';
import type { ClipTransition } from '@/lib/edl/types';

/**
 * Choosing how the full-frame inserts arrive and leave, before anything is cut.
 *
 * ── Why it is a list and not one choice ─────────────────────────────────
 *
 * The builder cycles a vocabulary: insert one slides in, insert two zooms,
 * insert three whips, and then it comes round again. That is deliberate —
 * every insert making the same move is what makes a video read as a slideshow
 * — so the thing being chosen here is genuinely a SET, not a single value, and
 * a radio list would misrepresent what happens next.
 *
 * ── The order is part of the answer ─────────────────────────────────────
 *
 * Pick slide-left then slide-right and the inserts alternate. Pick them the
 * other way round and the first one goes the other way. So selections append
 * in click order and the tiles carry their position, rather than sorting into
 * the canonical list and quietly discarding a decision.
 *
 * ── Every tile moves ────────────────────────────────────────────────────
 *
 * Twelve words is not a picker. Nobody can tell `whip` from `slide-left`, or
 * `film-burn` from `light-leak`, from the name — and the whole failure mode of
 * this feature is somebody choosing a transition they have never seen and
 * finding out after a render. So each tile plays its own transition on a loop,
 * in CSS, on two flat plates: the dark one is the speaker, the violet one is
 * the insert. It is an approximation of the renderer, not a copy of it, and it
 * is right about the only three things a decision needs — which direction, how
 * fast, and whether anything is painted over it.
 */
export function TransitionPicker({
  value,
  onChange,
  className,
}: {
  /** The chosen vocabulary, in cycling order. Empty means "the style's own". */
  value: ClipTransition[];
  onChange: (next: ClipTransition[]) => void;
  className?: string;
}) {
  const toggle = (type: ClipTransition) =>
    onChange(value.includes(type) ? value.filter((t) => t !== type) : [...value, type]);

  return (
    <div className={className}>
      <style>{TILE_CSS}</style>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-bold">How the inserts come and go</h3>
        {value.length ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[12px] text-muted underline decoration-line underline-offset-4 hover:text-chalk"
          >
            Let the style choose
          </button>
        ) : (
          <span className="text-[12px] text-faint">The style&rsquo;s own set, unless you say otherwise</span>
        )}
      </div>

      <p className="mt-1 text-[12px] leading-snug text-muted">
        {value.length
          ? `Your ${value.length === 1 ? 'one' : value.length} cycle${value.length === 1 ? 's' : ''} through the video in the order you picked them.`
          : 'Pick as many as you like — they cycle through the video, so consecutive inserts differ.'}
      </p>

      {TRANSITION_GROUPS.map((group) => (
        <React.Fragment key={group.label}>
          <p className="mt-3.5 text-[11px] font-bold uppercase tracking-[0.12em] text-faint">
            {group.label} <span className="font-normal normal-case tracking-normal">· {group.note}</span>
          </p>
          <ul className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {group.types.map((type) => {
              const at = value.indexOf(type);
              return (
                <li key={type}>
                  <button
                    type="button"
                    onClick={() => toggle(type)}
                    aria-pressed={at >= 0}
                    title={TRANSITION_COPY[type].note}
                    className={clsx(
                      'w-full overflow-hidden rounded-xl border text-left transition-colors',
                      at >= 0 ? 'border-violet ring-1 ring-violet/60' : 'border-line hover:border-line2',
                    )}
                  >
                    <TransitionPlate type={type} order={at >= 0 ? at + 1 : null} />
                    <span className="block px-3 py-2">
                      <span className="block text-[12.5px] font-bold">{TRANSITION_COPY[type].label}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                        {TRANSITION_COPY[type].note}
                      </span>
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
 * One transition, playing.
 *
 * Two stacked plates and, for the flavours, a third element that paints the
 * effect. Everything is a named CSS animation on the same 3s clock, so the
 * grid stays in step and reads as one instrument rather than twelve loops
 * drifting against each other.
 */
function TransitionPlate({ type, order }: { type: ClipTransition; order: number | null }) {
  return (
    <span className="relative block aspect-[4/3] overflow-hidden bg-ink">
      {/* The speaker underneath: a head and shoulders, so the insert has
          something recognisable to cover rather than a flat colour. */}
      <span className="absolute inset-0 grid place-items-center">
        <span className="block h-1/3 w-1/4 rounded-t-full bg-line2/70" />
      </span>

      <span className={clsx('tx-plate', `tx-${type}`)} aria-hidden="true">
        <span className="tx-bars" />
      </span>
      <span className={clsx('tx-fx', `tx-fx-${type}`)} aria-hidden="true" />

      {order ? (
        <span className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-violet text-[9px] font-bold text-ink">
          {order}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The loop.
 *
 * One 3s cycle for every tile: arrive over the first fifth, hold, leave over
 * the last. The percentages are shared between the keyframes so a transition's
 * exit is visibly the continuation of its entrance — `slide-left` goes on
 * leftwards rather than reversing, which is the one thing about this
 * vocabulary that is easy to get wrong and impossible to unsee afterwards.
 *
 * `prefers-reduced-motion` stops all of it and leaves the insert placed, which
 * still shows what the tile is for.
 */
const TILE_CSS = `
/* The insert. Every per-type rule below sets the "animation" shorthand, which
   replaces this one — so a type with no rule simply never appears, which is a
   visible bug rather than a silent one. */
.tx-plate{position:absolute;inset:0;background:linear-gradient(145deg,#9B7BFF,#6F4FE0);opacity:0}
.tx-plate .tx-bars{position:absolute;inset:0;
  background:repeating-linear-gradient(115deg,rgba(255,255,255,.16) 0 6px,transparent 6px 16px)}
.tx-fx{position:absolute;inset:0;pointer-events:none;opacity:0}

@keyframes tx-fade{0%{opacity:0;transform:scale(1.04)}10%{opacity:1;transform:scale(1)}
  88%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.97)}}
.tx-fade{animation:tx-fade 3s cubic-bezier(.4,.6,.3,1) infinite}

/* A hard cut is written as two keyframes a tenth of a per cent apart rather
   than with steps(), whose per-interval semantics hold the START of every
   interval and left the tile frozen on frame zero for the whole loop. */
@keyframes tx-cut{0%,9.9%{opacity:0}10%,87.9%{opacity:1}88%,100%{opacity:0}}
.tx-cut{animation:tx-cut 3s linear infinite}

@keyframes tx-sl{0%{opacity:1;transform:translateX(100%)}10%,88%{transform:translateX(0)}100%{opacity:1;transform:translateX(-100%)}}
.tx-slide-left{animation:tx-sl 3s cubic-bezier(.4,.6,.3,1) infinite}
@keyframes tx-sr{0%{opacity:1;transform:translateX(-100%)}10%,88%{transform:translateX(0)}100%{opacity:1;transform:translateX(100%)}}
.tx-slide-right{animation:tx-sr 3s cubic-bezier(.4,.6,.3,1) infinite}
@keyframes tx-su{0%{opacity:1;transform:translateY(100%)}10%,88%{transform:translateY(0)}100%{opacity:1;transform:translateY(-100%)}}
.tx-slide-up{animation:tx-su 3s cubic-bezier(.4,.6,.3,1) infinite}
@keyframes tx-sd{0%{opacity:1;transform:translateY(-100%)}10%,88%{transform:translateY(0)}100%{opacity:1;transform:translateY(100%)}}
.tx-slide-down{animation:tx-sd 3s cubic-bezier(.4,.6,.3,1) infinite}

@keyframes tx-zoom{0%{opacity:0;transform:scale(.86)}10%,88%{opacity:1;transform:scale(1)}
  100%{opacity:0;transform:scale(1.16)}}
.tx-zoom{animation:tx-zoom 3s cubic-bezier(.4,.6,.3,1) infinite}

@keyframes tx-whip{0%{opacity:0;transform:translateX(34%);filter:blur(7px)}
  5%{opacity:1}10%,88%{opacity:1;transform:translateX(0);filter:blur(0)}
  96%{opacity:1;filter:blur(7px)}100%{opacity:0;transform:translateX(-34%);filter:blur(9px)}}
.tx-whip{animation:tx-whip 3s cubic-bezier(.4,.6,.3,1) infinite}

/* Snaps in already broken, washes out for a beat, then jitters itself straight
   — the same three acts the renderer plays, at tile size. The plate is fully
   opaque throughout: a glitch over a half-faded picture reads as a rendering
   fault, which is the one thing it must not look like. */
@keyframes tx-glitch{
  0%,7.9%{opacity:0}
  /* Opacity is restated on EVERY keyframe below, not only at the two ends.
     A property named at 8% and again at 88% and nowhere in between does not
     hold — it interpolates across the whole gap, which had the plate at 6%
     opacity for its own exit while the tear bars sat on top of nothing. */
  8%{opacity:1;transform:translateX(9%) scaleY(1.06);filter:brightness(2.6) contrast(.5)}
  11%{opacity:1;transform:translateX(-6%) scaleY(.97);filter:brightness(1.7) contrast(.8)}
  14%{opacity:1;transform:translateX(4%);filter:brightness(1) contrast(1)}
  17%{opacity:1;transform:translateX(-2%)}
  20%,80%{opacity:1;transform:translateX(0);filter:brightness(1) contrast(1)}
  83%{opacity:1;transform:translateX(-5%);filter:brightness(1.6) contrast(.8)}
  87.9%{opacity:1;transform:translateX(7%) scaleY(1.05);filter:brightness(2.6) contrast(.5)}
  88%,100%{opacity:0}}
.tx-glitch{animation:tx-glitch 3s linear infinite}

/* The tear: bands shoved sideways for the same beat the wash lasts. A painted
   gradient rather than a second copy of the picture, so it costs one
   composited layer and no repaint. */
@keyframes tx-glitch-bars{
  0%,7.9%{opacity:0;transform:translateX(0)}
  8%{opacity:.9;transform:translateX(-14%)}
  11%{opacity:.7;transform:translateX(11%)}
  14%{opacity:.5;transform:translateX(-6%)}
  17%,82%{opacity:0;transform:translateX(0)}
  85%{opacity:.8;transform:translateX(13%)}
  88%,100%{opacity:0}}
.tx-fx-glitch{background:linear-gradient(180deg,transparent 12%,#fff 12%,#fff 19%,
  transparent 19%,transparent 44%,#C7B3FF 44%,#C7B3FF 52%,transparent 52%,
  transparent 71%,#fff 71%,#fff 76%,transparent 76%);
  animation:tx-glitch-bars 3s linear infinite}

/* Snap in, hold, snap out — the flavours do not fade, the effect over them is
   what covers the join. Same two-adjacent-percentages trick as cut. */
@keyframes tx-snap{0%,9.9%{opacity:0}10%,87.9%{opacity:1}88%,100%{opacity:0}}
.tx-flash,.tx-film-burn,.tx-light-leak{animation:tx-snap 3s linear infinite}

@keyframes tx-fx-flash{0%,6%{opacity:0}10%{opacity:.95}18%{opacity:0}
  84%{opacity:0}88%{opacity:.95}96%,100%{opacity:0}}
.tx-fx-flash{background:#fff;animation:tx-fx-flash 3s linear infinite}

@keyframes tx-fx-burn{0%,3%{opacity:0;transform:scale(.2)}11%{opacity:1;transform:scale(1)}
  24%{opacity:0;transform:scale(1.9)}80%{opacity:0;transform:scale(.2)}
  89%{opacity:1;transform:scale(1.1)}99%,100%{opacity:0;transform:scale(1.9)}}
.tx-fx-film-burn{background:radial-gradient(circle at 62% 42%,rgba(255,252,244,.98) 0%,
  rgba(255,164,58,.9) 36%,rgba(190,62,10,.35) 52%,transparent 70%);
  animation:tx-fx-burn 3s ease-out infinite}

@keyframes tx-fx-leak{0%,3%{opacity:0;transform:translateX(-120%)}10%{opacity:1}
  24%{opacity:0;transform:translateX(120%)}80%{opacity:0;transform:translateX(-120%)}
  88%{opacity:1}99%,100%{opacity:0;transform:translateX(120%)}}
.tx-fx-light-leak{background:linear-gradient(100deg,transparent 22%,rgba(255,214,158,.55) 40%,
  rgba(255,248,232,.95) 50%,rgba(255,120,190,.5) 60%,transparent 78%);
  animation:tx-fx-leak 3s linear infinite}

@media (prefers-reduced-motion:reduce){
  .tx-plate,.tx-fx{animation:none!important;transform:none;filter:none}
  .tx-plate{opacity:1}
  .tx-fx{opacity:.35}
}
`;
