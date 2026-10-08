import { ENGLISH } from '@/lib/lang/en';
import { packFor } from '@/lib/lang';
/**
 * Normalised transcript shape. Every ASR provider adapter converts into this,
 * so nothing downstream knows or cares which vendor produced it.
 */

export interface TranscriptWord {
  text: string;
  /** Seconds into the SOURCE file. */
  startSec: number;
  endSec: number;
  confidence: number;
  speaker: number;
  /** Provider flagged this as a disfluency ("um", "uh", …). */
  isFiller: boolean;
  /** True when the word ends a sentence — drives caption grouping and cut safety. */
  endsSentence: boolean;
}

export interface TranscriptSentence {
  text: string;
  startSec: number;
  endSec: number;
  speaker: number;
  /** Index range into `Transcript.words`, inclusive of start, exclusive of end. */
  wordStart: number;
  wordEnd: number;
  /**
   * True when this came from breaking a long sentence at a clause rather
   * than from punctuation the speaker gave us.
   *
   * It matters to one detector: a fragment that ends without a terminator
   * reads as an abandoned run-up, and a piece of a split sentence ends
   * without one by construction. Flagging it keeps the false-start pass from
   * inventing run-ups that nobody said.
   */
  split?: boolean;
}

export interface Transcript {
  provider: string;
  language: string;
  durationSec: number;
  text: string;
  words: TranscriptWord[];
  sentences: TranscriptSentence[];
  /** Populated when we could not reach any ASR provider. */
  degraded?: boolean;
}

export interface TranscribeOptions {
  languageHint?: string;
  /** Talking-head content is usually one person; diarisation costs time. */
  diarize?: boolean;
}

export interface TranscriptionProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** Cost in USD for a clip of the given length — used by the budget guard. */
  estimateCostUsd(durationSec: number): number;
  transcribe(audioPath: string, options?: TranscribeOptions): Promise<Transcript>;
}

/**
 * Words that count as fillers when they stand alone between pauses.
 *
 * English only, and kept here for the callers that have no language to hand.
 * Everything that knows what language it is looking at should use
 * `packFor(language).fillers` — "ähm", "euh" and "eh" are not in this set and
 * a German video edited against it keeps every one of them.
 */
export const FILLER_LEXICON = ENGLISH.fillers;

/**
 * Multi-word hedges. These are only cut when the director agrees, because
 * "you know" can be load-bearing ("you know what I mean?" as a real question).
 */
export const HEDGE_PHRASES = ENGLISH.hedgePhrases;

export function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
}

/** Build sentence groupings from a flat word list when the provider gives none. */
export function deriveSentences(
  words: TranscriptWord[],
  language?: string,
): TranscriptSentence[] {
  const sentences: TranscriptSentence[] = [];
  let start = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    // A sentence ends on punctuation, a speaker change, or a long breath.
    const gapAfter = next ? next.startSec - w.endSec : Infinity;
    const boundary =
      w.endsSentence ||
      !next ||
      next.speaker !== w.speaker ||
      gapAfter > 0.9;

    if (boundary) {
      sentences.push(...splitLong(words, start, i + 1, language));
      start = i + 1;
    }
  }
  return sentences;
}

/**
 * How long a sentence is allowed to be before it gets broken at a clause.
 *
 * ── Why this is needed at all ───────────────────────────────────────────
 *
 * A sentence is the unit the whole editor reasons in: the retake detector
 * compares sentences, the camera-move script scores sentences, the scene
 * director picks a passage of them. All of that assumes a sentence is about
 * one thing.
 *
 * Which held while the footage was English. Measured on the same three
 * sentences recorded in French and Spanish, Deepgram punctuates them with
 * COMMAS where it ends the English with a full stop:
 *
 *   "Luego, luego añades la música, luego añades los subtítulos, crecimos
 *    alrededor de un 40 por ciento el año pasado, creo, crecimos un 40 por
 *    ciento."
 *
 * One 25-word "sentence" holding four separate claims and a retake of one of
 * them. The retake is invisible, because both takes are inside the same
 * sentence and nothing compares a sentence to itself; the camera move lands
 * at the top of it, nine seconds before the figure that earned it.
 *
 * So anything over these limits is cut at its strongest internal boundary.
 * The pieces are marked, because a fragment ending in a comma is not the
 * same evidence as one ending in nothing — the false-start detector treats
 * an unfinished fragment as an abandoned run-up, and a clause split must not
 * manufacture those.
 */
const MAX_SENTENCE_SEC = 5.5;
const MAX_SENTENCE_WORDS = 16;
/**
 * And a lower bar when the speaker marked the clause themselves.
 *
 * A comma inside a sentence this long is a boundary whether or not a pause
 * came with it — measured on the Spanish clip, where the commas in "…el año
 * pasado, creo, crecimos un 40 por ciento" carry gaps of 0.00s and 0.16s and
 * the second half is a retake of the first. Waiting for a breath would have
 * kept all sixteen words as one claim.
 */
