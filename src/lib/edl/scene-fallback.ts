import type { TimeMapper } from '@/lib/timeline/time-mapper';
import { deriveSentences, type Transcript } from '@/lib/transcribe/types';
import type { AnimatedScene, BrollClip, SceneKind, SceneLook } from './types';
import { trimToWords } from '@/lib/text';

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
  fifty: 50, sixty: 60,
};

/**
 * The words that MULTIPLY the one before them.
 *
 * Separated from the plain number words because they behave differently, and
 * lumping them together is what made "one hundred dollars" come out as the
 * figure 1: the matcher found "one", stopped, and never looked at the word
 * doing all the work. "three thousand users" was 3 for the same reason.
 */
const SCALE: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000, billion: 1_000_000_000 };

const UNIT = '%|percent|x|k|m|minutes?|seconds?|hours?|days?|weeks?|months?|years?|dollars?|times';
/**
 * The unit, if there is one, and NOT a word boundary after it.
 *
 * `\b` after an optional group is the trap: for "40%" the boundary has to fall
 * between "%" and a space, and both are non-word characters, so there is no
 * boundary there at all. The group backtracked to empty and the match ended
 * after "40" — which put the figure on screen as a bare 40 and left the "%"
 * stranded in the sentence underneath it ("revenue grew % this quarter"). A
 * lookahead for a letter does the job the boundary was meant to do — stop
 * "day" matching inside "daylight" — without needing one to exist.
 */
const UNIT_TAIL = `(?:\\s*(${UNIT})(?![a-z]))?`;

const NUMBER = new RegExp(
  `\\b(\\d[\\d.,]*|${Object.keys(SPOKEN).join('|')})` +
    `(?:\\s+(${Object.keys(SCALE).join('|')}))?` +
    UNIT_TAIL,
  'i',
);

/** A scale word standing on its own — "hundreds of hours", "a million times". */
const BARE_SCALE = new RegExp(`\\b(${Object.keys(SCALE).join('|')})${UNIT_TAIL}`, 'i');

/** The figure as a number, whether it was written, spoken, or both. */
function figureValue(token: string, scale?: string): number {
  const digits = parseFloat(token.replace(/,/g, ''));
  const base = Number.isFinite(digits) ? digits : (SPOKEN[token.toLowerCase()] ?? SCALE[token.toLowerCase()] ?? NaN);
  if (!Number.isFinite(base)) return NaN;
  return scale ? base * (SCALE[scale.toLowerCase()] ?? 1) : base;
}

/**
 * The units that are written as SUFFIXES, with no space.
 *
 * "40%", "2.5x", "10k" — these are part of the figure. "40 minutes" is a
 * figure and a word, and the space is the difference between a statistic and a
 * typo at the size these are drawn.
 */
const SUFFIX_UNITS = new Set(['%', 'x', 'k', 'm']);

/** The figure as it should be set. */
function figureLabel(value: number, unit: string | undefined): string {
  const figure = value.toLocaleString('en-GB');
  if (!unit) return figure;
  return SUFFIX_UNITS.has(unit.toLowerCase()) ? `${figure}${unit}` : `${figure} ${unit}`;
}

/**
 * Whether a figure is worth building a whole scene around.
 *
 * A big-number scene exists to put ONE number on the screen at a size you can
 * read across a room. "1" is not that. Spoken English uses "one" as a pronoun
 * far more often than as a quantity — "the one you picked", "no one showed up"
 * — and every one of those produced a full-frame scene shouting a figure that
 * carried none of the sentence's meaning, with the word torn out of the middle
 * of the line underneath it.
 *
 * A unit rescues it, because "one minute" is a measurement and reads as one.
 */
function figureIsWorthIt(value: number, unit: string | undefined, spokenAs: string): boolean {
  if (!Number.isFinite(value)) return false;
  if (unit) return true;
  // A digit is somebody being deliberate: "1%" was typed as a figure.
  if (/^\d/.test(spokenAs)) return true;
  return Math.abs(value) >= 2;
}

/**
 * Exported for the tests, which is worth the export: the figure matcher is the
 * part of this file with the most ways to be quietly wrong, and every one of
 * them reaches the screen as a full-frame scene.
 */
export function shapeOf(text: string): { kind: SceneKind; headline: string; items: string[]; bonus: number } | null {
  const clean = tidy(text);
  if (clean.split(/\s+/).length < 3) return null;

  const listed = listedThings(clean);
  if (listed) {
    // Trimmed to a plate's worth. A nine-word title in the middle of an orbit
    // stacks to five lines and grows into the chips either side of it.
    const title = listed.headline.split(/\s+/).slice(0, 6).join(' ');
    return { kind: 'orbit', headline: title, items: listed.items, bonus: 40 };
  }

  // A compound first — "one hundred dollars" — then a scale word on its own.
  const figure = clean.match(NUMBER) ?? clean.match(BARE_SCALE);
  if (figure) {
    const compound = figure.length > 3;
    const scale = compound ? figure[2] : undefined;
    const unit = compound ? figure[3] : figure[2];
    const value = figureValue(figure[1], scale);

    if (figureIsWorthIt(value, unit, figure[1])) {
      // The words either side of the figure say what it counts.
      const label = clean.replace(figure[0], ' ').replace(/\s+/g, ' ').trim();
      return {
        kind: 'big-number',
        // Written as a numeral even when it was spoken as a word: the whole
        // point of a big-number scene is a figure you can read at a glance.
        headline: figureLabel(value, unit),
        // Whole words: a plain character cut put "…but the you picke" on screen.
        items: [trimToWords(label, 48)],
        bonus: 30,
      };
    }
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
  /** The world to draw it in. A rescued scene still belongs to the style. */
  look: SceneLook = 'studio',
): AnimatedScene | null {
  /*
   * Derive the sentences if the transcript arrived without them.
   *
   * Every provider is supposed to fill this in, and returning null when one
   * did not was the last silent way for a video to end up with no scene: no
   * error, no log line, just nothing. Words are always there, and grouping
   * them is the same work the transcribers do.
   */
  const sentences = transcript.sentences?.length
    ? transcript.sentences
    : deriveSentences(transcript.words ?? []);
  if (!sentences.length) return null;

  const candidates: Candidate[] = [];

  /*
   * The hook is a share of the video, not a fixed two and a half seconds.
   *
   * On a twenty-second video those seconds are the speaker earning attention
   * and a scene has no business there. On a six-second one they are half the
   * film, and protecting them plus requiring a readable 2.4 seconds leaves
   * nowhere legal to put anything — so the clip gets no scene for a reason
   * that has nothing to do with what is in it.
   */
  const hook = Math.min(HOOK_SEC, durationSec * 0.15);

  for (const sentence of sentences) {
    const shape = shapeOf(sentence.text);
    if (!shape) continue;

    const start = Math.max(hook, mapper.toOutputClamped(sentence.startSec));
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
    // Null, so the look's own entry decides. The rescued scene is the one
    // nobody chose; it should not also be the one that arrives differently.
    enter: null,
    exit: null,
    kind: best.kind,
    look,
    backdrop: best.kind === 'big-number' ? 'rays' : 'gradient',
    headline: best.headline,
    items: best.items,
    iconQueries: best.iconQueries,
    iconSvgs: best.items.map(() => null),
    art: null,
    accent,
    reason: 'Chosen from the transcript because the scene pass returned nothing placeable.',
  };
}
