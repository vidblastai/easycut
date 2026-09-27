import type { TimeMapper } from '@/lib/timeline/time-mapper';
import type { Transcript } from '@/lib/transcribe/types';
import type { AnimatedScene, BrollClip, SceneKind } from './types';

/**
 * One scene, guaranteed, without asking a model anything.
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 *
 * The scene pass is a judgement call made by a language model, and a judgement
 * call has a failure mode a deterministic step does not: it can decline. Over
 * several rounds of real use it declined on footage that plainly had something
 * in it, and every time the result was the same — a talking head with captions
 * on it, which is the thing this product exists to stop shipping.
 *
 * So the model decides WHERE a scene goes and WHAT is in it, and this decides
 * that there is one. If the pass returns nothing, or returns something that
 * does not survive being placed on the cut timeline, this picks the best
 * passage it can find by reading the transcript and builds a scene from the
 * speaker's own words. It is not as good as the model's choice. It is
 * enormously better than no animation at all, which is the alternative it is
 * actually competing with.
 *
 * It reads the same six shapes, in the order they are worth having:
 *
 *   big-number  a sentence carrying a figure
 *   orbit       a run of three or more comma-separated things
 *   kinetic-text  the most quotable short line in the video
 */

/** Same guards the model's scenes are held to, so both arrive equal. */
const HOOK_SEC = 2.5;
const MIN_SEC = 2.4;
const MAX_SEC = 5.5;

interface Candidate {
  kind: SceneKind;
  headline: string;
  items: string[];
  iconQueries: string[];
  startSec: number;
  endSec: number;
  /** Higher is better. */
  score: number;
}

const FILLER = /^(so|um|uh|like|and|but|okay|right|yeah|well|i mean)\b/i;

