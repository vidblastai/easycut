import { z } from 'zod';
import { TimeMapper, layoutSegments } from '@/lib/timeline/time-mapper';
import {
  CAPTION_ANIMATIONS,
  CaptionWordStyleSchema,
  GRAPHIC_TYPES,
  TRANSITION_TYPES,
  EdlSchema,
  type CaptionCue,
  type Edl,
  type Segment,
} from './types';

/**
 * Manual edits, expressed as operations on the EDL.
 *
 * The AI produces a first cut; this is how a person changes it afterwards. Each
 * operation is small, named, and reversible by replaying the stack — which is
 * what lets the timeline editor offer undo without snapshotting a whole document
 * per keystroke, and what lets the server re-derive the same result the client
 * previewed.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE HARD PART: re-timing.
 *
 * Trimming a segment by 400 ms moves everything after it. A caption three cuts
 * later is anchored to words the speaker said at a fixed moment in the SOURCE,
 * so its output time has to shift by exactly the amount the edit displaced it —
 * not by a guess, and not by leaving it where it was.
 *
 * `relayout` does this exactly: it reads each cue's anchor back
 * into source time using the OLD segment layout, then forward into output time
 * using the NEW one. Anything anchored to footage that no longer exists is
 * dropped rather than clamped, because a caption for deleted words is a lie.
 * ────────────────────────────────────────────────────────────────────────────
 */

/* ─────────────────────────────────────────────────────────── schema ─── */

export const CLIP_TRACKS = ['broll', 'graphics', 'overlays', 'punchIns', 'sfx', 'transitions'] as const;
export type ClipTrack = (typeof CLIP_TRACKS)[number];

export const EdlOperationSchema = z.discriminatedUnion('op', [
  /* segments — the cut itself */
  z.object({
    op: z.literal('segment.trim'),
    id: z.string(),
    sourceStartSec: z.number().nonnegative().optional(),
    sourceEndSec: z.number().nonnegative().optional(),
  }),
  z.object({ op: z.literal('segment.split'), id: z.string(), atOutSec: z.number().nonnegative() }),
  z.object({ op: z.literal('segment.delete'), id: z.string() }),
  z.object({ op: z.literal('segment.reorder'), id: z.string(), toIndex: z.number().int().nonnegative() }),
  z.object({ op: z.literal('segment.speed'), id: z.string(), speed: z.number().min(0.25).max(4) }),

  /* clips — everything laid on top */
  z.object({
    op: z.literal('clip.move'),
    track: z.enum(CLIP_TRACKS),
    id: z.string(),
    outStartSec: z.number().nonnegative(),
  }),
  z.object({
    op: z.literal('clip.trim'),
    track: z.enum(CLIP_TRACKS),
    id: z.string(),
    outStartSec: z.number().nonnegative().optional(),
    outEndSec: z.number().nonnegative().optional(),
  }),
  z.object({ op: z.literal('clip.delete'), track: z.enum(CLIP_TRACKS), id: z.string() }),
  z.object({
    op: z.literal('clip.add'),
    track: z.enum(CLIP_TRACKS),
    atSec: z.number().nonnegative(),
    durationSec: z.number().positive().default(2),
    /** Seed content: a B-roll query, a graphic's text, a sound effect name. */
    value: z.string().default(''),
    graphicType: z.enum(GRAPHIC_TYPES).optional(),
    /**
     * The id the new clip will have. Carried in the operation, NOT invented
     * when it is applied.
     *
     * This used to be `Math.random()` inside the reducer, which is wrong the
     * moment an operation is applied more than once — and the editor applies
     * the whole stack on every render, to show you the pending edit. So a clip
     * you added got a different identity thirty times a second: its React key
     * changed, its DOM node was destroyed and rebuilt, and any attempt to move,
     * trim or delete it failed with "Not found on this track" because the id
     * you grabbed no longer existed by the time you let go.
     *
     * Optional so a payload written before this field existed still applies —
     * once, on the server, where instability does not show.
     */
    id: z.string().optional(),
  }),
  z.object({
    op: z.literal('clip.update'),
    track: z.enum(CLIP_TRACKS),
    id: z.string(),
    patch: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])),
  }),

  /* captions */
  z.object({ op: z.literal('caption.text'), id: z.string(), text: z.string().max(240) }),
  z.object({
    op: z.literal('caption.time'),
    id: z.string(),
    startSec: z.number().nonnegative(),
    endSec: z.number().nonnegative(),
  }),
  z.object({
    op: z.literal('caption.emphasis'),
    id: z.string(),
    wordIndex: z.number().int().nonnegative(),
    emphasis: z.boolean(),
  }),
  /**
   * Style ONE word differently from the rest of its line.
   *
   * A patch rather than a whole style, so "make this word blue" does not also
   * silently reset the font somebody chose for it a minute ago. Passing null
   * for a field clears that one override; passing `style: null` clears them
   * all and returns the word to the line.
   */
  z.object({
    op: z.literal('caption.wordStyle'),
    id: z.string(),
    wordIndex: z.number().int().nonnegative(),
    style: CaptionWordStyleSchema.nullable(),
  }),
  z.object({ op: z.literal('caption.delete'), id: z.string() }),

  /* global */
  z.object({ op: z.literal('captionStyle.set'), patch: z.object({
    animation: z.enum(CAPTION_ANIMATIONS).optional(),
    fontSizeRatio: z.number().min(0.02).max(0.12).optional(),
    positionY: z.number().min(0.05).max(0.97).optional(),
    maxWordsPerCue: z.number().int().min(1).max(12).optional(),
    uppercase: z.boolean().optional(),
    emphasisColor: z.string().optional(),
    color: z.string().optional(),
  }) }),
  z.object({ op: z.literal('music.gain'), gainDb: z.number().min(-60).max(6) }),
  z.object({ op: z.literal('music.remove') }),
  z.object({ op: z.literal('transition.set'), id: z.string(), type: z.enum(TRANSITION_TYPES) }),
]);

