import { packFor } from '@/lib/lang';
import { normalizeWord } from '@/lib/transcribe/types';
import type { Transcript, TranscriptSentence, TranscriptWord } from '@/lib/transcribe/types';
import { restatementEvidence } from './paraphrase';
import { intersectionLength, mergeIntervals, type Interval } from './silence';

export interface CleanupFinding extends Interval {
  kind: 'filler' | 'stammer' | 'false-start' | 'retake';
  text: string;
  /** 0..1 — the pipeline only auto-applies findings above the preset's floor. */
  confidence: number;
  /**
   * The span this cut exists to preserve, where there is one.
   *
   * Every pass that drops one of two takes is making a trade: this goes so
   * that THAT survives. Two passes can reach the same pair of takes and
   * trade in opposite directions — the false-start pass cutting the earlier
   * attempt to keep the later one, the restatement reviewer cutting the
   * later to keep the earlier — and when both removals are applied the line
   * is gone from the video altogether. Measured on a real upload: the whole
   * call to action, both takes of it, deleted by two passes that each
   * thought they were keeping one.
   *
   * Naming the keeper is what makes that detectable. See
   * `applicableFindings`.
   */
  keeps?: Interval;
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

/**
 * Three dots are not a full stop.
 *
 * Every detector below asks "did the speaker finish this sentence?", and the
 * test was `/[.!?]$/`. An ellipsis matches it. So "It's really really…" —
 * the exact shape of an abandoned line — read as a completed thought, and the
 * two passes that exist to find abandoned lines both skipped it. Measured on
 * one 40-second upload that was two of the three repeats left in the cut.
 *
 * Deepgram writes a trail-off as "…" or "...", a hard break as "--", and both
 * mean the same thing here: the speaker stopped without landing it.
 */
const ABANDONED = /(?:\.\.\.|\u2026|--|\u2014)\s*["\')\]]?$/;

function isFinished(text: string): boolean {
  const trimmed = text.trim();
  if (ABANDONED.test(trimmed)) return false;
  return /[.!?]["\')\]]?$/.test(trimmed);
}

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
  if (options.removeFalseStarts) {
    findings.push(...findFalseStarts(transcript.sentences));
    findings.push(...findTrailingOff(transcript.sentences, transcript.words, language));
  }
  if (options.removeRetakes) findings.push(...findRetakes(transcript.sentences, language));
  return dropContained(findings).sort((a, b) => a.startSec - b.startSec);
}

/**
 * One cut per thing cut.
 *
 * Two passes can reach the same fragment from different directions —
 * "It's really really…" is both an abandoned run-up before the next sentence
 * and a sentence that trails off — and the removals merge, so the EDIT is
 * right either way. The count is not: the panel said four false starts where
 * there were three, and a number the customer can check against the video is
 * worth more than the line of code it costs.
 *
 * Only a finding wholly inside another of the same kind, and never one
 * carrying a review: two retakes can share a span and still be different
 * pairs of takes awaiting different answers.
 */
function dropContained(findings: CleanupFinding[]): CleanupFinding[] {
  return findings.filter((f, i) =>
    f.review
      ? true
      : !findings.some(
          (other, j) =>
            j !== i &&
            other.kind === f.kind &&
            other.startSec <= f.startSec &&
            other.endSec >= f.endSec &&
            // A tie has to resolve one way or nothing survives it.
            (other.endSec - other.startSec > f.endSec - f.startSec || j < i),
        ),
  );
}

export function applicableFindings(findings: CleanupFinding[], options: CleanupOptions): Interval[] {
  const above = findings.filter((f) => f.confidence >= options.confidenceFloor);
  return keepOneOfEachPair(above).map((f) => ({ startSec: f.startSec, endSec: f.endSec }));
}

/** How much of a take has to be gone before it no longer counts as kept. */
const KEEPER_LOST_AT = 0.5;

/**
 * No cut may remove the take another cut was keeping.
 *
 * Both passes that drop a take name the one they are keeping, so a
 * contradiction is visible: this finding's keeper is inside that finding's
 * removal. The more confident finding wins and the other is dropped, which
 * leaves exactly one take of the pair in the video — the only outcome that
 * is right whichever pass was right about which take.
 *
 * Strongest first, and checked against the union of what has already been
 * accepted: two small removals can between them account for a keeper that
 * neither covers on its own.
 */
function keepOneOfEachPair(applied: CleanupFinding[]): CleanupFinding[] {
  const order = [...applied].sort((a, b) => b.confidence - a.confidence);
  const kept: CleanupFinding[] = [];

  for (const finding of order) {
    if (finding.keeps) {
      const span = finding.keeps.endSec - finding.keeps.startSec;
      // Merged, because two accepted removals may overlap each other and a
      // double-counted second would read as more of the keeper than exists.
      const removed = mergeIntervals(
        kept.map((f) => ({ startSec: f.startSec, endSec: f.endSec })),
      );
      const gone = span > 0 ? intersectionLength(finding.keeps, removed) / span : 0;
      if (gone >= KEEPER_LOST_AT) continue;
    }
    kept.push(finding);
  }
  return kept.sort((a, b) => a.startSec - b.startSec);
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

/** The fastest a repeat can be said and still be deliberate, per word. */
const STAMMER_SEC_PER_WORD = 0.42;
/** Longest phrase checked for a repeat. Beyond this it is a retake. */
const MAX_STAMMER_PHRASE = 3;

/**
 * "the the thing", "I I think", "and it and it" — keep the last attempt.
 *
 * Single words were all this caught, and the stammer people actually produce
 * is as often a phrase: "and it and it literally does everything else" came
 * out of a real upload and went into the cut untouched, because no word in it
 * is immediately followed by itself.
 *
 * The phrase case needs a guard the single-word case does not, because
 * "we go up, and up, and up" is a repeat somebody MEANT. Two signals separate
 * them, and the speaker provides both: a deliberate repeat is punctuated, and
 * it is slower. So a phrase repeat is only a stammer when the first copy
 * carries no punctuation at all and the whole run is said at stammer speed.
 */
function findStammers(words: TranscriptWord[]): CleanupFinding[] {
  const out: CleanupFinding[] = [];
  let i = 0;

  while (i < words.length - 1) {
    const phrase = phraseStammerAt(words, i);
    if (phrase) {
      out.push(phrase.finding);
      i = phrase.keepFrom;
      continue;
    }

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
      const tight = span / repeats < STAMMER_SEC_PER_WORD;
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

/**
 * A repeated phrase starting at `from`, or null.
 *
 * Longest first: "and it and it" is one two-word stammer, and reading it as
 * two one-word ones would cut "and it" out of the middle and leave "and it"
 * either side of a hole.
 */
function phraseStammerAt(
  words: TranscriptWord[],
  from: number,
): { finding: CleanupFinding; keepFrom: number } | null {
  for (let len = MAX_STAMMER_PHRASE; len >= 2; len--) {
    if (from + len * 2 > words.length) continue;

    const first = words.slice(from, from + len);
    // Punctuation inside the first copy means the speaker placed a boundary
    // there, and a placed boundary is a rhetorical repeat, not a stumble.
    if (first.some((w) => /[,;:.!?\u2014]/.test(w.text))) continue;

    const key = first.map((w) => normalizeWord(w.text)).join(' ');
    if (!key || first.some((w) => !normalizeWord(w.text))) continue;

    let repeats = 1;
    while (from + (repeats + 1) * len <= words.length) {
      const next = words
        .slice(from + repeats * len, from + (repeats + 1) * len)
        .map((w) => normalizeWord(w.text))
        .join(' ');
      if (next !== key) break;
      repeats++;
    }
    if (repeats < 2) continue;

    const keepFrom = from + (repeats - 1) * len;
    const span = words[from + repeats * len - 1].endSec - words[from].startSec;
    if (span / (repeats * len) >= STAMMER_SEC_PER_WORD) continue;

    return {
      keepFrom,
      finding: {
        kind: 'stammer',
        startSec: words[from].startSec,
        endSec: words[keepFrom - 1].endSec,
        text: words.slice(from, from + repeats * len).map((w) => w.text).join(' '),
        confidence: 0.78,
      },
    };
  }
  return null;
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
    const finished = isFinished(cur.text);

    /*
     * Either the next sentence restarts with the same words…
     *
     * …but a run-up is by definition ABANDONED, and a half-match between two
     * finished sentences is not one. "We grew forty percent." followed by
     * "We grew fifty percent." shares a two-word opening and is two facts;
     * cutting the first on a prefix match loses one of them.
     *
     * Three ways a sentence qualifies, then. An unfinished one always does.
     * A finished one does when the whole of it is repeated, which is what a
     * clean restart looks like. And — the case that was being missed — a
     * finished one does when the next sentence carries its opening and then
     * goes substantially FURTHER:
     *
     *   "You only have to go to easycut.com."
     *   "You only have to go to easycut.i, put in your footage, and it
     *    literally does everything else."
     *
     * Seven words against eighteen, sharing six, eight hundredths of a second
     * apart. The speaker got the domain wrong and started again. Length is
     * what separates that from the two-facts case: a parallel pair is a
     * parallel pair, roughly the same shape twice over, while a restart
     * abandons a short attempt for a longer one.
     */
    const restartsLonger =
      shared >= 3 &&
      prefixRatio >= 0.6 &&
      nextWords.length >= curWords.length + 4 &&
      next.startSec - cur.endSec <= 1.5;

    if (shared >= 2 && prefixRatio >= 0.5 && (shared === curWords.length || !finished || restartsLonger)) {
      out.push({
        kind: 'false-start',
        startSec: cur.startSec,
        endSec: next.startSec,
        text: cur.text,
        confidence: Math.min(0.95, 0.6 + prefixRatio * 0.35),
        keeps: { startSec: next.startSec, endSec: next.endSec },
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
    const trailsOff = !cur.split && curWords.length <= 4 && !isFinished(cur.text);
    if (trailsOff && next.startSec - cur.endSec < 1.2) {
      out.push({
        kind: 'false-start',
        startSec: cur.startSec,
        endSec: next.startSec,
        text: cur.text,
        confidence: 0.66,
        keeps: { startSec: next.startSec, endSec: next.endSec },
      });
    }
  }
  return out;
}

/* ------------------------------------------------------- trailing off */

/** A tail longer than this is a clause with content in it, not a trail-off. */
const TAIL_MAX_WORDS = 4;
/** At or under this, there is nothing worth keeping and the fragment goes. */
const WHOLE_FRAGMENT_WORDS = 5;
/** What has to survive on the front for a tail cut to be worth making. */
const MIN_KEPT_WORDS = 3;

/**
 * The sentence the speaker gave up on halfway.
 *
 * `findFalseStarts` needs two sentences — an attempt and a retry — and this
 * is the other half of the problem: a line that trails off and is simply not
 * finished, with whatever came next being a different thought. Both of these
 * were left in a cut:
 *
 *   "Cloud Code just replaced video editors, but not…"
 *   "It's really really…"
 *
 * They want different cuts, which is the whole reason this is its own pass.
 * The first has a perfectly good hook on the front of it — "Cloud Code just
 * replaced video editors" is the opening line of the video — and one dead
 * clause on the end, so only the clause goes. The second is nothing but the
 * run-up, so all of it goes.
 *
 * Finding where the dead clause starts is the only judgement here, and it is
 * deliberately narrow: walk back at most four words from the end, and cut
 * only from a word that can OPEN a clause. No clause opener in those four
 * words means the trail-off is the tail of something continuous, where any
 * cut would land mid-phrase, so nothing is proposed. A sentence we split
 * ourselves is skipped outright — that edge is ours, not the speaker's.
 *
 * Cutting a whole fragment needs one more thing, because a trailing-off
 * SHORT line is not always a mistake — "and the best part is…" is a hook,
 * and the thing that makes it a hook is the pause after it. So the fragment
 * only goes on its own when the speaker came straight back, or when the
 * fragment stammers inside itself. A trail-off nobody hurried out of, and a
 * trail-off that ends the video, are flagged for a person to look at instead.
 */
function findTrailingOff(
  sentences: TranscriptSentence[],
  words: TranscriptWord[],
  language: string,
): CleanupFinding[] {
  const { clauseOpeners } = packFor(language);
  const out: CleanupFinding[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    if (sentence.split) continue;
    if (!ABANDONED.test(sentence.text.trim())) continue;

    const span = words.slice(sentence.wordStart, sentence.wordEnd);
    if (!span.length) continue;

    if (span.length <= WHOLE_FRAGMENT_WORDS) {
      const next = sentences[i + 1];
      const hurried = Boolean(next) && next.startSec - sentence.endSec < 1.2;
      const stammers = span.some(
        (w, k) => k > 0 && normalizeWord(w.text) === normalizeWord(span[k - 1].text),
      );
      out.push({
        kind: 'false-start',
        startSec: sentence.startSec,
        endSec: sentence.endSec,
        text: sentence.text,
        // Under every preset's floor when it might be a held beat: shown in
        // the review panel, left in the cut until somebody says otherwise.
        confidence: hurried || stammers ? 0.82 : 0.55,
      });
      continue;
    }

    // The EARLIEST opener in the last few words, so "…, but not…" cuts from
    // "but" rather than leaving it dangling on the end of the keeper.
    let cutFrom = -1;
    const reach = Math.min(TAIL_MAX_WORDS, span.length - MIN_KEPT_WORDS);
    for (let back = 1; back <= reach; back++) {
      const index = span.length - back;
      if (clauseOpeners.has(normalizeWord(span[index].text))) cutFrom = index;
    }
    if (cutFrom < 0) continue;

    out.push({
      kind: 'false-start',
      startSec: span[cutFrom].startSec,
      endSec: sentence.endSec,
      text: span.slice(cutFrom).map((w) => w.text).join(' '),
      confidence: 0.78,
      // The front of the same sentence is the reason for the cut.
      keeps: { startSec: sentence.startSec, endSec: span[cutFrom].startSec },
    });
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
      const finished = isFinished(b.text);
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
        keeps: laterIsTruncated
          ? { startSec: a.startSec, endSec: a.endSec }
          : { startSec: b.startSec, endSec: b.endSec },
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
      // Flipped with the ruling, not inherited. The finding was built keeping
      // one take and the reader just chose the other, so a stale `keeps`
      // would name the span this cut now REMOVES — and the guard in
      // `applicableFindings` reads it to decide whether a line still exists.
      keeps: cutting === 'later' ? review.earlierSpan : review.laterSpan,
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
