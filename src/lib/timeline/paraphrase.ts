import { packFor, type LanguagePack } from '@/lib/lang';

/**
 * Did they say that again, or did they say something new?
 *
 * ── Why the words alone are not enough ──────────────────────────────────
 *
 * The retake detector used to compare two sentences as bags of words. That
 * finds the easy case — the line delivered twice, near enough verbatim — and
 * misses the case creators actually produce, which is a line delivered again
 * BETTER:
 *
 *     "So the point is you have to start."
 *     "What I'm saying is you just need to begin."
 *
 * Those two share "you" and "to". Any bag-of-words measure calls them
 * unrelated, so the edit keeps both and the viewer hears the same thought
 * twice. It is the single most common thing left in a creator's raw footage.
 *
 * And the mistake runs the other way too. These two share almost every word:
 *
 *     "Then you add the music."
 *     "Then you add the captions."
 *
 * A lexical score reads that as a retake and eats a step out of a tutorial.
 *
 * ── What this module does about it ──────────────────────────────────────
 *
 * Four passes, cheapest first, each one aimed at a specific way speech
 * disguises a restatement:
 *
 *  1. **Strip the frame.** "What I'm saying is", "in other words", "was ich
 *     meine ist", "lo que quiero decir es" — a restatement is announced, and
 *     the announcement is not part of the claim. Comparing the frames against
 *     each other is comparing noise. Stripping them also leaves the strongest
 *     positive signal there is: a sentence that OPENS by saying it is a
 *     rewording usually is one.
 *  2. **Fold the vocabulary.** "have to" / "need to" / "gotta" are one modal;
 *     "begin" and "start" are one verb. Folding them is what lifts the
 *     example above from 0.1 to 0.9.
 *  3. **Weight content over function.** "forty" is evidence. "you" is not.
 *     Treating them equally is why a 0.72 threshold had to be so blunt.
 *  4. **Veto the lookalikes.** A sequencing opener ("then", "next", "dann",
 *     "luego") or a pair of conflicting figures means the speaker moved on,
 *     however alike the two sentences read.
 *
 * What survives all four and still cannot be settled comes back as `maybe`,
 * which is the honest answer for "We grew forty percent / We grew fifty
 * percent" — and is the band a reader is asked about in `director/retakes`.
 *
 * ── Why none of the words are in this file ──────────────────────────────
 *
 * They are in `lib/lang`, one pack per language, because the four passes
 * above are the same work in German, French and Spanish and only the tables
 * change. Those languages need it MORE than English does, not less: an
 * English filler is a noise the ASR has to be asked for, while "also",
 * "ben" and "bueno" are real words every transcript contains.
 *
 * Everything here is pure and deterministic: the same footage scores the same
 * way on every run, with or without a network.
 */

export type RestatementVerdict = 'restated' | 'maybe' | 'different';

export interface RestatementEvidence {
  verdict: RestatementVerdict;
  /** 0..1 — how much of the same thought the two sentences carry. */
  score: number;
  /** Plain-language reasons, for the review panel and the reader's prompt. */
  reasons: string[];
  /**
   * Which of the two carries a clause the other does not — "…if your footage
   * is already organised", "…unless you shoot at night".
   *
   * It matters because a retake that drops a condition is not the same
   * sentence. Which way round it falls decides whether that is a problem:
   * keeping the qualified take and cutting the plain one loses nothing,
   * and doing the reverse loses the condition. The caller knows which take
   * it means to cut, so it decides; this only reports where the clause is.
   */
  carriesCondition?: 'earlier' | 'later';
}

/* ------------------------------------------------------------- tokenising */

/**
 * Words, as this language counts them.
 *
 * The apostrophe is the whole reason this takes a pack. French "qu'il" is
 * two words and has to be split or it never matches "il" anywhere else;
 * English "don't" is one word and splitting it leaves a stray "t".
 */