export type EdlOperation = z.infer<typeof EdlOperationSchema>;

export const EdlOperationsSchema = z.array(EdlOperationSchema).max(500);

/* ───────────────────────────────────────────── track accessors ─── */

/**
 * Tracks store their times under different field names — B-roll has a start and
 * an end, a sound effect only has an instant. These accessors let every
 * operation treat them uniformly instead of switching on the track everywhere.
 */
interface TimedItem {
  id: string;
  start: number;
  end: number;
}

function readTrack(edl: Edl, track: ClipTrack): TimedItem[] {
  switch (track) {
    case 'sfx':
      return edl.sfx.map((c) => ({ id: c.id, start: c.atSec, end: c.atSec }));
    case 'transitions':
      return edl.transitions.map((c) => ({ id: c.id, start: c.atSec, end: c.atSec + c.durationSec }));
    default:
      return (edl[track] as Array<{ id: string; outStartSec: number; outEndSec: number }>).map((c) => ({
        id: c.id,
        start: c.outStartSec,
        end: c.outEndSec,
      }));
  }
}

function writeTime(edl: Edl, track: ClipTrack, id: string, start: number, end: number): Edl {
  if (track === 'sfx') {
    return { ...edl, sfx: edl.sfx.map((c) => (c.id === id ? { ...c, atSec: start } : c)) };
  }
  if (track === 'transitions') {
    return {
      ...edl,
      transitions: edl.transitions.map((c) =>
        c.id === id ? { ...c, atSec: start, durationSec: Math.max(0.05, end - start) } : c,
      ),
    };
  }
  const list = (edl[track] as Array<Record<string, unknown>>).map((c) =>
    c.id === id ? { ...c, outStartSec: start, outEndSec: end } : c,
  );
  return { ...edl, [track]: list } as Edl;
}

/** Tracks where two items on screen at once is incoherent rather than merely busy. */
const EXCLUSIVE_TRACKS: ClipTrack[] = ['broll', 'graphics', 'punchIns'];

/* ───────────────────────────────────────────────────── apply ─── */

export interface ApplyResult {
  edl: Edl;
  /** Operations that could not be applied, with the reason. */
  rejected: Array<{ op: EdlOperation; reason: string }>;
}

export function applyOperations(input: Edl, operations: EdlOperation[]): ApplyResult {
  let edl = input;
  const rejected: ApplyResult['rejected'] = [];

  for (const operation of operations) {
    try {
      edl = applyOne(edl, operation);
    } catch (error) {
      rejected.push({ op: operation, reason: (error as Error).message });
    }
  }

  return { edl: normalize(edl), rejected };
}

/**
 * Runs a stored document through the same tidy-up every edit ends with.
 *
 * Documents written by an older build can break invariants this one relies on —
 * two captions covering the same second, most of all, which the renderer
 * resolves by drawing whichever comes first in the array and silently losing
 * the other. Replaying an empty operation stack re-imposes the rules without
 * touching anything that was already legal, so the editor and the renderer
 * always open a document they can trust.
 *
 * Anything that will not parse is handed straight back: the caller's own error
 * path is a better place to find that out than a crash in here.
 */
export function healEdl(document: unknown): unknown {
  const parsed = EdlSchema.safeParse(document);
  return parsed.success ? applyOperations(parsed.data, []).edl : document;
}

