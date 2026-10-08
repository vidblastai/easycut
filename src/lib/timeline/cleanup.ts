import { FILLER_LEXICON, normalizeWord } from '@/lib/transcribe/types';
import type { Transcript, TranscriptSentence, TranscriptWord } from '@/lib/transcribe/types';
import type { Interval } from './silence';

export interface CleanupFinding extends Interval {
  kind: 'filler' | 'stammer' | 'false-start' | 'retake';
  text: string;
  /** 0..1 — the pipeline only auto-applies findings above the preset's floor. */
  confidence: number;
}

export interface CleanupOptions {
  removeFillers: boolean;
  removeStammers: boolean;
  removeFalseStarts: boolean;
  removeRetakes: boolean;
  /** Findings below this confidence are reported to the UI but not applied. */
  confidenceFloor: number;
}

export const CLEANUP_PRESETS: Record<'raw' | 'roughcut', CleanupOptions> = {
  raw: {
    removeFillers: true,
    removeStammers: true,
    removeFalseStarts: true,
    removeRetakes: true,
    confidenceFloor: 0.62,
  },
  // The user already made these decisions. Second-guessing their edit is the
  // fastest way to make the product feel like it's fighting them.
  roughcut: {
    removeFillers: true,
    removeStammers: true,
    removeFalseStarts: false,
    removeRetakes: false,
    confidenceFloor: 0.85,
  },
};

export function findCleanupTargets(transcript: Transcript, options: CleanupOptions): CleanupFinding[] {
  const findings: CleanupFinding[] = [];
  if (options.removeFillers) findings.push(...findFillers(transcript.words));
  if (options.removeStammers) findings.push(...findStammers(transcript.words));
  if (options.removeFalseStarts) findings.push(...findFalseStarts(transcript.sentences));
  if (options.removeRetakes) findings.push(...findRetakes(transcript.sentences));
  return findings.sort((a, b) => a.startSec - b.startSec);
}

export function applicableFindings(findings: CleanupFinding[], options: CleanupOptions): Interval[] {
  return findings
    .filter((f) => f.confidence >= options.confidenceFloor)
    .map((f) => ({ startSec: f.startSec, endSec: f.endSec }));
}

/* ------------------------------------------------------------------ fillers */

/**
 * A filler is only worth cutting when it stands alone. "Um" wedged tightly
 * between two words is part of the rhythm of the sentence and removing it
 * produces an audible click; "um" sitting in its own little pocket of silence
 * is pure noise.
 */
function findFillers(words: TranscriptWord[]): CleanupFinding[] {
  const out: CleanupFinding[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const normalized = normalizeWord(w.text);
    const isFiller = w.isFiller || FILLER_LEXICON.has(normalized);
    if (!isFiller) continue;

    const gapBefore = i > 0 ? w.startSec - words[i - 1].endSec : Infinity;
    const gapAfter = i < words.length - 1 ? words[i + 1].startSec - w.endSec : Infinity;

    // Isolation score: the more breathing room around it, the safer the cut.
    const isolation = Math.min(gapBefore, gapAfter);
    let confidence: number;
    if (isolation >= 0.18) confidence = 0.95;
    else if (isolation >= 0.08) confidence = 0.78;
    else confidence = 0.45; // packed into the sentence — flag, don't cut

    // Fillers at the very start of a take are almost always disposable.
    if (i === 0) confidence = Math.max(confidence, 0.9);

    out.push({
      kind: 'filler',
      startSec: w.startSec - Math.min(gapBefore, 0.04),
      endSec: w.endSec + Math.min(gapAfter, 0.04),
      text: w.text,
      confidence,
    });
  }
  return out;
}

/* ----------------------------------------------------------------- stammers */

/** "the the thing", "I I think" — keep the last attempt, drop the rest. */
function findStammers(words: TranscriptWord[]): CleanupFinding[] {
  const out: CleanupFinding[] = [];
  let i = 0;

  while (i < words.length - 1) {
    const base = normalizeWord(words[i].text);
    if (!base || base.length > 12) {
      i++;
      continue;
    }

    let j = i + 1;
    while (j < words.length && normalizeWord(words[j].text) === base) j++;

    const repeats = j - i;
    if (repeats > 1) {
      // Only a stammer if the repeats are tight together; "very, very good" is
      // deliberate emphasis and comes with a comma-sized pause.
      const span = words[j - 1].endSec - words[i].startSec;
      const tight = span / repeats < 0.42;
      if (tight) {
        out.push({
          kind: 'stammer',
          startSec: words[i].startSec,
          endSec: words[j - 2].endSec, // keep the final repetition
          text: words.slice(i, j).map((w) => w.text).join(' '),
          confidence: 0.8,
        });
      }
      i = j;
    } else {
      i++;
    }
  }
  return out;
}

/* ------------------------------------------------------------ false starts */

/**
 * A false start is an abandoned run-up: "So the thing about— so what I actually
 * mean is…". We detect it as a short fragment whose opening words are repeated
 * by the fragment that immediately follows it.
 */