function tokenize(text: string, pack: LanguagePack): string[] {
  const lower = text.toLowerCase().replace(/[’ʼ]/g, "'");
  const split = pack.elision ? lower.replace(/'/g, "' ") : lower.replace(/'/g, '');
  return split
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/'/g, ''))
    .filter(Boolean);
}

/** Does `tokens` start with this phrase, written as a string? */
function startsWith(tokens: string[], phrase: string[]): boolean {
  if (phrase.length > tokens.length) return false;
  return phrase.every((w, i) => tokens[i] === w);
}

function endsWith(tokens: string[], phrase: string[]): boolean {
  if (phrase.length > tokens.length) return false;
  const offset = tokens.length - phrase.length;
  return phrase.every((w, i) => tokens[offset + i] === w);
}

/**
 * Frames are written as sentences and matched as tokens.
 *
 * Matching them as strings looked simpler and was wrong: an ASR writes "Ce
 * que je veux dire, c'est qu'il faut commencer" with a comma inside the
 * frame, and a string prefix never matches it. Tokens do not carry
 * punctuation, so the comma stops mattering.
 */
const phraseCache = new WeakMap<LanguagePack, Map<string, string[][]>>();

function phrasesOf(pack: LanguagePack, which: 'strong' | 'weak' | 'trailing' | 'sequencing'): string[][] {
  let perPack = phraseCache.get(pack);
  if (!perPack) {
    perPack = new Map();
    phraseCache.set(pack, perPack);
  }
  const hit = perPack.get(which);
  if (hit) return hit;

  const source =
    which === 'strong'
      ? pack.strongFrames
      : which === 'weak'
        ? pack.weakFrames
        : which === 'trailing'
          ? pack.trailingHedges
          : pack.sequencingOpeners;

  // Longest first, so "what I'm saying is" wins over "I mean".
  const built = source
    .map((phrase) => tokenize(phrase, pack))
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length);
  perPack.set(which, built);
  return built;
}

/* ------------------------------------------------------------------- core */

export interface Core {
  tokens: string[];
  /** True when a strong frame announced the sentence as a rewording. */
  announced: boolean;
  /** True when the sentence opens by moving on to the next item. */
  sequencing: boolean;
  figures: Set<string>;
}

/** What the sentence actually claims, with the packaging taken off. */
export function coreOf(text: string, language: string = 'en'): Core {
  const pack = packFor(language);
  let tokens = tokenize(text, pack);

  const sequencing = phrasesOf(pack, 'sequencing').some((p) => startsWith(tokens, p));

  let announced = false;
  for (const frame of phrasesOf(pack, 'strong')) {
    if (startsWith(tokens, frame)) {
      announced = true;
      tokens = tokens.slice(frame.length);
      break;
    }
  }

  // Weak frames stack: "okay so look, …" is three of them in a row.
  for (let i = 0; i < 3; i++) {
    const hit = phrasesOf(pack, 'weak').find((p) => startsWith(tokens, p));
    if (!hit || hit.length >= tokens.length) break;
    tokens = tokens.slice(hit.length);
  }

  /*
   * The frame nobody wrote down: a short lead-in clause ending in the
   * copula. "The whole reason this works is …", "Was ich eigentlich sagen
   * will ist …".
   *
   * Capped, and never across a number. Without the cap it ate "it takes ten
   * minutes if your footage is" and left the sentence as "organised" — a
   * frame stripper that strips the claim is worse than none.
   */
  const { openers, copulas, maxGap } = pack.genericFrame;
  if (tokens.length > 2 && openers.includes(tokens[0])) {
    const limit = Math.min(tokens.length - 1, maxGap + 1);
    for (let i = 1; i <= limit; i++) {
      if (!copulas.includes(tokens[i])) continue;
      const lead = tokens.slice(0, i + 1);
      if (!lead.some((t) => isFigure(t, pack))) tokens = tokens.slice(i + 1);
      break;
    }
  }

  // "…last year, I think" is the same claim as "…last year".
  for (let i = 0; i < 2; i++) {
    const hit = phrasesOf(pack, 'trailing').find((p) => endsWith(tokens, p));
    if (!hit || hit.length >= tokens.length) break;
    tokens = tokens.slice(0, -hit.length);
  }

  const folded = fold(tokens, pack);
  return {
    tokens: folded,
    announced,
    sequencing,
    figures: new Set(folded.filter((t) => /^\d/.test(t))),
  };
}

function isFigure(token: string, pack: LanguagePack): boolean {
  return /\d/.test(token) || Boolean(pack.numberWords[token]);
}

/* -------------------------------------------------------------- vocabulary */

/** Phrase folds, then per-word synonyms over a stem. Order matters. */
function fold(tokens: string[], pack: LanguagePack): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    /*
     * Longest first: "you always want to" has to beat "you want to".
     *
     * Matched on the stem, not the surface: the table says "give up" and the
     * footage says "gives up", "gave up", "giving up". Listing every
     * inflection of every phrase is how a table like this rots.
     */
    const phrase = phraseFolds(pack).find((p) =>
      p[0].every((w, k) => tokens[i + k] !== undefined && light(tokens[i + k], pack) === light(w, pack)),
    );
    if (phrase) {
      out.push(...phrase[1].map((w) => canonical(w, pack)));
      i += phrase[0].length;
      continue;
    }
    out.push(canonical(tokens[i], pack));
    i++;
  }
  return out;
}