function applyOne(edl: Edl, op: EdlOperation): Edl {
  switch (op.op) {
    /* ───────────────────────────────────────────────── segments ─── */
    case 'segment.trim': {
      const next = edl.segments.map((s) => {
        if (s.id !== op.id) return s;
        const start = op.sourceStartSec ?? s.sourceStartSec;
        const end = op.sourceEndSec ?? s.sourceEndSec;
        if (end - start < 0.08) throw new Error('A clip has to be at least 80ms long');
        if (start < 0 || end > edl.source.durationSec + 0.01) {
          throw new Error('Trimmed past the end of the footage');
        }
        return { ...s, sourceStartSec: start, sourceEndSec: end };
      });
      return relayout(edl, next);
    }

    case 'segment.split': {
      const target = edl.segments.find((s) => s.id === op.id);
      if (!target) throw new Error('Clip not found');

      // The split point arrives in output time; the cut happens in the source.
      const offset = (op.atOutSec - target.outStartSec) * target.speed;
      const at = target.sourceStartSec + offset;
      if (at - target.sourceStartSec < 0.08 || target.sourceEndSec - at < 0.08) {
        throw new Error('Too close to the edge of the clip to split');
      }

      const next: Segment[] = [];
      for (const s of edl.segments) {
        if (s.id !== op.id) {
          next.push(s);
          continue;
        }
        next.push({ ...s, sourceEndSec: at });
        next.push({ ...s, id: `${s.id}-b`, sourceStartSec: at });
      }
      return relayout(edl, next);
    }

    case 'segment.delete': {
      if (edl.segments.length <= 1) throw new Error('The last clip cannot be deleted');
      return relayout(edl, edl.segments.filter((s) => s.id !== op.id));
    }

    case 'segment.reorder': {
      const from = edl.segments.findIndex((s) => s.id === op.id);
      if (from < 0) throw new Error('Clip not found');
      const next = [...edl.segments];
      const [moved] = next.splice(from, 1);
      next.splice(Math.min(op.toIndex, next.length), 0, moved);
      return relayout(edl, next);
    }

    case 'segment.speed':
      return relayout(
        edl,
        edl.segments.map((s) => (s.id === op.id ? { ...s, speed: op.speed } : s)),
      );

    /* ──────────────────────────────────────────────────── clips ─── */
    case 'clip.move': {
      const items = readTrack(edl, op.track);
      const item = items.find((i) => i.id === op.id);
      if (!item) throw new Error('Not found on this track');

      const length = item.end - item.start;
      const placed = EXCLUSIVE_TRACKS.includes(op.track)
        ? resolveMove(items, op.id, op.outStartSec, length, edl.format.durationSec)
        : (() => {
            const start = clamp(op.outStartSec, 0, Math.max(0, edl.format.durationSec - length));
            return { start, end: start + length };
          })();
      if (!placed) throw new Error('No room on that track — shorten it or move something else first');

      return writeTime(edl, op.track, op.id, placed.start, placed.end);
    }

    case 'clip.trim': {
      const items = readTrack(edl, op.track);
      const item = items.find((i) => i.id === op.id);
      if (!item) throw new Error('Not found on this track');

      const wanted = {
        start: clamp(op.outStartSec ?? item.start, 0, edl.format.durationSec),
        end: clamp(op.outEndSec ?? item.end, 0, edl.format.durationSec),
      };
      if (wanted.end - wanted.start < 0.15) throw new Error('Too short to be visible');

      const placed = EXCLUSIVE_TRACKS.includes(op.track)
        ? resolveTrim(items, op.id, wanted.start, wanted.end, edl.format.durationSec)
        : wanted;

      return writeTime(edl, op.track, op.id, placed.start, placed.end);
    }

    case 'clip.add': {
      const id = op.id ?? `${op.track}-${Math.random().toString(36).slice(2, 8)}`;
      const wantStart = clamp(op.atSec, 0, Math.max(0, edl.format.durationSec - 0.2));
      const wantEnd = Math.min(edl.format.durationSec, wantStart + op.durationSec);

      // Added clips obey the same one-at-a-time rule as moved ones. Dropping a
      // second B-roll insert on top of the first used to leave them overlapping,
      // which the renderer resolves by drawing one over the other — so the
      // timeline showed a state the video could not be in.
      const placed = EXCLUSIVE_TRACKS.includes(op.track)
        ? resolveMove(readTrack(edl, op.track), id, wantStart, wantEnd - wantStart, edl.format.durationSec)
        : { start: wantStart, end: wantEnd };
      if (!placed) throw new Error('No room on that track at this point');
      const start = placed.start;
      const end = placed.end;

      if (op.track === 'sfx') {
        return { ...edl, sfx: [...edl.sfx, {
          id, atSec: start, sound: (op.value || 'pop') as never, gainDb: -15,
          url: `/audio/sfx/${op.value || 'pop'}.wav`,
        }] };
      }
      if (op.track === 'transitions') {
        return { ...edl, transitions: [...edl.transitions, {
          id, atSec: start, type: (op.value || 'dissolve') as never, durationSec: 0.24,
        }] };
      }
      if (op.track === 'broll') {
        // An insert with no query yet is fine — the asset stage resolves it on
        // the next render, and the user types what it should show.
        return { ...edl, broll: [...edl.broll, {
          id, outStartSec: start, outEndSec: end, kind: 'stock-video' as const,
          url: '', clipStartSec: 0, scale: 1, kenBurns: 'in' as const,
          audioGainDb: -60, opacity: 1, intent: 'Added by hand', query: op.value, attribution: undefined,
        }] };
      }
      if (op.track === 'graphics') {
        return { ...edl, graphics: [...edl.graphics, {
          id, type: op.graphicType ?? 'icon', outStartSec: start, outEndSec: end,
          animation: 'pop' as const, x: 0.76, y: 0.22, scale: 1,
          text: op.value, subtext: '', items: [], assetUrl: null,
          iconQuery: op.value, imagePrompt: '', color: edl.captionStyle.emphasisColor,
        }] };
      }
      if (op.track === 'punchIns') {
        return { ...edl, punchIns: [...edl.punchIns, {
          id, outStartSec: start, outEndSec: end, scale: 1.15,
          x: edl.reframe?.keyframes[0]?.cx ?? 0.5,
          y: edl.reframe?.keyframes[0]?.cy ?? 0.42,
          easing: 'snap' as const,
        }] };
      }
      return { ...edl, overlays: [...edl.overlays, {
        id, type: 'lower-third' as const, outStartSec: start, outEndSec: end,
        text: op.value, subtext: '', color: edl.captionStyle.emphasisColor, opacity: 1,
      }] };
    }

    case 'clip.delete': {
      if (op.track === 'sfx') return { ...edl, sfx: edl.sfx.filter((c) => c.id !== op.id) };
      if (op.track === 'transitions') {
        return { ...edl, transitions: edl.transitions.filter((c) => c.id !== op.id) };
      }
      const list = (edl[op.track] as Array<{ id: string }>).filter((c) => c.id !== op.id);
      return { ...edl, [op.track]: list } as Edl;
    }

    case 'clip.update': {
      // Only whitelisted, non-temporal fields. Time is moved with move/trim so
      // the collision rules can't be bypassed by writing outStartSec directly.
      const allowed = new Set([
        'text', 'subtext', 'items', 'query', 'intent', 'url', 'assetUrl', 'iconQuery',
        'imagePrompt', 'color', 'scale', 'opacity', 'kenBurns', 'audioGainDb',
        'clipStartSec', 'sound', 'gainDb', 'x', 'y', 'animation', 'type', 'easing',
      ]);
      const patch = Object.fromEntries(Object.entries(op.patch).filter(([k]) => allowed.has(k)));

      if (op.track === 'sfx') {
        return { ...edl, sfx: edl.sfx.map((c) => (c.id === op.id ? { ...c, ...patch } : c)) };
      }
      if (op.track === 'transitions') {
        return { ...edl, transitions: edl.transitions.map((c) => (c.id === op.id ? { ...c, ...patch } : c)) };
      }
      const list = (edl[op.track] as Array<{ id: string }>).map((c) =>
        c.id === op.id ? { ...c, ...patch } : c,
      );
      return { ...edl, [op.track]: list } as Edl;
    }

    /* ───────────────────────────────────────────────── captions ─── */
    case 'caption.text':
      return { ...edl, captions: edl.captions.map((c) => (c.id === op.id ? respell(c, op.text) : c)) };

    case 'caption.time': {
      const cue = edl.captions.find((c) => c.id === op.id);
      if (!cue) throw new Error('Caption not found');

      // Captions are a one-at-a-time track, whatever the schema says. The
      // renderer picks the first cue covering the current second, so two that
      // overlap means one silently disappears behind the other — chosen by
      // array position, which is not a decision anybody made.
      //
      // They are also a GAPLESS track: the transcript hands them over back to
      // back, so there is no free air for a cue to grow or shift into. Clamping
      // at the neighbour — the right answer for a B-roll insert — would make
      // every drag a no-op. So the neighbour gives way instead, the way a roll
      // or a slide works in an editing suite.
      const others: TimedItem[] = edl.captions.map((c) => ({ id: c.id, start: c.startSec, end: c.endSec }));
      const wantedEnd = Math.max(op.startSec + MIN_CUE_SEC, op.endSec);
      const keptLength = Math.abs((wantedEnd - op.startSec) - (cue.endSec - cue.startSec)) < 1e-3;

      const placed = keptLength
        ? resolveCaptionSlide(others, op.id, op.startSec, edl.format.durationSec)
        : resolveCaptionEdge(others, op.id, op.startSec, wantedEnd, edl.format.durationSec);

      return {
        ...edl,
        captions: edl.captions.map((c) => {
          if (c.id === op.id) return retimeCue(c, placed.start, placed.end);
          const neighbour = placed.moved.get(c.id);
          return neighbour ? retimeCue(c, neighbour.start, neighbour.end) : c;
        }),
      };
    }

    case 'caption.emphasis':
      return {
        ...edl,
        captions: edl.captions.map((c) =>
          c.id === op.id
            ? { ...c, words: c.words.map((w, i) => (i === op.wordIndex ? { ...w, emphasis: op.emphasis } : w)) }
            : c,
        ),
      };

    case 'caption.wordStyle':
      return {
        ...edl,
        captions: edl.captions.map((c) =>
          c.id === op.id
            ? {
                ...c,
                words: c.words.map((w, i) => {
                  if (i !== op.wordIndex) return w;
                  // null clears the lot; anything else merges, so two separate
                  // decisions about the same word do not overwrite each other.
                  if (op.style === null) return { ...w, style: null };
                  return { ...w, style: { ...(w.style ?? {}), ...op.style } };
                }),
              }
            : c,
        ),
      };

    case 'caption.delete':
      return { ...edl, captions: edl.captions.filter((c) => c.id !== op.id) };

    /* ─────────────────────────────────────────────────── global ─── */
    case 'captionStyle.set': {
      const style = { ...edl.captionStyle, ...op.patch };
      const captions =
        op.patch.uppercase === undefined
          ? edl.captions
          : edl.captions.map((c) => ({
              ...c,
              words: c.words.map((w) => ({
                ...w,
                text: op.patch.uppercase ? w.text.toUpperCase() : w.text.toLowerCase(),
              })),
            }));
      return { ...edl, captionStyle: style, captions };
    }

    case 'music.gain':
      if (!edl.music) throw new Error('No music track');
      return { ...edl, music: { ...edl.music, gainDb: op.gainDb } };

    case 'music.remove':
      return { ...edl, music: null };

    case 'transition.set':
      return {
        ...edl,
        transitions: edl.transitions.map((t) => (t.id === op.id ? { ...t, type: op.type } : t)),
      };
  }
}

