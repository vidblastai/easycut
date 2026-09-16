/**
 * Every pixel the marketing page draws, in one stylesheet.
 *
 * It lives here rather than beside each component for one reason: the same
 * *shot* has to appear in the hero, in the before/after, in the B-roll tile and
 * on both sides of the transition demo. Four copies of a drawn scene drift —
 * one gets a warmer key light, another loses the rim, and the page stops
 * looking like it is about one video. So the scene is a class, `.shot`, and
 * everything that needs footage uses it.
 *
 * On drawing a person. The subject is a head and a pair of shoulders in flat
 * tone — no features, no hair, no skin detail. A stock photograph here would be
 * a stranger appearing to endorse the product, and a rendered face would be
 * worse. Two rounded rectangles read as "someone talking to camera" from across
 * the room and claim nothing about who.
 */
export function MarketingStyles() {
  return <style>{MARKETING_CSS}</style>;
}

const MARKETING_CSS = `
/* ══════════════════════════════════════════════════════════ the shot ═════ */
/* A lit room with somebody in it, drawn. Used anywhere a frame of footage is
   needed. .shot-warm is the graded version — the "after" side. */
.shot { position: absolute; inset: 0; overflow: hidden; container-type: size; }
.shot::before {
  content: ''; position: absolute; inset: 0;
  background:
    radial-gradient(75% 60% at 74% 16%, rgba(255, 206, 156, 0.30), transparent 62%),
    radial-gradient(60% 55% at 12% 88%, rgba(120, 96, 200, 0.26), transparent 66%),
    linear-gradient(168deg, #262430 0%, #1A1922 48%, #121118 100%);
}
/* A practical light behind them, thrown out of focus. Depth for two rules. */
.shot::after {
  content: ''; position: absolute; left: 8%; top: 14%;
  width: 16%; aspect-ratio: 1; border-radius: 999px;
  background: radial-gradient(circle, rgba(255, 214, 160, 0.55), transparent 70%);
  filter: blur(6px);
}
.shot-warm::before {
  background:
    radial-gradient(75% 60% at 72% 14%, rgba(255, 198, 138, 0.40), transparent 60%),
    radial-gradient(62% 58% at 10% 90%, rgba(150, 118, 255, 0.34), transparent 64%),
    linear-gradient(168deg, #2C2436 0%, #1C1825 48%, #100E16 100%);
}

/* Framed the way a talking head is framed: head in the top third with a little
   headroom, shoulders running off the bottom edge. Sized as a share of the
   frame's HEIGHT rather than its width, so the figure keeps its proportions in
   a hero and in a 260px tile. */
/* Sized off the frame's HEIGHT, so the figure keeps its proportions in a hero
   and in a 260px tile alike. The wide variant is the same person from further
   back and off to one side, which is what the cut in the transitions demo is
   cutting to — two different framings of one subject, rather than two flat
   panels sliding past each other. */
.shot-figure {
  position: absolute; left: 53%; top: 13%; bottom: 0;
  height: 87%; width: auto; transform: translateX(-50%);
  overflow: visible;
}
.shot-wide .shot-figure { left: 31%; top: 38%; height: 62%; }
.shot-wide::before { background:
    radial-gradient(70% 60% at 26% 18%, rgba(255, 206, 156, 0.26), transparent 62%),
    radial-gradient(64% 58% at 88% 86%, rgba(120, 96, 200, 0.30), transparent 66%),
    linear-gradient(168deg, #21202C 0%, #17161F 48%, #101016 100%); }
.shot-body { fill: #3B3555; }
.shot-skin { fill: #D9B68B; }
/* Floor falloff, so the figure sits in the room rather than on top of it. */
.shot-floor {
  position: absolute; left: 0; right: 0; bottom: 0; height: 38%;
  background: linear-gradient(180deg, transparent, rgba(0,0,0,0.5));
}
/* The only thing that moves in the shot: a slow light drift, so a still frame
   of a "video" is not perfectly static. */
.shot-sheen {
  position: absolute; inset: -20% -40%;
  background: linear-gradient(105deg, transparent 42%, rgba(255,255,255,0.05) 50%, transparent 58%);
  animation: mk-sheen 7s var(--ease) infinite;
}
@keyframes mk-sheen {
  0%, 12% { transform: translateX(-30%); }
  60%, 100% { transform: translateX(30%); }
}

/* B-roll art: a city after dark, as lights rather than buildings. Drawing
   windows with a repeating gradient looked like a rendering bug at tile size. */
.shot-broll {
  position: absolute; inset: 0;
  background:
    radial-gradient(22% 34% at 18% 74%, rgba(255, 180, 90, 0.55), transparent 70%),
    radial-gradient(16% 26% at 38% 86%, rgba(120, 200, 255, 0.45), transparent 70%),
    radial-gradient(26% 40% at 72% 70%, rgba(180, 130, 255, 0.50), transparent 70%),
    radial-gradient(14% 22% at 88% 84%, rgba(255, 140, 120, 0.42), transparent 70%),
    radial-gradient(70% 60% at 50% 8%, rgba(60, 96, 170, 0.45), transparent 72%),
    linear-gradient(170deg, #17203A 0%, #0E1526 55%, #080C16 100%);
}
.shot-broll::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 26%;
  background: linear-gradient(180deg, transparent, rgba(4, 6, 12, 0.9));
}

/* ═════════════════════════════════════════════════ hero: the edit reel ═══ */
.ec-reel { --loop: 12s; }
.ec-reel-stage {
  border: 1px solid var(--line); border-radius: 20px;
  background: linear-gradient(180deg, #16161C, #101015);
  padding: 14px;
  box-shadow: 0 30px 80px -40px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(155,123,255,0.06);
}
.ec-reel-frame {
  position: relative; aspect-ratio: 16 / 9; overflow: hidden;
  border-radius: 12px; background: #0A0A0D;
  container-type: inline-size; isolation: isolate;
}

/* B-roll wiping in over the take. */
.ec-broll {
  position: absolute; left: 4cqw; top: 4cqw; width: 34cqw; aspect-ratio: 16/9;
  border-radius: 1.2cqw; overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.10);
  clip-path: inset(0 100% 0 0 round 1.2cqw);
  animation: ec-broll-in var(--loop) var(--ease) infinite forwards;
}
.ec-broll-tag {
  position: absolute; left: 1.4cqw; bottom: 1.2cqw; max-width: calc(100% - 2.8cqw);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border-radius: 999px; padding: 0.5cqw 1.3cqw;
  background: rgba(8,8,12,0.78); backdrop-filter: blur(6px);
  font-size: clamp(8px, 1.3cqw, 11px); font-weight: 700; color: var(--chalk);
}
@keyframes ec-broll-in {
  0%, 46.6% { clip-path: inset(0 100% 0 0 round 1.2cqw); }
  52%, 100% { clip-path: inset(0 0 0 0 round 1.2cqw); }
}

.ec-stat {
  position: absolute; right: 5cqw; bottom: 26%;
  display: flex; flex-direction: column; gap: 1px;
  border: 1px solid rgba(155,123,255,0.38); border-radius: 1.2cqw;
  padding: 1.2cqw 1.8cqw;
  background: rgba(19,17,28,0.88); backdrop-filter: blur(10px);
  opacity: 0; transform: translateY(12px) scale(0.94);
  animation: ec-stat-in var(--loop) var(--ease) infinite forwards;
}
.ec-stat b { font-size: clamp(15px, 3.2cqw, 30px); font-weight: 800; letter-spacing: -0.04em; color: var(--violet-hi); line-height: 1; }
.ec-stat span { font-size: clamp(8px, 1.5cqw, 12px); font-weight: 600; color: var(--muted); }
@keyframes ec-stat-in {
  0%, 61.6% { opacity: 0; transform: translateY(12px) scale(0.94); }
  67%, 100% { opacity: 1; transform: translateY(0) scale(1); }
}

.ec-caption {
  position: absolute; left: 0; right: 0; bottom: 7%;
  display: flex; justify-content: center; gap: 0.3em;
  font-size: clamp(15px, 5cqw, 38px); font-weight: 800; letter-spacing: -0.025em;
}
.ec-word {
  display: inline-block; color: #fff;
  text-shadow: 0 0.3cqw 1.4cqw rgba(0,0,0,0.7);
  opacity: 0; transform: translateY(6px) scale(0.88);
  animation: ec-word-in var(--loop) cubic-bezier(0.2, 1.5, 0.4, 1) infinite forwards;
}
.ec-word-accent { color: var(--violet-hi); }
/* One keyframe set per word rather than a delay on a shared one: a delay
   shifts the element's whole twelve-second loop, so it no longer lines up with
   the master clock every other pass. The stagger belongs in the percentages. */
@keyframes ec-word-in {
  0%, 29% { opacity: 0; transform: translateY(6px) scale(0.88); }
  33%, 100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes ec-word-in-2 {
  0%, 31.7% { opacity: 0; transform: translateY(6px) scale(0.88); }
  35.7%, 100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes ec-word-in-3 {
  0%, 34.3% { opacity: 0; transform: translateY(6px) scale(0.88); }
  38.3%, 100% { opacity: 1; transform: translateY(0) scale(1); }
}
.ec-word:nth-child(2) { animation-name: ec-word-in-2; }
.ec-word:nth-child(3) { animation-name: ec-word-in-3; }

.ec-chip {
  position: absolute; right: 2.5cqw; top: 2.5cqw; z-index: 3;
  display: inline-flex; align-items: center; gap: 0.9cqw;
  border-radius: 999px; padding: 0.8cqw 1.8cqw;
  background: rgba(8,8,12,0.76); backdrop-filter: blur(8px);
  font-size: clamp(9px, 1.7cqw, 13px); font-weight: 700; color: var(--chalk);
  white-space: nowrap;
}
.ec-chip i { width: 0.8em; height: 0.8em; border-radius: 999px; flex: none; }
.ec-dot-raw { background: var(--bad); }
.ec-dot-done { background: var(--ok); }
.ec-chip-raw { animation: ec-chip-out var(--loop) var(--ease) infinite forwards; }
.ec-chip-done { opacity: 0; animation: ec-chip-in var(--loop) var(--ease) infinite forwards; }
@keyframes ec-chip-out { 0%, 86% { opacity: 1; } 89%, 100% { opacity: 0; } }
@keyframes ec-chip-in  { 0%, 87% { opacity: 0; } 91%, 100% { opacity: 1; } }

/* The timeline under the frame. The pauses are marked, then squeezed out, and
   the bar is visibly shorter afterwards — flex-grow animates, so it really is. */
.ec-strip { position: relative; margin-top: 12px; }
.ec-strip-row { display: flex; gap: 3px; height: 26px; }
.ec-cell { position: relative; overflow: hidden; border-radius: 5px; min-width: 0; display: grid; place-items: center; }
.ec-cell-talk { background: #23232E; }
.ec-cell-talk i {
  display: block; width: 76%; height: 10px; border-radius: 2px;
  background: repeating-linear-gradient(90deg, var(--faint) 0 2px, transparent 2px 5px);
  mask-image: radial-gradient(60% 100% at 50% 50%, #000 40%, rgba(0,0,0,0.35));
}
.ec-cell-gap {
  background: repeating-linear-gradient(135deg, rgba(255,123,123,0.32) 0 5px, rgba(255,123,123,0.12) 5px 10px);
  box-shadow: inset 0 0 0 1px rgba(255,123,123,0.32);
  animation: ec-gap-close var(--loop) var(--ease) infinite forwards;
}
@keyframes ec-gap-close {
  0%, 16.6% { flex-grow: 7; opacity: 1; margin-right: 0; }
  26%, 100% { flex-grow: 0.0001; opacity: 0; margin-right: -3px; }
}
.ec-playhead {
  position: absolute; top: -3px; bottom: -3px; width: 2px; border-radius: 2px;
  background: var(--violet); box-shadow: 0 0 10px rgba(155,123,255,0.8);
  animation: ec-sweep var(--loop) linear infinite;
}
@keyframes ec-sweep { from { left: 0%; } to { left: calc(100% - 2px); } }
.ec-sfx-row { position: absolute; inset: 0; pointer-events: none; }
.ec-sfx {
  position: absolute; top: 50%; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px;
  border-radius: 999px; background: var(--violet-hi); opacity: 0;
  animation: ec-ping var(--loop) var(--ease) infinite forwards;
}
@keyframes ec-ping {
  0%, 76.6% { opacity: 0; box-shadow: 0 0 0 0 rgba(155,123,255,0.55); }
  79% { opacity: 1; box-shadow: 0 0 0 9px rgba(155,123,255,0); }
  82%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(155,123,255,0); }
}
@keyframes ec-ping-2 {
  0%, 78.7% { opacity: 0; box-shadow: 0 0 0 0 rgba(155,123,255,0.55); }
  81% { opacity: 1; box-shadow: 0 0 0 9px rgba(155,123,255,0); }
  84%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(155,123,255,0); }
}
@keyframes ec-ping-3 {
  0%, 80.8% { opacity: 0; box-shadow: 0 0 0 0 rgba(155,123,255,0.55); }
  83% { opacity: 1; box-shadow: 0 0 0 9px rgba(155,123,255,0); }
  86%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(155,123,255,0); }
}
.ec-sfx:nth-child(2) { animation-name: ec-ping-2; }
.ec-sfx:nth-child(3) { animation-name: ec-ping-3; }

.ec-layers { display: flex; flex-wrap: wrap; justify-content: center; gap: 7px; margin-top: 16px; }
.ec-layer {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--line); border-radius: 999px; padding: 5px 11px 5px 7px;
  font-size: 12px; font-weight: 600; color: var(--muted); background: var(--charcoal);
  opacity: 0.32; transform: translateY(3px);
  animation: ec-layer-in var(--loop) var(--ease) infinite forwards;
}
@keyframes ec-layer-in {
  0% { opacity: 0.32; transform: translateY(3px); border-color: var(--line); color: var(--muted); }
  2%, 100% { opacity: 1; transform: translateY(0); border-color: rgba(155,123,255,0.32); color: var(--chalk); }
}
.ec-tick {
  display: grid; place-items: center; flex: none;
  width: 16px; height: 16px; border-radius: 999px;
  background: var(--violet-dim); color: var(--violet-hi);
  transform: scale(0.6); opacity: 0;
  animation: ec-tick-in var(--loop) cubic-bezier(0.2, 1.6, 0.4, 1) infinite forwards;
}
.ec-tick svg { width: 11px; height: 11px; }
@keyframes ec-tick-in { 0% { transform: scale(0.6); opacity: 0; } 2.5%, 100% { transform: scale(1); opacity: 1; } }

@media (max-width: 640px) {
  .ec-reel-stage { padding: 10px; border-radius: 16px; }
  .ec-strip-row { height: 20px; gap: 2px; }
  .ec-layer { font-size: 11px; padding: 4px 9px 4px 6px; }
}

/* ═══════════════════════════════════════════════════════ before / after ══ */
.ba {
  position: relative; aspect-ratio: 16 / 9; overflow: hidden;
  border-radius: 14px; border: 1px solid var(--line); background: #0A0A0D;
  container-type: inline-size; touch-action: pan-y;
}
/* Each side is its own stacking context. Without that, clip-path makes the
   after layer one while the before layer stays flat — so the before layer's
   z-indexed children escape into the root context and paint OVER the side that
   is supposed to be covering them. That is how the dead-air strip ended up
   running straight through the finished half. */
.ba-layer { position: absolute; inset: 0; isolation: isolate; }
.ba-before { z-index: 1; }
.ba-after  { z-index: 2; }

.ba-badge {
  position: absolute; top: 3.5cqw; z-index: 3;
  display: inline-flex; align-items: center; border-radius: 999px;
  padding: 1.1cqw 2.4cqw; white-space: nowrap;
  font-size: clamp(9px, 1.7cqw, 13px); font-weight: 700; letter-spacing: -0.01em;
  background: rgba(8,8,12,0.78); backdrop-filter: blur(8px); color: var(--chalk);
}
.ba-badge-before { left: 3.5cqw; box-shadow: inset 0 0 0 1px rgba(255,123,123,0.32); }
.ba-badge-after  { right: 3.5cqw; box-shadow: inset 0 0 0 1px rgba(91,214,160,0.36); }

/* The pauses, as the timeline saw them. Only on the "before" side, because
   after the edit they are not there. */
.ba-deadair {
  position: absolute; left: 3.5cqw; right: 3.5cqw; bottom: 3.5cqw; z-index: 3;
  display: flex; gap: 0.6cqw; height: 2.4cqw;
}
.ba-deadair span { flex: 1; border-radius: 1px; background: rgba(255,255,255,0.14); }
.ba-deadair span:nth-child(2), .ba-deadair span:nth-child(5), .ba-deadair span:nth-child(7) {
  background: repeating-linear-gradient(135deg, rgba(255,123,123,0.5) 0 3px, rgba(255,123,123,0.18) 3px 6px);
}

/* Everything the edit adds sits in the right-hand half of the frame, where the
   slider starts, so the first look already shows work rather than an empty
   plate waiting to be dragged into view. */
.ba-broll {
  position: absolute; right: 4cqw; top: 11cqw; width: 25cqw; aspect-ratio: 16/9;
  border-radius: 1.4cqw; overflow: hidden; z-index: 2;
  box-shadow: 0 1cqw 3cqw -1cqw rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.12);
}
.ba-stat {
  position: absolute; right: 4cqw; top: 30cqw; z-index: 2;
  display: flex; flex-direction: column;
  border: 1px solid rgba(155,123,255,0.40); border-radius: 1.4cqw;
  padding: 1.3cqw 1.9cqw;
  background: rgba(19,17,28,0.9); backdrop-filter: blur(10px);
}
.ba-stat b { font-size: clamp(14px, 3.2cqw, 34px); font-weight: 800; letter-spacing: -0.04em; line-height: 1; color: var(--violet-hi); }
.ba-stat span { margin-top: 0.4cqw; font-size: clamp(8px, 1.4cqw, 12px); font-weight: 600; color: var(--muted); }
.ba-caption {
  position: absolute; left: 42cqw; right: 5cqw; bottom: 6cqw; z-index: 2;
  text-align: center; color: #fff; line-height: 1.15;
  font-size: clamp(12px, 3.4cqw, 34px); font-weight: 800; letter-spacing: -0.028em;
  text-shadow: 0 0.3cqw 1.4cqw rgba(0,0,0,0.7);
}
.ba-caption em { font-style: normal; color: var(--violet-hi); }
.ba-music {
  position: absolute; left: 44cqw; bottom: 3.5cqw; z-index: 2;
  display: flex; align-items: flex-end; gap: 0.5cqw; height: 3cqw;
}
.ba-music i {
  display: block; width: 0.7cqw; border-radius: 999px; background: rgba(155,123,255,0.9);
  animation: ba-bar 1.1s var(--ease) infinite alternate;
}
@keyframes ba-bar { from { height: 18%; } to { height: 100%; } }

.ba-seam {
  position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; z-index: 4;
  background: rgba(245,245,247,0.9); box-shadow: 0 0 18px rgba(0,0,0,0.7);
  pointer-events: none;
}
.ba-handle {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  display: grid; place-items: center; width: 38px; height: 38px; border-radius: 999px;
  background: var(--chalk); color: #14141A; box-shadow: 0 6px 20px rgba(0,0,0,0.55);
}
.ba-handle svg { width: 20px; height: 12px; }
.ba-range {
  position: absolute; inset: 0; z-index: 5; width: 100%; height: 100%;
  margin: 0; padding: 0; opacity: 0; cursor: ew-resize;
  -webkit-appearance: none; appearance: none; background: transparent;
}
.ba-range::-webkit-slider-thumb { -webkit-appearance: none; width: 44px; height: 100%; }
.ba-range::-moz-range-thumb { width: 44px; height: 100%; border: 0; background: transparent; }
.ba:has(.ba-range:focus-visible) .ba-handle { outline: 2px solid var(--violet); outline-offset: 3px; }
@media (max-width: 640px) {
  .ba-handle { width: 30px; height: 30px; }
  .ba-handle svg { width: 16px; height: 10px; }
}

/* ═══════════════════════════════════════════════════════ layer demos ════ */
.layer-grid {
  display: grid; gap: 1px; background: var(--line);
  border: 1px solid var(--line); border-radius: 18px; overflow: hidden;
}
@media (min-width: 640px)  { .layer-grid { grid-template-columns: 1fr 1fr; } }
@media (min-width: 1024px) { .layer-grid { grid-template-columns: repeat(3, 1fr); } }
.layer-tile { background: var(--charcoal); }
.layer-stage {
  position: relative; aspect-ratio: 16 / 9; overflow: hidden;
  background: #0B0B10; border-bottom: 1px solid var(--line-soft);
  container-type: inline-size;
}
.layer-copy { padding: 16px 18px 20px; }
.layer-copy h3 { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; }
.layer-copy p { margin-top: 6px; font-size: 13px; line-height: 1.6; color: var(--muted); }

.d-cap {
  position: absolute; left: 0; right: 0; bottom: 12%; z-index: 2;
  display: flex; align-items: center; justify-content: center; gap: 0.28em;
  font-size: clamp(13px, 7cqw, 30px); font-weight: 800; letter-spacing: -0.03em; color: #fff;
  text-shadow: 0 0.3cqw 1.2cqw rgba(0,0,0,0.75);
}
.d-cap span { opacity: 0; transform: translateY(6px) scale(0.86); animation: d-pop 3.2s cubic-bezier(0.2, 1.5, 0.4, 1) infinite; }
.d-cap-hit { color: var(--violet-hi); }
@keyframes d-pop {
  0% { opacity: 0; transform: translateY(6px) scale(0.86); }
  12%, 78% { opacity: 1; transform: translateY(0) scale(1); }
  92%, 100% { opacity: 0; transform: translateY(-4px) scale(0.96); }
}

.d-broll-card {
  position: absolute; inset: 12% 8%; border-radius: 8px; overflow: hidden; z-index: 2;
  box-shadow: 0 10px 28px -10px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,255,255,0.12);
  transform: translateX(118%);
  animation: d-slide 4s var(--ease) infinite;
}
@keyframes d-slide {
  0% { transform: translateX(118%); }
  14%, 76% { transform: translateX(0); }
  92%, 100% { transform: translateX(-118%); }
}
.d-broll-tag {
  position: absolute; left: 10%; bottom: 7%; z-index: 3;
  border-radius: 999px; padding: 0.7cqw 1.8cqw;
  background: rgba(8,8,12,0.8); backdrop-filter: blur(6px);
  font-size: clamp(8px, 2.5cqw, 11px); font-weight: 700; color: var(--chalk);
  opacity: 0; animation: d-tagin 4s var(--ease) infinite;
}
@keyframes d-tagin { 0%, 16% { opacity: 0; } 24%, 74% { opacity: 1; } 86%, 100% { opacity: 0; } }

.d-gfx {
  position: absolute; left: 0; bottom: 0; width: 52%; height: 100%; z-index: 2;
  display: flex; align-items: flex-end; gap: 3.5cqw;
  padding: 26% 12% 14%;
}
.d-gfx i {
  display: block; flex: 1; height: 0; border-radius: 3px 3px 1px 1px;
  background: linear-gradient(180deg, var(--violet-hi), rgba(155,123,255,0.4));
  animation: d-grow 3.6s var(--ease) infinite;
}
@keyframes d-grow { 0% { height: 0; } 22%, 76% { height: var(--h); } 94%, 100% { height: 0; } }
.d-gfx-num {
  position: absolute; left: 12%; top: 13%; z-index: 3;
  font-size: clamp(11px, 5cqw, 22px); font-weight: 800; letter-spacing: -0.03em; color: var(--violet-hi);
  opacity: 0; transform: translateY(6px);
  animation: d-numin 3.6s cubic-bezier(0.2, 1.5, 0.4, 1) infinite;
}
@keyframes d-numin {
  0%, 24% { opacity: 0; transform: translateY(6px); }
  34%, 76% { opacity: 1; transform: translateY(0); }
  92%, 100% { opacity: 0; transform: translateY(-4px); }
}

.d-snd { position: absolute; inset: 0; z-index: 2; }
/* The bars have to stay readable over a lit room, so they get their own
   plate rather than a heavier colour that would fight the palette. */
.d-snd-scrim { position: absolute; inset: 0; background: rgba(8, 8, 13, 0.74); }
.d-snd-music {
  position: absolute; left: 8%; right: 8%; top: 50%; height: 46%;
  transform: translateY(-50%);
  display: flex; align-items: center; justify-content: space-between;
}
.d-snd-music i {
  display: block; width: 2cqw; height: 34%; border-radius: 999px;
  background: rgba(155,123,255,0.75);
  animation: d-duck 4s var(--ease) infinite;
}
/* An envelope rather than a repeating pattern: a comb of two alternating
   heights reads as a texture, not as somebody speaking. */
.d-snd-music i:nth-child(1), .d-snd-music i:nth-child(22) { height: 16%; }
.d-snd-music i:nth-child(2), .d-snd-music i:nth-child(21) { height: 30%; }
.d-snd-music i:nth-child(3), .d-snd-music i:nth-child(20) { height: 54%; }
.d-snd-music i:nth-child(4), .d-snd-music i:nth-child(19) { height: 38%; }
.d-snd-music i:nth-child(5), .d-snd-music i:nth-child(18) { height: 72%; }
.d-snd-music i:nth-child(6), .d-snd-music i:nth-child(17) { height: 58%; }
.d-snd-music i:nth-child(7), .d-snd-music i:nth-child(16) { height: 88%; }
.d-snd-music i:nth-child(8), .d-snd-music i:nth-child(15) { height: 66%; }
.d-snd-music i:nth-child(9), .d-snd-music i:nth-child(14) { height: 100%; }
.d-snd-music i:nth-child(10), .d-snd-music i:nth-child(13) { height: 76%; }
.d-snd-music i:nth-child(11), .d-snd-music i:nth-child(12) { height: 92%; }
@keyframes d-duck {
  0%, 24% { transform: scaleY(1); opacity: 1; }
  38%, 68% { transform: scaleY(0.24); opacity: 0.5; }
  84%, 100% { transform: scaleY(1); opacity: 1; }
}
.d-snd-voice {
  position: absolute; left: 18%; right: 18%; top: 50%; height: 4px; margin-top: -2px;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, var(--chalk) 16%, var(--chalk) 84%, transparent);
  transform: scaleX(0); animation: d-voice 4s var(--ease) infinite;
}
@keyframes d-voice {
  0%, 28% { transform: scaleX(0); opacity: 0; }
  42%, 66% { transform: scaleX(1); opacity: 1; }
  80%, 100% { transform: scaleX(0); opacity: 0; }
}
.d-snd-tag {
  position: absolute; right: 8%; top: 11%; z-index: 3;
  font-size: clamp(8px, 2.5cqw, 11px); font-weight: 700; color: var(--violet-hi);
  opacity: 0; animation: d-tagin2 4s var(--ease) infinite;
}
@keyframes d-tagin2 { 0%, 32% { opacity: 0; } 44%, 66% { opacity: 1; } 78%, 100% { opacity: 0; } }

/* Two real frames swapping, not two flat panels — the swap has to be readable
   in a screenshot, not only in motion. */
.d-tr { position: absolute; inset: 0; overflow: hidden; z-index: 2; }
.d-tr-a, .d-tr-b { position: absolute; inset: 0; overflow: hidden; }
.d-tr-a { animation: d-whip-a 3s var(--ease) infinite; }
.d-tr-b { transform: translateX(100%); animation: d-whip-b 3s var(--ease) infinite; }
@keyframes d-whip-a {
  0%, 38% { transform: translateX(0); filter: blur(0); }
  54% { transform: translateX(-100%); filter: blur(8px); }
  54.01%, 100% { transform: translateX(-100%); filter: blur(0); }
}
@keyframes d-whip-b {
  0%, 38% { transform: translateX(100%); filter: blur(8px); }
  54%, 100% { transform: translateX(0); filter: blur(0); }
}
.d-tr-blur {
  position: absolute; inset: 0; z-index: 3; opacity: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
  animation: d-whip-smear 3s var(--ease) infinite;
}
@keyframes d-whip-smear { 0%, 40% { opacity: 0; } 48% { opacity: 1; } 58%, 100% { opacity: 0; } }

/* Reframing: the crop follows about a third of a second behind the subject,
   which is what a tracked crop looks like. Welded to the subject it reads as a
   screenshot; three seconds behind, as in the first draft, it reads as broken. */
.d-rf { position: absolute; inset: 0; z-index: 2; }
.d-rf-subject {
  position: absolute; bottom: 0; height: 62%; width: auto; left: 14%;
  animation: d-walk 6s ease-in-out infinite;
}
/* The crop follows about a third of a second behind the subject, which is what
   a tracked crop looks like. Welded to the subject it reads as a screenshot. */
.d-rf-crop {
  position: absolute; top: 5%; bottom: 5%; aspect-ratio: 9/16; left: 12%;
  border: 2px solid var(--violet); border-radius: 4px;
  box-shadow: 0 0 0 2000px rgba(8, 8, 11, 0.62);
  animation: d-track 6s ease-in-out infinite;
}
@keyframes d-walk  { 0%, 100% { left: 8%; } 50% { left: 48%; } }
@keyframes d-track { 0%, 100% { left: 2%; }  3% { left: 2%; } 52% { left: 42%; } 55% { left: 42%; } }
.d-rf-tag {
  position: absolute; left: 5%; top: 7%; z-index: 4;
  border-radius: 4px; padding: 2px 6px;
  background: var(--violet); color: #14101F;
  font-size: clamp(8px, 2.4cqw, 10px); font-weight: 800; letter-spacing: 0.02em;
}
`;