const foldCache = new WeakMap<LanguagePack, Array<[string[], string[]]>>();

function phraseFolds(pack: LanguagePack): Array<[string[], string[]]> {
  let hit = foldCache.get(pack);
  if (!hit) {
    hit = [...pack.phrases].sort((a, b) => b[0].length - a[0].length);
    foldCache.set(pack, hit);
  }
  return hit;
}

/**
 * Inflection off, meaning intact. "Gives", "gave" and "giving" all land on
 * the same token; "begin" and "start" do not — that is `canonical`'s job.
 */
function light(word: string, pack: LanguagePack): string {
  const asNumber = pack.numberWords[word];
  if (asNumber) return asNumber;
  return pack.stem(pack.irregulars[word] ?? word);
}

function canonical(word: string, pack: LanguagePack): string {
  const asNumber = pack.numberWords[word];
  if (asNumber) return asNumber;
  const base = light(word, pack);
  // The synonym's target is stemmed too, or "everybody" lands on "people"
  // while "people" lands on "peopl" and the two never meet.
  const target = pack.synonyms[pack.irregulars[word] ?? word] ?? pack.synonyms[base];
  return target ? light(target, pack) : base;
}

/*
 * A function word stays a function word after folding. "the" stems to "th"
 * and "have to" folds to "must", and a lookup that misses them weights
 * "the" as heavily as "forty" — which is the bug this whole module exists to
 * fix, reintroduced one layer down.
 */
const grammarCache = new WeakMap<LanguagePack, Set<string>>();

function grammarWords(pack: LanguagePack): Set<string> {
  let hit = grammarCache.get(pack);
  if (!hit) {
    hit = new Set(pack.functionWords);
    for (const word of pack.functionWords) hit.add(canonical(word, pack));
    grammarCache.set(pack, hit);
  }
  return hit;
}

/* ---------------------------------------------------------------- scoring */

const CONTENT_WEIGHT = 1;
const FUNCTION_WEIGHT = 0.25;

function weightOf(token: string, pack: LanguagePack): number {
  if (/^\d/.test(token)) return CONTENT_WEIGHT; // a figure is always the point
  return grammarWords(pack).has(token) ? FUNCTION_WEIGHT : CONTENT_WEIGHT;
}

function weigh(tokens: Iterable<string>, pack: LanguagePack): number {
  let sum = 0;
  for (const t of tokens) sum += weightOf(t, pack);
  return sum;
}

/** How much of the same thought, weighting the words that carry it. */
function overlap(a: string[], b: string[], pack: LanguagePack) {
  const setA = new Set(a);
  const setB = new Set(b);
  const shared = [...setA].filter((t) => setB.has(t));
  const sharedWeight = weigh(shared, pack);
  const union = weigh(setA, pack) + weigh(setB, pack) - sharedWeight;
  const smaller = Math.min(weigh(setA, pack), weigh(setB, pack));
  return {
    jaccard: union === 0 ? 0 : sharedWeight / union,
    containment: smaller === 0 ? 0 : sharedWeight / smaller,
  };
}

const RESTATED_AT = 0.72;
const MAYBE_AT = 0.5;
/** Below this many real words, any two sentences match on function words. */
const MIN_CONTENT_TOKENS = 2;

/**
 * Judge one pair. `gapSec` is the silence between them, which is what
 * separates a self-correction from a list of similar steps: "forty percent—
 * fifty percent" half a second apart is one claim being fixed; the same two
 * figures ten seconds apart are two different claims.
 */