/* ─────────────────────────────────────────────────── re-timing ─── */

/**
 * Re-lays the cut and drags every cue along with it.
 *
 * This is the function that makes manual trimming safe. Read the comment at the
 * top of the file for why it works the way it does.
 */
export function relayout(edl: Edl, nextSegments: Segment[]): Edl {
  const before = new TimeMapper(edl.segments);

  const laid = layoutSegments(
    nextSegments.map((s) => ({
      sourceStartSec: s.sourceStartSec,
      sourceEndSec: s.sourceEndSec,
      speed: s.speed,
      reason: s.reason,
      text: s.text,
    })),
  ).map((s, i) => ({ ...s, id: nextSegments[i]?.id ?? s.id }));

  if (!laid.length) throw new Error('That would leave nothing in the video');

  const after = new TimeMapper(laid);
  const durationSec = after.outputDuration;
  const afterById = new Map(laid.map((s) => [s.id, s]));

  /**
   * Which segment an output timestamp belongs to, and where it sits in the
   * source.
   *
   * The bias is the whole point. A timestamp that lands exactly on a cut is a
   * member of BOTH neighbouring segments by the arithmetic, and picking the
   * wrong one used to be harmless — segments stayed in order, so either answer
   * gave the same source time. Reordering broke that: the two segments are now
   * in different places, and a caption whose first word began exactly on a cut
   * was carried off with the wrong one, landing on top of a cue that was
   * already there. Two captions on screen at once means the renderer picks one
   * by array position and the other silently never appears.
   *
   * So an interval's start belongs to the segment it opens, and its end to the
   * segment it closes.
   */
  const locate = (outSec: number, edge: 'start' | 'end') => {
    const nudge = edge === 'end' ? -1e-4 : 0;
    const seg = before.segmentAt(outSec + nudge) ?? before.segmentAt(outSec - nudge);
    if (!seg) return null;
    return { seg, sourceSec: seg.sourceStartSec + (outSec - seg.outStartSec) * seg.speed };
  };

  /** A source timestamp's new home, preferring the segment it came from. */
  const place = (sourceSec: number, cameFrom: string): number | null => {
    const holds = (s: Segment) => sourceSec >= s.sourceStartSec - 1e-6 && sourceSec <= s.sourceEndSec + 1e-6;
    const at = (s: Segment) => s.outStartSec + (sourceSec - s.sourceStartSec) / s.speed;

    const same = afterById.get(cameFrom);
    if (same && holds(same)) return at(same);
    // A split leaves the second half under a new id, so fall back to a search.
    const found = laid.find(holds);
    return found ? at(found) : null;
  };

  /** Output → output, carried by the segment the timestamp belongs to. */
  const move = (outSec: number, edge: 'start' | 'end' = 'start'): number | null => {
    const found = locate(outSec, edge);
    return found ? place(found.sourceSec, found.seg.id) : null;
  };

  const moveSpan = (start: number, end: number): { start: number; end: number } | null => {
    const a = move(start, 'start');
    const b = move(end, 'end');
    if (a === null && b === null) return null;

    // One end surviving is enough — the cue shortens rather than disappearing.
    const lo = a ?? move(Math.min(end, start + 0.03), 'start') ?? 0;
    // A span whose ends came to rest in segments that are no longer next to
    // each other has been torn in half by a reorder. Keep the half that starts
    // it, at its original length, rather than stretching the cue across
    // everything that now sits in between.
    const hi = b !== null && b > lo ? b : lo + Math.max(0.2, end - start);

    if (hi - lo < 0.05) return null;
    return { start: clamp(lo, 0, durationSec), end: clamp(hi, 0, durationSec) };
  };

  const remapList = <T extends { outStartSec: number; outEndSec: number }>(list: T[]): T[] =>
    list.flatMap((item) => {
      const span = moveSpan(item.outStartSec, item.outEndSec);
      return span ? [{ ...item, outStartSec: span.start, outEndSec: span.end }] : [];
    });

  return {
    ...edl,
    segments: laid,
    format: { ...edl.format, durationSec },

    // Captions are re-timed word by word: a trim that removes half a sentence
    // should take exactly those words with it.
    captions: edl.captions.flatMap((cue) => {
      const words = cue.words.flatMap((w) => {
        const span = moveSpan(w.startSec, w.endSec);
        return span ? [{ ...w, startSec: span.start, endSec: span.end }] : [];
      });
      if (!words.length) return [];
      return [{ ...cue, words, startSec: words[0].startSec, endSec: words[words.length - 1].endSec }];
    }),

    broll: remapList(edl.broll),
    graphics: remapList(edl.graphics),
    overlays: edl.overlays.flatMap((o) => {
      // Full-length furniture (progress bar, grain, vignette) just restretches.
      if (o.outStartSec <= 0.01 && o.outEndSec >= edl.format.durationSec - 0.01) {
        return [{ ...o, outStartSec: 0, outEndSec: durationSec }];
      }
      const span = moveSpan(o.outStartSec, o.outEndSec);
      return span ? [{ ...o, outStartSec: span.start, outEndSec: span.end }] : [];
    }),
    punchIns: remapList(edl.punchIns),

    sfx: edl.sfx.flatMap((c) => {
      const at = move(c.atSec);
      return at === null ? [] : [{ ...c, atSec: at }];
    }),

    // Transitions are regenerated rather than moved: an edit changes WHERE the
    // visible seams are, and a transition decorating a seam that no longer
    // exists is the exact tell of an automated edit we work to avoid.
    transitions: regenerateTransitions(edl, after, durationSec),

    reframe: edl.reframe
      ? {
          ...edl.reframe,
          keyframes: edl.reframe.keyframes.flatMap((k) => {
            const at = move(k.outSec);
            return at === null ? [] : [{ ...k, outSec: at }];
          }),
        }
      : null,

    music: edl.music
      ? { ...edl.music, fadeOutSec: Math.min(edl.music.fadeOutSec, Math.max(0.2, durationSec * 0.12)) }
      : null,

    deliverable: {
      ...edl.deliverable,
      thumbnailAtSec: clamp(move(edl.deliverable.thumbnailAtSec) ?? durationSec * 0.3, 0, durationSec),
      chapters: edl.deliverable.chapters.flatMap((c) => {
        const at = move(c.atSec);
        return at === null ? [] : [{ ...c, atSec: at }];
      }),
    },
  };
}