/** Strip the throat-clearing off the front of a line. */
function tidy(text: string): string {
  let out = text.trim().replace(/^[^\w"']+/, '');
  while (FILLER.test(out)) out = out.replace(FILLER, '').replace(/^[\s,]+/, '');
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Pull a list of things, and the line that frames them, out of one sentence.
 *
 * People say these two ways round, and both have to work:
 *
 *   "captions, the b-roll, the effects, everything you see was done by AI"
 *    ^ the things                       ^ the framing, at the end
 *
 *   "you can eat the leaves, the stem, and the flowers"
 *    ^ the framing, at the front, welded onto the first thing
 *
 * So the long part is the headline wherever it sits, the short parts are the
 * items, and a leading stem ("you can eat") is peeled off the first item and
 * promoted. Getting this wrong is what made an orbit whose title was the word
 * "Captions".
 */
function listedThings(text: string): { headline: string; items: string[] } | null {
  const body = text.replace(/[.!?]+$/, '');
  if (!body.includes(',')) return null;

  const parts = body
    .split(/,|\s+and\s+(?=[^,]*$)/)
    .map((part) => tidy(part).replace(/^(and|or)\s+/i, '').trim())
    .filter(Boolean);
  if (parts.length < 3) return null;

  const isShort = (part: string) => part.split(/\s+/).length <= 5;
  let headline = '';
  let items = [...parts];

  // A long tail clause frames the list from behind.
  if (!isShort(items[items.length - 1]) && items.length > 3) {
    headline = items.pop()!;
  }

  // Otherwise the stem is welded to the front of the first item: "you can eat
  // the leaves" is a frame plus a thing, not a thing.
  if (!headline) {
    const stem = items[0].match(/^((?:you|we|i|they|it)\s+\w+(?:\s+\w+)?)\s+(.*)$/i);
    if (stem) {
      headline = stem[1];
      items[0] = stem[2];
    }
  }

  items = items.filter((part) => part.length >= 2 && isShort(part)).slice(0, 5);
  if (items.length < 3) return null;

  return { headline: headline || items.join(' · '), items };
}

/*
 * Numbers as people actually say them.
 *
 * Speech-to-text writes what was spoken, so "it took me eleven minutes" comes
 * through as a word, not a digit — and a matcher that only looked for digits
 * walked past every figure in a normally-spoken sentence.
 */
const SPOKEN: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, hundred: 100, thousand: 1000, million: 1_000_000,
};
const UNIT = '%|percent|x|k|m|million|billion|minutes?|seconds?|hours?|days?|weeks?|months?|years?|dollars?|times';
const NUMBER = new RegExp(`\\b(\\d[\\d.,]*|${Object.keys(SPOKEN).join('|')})\\s*(${UNIT})?\\b`, 'i');

/** The figure as a number, whether it was written or spoken. */
function figureValue(token: string): number {
  const digits = parseFloat(token.replace(/,/g, ''));
  return Number.isFinite(digits) ? digits : (SPOKEN[token.toLowerCase()] ?? NaN);
}

function shapeOf(text: string): { kind: SceneKind; headline: string; items: string[]; bonus: number } | null {
  const clean = tidy(text);
  if (clean.split(/\s+/).length < 3) return null;

  const listed = listedThings(clean);
  if (listed) {
    return { kind: 'orbit', headline: listed.headline.slice(0, 60), items: listed.items, bonus: 40 };
  }

  const figure = clean.match(NUMBER);
  if (figure && Number.isFinite(figureValue(figure[1]))) {
    // The words either side of the figure say what it counts.
    const label = clean.replace(NUMBER, '').replace(/\s+/g, ' ').trim();
    return {
      kind: 'big-number',
      // Written as a numeral even when it was spoken as a word: the whole point
      // of a big-number scene is a figure you can read at a glance.
      headline: `${figureValue(figure[1])}${figure[2] ? ' ' + figure[2] : ''}`,
      items: [label.slice(0, 48)],
      bonus: 30,
    };
  }

  // Anything else is worth saying as itself, if it is short enough to read.
  const words = clean.split(/\s+/);
  if (words.length > 12) return null;
  return { kind: 'kinetic-text', headline: clean, items: [], bonus: 0 };
}

/**
 * Pick the one passage this video would most miss if nothing were drawn.
 *
 * Everything is measured in OUTPUT time — the cut has already happened by the
 * time this runs, so a sentence's real position is where the mapper puts it,
 * not where it was said.
 */
export function fallbackScene(
  transcript: Transcript,
  mapper: TimeMapper,
  durationSec: number,
  broll: BrollClip[],
  accent: string,
): AnimatedScene | null {
  const sentences = transcript.sentences ?? [];
  if (!sentences.length) return null;

  const candidates: Candidate[] = [];

  for (const sentence of sentences) {
    const shape = shapeOf(sentence.text);
    if (!shape) continue;

    const start = Math.max(HOOK_SEC, mapper.toOutputClamped(sentence.startSec));
    const spoken = Math.min(durationSec - 0.3, mapper.toOutputClamped(sentence.endSec));
    if (spoken <= start) continue;

    /*
     * A scene lasts long enough to read, even when the line was said quickly.
     *
     * Holding every candidate to the minimum as SPOKEN threw away whole
     * videos: "it took me eleven minutes" takes under two seconds to say, and
     * requiring 2.4 of them meant a fast talker got no scene at all. The line
     * sets where the scene starts; how long it stays is the renderer's
     * business, so the window borrows from the pause after it.
     */
    const end = Math.min(durationSec - 0.3, Math.max(spoken, start + MIN_SEC));
    if (end - start < MIN_SEC) continue;
    if (broll.some((b) => start < b.outEndSec && end > b.outStartSec)) continue;

    candidates.push({
      kind: shape.kind,
      headline: shape.headline,
      items: shape.items,
      iconQueries: shape.items.map(() => ''),
      startSec: start,
      endSec: Math.min(end, start + MAX_SEC),
      // Shape first, then how far in it is: the middle of a video is where the
      // attention dips and where an animation earns the most.
      score: shape.bonus + Math.min(20, (start / Math.max(1, durationSec)) * 20),
    });
  }

  if (!candidates.length) return null;
  const best = candidates.sort((a, b) => b.score - a.score)[0];

  return {
    id: 'scene-fallback',
    outStartSec: best.startSec,
    outEndSec: best.endSec,
    kind: best.kind,
    backdrop: best.kind === 'big-number' ? 'rays' : 'gradient',
    headline: best.headline,
    items: best.items,
    iconQueries: best.iconQueries,
    iconSvgs: best.items.map(() => null),
    accent,
    reason: 'Chosen from the transcript because the scene pass returned nothing placeable.',
  };
}
