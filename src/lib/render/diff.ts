import type { Edl } from '@/lib/edl/types';

/**
 * What actually changed between two versions of an edit, in output seconds.
 *
 * The point of this file is that a re-render should cost what the change cost,
 * not what the video cost. Today every edit — retyping one caption word on a
 * ten-minute talk — re-renders all fifteen thousand frames, which is half an
 * hour for a keystroke. An edit whose effect is three seconds long should take
 * about as long as three seconds of video takes to render.
 *
 * ── Why a single span rather than a list of ranges ───────────────────────
 *
 * Because the second-cheapest thing after "render three seconds" is "render
 * the whole thing", and everything in between costs more in splice joins than
 * it saves in frames. One contiguous span covers what people actually do —
 * fix a caption, move a graphic, drop a punch-in — and anything scattered
 * falls back to a full render, which is always correct.
 *
 * ── Why most fields mean "all" ───────────────────────────────────────────
 *
 * Output time is a function of the segment list: make one segment a second
 * shorter and every cue after it moves. So a segment change is not a local
 * change, it is a new video. Same for the format, the caption style, the
 * reframe track and the watermark — each of them paints on every frame. Being
 * conservative here costs a full render; being clever here ships a video with
 * a seam in it.
 */

export type RenderDelta =
  /** Nothing that reaches the screen changed. */
  | { kind: 'none' }
  /** Everything has to be drawn again. */
  | { kind: 'all'; reason: string }
  /** Only this stretch of output time needs re-drawing. */
  | { kind: 'span'; fromSec: number; toSec: number; reason: string };

/** Fields whose change means every frame is different. */
const GLOBAL_FIELDS: Array<[keyof Edl, string]> = [
  ['format', 'the shape or length of the video'],
  ['segments', 'the cuts (every later cue moves with them)'],
  ['captionStyle', 'the caption look'],
  ['reframe', 'the framing track'],
  ['source', 'the footage'],
  ['watermark', 'the watermark'],
  // Both are audio, and the audio is reused wholesale by an incremental
  // render — so a change to either one has to go the long way round.
  ['music', 'the music'],
  ['sfx', 'the sound effects'],
];

/** Cue lists, and how to read the stretch of output time each entry occupies. */
const TIMED_FIELDS: Array<[keyof Edl, string]> = [
  ['captions', 'a caption'],
  ['broll', 'a B-roll insert'],
  ['graphics', 'a graphic'],
  ['overlays', 'an overlay'],
  ['punchIns', 'a punch-in'],
  ['transitions', 'a transition'],
];

interface Window {
  from: number;
  to: number;
}

/**
 * The stretch of output time an entry is responsible for.
 *
 * Padded, because several layers reach outside their own timing: a transition
 * is centred on an instant and flashes either side of it, a B-roll insert eases
 * in and out, and a reaction cut moves the speaker before the picture arrives.
 * Padding costs a few extra frames; not padding costs a visible step at the
 * splice.
 */
const PAD_SEC = 0.5;

function windowOf(entry: unknown): Window | null {
  const e = entry as Record<string, number | undefined>;
  const from = e.outStartSec ?? e.startSec ?? e.at ?? e.atSec;
  if (typeof from !== 'number') return null;
  const to = e.outEndSec ?? e.endSec ?? from;
  return { from: from - PAD_SEC, to: (typeof to === 'number' ? to : from) + PAD_SEC };
}

/** Index a cue list by id, so a change is matched against its own old self. */
function byId(list: ReadonlyArray<unknown>): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const entry of list) {
    const id = (entry as { id?: string }).id;
    if (typeof id === 'string') map.set(id, entry);
  }
  return map;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function renderDelta(previous: Edl, next: Edl): RenderDelta {
  for (const [field, what] of GLOBAL_FIELDS) {
    if (!same(previous[field], next[field])) {
      return { kind: 'all', reason: `${what} changed` };
    }
  }

  const touched: Window[] = [];
  const reasons: string[] = [];

  for (const [field, what] of TIMED_FIELDS) {
    const before = (previous[field] ?? []) as ReadonlyArray<unknown>;
    const after = (next[field] ?? []) as ReadonlyArray<unknown>;
    if (same(before, after)) continue;

    const old = byId(before);
    const now = byId(after);

    // An entry with no id cannot be matched to its old self, so the only
    // honest answer is that the whole list might have moved.
    if (old.size !== before.length || now.size !== after.length) {
      return { kind: 'all', reason: `${what} list changed and could not be matched up` };
    }

    for (const [id, entry] of now) {
      const was = old.get(id);
      if (same(was, entry)) continue;
      // Changed or added: both its old and new positions have to be redrawn.
      for (const w of [windowOf(entry), was ? windowOf(was) : null]) if (w) touched.push(w);
      reasons.push(was ? `${what} changed` : `${what} added`);
    }
    for (const [id, entry] of old) {
      if (now.has(id)) continue;
      const w = windowOf(entry);
      if (w) touched.push(w);
      reasons.push(`${what} removed`);
    }
  }

  if (!touched.length) {
    // Something changed that does not reach the screen — a title, a hashtag,
    // the list of degraded layers. There is nothing to draw again.
    return same(previous, next) ? { kind: 'none' } : { kind: 'none' };
  }

  const fromSec = Math.max(0, Math.min(...touched.map((w) => w.from)));
  const toSec = Math.min(next.format.durationSec, Math.max(...touched.map((w) => w.to)));

  return {
    kind: 'span',
    fromSec,
    toSec,
    reason: [...new Set(reasons)].join(', '),
  };
}

/**
 * Whether re-rendering a span is actually worth the splice.
 *
 * A span covering most of the video saves little and still pays for two joins
 * and a concat, so below this the full render is both faster and simpler. The
 * threshold is deliberately generous: the failure mode of guessing wrong is a
 * render that takes as long as it does today, which is what would have
 * happened anyway.
 */
export const WORTH_SPLICING_BELOW = 0.6;

export function worthSplicing(delta: RenderDelta, durationSec: number): boolean {
  if (delta.kind !== 'span' || durationSec <= 0) return false;
  return (delta.toSec - delta.fromSec) / durationSec < WORTH_SPLICING_BELOW;
}