function regenerateTransitions(edl: Edl, after: TimeMapper, durationSec: number) {
  const cuts = after.cutPoints();
  const palette = edl.transitions.length
    ? [...new Set(edl.transitions.map((t) => t.type))]
    : [];
  if (!palette.length) return [];

  return cuts
    .filter((atSec) => atSec > 0.4 && atSec < durationSec - 0.4)
    .map((atSec, i) => ({
      id: `transition-${i}`,
      atSec,
      type: palette[i % palette.length],
      durationSec: edl.transitions[0]?.durationSec ?? 0.24,
    }));
}

/* ─────────────────────────────────────────────────── helpers ─── */

/**
 * Rewrites a caption's words while keeping its timing, distributing the span in
 * proportion to word length — "extraordinarily" genuinely takes longer to say
 * than "a", and an even split reads as out of sync.
 */
function respell(cue: CaptionCue, text: string): CaptionCue {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return cue;

  const total = words.reduce((sum, w) => sum + w.length, 0) || 1;
  const span = cue.endSec - cue.startSec;
  let cursor = cue.startSec;

  return {
    ...cue,
    words: words.map((word, i) => {
      const start = cursor;
      cursor += (word.length / total) * span;
      return {
        text: word,
        startSec: start,
        endSec: i === words.length - 1 ? cue.endSec : cursor,
        emphasis: cue.words[i]?.emphasis ?? false,
      };
    }),
  };
}