function findFalseStarts(sentences: TranscriptSentence[]): CleanupFinding[] {
  const out: CleanupFinding[] = [];

  for (let i = 0; i < sentences.length - 1; i++) {
    const cur = sentences[i];
    const next = sentences[i + 1];

    const curWords = tokenize(cur.text);
    const nextWords = tokenize(next.text);
    if (curWords.length === 0 || curWords.length > 8) continue;

    // The restart has to follow closely — a pause of several seconds means the
    // speaker moved on to a new thought, not retried the same one.
    if (next.startSec - cur.endSec > 2.2) continue;

    const shared = commonPrefixLength(curWords, nextWords);
    const prefixRatio = shared / curWords.length;

    // Either the next sentence restarts with the same words…
    if (shared >= 2 && prefixRatio >= 0.5) {
      out.push({
        kind: 'false-start',
        startSec: cur.startSec,
        endSec: next.startSec,
        text: cur.text,
        confidence: Math.min(0.95, 0.6 + prefixRatio * 0.35),
      });
      continue;
    }

    // …or the fragment is very short and trails off without finishing.
    const trailsOff = curWords.length <= 4 && !/[.!?]$/.test(cur.text.trim());
    if (trailsOff && next.startSec - cur.endSec < 1.2) {
      out.push({
        kind: 'false-start',
        startSec: cur.startSec,
        endSec: next.startSec,
        text: cur.text,
        confidence: 0.66,
      });
    }
  }
  return out;
}

/* ---------------------------------------------------------------- retakes */

/**
 * Someone flubs a line, sighs, and says it again. Sometimes four times.
 *
 * We compare each sentence against the next few and, when two are near
 * duplicates, drop the earlier one — people retry until they get it right, so
 * the LAST attempt is the keeper. The exception is a final attempt that is
 * clearly truncated, where the earlier complete take wins.
 */
function findRetakes(sentences: TranscriptSentence[], lookahead = 4): CleanupFinding[] {
  const out: CleanupFinding[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < sentences.length; i++) {
    if (consumed.has(i)) continue;
    const a = sentences[i];
    const aWords = tokenize(a.text);
    if (aWords.length < 4) continue; // too short to judge

    for (let j = i + 1; j <= Math.min(i + lookahead, sentences.length - 1); j++) {
      if (consumed.has(j)) continue;
      const b = sentences[j];
      const bWords = tokenize(b.text);
      if (bWords.length < 3) continue;

      /*
       * Two measures, because a retake takes two shapes.
       *
       * A RESTATEMENT says roughly the same words again, and the two sets
       * match both ways — jaccard reads that well. A TIGHTENING says it in
       * fewer words, and the second is a subset of the first, which jaccard
       * scores as a poor match however complete the subset is.
       *
       * Containment is discounted because a subset is weaker evidence: a
       * perfect one reaches 0.85 and clears the bar, where a partial one
       * does not. Without this the tightening case — the commonest retake
       * there is — was never detected at all.
       */
      const similarity = Math.max(jaccard(aWords, bWords), containment(aWords, bWords) * 0.85);
      if (similarity < 0.72) continue;

      // Retakes happen close together — minutes apart it's a callback, not a flub.
      if (b.startSec - a.endSec > 25) continue;

      /*
       * The later take wins, unless the speaker abandoned it.
       *
       * People retry until they get it right, so the last attempt is the one
       * they meant — that is the editorial convention and it is what the
       * brief asks for. The exception is a retry they gave up on halfway,
       * which has to be recognised or the edit keeps the fragment and throws
       * away the good take.
       *
       * Length alone cannot tell those apart. "We grew about forty percent
       * last year, I think" restated as "We grew forty percent." is four
       * words against nine and is the BETTER take — tighter, and finished.
       * So brevity only counts as abandonment when the sentence also has no
       * terminator: `deriveSentences` splits on punctuation or on a long
       * gap, so a take ending in a full stop is one the speaker finished.
       */
      const finished = /[.!?]["')\]]?$/.test(b.text.trim());
      const laterIsTruncated = bWords.length < aWords.length * 0.6 && !finished;
      const loser = laterIsTruncated ? b : a;
      const loserIndex = laterIsTruncated ? j : i;

      out.push({
        kind: 'retake',
        startSec: loser.startSec,
        endSec: loser.endSec,
        text: loser.text,
        confidence: Math.min(0.94, 0.55 + similarity * 0.45),
      });
      consumed.add(loserIndex);
      if (!laterIsTruncated) break; // `a` is gone; stop comparing against it
    }
  }
  return out;
}

/* ------------------------------------------------------------------ helpers */

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length > 0);
}

function commonPrefixLength(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Bag-of-words similarity — robust to the small rewordings between takes. */
function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) if (setB.has(item)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * How much of the SHORTER attempt is inside the longer one.
 *
 * Jaccard on its own misses the commonest retake there is: the second go at
 * a line is usually tighter, and a subset scores badly against a superset.
 * "We grew about forty percent last year, I think" restated as "We grew
 * forty percent" shares four words out of nine — 0.44, under any sensible
 * threshold — while every word of the retake is in the original.
 */
function containment(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  if (!small.size) return 0;
  let inside = 0;
  for (const item of small) if (large.has(item)) inside++;
  return inside / small.size;
}

/** Human-readable summary for the "here's what we removed" panel. */
export function summarizeCleanup(findings: CleanupFinding[], options: CleanupOptions) {
  const applied = findings.filter((f) => f.confidence >= options.confidenceFloor);
  const byKind = (kind: CleanupFinding['kind']) => applied.filter((f) => f.kind === kind);
  const seconds = (list: CleanupFinding[]) =>
    Math.round(list.reduce((s, f) => s + (f.endSec - f.startSec), 0) * 10) / 10;

  return {
    fillers: { count: byKind('filler').length, seconds: seconds(byKind('filler')) },
    stammers: { count: byKind('stammer').length, seconds: seconds(byKind('stammer')) },
    falseStarts: { count: byKind('false-start').length, seconds: seconds(byKind('false-start')) },
    retakes: { count: byKind('retake').length, seconds: seconds(byKind('retake')) },
    totalSeconds: seconds(applied),
    flaggedNotApplied: findings.length - applied.length,
  };
}