const CLAUSE_SENTENCE_SEC = 4.5;
const CLAUSE_SENTENCE_WORDS = 12;
/** No piece shorter than this: a three-word clause is not a claim. */
const MIN_PIECE_WORDS = 4;

function splitLong(
  words: TranscriptWord[],
  from: number,
  to: number,
  language?: string,
  wasSplit = false,
): TranscriptSentence[] {
  const slice = words.slice(from, to);
  if (!slice.length) return [];

  const sentence = buildSentence(words, from, to, wasSplit);
  if (slice.length < MIN_PIECE_WORDS * 2) return [sentence];

  const sec = sentence.endSec - sentence.startSec;
  const tooLong = slice.length > MAX_SENTENCE_WORDS || sec > MAX_SENTENCE_SEC;
  const longish = slice.length > CLAUSE_SENTENCE_WORDS || sec > CLAUSE_SENTENCE_SEC;
  const marked = slice
    .slice(MIN_PIECE_WORDS - 1, -MIN_PIECE_WORDS)
    .some((w) => /[,;:]["')\]]?$/.test(w.text.trim()));
  if (!tooLong && !(longish && marked)) return [sentence];

  /*
   * One long sentence must survive intact, and it is the list.
   *
   * "It reads your inbox, checks the calendar, plans your day, and gives you
   * the time back" is four clauses and ONE claim, and it is also exactly the
   * sentence the checklist layer reads to put the four items on screen.
   * Broken at its commas the claim is still fine and the checklist is gone.
   */
  if (looksLikeList(slice, language)) return [sentence];

  const at = clauseBoundary(words, from, to);
  if (at === null) return [sentence];

  return [
    ...splitLong(words, from, at, language, true),
    ...splitLong(words, at, to, language, true),
  ];
}

/**
 * An enumeration, told apart from a sentence that merely has commas in it.
 *
 * Two signals, either one enough, and both need at least two internal commas:
 *
 *  - **Three short parts.** "The captions, the b-roll, the effects, …" — a
 *    run of parallel constituents is what a list IS, and they are short
 *    because each one names a thing. This catches the list with no
 *    conjunction, which is common in speech.
 *  - **A coordinator before the last part.** "…, and gives you the time
 *    back" — the final part of a list is often the long one, and the "and"
 *    is what marks it as the end of a series rather than a new clause.
 *
 * What neither catches, correctly: "When I started, honestly, I had no idea
 * what I was doing" — two commas, two short parts, no coordinator, and a
 * final clause that is its own claim. That one gets split.
 */
function looksLikeList(slice: TranscriptWord[], language?: string): boolean {
  const isComma = (word?: TranscriptWord) => Boolean(word && /,["')\]]?$/.test(word.text.trim()));
  if (slice.slice(0, -1).filter(isComma).length < 2) return false;

  const parts: number[] = [];
  let run = 0;
  for (const word of slice) {
    run++;
    if (isComma(word)) {
      parts.push(run);
      run = 0;
    }
  }
  if (run) parts.push(run);
  if (parts.filter((n) => n <= 5).length >= 3) return true;

  const coordinators = packFor(language).coordinators;
  return slice.some(
    (w, i) =>
      i > 0 &&
      isComma(slice[i - 1]) &&
      coordinators.includes(w.text.toLowerCase().replace(/[^\p{L}]/gu, '')),
  );
}

/**
 * The best place to break, which is not simply the middle.
 *
 * A comma the speaker breathed after is a real boundary and scores highest;
 * a comma alone is next; a bare pause with no punctuation is the fallback.
 * Ties go to the break nearest the middle, so one split halves the sentence
 * instead of shaving a clause off the front.
 */
function clauseBoundary(words: TranscriptWord[], from: number, to: number): number | null {
  const middle = (from + to) / 2;
  let best: { at: number; score: number } | null = null;

  for (let i = from + MIN_PIECE_WORDS - 1; i <= to - MIN_PIECE_WORDS - 1; i++) {
    const gap = words[i + 1].startSec - words[i].endSec;
    const punctuated = /[,;:]["')\]]?$/.test(words[i].text.trim());
    if (!punctuated && gap < 0.3) continue;

    const score =
      (punctuated ? 2 : 0) +
      (gap >= 0.22 ? 1 : 0) +
      Math.min(0.9, gap) -
      Math.abs(i + 1 - middle) / (to - from);
    if (!best || score > best.score) best = { at: i + 1, score };
  }
  return best?.at ?? null;
}

function buildSentence(
  words: TranscriptWord[],
  from: number,
  to: number,
  split: boolean,
): TranscriptSentence {
  const slice = words.slice(from, to);
  return {
    text: slice.map((s) => s.text).join(' ').replace(/\s+([,.!?])/g, '$1'),
    startSec: slice[0].startSec,
    endSec: slice[slice.length - 1].endSec,
    speaker: slice[0].speaker,
    wordStart: from,
    wordEnd: to,
    ...(split ? { split: true } : {}),
  };
}