/** Moves a whole cue, keeping the relative rhythm of its words. */
function retimeCue(cue: CaptionCue, startSec: number, endSec: number): CaptionCue {
  const oldSpan = cue.endSec - cue.startSec || 1;
  const scale = (endSec - startSec) / oldSpan;

  return {
    ...cue,
    startSec,
    endSec,
    words: cue.words.map((w) => ({
      ...w,
      startSec: startSec + (w.startSec - cue.startSec) * scale,
      endSec: startSec + (w.endSec - cue.startSec) * scale,
    })),
  };
}

/**
 * Where a clip being MOVED actually lands on a track that allows only one thing
 * at a time.
 *
 * The old version pushed the clip clear of whatever it hit, up to four times,
 * and then gave up. Giving up meant returning a position that still overlapped
 * — which happens whenever the push direction runs out of room, most obviously
 * when you drop something near the end of the video. The timeline then showed
 * two B-roll inserts on top of each other, a state the renderer resolves by
 * drawing one over the other, so what you saw was not what you would get.
 *
 * Now the gaps are enumerated and the clip goes to the nearest one that can
 * actually hold it. If none can, the move is refused with a reason, which is
 * the honest answer and the one a person can act on.
 */
function resolveMove(
  items: TimedItem[],
  id: string,
  start: number,
  length: number,
  durationSec: number,
): { start: number; end: number } | null {
  const others = items.filter((i) => i.id !== id);
  const latest = Math.max(0, durationSec - length);
  const wanted = clamp(start, 0, latest);

  const clashes = (at: number) =>
    others.some((o) => at < o.end - 1e-3 && at + length > o.start + 1e-3);

  if (!clashes(wanted)) return { start: wanted, end: wanted + length };

  let best: number | null = null;
  let bestGap = Infinity;
  for (const [lo, hi] of freeSlots(others, length, durationSec)) {
    const landed = clamp(wanted, lo, hi);
    const gap = Math.abs(landed - wanted);
    if (gap < bestGap) { bestGap = gap; best = landed; }
  }

  return best === null ? null : { start: best, end: best + length };
}

/**
 * Every range of start times where a clip of a given length fits between the
 * others, as [earliest, latest] pairs. Includes the space before the first clip
 * and after the last.
 */
