import { packFor } from '@/lib/lang';
import { normalizeWord } from '@/lib/transcribe/types';
import type { Transcript, TranscriptSentence, TranscriptWord } from '@/lib/transcribe/types';
import { restatementEvidence } from './paraphrase';
import type { Interval } from './silence';

export interface CleanupFinding extends Interval {
  kind: 'filler' | 'stammer' | 'false-start' | 'retake';
  text: string;
  /** 0..1 — the pipeline only auto-applies findings above the preset's floor. */
  confidence: number;
  /** Set on a retake whose two takes could not be told apart by their words. */
  review?: RetakeReview;
}

/**
 * Everything a second opinion needs about one pair of takes.
 *
 * It travels on the finding rather than in a side table because the reader's
 * answer can move the cut to the OTHER sentence — so both spans have to
 * survive the trip.
 */
export interface RetakeReview {
  earlier: string;
  later: string;
  earlierSpan: Interval;
  laterSpan: Interval;
  gapSec: number;
  /** Which of the two this finding currently proposes to cut. */
  cutting: 'earlier' | 'later';
  /** The deterministic score, before anybody read it. */
  score: number;
  reasons: string[];
  /** True while the words alone cannot settle it. */
  needsReader: boolean;
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
  /*
   * The language comes off the transcript, not from a setting. The ASR heard
   * the audio and we did not, and a German video edited with English filler
   * words and English function words is edited by a detector that cannot
   * read it — it would leave every "ähm" in and score every pair of
   * sentences on the wrong words.
   */
  const language = transcript.language;
  const findings: CleanupFinding[] = [];
  if (options.removeFillers) findings.push(...findFillers(transcript.words, language));
  if (options.removeStammers) findings.push(...findStammers(transcript.words));
  if (options.removeFalseStarts) findings.push(...findFalseStarts(transcript.sentences));
  if (options.removeRetakes) findings.push(...findRetakes(transcript.sentences, language));
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
function findFillers(words: TranscriptWord[], language: string): CleanupFinding[] {
  const out: CleanupFinding[] = [];
  const { fillers } = packFor(language);

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const normalized = normalizeWord(w.text);
    const isFiller = w.isFiller || fillers.has(normalized);
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
    const finished = /[.!?]["')\]]?$/.test(cur.text.trim());

    /*
     * Either the next sentence restarts with the same words…
     *
     * …but a run-up is by definition ABANDONED, and a half-match between two
     * finished sentences is not one. "We grew forty percent." followed by
     * "We grew fifty percent." shares a two-word opening and is two facts;
     * cutting the first on a prefix match loses one of them. So a finished
     * sentence only counts as a run-up when the whole of it is repeated —
     * which is what a real restart does.
     */
    if (shared >= 2 && prefixRatio >= 0.5 && (shared === curWords.length || !finished)) {
      out.push({
        kind: 'false-start',
        startSec: cur.startSec,
        endSec: next.startSec,
        text: cur.text,
        confidence: Math.min(0.95, 0.6 + prefixRatio * 0.35),
      });
      continue;
    }

    /*
     * …or the fragment is very short and trails off without finishing.
     *
     * Not when WE made the fragment, though: a long sentence broken at a
     * clause ends without a terminator by construction, and reading that as
     * an abandoned run-up would cut "In Berlin," off the front of a
     * perfectly good sentence.
     */
    const trailsOff =
      !cur.split && curWords.length <= 4 && !/[.!?]$/.test(cur.text.trim());
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
 * We compare each sentence against the next few and, when two say the same
 * thing, drop the earlier one — people retry until they get it right, so the
 * LAST attempt is the keeper. The exception is a final attempt that is
 * clearly truncated, where the earlier complete take wins.
 *
 * "The same thing" is the hard part and it is not a word count: see
 * `./paraphrase`. Pairs that land in its middle band come back marked
 * `needsReader` and are not cut by anybody here — `applyRestatementReview`
 * folds in a second opinion, and without one they stay flagged and intact.
 */
function findRetakes(
  sentences: TranscriptSentence[],
  language: string,
  lookahead = 4,
): CleanupFinding[] {
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

      // Retakes happen close together — minutes apart it's a callback, not a flub.
      const gapSec = b.startSec - a.endSec;
      if (gapSec > 25) continue;

      /*
       * Comparing the two as bags of words is not enough, and the reason is
       * worth stating here rather than only in `paraphrase`: the retake a
       * creator actually produces is the line said AGAIN BETTER, in almost
       * entirely different words. "So the point is you have to start" and
       * "what I'm saying is you just need to begin" share two words. The old
       * lexical gate read them as unrelated and left both in the cut.
       *
       * `restatementEvidence` strips the announcement off the front, folds
       * the vocabulary, and weighs the words that carry the claim — and it
       * vetoes the opposite mistake, where a list of near-identical steps
       * looks like one line repeated.
       */
      const evidence = restatementEvidence(a.text, b.text, gapSec, language);
      if (evidence.verdict === 'different') continue;
      const similarity = evidence.score;

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

      /*
       * Cutting the take that carries the condition is the one asymmetry
       * here. "It takes ten minutes" against "it takes ten minutes if your
       * footage is organised" is a safe cut in one direction and an edit
       * that changes what the video promises in the other — so when the
       * loser is the qualified one, nobody cuts it without a second look.
       */
      const cutsTheCondition =
        evidence.carriesCondition === (laterIsTruncated ? 'later' : 'earlier');
      const needsReader = evidence.verdict === 'maybe' || cutsTheCondition;
      out.push({
        kind: 'retake',
        startSec: loser.startSec,
        endSec: loser.endSec,
        text: loser.text,
        /*
         * A `maybe` is deliberately pinned under every preset's floor. It
         * shows up in the review panel as something to look at and is not
         * cut, which is the right default when nobody has read it: a
         * repetition left in is a blemish, a sentence wrongly cut is a hole.
         */
        confidence: needsReader
          ? Math.min(0.58, 0.45 + similarity * 0.15)
          : Math.min(0.94, 0.55 + similarity * 0.45),
        review: {
          earlier: a.text,
          later: b.text,
          earlierSpan: { startSec: a.startSec, endSec: a.endSec },
          laterSpan: { startSec: b.startSec, endSec: b.endSec },
          gapSec,
          cutting: laterIsTruncated ? 'later' : 'earlier',
          score: evidence.score,
          reasons: evidence.reasons,
          needsReader,
        },
      });
      // An unsettled pair keeps both sentences in play: nothing has been cut
      // yet, so neither take is spoken for.
      if (!needsReader) consumed.add(loserIndex);
      if (!laterIsTruncated && !needsReader) break; // `a` is gone; stop comparing against it
    }
  }
  return out;
}

/* ------------------------------------------------------- the second opinion */

export interface RestatementRuling {
  verdict: 'restated' | 'different' | 'unsure';
  /** Which take to keep. Only read when the verdict is `restated`. */
  keep: 'earlier' | 'later';
  why?: string;
}

/**
 * A name for one pair of takes, stable across a re-run.
 *
 * Built from the two start times rather than a counter, so the same footage
 * produces the same ids however many pairs were found before this one —
 * which is what lets a verdict be cached and an edit be reproducible.
 */
export function retakeKey(review: RetakeReview): string {
  return `${review.earlierSpan.startSec.toFixed(2)}>${review.laterSpan.startSec.toFixed(2)}`;
}

/** The pairs that need a reader, in the shape the reader is asked in. */
export function pendingRestatements(findings: CleanupFinding[]) {
  return findings
    .filter((f) => f.kind === 'retake' && f.review?.needsReader)
    .map((f) => ({
      id: retakeKey(f.review!),
      earlier: f.review!.earlier,
      later: f.review!.later,
      gapSec: f.review!.gapSec,
      reasons: f.review!.reasons,
    }));
}

/**
 * Fold a reader's verdicts back into the findings.
 *
 * Three outcomes, and the asymmetry between them is the point:
 *
 *  - `different` DELETES the finding. The pair was two real sentences that
 *    happened to rhyme, and the cut would have cost the viewer information.
 *  - `restated` lifts the confidence over every preset's floor, and moves the
 *    cut to the other take if the reader says the later one is the worse of
 *    the two.
 *  - `unsure`, or no answer at all, changes nothing: the finding stays below
 *    the floor, visible in the review panel and still in the video.
 *
 * Pure, so the same verdicts always produce the same edit.
 */
export function applyRestatementReview(
  findings: CleanupFinding[],
  rulings: Map<string, RestatementRuling>,
): CleanupFinding[] {
  const out: CleanupFinding[] = [];

  for (const finding of findings) {
    const review = finding.review;
    if (finding.kind !== 'retake' || !review?.needsReader) {
      out.push(finding);
      continue;
    }

    const ruling = rulings.get(retakeKey(review));
    if (!ruling || ruling.verdict === 'unsure') {
      out.push({ ...finding, review: { ...review, reasons: notedWith(review, ruling) } });
      continue;
    }
    if (ruling.verdict === 'different') continue;

    const cutting = ruling.keep === 'earlier' ? 'later' : 'earlier';
    const span = cutting === 'later' ? review.laterSpan : review.earlierSpan;
    out.push({
      ...finding,
      startSec: span.startSec,
      endSec: span.endSec,
      text: cutting === 'later' ? review.later : review.earlier,
      // A read pair is settled: over the raw preset's floor, under the
      // roughcut preset's, because roughcut footage is already edited.
      confidence: 0.88,
      review: { ...review, cutting, needsReader: false, reasons: notedWith(review, ruling) },
    });
  }

  // Two pairs can nominate the same sentence — a line said three times puts
  // the middle take in both. Cutting it twice is harmless but reporting it
  // twice is not.
  const seen = new Set<string>();
  return out.filter((f) => {
    const key = `${f.kind}:${f.startSec.toFixed(3)}:${f.endSec.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function notedWith(review: RetakeReview, ruling?: RestatementRuling): string[] {
  if (!ruling) return [...review.reasons, 'nobody read it — left in'];
  const why = ruling.why?.trim();
  return [...review.reasons, why ? `read as ${ruling.verdict}: ${why}` : `read as ${ruling.verdict}`];
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