export function restatementEvidence(
  earlierText: string,
  laterText: string,
  gapSec: number,
  language: string = 'en',
): RestatementEvidence {
  const pack = packFor(language);
  const a = coreOf(earlierText, language);
  const b = coreOf(laterText, language);
  const reasons: string[] = [];

  const content = (tokens: string[]) =>
    new Set(tokens.filter((t) => weightOf(t, pack) === CONTENT_WEIGHT));
  if (Math.min(content(a.tokens).size, content(b.tokens).size) < MIN_CONTENT_TOKENS) {
    return { verdict: 'different', score: 0, reasons: ['too little said to compare'] };
  }

  const { jaccard, containment } = overlap(a.tokens, b.tokens, pack);
  const carriesCondition = conditionSide(a.tokens, b.tokens, pack);
  /*
   * Containment is discounted because a subset is weaker evidence than a
   * two-way match: a tightened retake ("We grew forty percent") sits entirely
   * inside the rambling one, and a perfect subset reaches 0.85 — over the bar
   * — while a partial one does not.
   */
  let score = Math.max(jaccard, containment * 0.85);
  if (score > 0.6) reasons.push(`${Math.round(score * 100)}% of the same words`);

  if (a.figures.size && b.figures.size) {
    const same = [...a.figures].filter((f) => b.figures.has(f));
    if (same.length) {
      score = Math.min(1, score + 0.08);
      reasons.push(`both say ${same.join(', ')}`);
    }
  }

  // An announced rewording is the strongest signal there is, and it is the
  // only one that can carry a pair over the line on its own.
  if (b.announced) {
    score = Math.min(1, score + 0.14);
    reasons.push('the second one announces itself as a rewording');
  }

  /* ----------------------------------------------------------- the vetoes */

  const figuresConflict =
    a.figures.size > 0 &&
    b.figures.size > 0 &&
    ![...a.figures].some((f) => b.figures.has(f));

  if (figuresConflict && !b.announced) {
    // Said back-to-back it is a correction; said apart it is the next number
    // in a list, and cutting it loses a fact.
    if (gapSec > 1.5) {
      return {
        verdict: 'different',
        score: Math.min(score, 0.45),
        reasons: [...reasons, 'different numbers, too far apart to be a correction'],
      };
    }
    reasons.push('the numbers disagree — a correction, or the next one in a list');
    return { verdict: 'maybe', score: Math.min(score, 0.7), reasons, carriesCondition };
  }

  /*
   * One of them is a denial of the other.
   *
   * "You are not competing on features" against "you are competing on how
   * quickly someone understands" shares four words out of six, and the word
   * that makes them opposite claims is grammatically a function word worth a
   * quarter of a point. Checked separately, as a veto, because there is no
   * weighting of "not" that is both honest about its grammar and loud enough
   * about its meaning.
   *
   * A retake that FIXES a misspoken negation is lost this way, and that is
   * the right side to lose on: both takes stay in the video.
   */
  if (negated(a.tokens, pack) !== negated(b.tokens, pack)) {
    return {
      verdict: 'different',
      score: Math.min(score, 0.45),
      reasons: [...reasons, 'one of them is negated and the other is not'],
      carriesCondition,
    };
  }

  if (b.sequencing && !b.announced && score < 0.8) {
    return {
      verdict: 'different',
      score: Math.min(score, 0.45),
      reasons: [...reasons, 'the second one moves on to the next item'],
      carriesCondition,
    };
  }

  if (carriesCondition) {
    reasons.push(`the ${carriesCondition} one carries a condition the other does not`);
  }

  if (score >= RESTATED_AT) return { verdict: 'restated', score, reasons, carriesCondition };
  if (score >= MAYBE_AT) {
    return {
      verdict: 'maybe',
      score,
      reasons: [...reasons, 'close, but the wording differs'],
      carriesCondition,
    };
  }
  return { verdict: 'different', score, reasons, carriesCondition };
}

function negated(tokens: string[], pack: LanguagePack): boolean {
  const marks = negationMarks(pack);
  return tokens.some((t) => marks.has(t));
}

const negationCache = new WeakMap<LanguagePack, Set<string>>();

function negationMarks(pack: LanguagePack): Set<string> {
  let hit = negationCache.get(pack);
  if (!hit) {
    hit = new Set<string>();
    for (const word of pack.negations) {
      hit.add(word);
      hit.add(canonical(word, pack));
    }
    negationCache.set(pack, hit);
  }
  return hit;
}

/** Which side has a subordinate clause the other side has no trace of. */
function conditionSide(
  a: string[],
  b: string[],
  pack: LanguagePack,
): 'earlier' | 'later' | undefined {
  const setA = new Set(a);
  const setB = new Set(b);
  const subordinators = new Set([...pack.subordinators].map((w) => light(w, pack)));
  const onlyB = [...setB].some((t) => subordinators.has(t) && !setA.has(t));
  const onlyA = [...setA].some((t) => subordinators.has(t) && !setB.has(t));
  if (onlyB && !onlyA) return 'later';
  if (onlyA && !onlyB) return 'earlier';
  return undefined;
}
