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

/** Words that count as fillers when they stand alone between pauses. */
export const FILLER_LEXICON = new Set([
  'um', 'uh', 'umm', 'uhh', 'erm', 'er', 'ah', 'hmm', 'mm', 'mhm', 'eh',
]);

/**
 * Multi-word hedges. These are only cut when the director agrees, because
 * "you know" can be load-bearing ("you know what I mean?" as a real question).
 */
export const HEDGE_PHRASES = [
  ['you', 'know'],
  ['i', 'mean'],
  ['sort', 'of'],
  ['kind', 'of'],
  ['basically'],
  ['literally'],
  ['actually'],
];

export function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
}

/** Build sentence groupings from a flat word list when the provider gives none. */
export function deriveSentences(words: TranscriptWord[]): TranscriptSentence[] {
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
      const slice = words.slice(start, i + 1);
      if (slice.length) {
        sentences.push({
          text: slice.map((s) => s.text).join(' ').replace(/\s+([,.!?])/g, '$1'),
          startSec: slice[0].startSec,
          endSec: slice[slice.length - 1].endSec,
          speaker: slice[0].speaker,
          wordStart: start,
          wordEnd: i + 1,
        });
      }
      start = i + 1;
    }
  }
  return sentences;
}