function freeSlots(
  others: TimedItem[],
  length: number,
  durationSec: number,
): Array<[number, number]> {
  const sorted = [...others].sort((a, b) => a.start - b.start);
  const slots: Array<[number, number]> = [];
  let cursor = 0;

  for (const other of sorted) {
    if (other.start - cursor >= length - 1e-6) slots.push([cursor, other.start - length]);
    cursor = Math.max(cursor, other.end);
  }
  if (durationSec - cursor >= length - 1e-6) slots.push([cursor, durationSec - length]);

  return slots;
}

/** The cue immediately before and after this one, if any. */
function captionNeighbours(others: TimedItem[], me: TimedItem) {
  const prev = others.filter((o) => o.end <= me.start + ROLL_TOL_SEC).sort((a, b) => b.end - a.end)[0] ?? null;
  const next = others.filter((o) => o.start >= me.end - ROLL_TOL_SEC).sort((a, b) => a.start - b.start)[0] ?? null;
  return {
    prev,
    next,
    touchesPrev: prev !== null && me.start - prev.end <= ROLL_TOL_SEC,
    touchesNext: next !== null && next.start - me.end <= ROLL_TOL_SEC,
  };
}

/**
 * Where a whole caption lands when it is dragged, and what that does to the
 * cues on either side.
 *
 * This is a slide: the cue keeps its length and its place in the running order,
 * and the neighbours it is touching absorb the shift — the one behind stretches
 * by however far it went, the one ahead gives up the same. That keeps the track
 * gapless, which is the point: a hole in the caption track is a stretch of
 * speech with nothing on screen.
 *
 * It travels until a touching neighbour is down to MIN_CUE_SEC, or until it
 * meets a cue across a real gap — and then it stops there rather than leaping to
 * some distant patch of free time, because a caption that teleports out from
 * under the cursor is not something anybody asked for.
 */
function resolveCaptionSlide(
  items: TimedItem[],
  id: string,
  wantStart: number,
  durationSec: number,
): CaptionPlacement {
  const me = items.find((i) => i.id === id);
  if (!me) throw new Error('Caption not found');

  const others = items.filter((i) => i.id !== id);
  const { prev, next, touchesPrev, touchesNext } = captionNeighbours(others, me);
  const length = me.end - me.start;

  const earliest = prev === null ? 0 : touchesPrev ? prev.start + MIN_CUE_SEC : prev.end;
  const latest = (next === null ? durationSec : touchesNext ? next.end - MIN_CUE_SEC : next.start) - length;

  const start = clamp(wantStart, Math.min(earliest, latest), Math.max(earliest, latest));
  const end = start + length;

  const moved = new Map<string, TimedItem>();
  if (prev && touchesPrev && Math.abs(start - me.start) > 1e-6) moved.set(prev.id, { ...prev, end: start });
  if (next && touchesNext && Math.abs(end - me.end) > 1e-6) moved.set(next.id, { ...next, start: end });

  return { start, end, moved };
}

/** A caption's new span, plus whatever it pushed out of the way getting there. */
interface CaptionPlacement {
  start: number;
  end: number;
  moved: Map<string, TimedItem>;
}

/** Shortest a caption may be before it stops being readable. */
const MIN_CUE_SEC = 0.15;

/**
 * How close two cues must be to count as touching, and so to roll together.
 * Speech recognition hands back cues that abut to the microsecond; a tenth of
 * a second is loose enough to survive a round-trip through the UI and tight
 * enough that a deliberate gap is still a gap.
 */
const ROLL_TOL_SEC = 0.1;

/**
 * Where a caption's dragged edge lands, and what it does to the cue next door.
 *
 * Captions arrive from the transcript back to back, so clamping an edge at its
 * neighbour — the right answer for a B-roll insert — means dragging a caption's
 * end does nothing at all: there is never any free air to grow into. Editors
 * solve this with a roll: drag the boundary between two touching clips and both
 * edges move, the pair keeping their combined length.
 *
 * So that is what happens here. An edge dragged into a cue that is TOUCHING
 * this one takes the boundary with it, stopping when the neighbour is down to
 * MIN_CUE_SEC. An edge dragged at a cue across a real gap still clamps, because
 * there the gap is something somebody chose.
 */
function resolveCaptionEdge(
  items: TimedItem[],
  id: string,
  wantStart: number,
  wantEnd: number,
  durationSec: number,
): CaptionPlacement {
  const me = items.find((i) => i.id === id);
  if (!me) throw new Error('Caption not found');

  const others = items.filter((i) => i.id !== id);
  const moved = new Map<string, TimedItem>();

  let lo = clamp(wantStart, 0, durationSec);
  let hi = clamp(wantEnd, 0, durationSec);

  if (lo < me.start - 1e-6) {
    const prev = others.filter((o) => o.end <= me.start + ROLL_TOL_SEC).sort((a, b) => b.end - a.end)[0];
    if (prev && lo < prev.end - 1e-6) {
      if (me.start - prev.end <= ROLL_TOL_SEC) {
        lo = Math.max(lo, prev.start + MIN_CUE_SEC);
        moved.set(prev.id, { ...prev, end: lo });
      } else {
        lo = prev.end;
      }
    }
  }

  if (hi > me.end + 1e-6) {
    const next = others.filter((o) => o.start >= me.end - ROLL_TOL_SEC).sort((a, b) => a.start - b.start)[0];
    if (next && hi > next.start + 1e-6) {
      if (next.start - me.end <= ROLL_TOL_SEC) {
        hi = Math.min(hi, next.end - MIN_CUE_SEC);
        moved.set(next.id, { ...next, start: hi });
      } else {
        hi = next.start;
      }
    }
  }

  if (hi < lo + MIN_CUE_SEC) hi = lo + MIN_CUE_SEC;
  return { start: lo, end: hi, moved };
}

/**
 * Collision for a clip being TRIMMED.
 *
 * Here only the dragged edge may move — pushing the whole clip because its edge
 * met a neighbour would feel like the timeline fighting you. Each edge is
 * clamped to the neighbour it ran into.
 */
function resolveTrim(
  items: TimedItem[],
  id: string,
  start: number,
  end: number,
  durationSec: number,
): { start: number; end: number } {
  const others = items.filter((i) => i.id !== id);
  let lo = clamp(start, 0, durationSec);
  let hi = clamp(end, 0, durationSec);

  for (const other of others) {
    if (other.end <= lo + 1e-3 || other.start >= hi - 1e-3) continue;
    if (other.start <= lo) lo = Math.max(lo, other.end);
    else hi = Math.min(hi, other.start);
  }

  return { start: lo, end: Math.max(lo + 0.15, hi) };
}

/**
 * Last line of defence for the caption track.
 *
 * The renderer draws the FIRST cue covering the current second, so two that
 * overlap means one of them silently never appears — and which one is decided
 * by array position, which is nobody's decision. Every operation above already
 * keeps the track clear; this catches anything that arrives from outside them
 * (an older document, a hand-written EDL, a pipeline change) by trimming the
 * overhang off the cue that started first. A cue trimmed to nothing is dropped:
 * it was never going to be on screen anyway.
 */
function deoverlap(sorted: CaptionCue[]): CaptionCue[] {
  const out: CaptionCue[] = [];

  for (const cue of sorted) {
    const previous = out[out.length - 1];
    if (previous && cue.startSec < previous.endSec - 1e-6) {
      if (cue.startSec - previous.startSec < 0.05) {
        out.pop();
      } else {
        out[out.length - 1] = retimeCue(previous, previous.startSec, cue.startSec);
      }
    }
    out.push(cue);
  }

  return out;
}

/** Final tidy so the document always satisfies the renderer's assumptions. */
function normalize(edl: Edl): Edl {
  const d = edl.format.durationSec;
  const inRange = <T extends { outStartSec: number; outEndSec: number }>(list: T[]) =>
    list
      .filter((c) => c.outEndSec > 0.01 && c.outStartSec < d - 0.01 && c.outEndSec > c.outStartSec)
      .sort((a, b) => a.outStartSec - b.outStartSec);

  return {
    ...edl,
    captions: deoverlap(edl.captions.filter((c) => c.words.length > 0).sort((a, b) => a.startSec - b.startSec)),
    broll: inRange(edl.broll),
    graphics: inRange(edl.graphics),
    overlays: inRange(edl.overlays),
    punchIns: inRange(edl.punchIns),
    sfx: edl.sfx.filter((c) => c.atSec >= 0 && c.atSec <= d).sort((a, b) => a.atSec - b.atSec),
    transitions: edl.transitions.filter((t) => t.atSec > 0 && t.atSec < d).sort((a, b) => a.atSec - b.atSec),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/* ───────────────────────────────────────────── human summaries ─── */

/** One-line description of an operation, for the undo stack in the UI. */
export function describeOperation(op: EdlOperation): string {
  switch (op.op) {
    case 'segment.trim': return 'Trimmed a clip';
    case 'segment.split': return 'Split a clip';
    case 'segment.delete': return 'Deleted a clip';
    case 'segment.reorder': return 'Reordered clips';
    case 'segment.speed': return `Set clip speed to ${op.speed}×`;
    case 'clip.move': return `Moved ${trackNoun(op.track)}`;
    case 'clip.trim': return `Trimmed ${trackNoun(op.track)}`;
    case 'clip.add': return `Added ${trackNoun(op.track)}`;
    case 'clip.delete': return `Deleted ${trackNoun(op.track)}`;
    case 'clip.update': return `Changed ${trackNoun(op.track)}`;
    case 'caption.text': return 'Edited a caption';
    case 'caption.time': return 'Retimed a caption';
    case 'caption.emphasis': return op.emphasis ? 'Emphasised a word' : 'Removed emphasis';
    case 'caption.wordStyle': return op.style === null ? 'Reset a word\u2019s style' : 'Styled a word';
    case 'caption.delete': return 'Deleted a caption';
    case 'captionStyle.set': return 'Changed the caption style';
    case 'music.gain': return 'Changed the music level';
    case 'music.remove': return 'Removed the music';
    case 'transition.set': return `Changed a transition to ${op.type}`;
  }
}

function trackNoun(track: ClipTrack): string {
  switch (track) {
    case 'broll': return 'a B-roll insert';
    case 'graphics': return 'a graphic';
    case 'overlays': return 'an overlay';
    case 'punchIns': return 'a punch-in';
    case 'sfx': return 'a sound effect';
    case 'transitions': return 'a transition';
  }
}
