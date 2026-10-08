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
 *  1. **Strip the frame.** "What I'm saying is", "the point is", "in other
 *     words" — a restatement is announced, and the announcement is not part
 *     of the claim. Comparing the frames against each other is comparing
 *     noise. Stripping them also leaves the strongest positive signal there
 *     is: a sentence that OPENS by saying it is a rewording usually is one.
 *  2. **Fold the vocabulary.** "have to" / "need to" / "gotta" are one modal;
 *     "begin" and "start" are one verb. Folding them is what lifts the
 *     example above from 0.1 to 0.9.
 *  3. **Weight content over function.** "forty" is evidence. "you" is not.
 *     Treating them equally is why a 0.72 threshold had to be so blunt.
 *  4. **Veto the lookalikes.** A sequencing opener ("then", "next", "second")
 *     or a pair of conflicting figures means the speaker moved on, however
 *     alike the two sentences read.
 *
 * What survives all four and still cannot be settled comes back as `maybe`,
 * which is the honest answer for "We grew forty percent / We grew fifty
 * percent" — and is the band a reader is asked about in `director/retakes`.
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

/* ------------------------------------------------------------ vocabulary */

/**
 * Function words. Not removed — removed would throw away the difference
 * between "you must start" and "I must start" — but weighted down, because a
 * shared "the" is not evidence of a shared thought.
 *
 * Placeholder nouns ("thing", "stuff") sit here too: they are what someone
 * says instead of naming the subject, so they carry no more meaning than
 * "it" does.
 */
const FUNCTION_WORDS = new Set([
  'i', 'me', 'my', 'mine', 'we', 'our', 'us', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
  'it', 'its', 'they', 'them', 'their', 'this', 'that', 'these', 'those', 'a', 'an', 'the',
  'and', 'or', 'but', 'so', 'then', 'if', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from',
  'by', 'as', 'be', 'do', 'go', 'get', 'got', 'have', 'has', 'had', 'there', 'here', 'about',
  'just', 'like', 'well', 'okay', 'ok', 'now', 'really', 'very', 'actually', 'basically',
  'literally', 'anyway', 'yeah', 'yes', 'no', 'not', 'dont', 'im', 'ive', 'thats', 'kind',
  'sort', 'lot', 'also', 'too', 'even', 'still', 'again', 'right', 'thing', 'stuff',
  'something', 'anything', 'everything', 'one', 'some', 'any', 'all', 'more', 'most', 'what',
  'which', 'who', 'whom', 'how', 'why', 'when', 'where', 'because', 'out', 'up', 'down',
  'over', 'into', 'than', 'much', 'many', 'own', 'off', 'onto', 'per',
  'almost', 'nearly', 'within', 'around', 'maybe', 'probably', 'already',
]);

/**
 * Near-equivalents a speaker swaps without noticing when they say the line
 * again. Deliberately small: every entry here is a chance to call two
 * different sentences the same, so it holds only pairs that are genuinely
 * interchangeable in spoken English, not a thesaurus.
 */
const SYNONYMS: Record<string, string> = {
  begin: 'start', commence: 'start', launch: 'start', kick: 'start',
  finish: 'end', complete: 'end', wrap: 'end', conclude: 'end',
  huge: 'big', massive: 'big', enormous: 'big', giant: 'big', large: 'big',
  tiny: 'small', little: 'small', minor: 'small',
  create: 'make', build: 'make', produce: 'make', construct: 'make',
  demonstrate: 'show', reveal: 'show', display: 'show',
  fast: 'quick', rapid: 'quick', speedy: 'quick',
  simple: 'easy', straightforward: 'easy', effortless: 'easy',
  difficult: 'hard', tough: 'hard', tricky: 'hard',
  crucial: 'important', key: 'important', vital: 'important', essential: 'important',
  critical: 'important', major: 'important',
  great: 'good', awesome: 'good', amazing: 'good', excellent: 'good', brilliant: 'good',
  terrible: 'bad', awful: 'bad', horrible: 'bad', poor: 'bad',
  purchase: 'buy', acquire: 'buy',
  utilize: 'use', utilise: 'use', employ: 'use',
  believe: 'think', reckon: 'think', figure: 'think', suppose: 'think',
  tell: 'say', mention: 'say', state: 'say',
  watch: 'look', see: 'look', view: 'look',
  cash: 'money', revenue: 'money', income: 'money',
  folk: 'people', guy: 'people', person: 'people', everybody: 'people', everyone: 'people',
  need: 'must', require: 'must', ought: 'must',
  assist: 'help',
  improve: 'better', enhance: 'better', upgrade: 'better',
  reduce: 'cut', decrease: 'cut', lower: 'cut', shrink: 'cut',
  increase: 'grow', raise: 'grow', boost: 'grow', expand: 'grow',
  clip: 'video', footage: 'video',
  film: 'shoot', record: 'shoot', capture: 'shoot', filming: 'shoot',
  should: 'must', shall: 'must',
  entire: 'whole',
};

/**
 * Two-word forms that are one word's worth of meaning. "You have to start"
 * and "you need to begin" are the same instruction, and no single-word table
 * can see it — "have" is a function word until "to" follows it.
 */
const PHRASES: Array<[string[], string[]]> = [
  [['have', 'to'], ['must']],
  [['has', 'to'], ['must']],
  [['had', 'to'], ['must']],
  [['got', 'to'], ['must']],
  [['gotta'], ['must']],
  [['need', 'to'], ['must']],
  [['needs', 'to'], ['must']],
  [['ought', 'to'], ['must']],
  [['supposed', 'to'], ['must']],
  [['going', 'to'], ['will']],
  [['gonna'], ['will']],
  /*
   * "You want to shoot in log" is not a statement about anybody's desires —
   * in creator-speak it is "you should", and a speaker swaps the two between
   * takes without hearing a difference. Second person only: "I want to show
   * you something" really is about wanting.
   */
  [['you', 'want', 'to'], ['you', 'must']],
  [['you', 'wanna'], ['you', 'must']],
  [['you', 'always', 'want', 'to'], ['you', 'always', 'must']],
  [['a', 'lot'], ['many']],
  [['tons', 'of'], ['many']],
  [['loads', 'of'], ['many']],
  [['plenty', 'of'], ['many']],
  [['kick', 'off'], ['start']],
  [['give', 'up'], ['quit']],
  [['end', 'up'], ['end']],
  [['come', 'down', 'to'], ['be']],
  [['figure', 'out'], ['solve']],
  [['work', 'out'], ['solve']],
  [['set', 'up'], ['setup']],
  [['make', 'sure'], ['ensure']],
];

/* ------------------------------------------------------------------ frames */

/**
 * Said out loud before a reworded line. A sentence opening with one of these
 * is the speaker telling you it is a second attempt, which is the highest
 * precision signal in the whole detector — nobody says "in other words" and
 * then changes the subject.
 */
const STRONG_FRAMES = [
  'what i mean is', 'what i meant is', "what i'm saying is", 'what im saying is',
  "what i'm trying to say is", 'what im trying to say is', 'all im saying is',
  "all i'm saying is", 'in other words', 'put another way', 'to put it another way',
  'another way to say', 'or rather', 'or better yet', 'better yet', 'which is to say',
  'let me say that again', 'let me rephrase', 'let me put it this way', 'let me try that again',
  'let me try again', 'say that again', 'to be clear', 'to put it simply', 'put simply',
  'i should say', 'i mean to say', 'scratch that', 'sorry', 'i mean', 'or actually',
  'the point is', 'my point is', 'the point being', 'point is',
];

/**
 * Discourse padding that opens either kind of sentence. Stripped so it stops
 * inflating the overlap, but it earns no credit — "basically" means nothing
 * about whether this is a retake.
 */
const WEAK_FRAMES = [
  'so basically', 'okay so', 'ok so', 'alright so', 'right so', 'and so', 'so look',
  'look', 'listen', 'see', 'now', 'basically', 'essentially', 'anyway', 'and then',
  'so', 'and', 'but', 'well', 'yeah', 'okay', 'ok', 'alright', 'again',
];

/**
 * Trailing hedges. "…last year, I think" is the same claim as "…last year",
 * and keeping the hedge makes the hedged take look like a different sentence.
 */
const TRAILING_HEDGES = [
  'i think', 'i guess', 'you know', 'or whatever', 'or something', 'more or less',
  'i suppose', 'if that makes sense', 'right', 'you know what i mean',
];

/**
 * Openers that mean the speaker moved ON. A retake does not begin with
 * "next"; a list item does. This is what keeps "then you add the music /
 * then you add the captions" out of the cut.
 */
const SEQUENCING_OPENERS = [
  'then', 'and then', 'next', 'after that', 'second', 'secondly', 'third', 'thirdly',
  'finally', 'lastly', 'also', 'plus', 'another', 'the other', 'meanwhile', 'later',
  'first', 'firstly', 'step two', 'step three', 'now for', 'as for', 'on top of that',
];

/**
 * The verbs English refuses to inflect regularly. A suffix stripper turns
 * "making" into "mak" and leaves "made" alone, so without this the same verb
 * in two tenses reads as two different words — which is exactly what happens
 * between a first take and a second one.
 */
const IRREGULARS: Record<string, string> = {
  is: 'be', are: 'be', was: 'be', were: 'be', am: 'be', been: 'be', being: 'be',
  does: 'do', did: 'do', doing: 'do', done: 'do',
  goes: 'go', going: 'go', went: 'go', gone: 'go',
  gets: 'get', getting: 'get', gotten: 'get',
  made: 'make', said: 'say', told: 'say', took: 'take', taken: 'take',
  thought: 'think', brought: 'bring', bought: 'buy', built: 'make',
  grew: 'grow', grown: 'grow', ran: 'run', came: 'come', gave: 'give',
  meant: 'mean', kept: 'keep', left: 'leave', felt: 'feel', found: 'find',
  knew: 'know', known: 'know', saw: 'look', seen: 'look', shown: 'show',
  has: 'have', had: 'have', having: 'have', lost: 'lose', spent: 'spend',
};

/**
 * The words that hang a condition, a cause or an exception off a sentence.
 * What follows one of these is not decoration: "ten minutes" and "ten
 * minutes if your footage is organised" are different promises.
 */
const SUBORDINATORS = new Set([
  'if', 'unless', 'until', 'when', 'whenever', 'because', 'since', 'although',
  'though', 'while', 'whereas', 'provided', 'assuming', 'once', 'before',
  'after', 'except', 'without', 'versus',
]);

const NUMBER_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13',
  fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18',
  nineteen: '19', twenty: '20', thirty: '30', forty: '40', fourty: '40', fifty: '50',
  sixty: '60', seventy: '70', eighty: '80', ninety: '90', hundred: '100',
  thousand: '1000', million: '1000000', billion: '1000000000',
};

/* ------------------------------------------------------------------- core */

interface Core {
  tokens: string[];
  /** True when a STRONG_FRAME announced the sentence as a rewording. */
  announced: boolean;
  /** True when the sentence opens by moving on to the next item. */
  sequencing: boolean;
  figures: Set<string>;
}

/** What the sentence actually claims, with the packaging taken off. */
export function coreOf(text: string): Core {
  const lower = text.toLowerCase().replace(/[’]/g, "'").trim();
  const figures = figuresIn(lower);

  let body = lower.replace(/^[^\p{L}\p{N}]+/u, '');
  const sequencing = SEQUENCING_OPENERS.some((o) => startsWithPhrase(body, o));

  // Longest match first, so "what i'm saying is" wins over "i mean".
  let announced = false;
  for (const frame of [...STRONG_FRAMES].sort((a, b) => b.length - a.length)) {
    if (startsWithPhrase(body, frame)) {
      announced = true;
      body = body.slice(frame.length);
      break;
    }
  }

  // Weak frames stack: "okay so look, …" is three of them in a row.
  for (let i = 0; i < 3; i++) {
    const hit = [...WEAK_FRAMES]
      .sort((a, b) => b.length - a.length)
      .find((f) => startsWithPhrase(body, f));
    if (!hit) break;
    body = body.slice(hit.length);
  }

  /*
   * The frame nobody wrote down: a short lead-in clause ending in "is".
   * "The whole reason this works is …", "What matters here is …". There are
   * too many to list, and they all have the same shape.
   *
   * Four intervening words at most, and no number inside. Without the cap
   * this ate "it takes ten minutes if your footage is" and left the sentence
   * as the word "organised" — a frame stripper that strips the claim is
   * worse than none.
   */
  const generic = body.match(/^\s*(?:what|the|that|this|all|my|here|there)\b(?:\s+[\p{L}\p{N}']+){0,4}?\s+is\b/u);
  if (generic && !containsFigure(generic[0])) body = body.slice(generic[0].length);

  for (const hedge of TRAILING_HEDGES) {
    const trimmed = body.replace(/[^\p{L}\p{N}]+$/u, '');
    if (trimmed.endsWith(hedge)) body = trimmed.slice(0, -hedge.length);
  }

  return { tokens: fold(words(body)), announced, sequencing, figures };
}

function startsWithPhrase(body: string, phrase: string): boolean {
  if (!body.startsWith(phrase)) return false;
  const after = body.charAt(phrase.length);
  // "so" must not match the front of "software".
  return after === '' || !/[\p{L}\p{N}']/u.test(after);
}

function words(text: string): string[] {
  return text
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/'/g, '').toLowerCase())
    .filter(Boolean);
}

/** Phrase folds, then per-word synonyms over a stem. Order matters. */
function fold(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    /*
     * Longest first: "you always want to" has to beat "you want to".
     *
     * Matched on the stem, not the surface: the table says "give up" and the
     * footage says "gives up", "gave up", "giving up". Listing every
     * inflection of every phrase is how a table like this rots.
     */
    const phrase = [...PHRASES]
      .sort((a, b) => b[0].length - a[0].length)
      .find((p) => p[0].every((w, k) => tokens[i + k] !== undefined && light(tokens[i + k]) === light(w)));
    if (phrase) {
      out.push(...phrase[1].map((w) => canonical(w)));
      i += phrase[0].length;
      continue;
    }
    out.push(canonical(tokens[i]));
    i++;
  }
  return out;
}

/**
 * Inflection off, meaning intact. "Gives", "gave" and "giving" all land on
 * the same token; "begin" and "start" do not — that is `canonical`'s job.
 */
function light(word: string): string {
  if (NUMBER_WORDS[word]) return NUMBER_WORDS[word];
  return stem(IRREGULARS[word] ?? word);
}

function canonical(word: string): string {
  if (NUMBER_WORDS[word]) return NUMBER_WORDS[word];
  const base = light(word);
  // The synonym's target is stemmed too, or "everybody" lands on "people"
  // while "people" lands on "peopl" and the two never meet.
  const target = SYNONYMS[IRREGULARS[word] ?? word] ?? SYNONYMS[base];
  return target ? light(target) : base;
}

/**
 * Enough stemming to join "saying" to "say" and no more. A real stemmer
 * would also join "starting" to "star", which is how you get two unrelated
 * sentences scoring as a match.
 */
function stem(word: string): string {
  if (word.length < 4) return word;
  let out = word;
  if (out.endsWith('ies') && out.length >= 5) out = `${out.slice(0, -3)}y`;
  else if (out.endsWith('ing') && out.length >= 5) out = undouble(out.slice(0, -3));
  else if (out.endsWith('ed') && out.length >= 5) out = undouble(out.slice(0, -2));
  else if (out.endsWith('es') && out.length >= 5) out = out.slice(0, -2);
  else if (out.endsWith('s') && !/(?:ss|us|is)$/.test(out)) out = out.slice(0, -1);
  /*
   * And then the silent 'e', which is the whole reason this exists: "make"
   * and "making" strip to "make" and "mak", and a comparison that cannot see
   * those as one word cannot see a retake either.
   */
  if (out.endsWith('e') && out.length > 2) out = out.slice(0, -1);
  return out.length >= 2 ? out : word;
}

function undouble(stemmed: string): string {
  const last = stemmed.at(-1);
  const prev = stemmed.at(-2);
  if (last && last === prev && !'lsz'.includes(last)) return stemmed.slice(0, -1);
  return stemmed;
}

function containsFigure(text: string): boolean {
  return /\d/.test(text) || words(text).some((w) => NUMBER_WORDS[w]);
}

function figuresIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d+(?:[.,]\d+)*/g)) out.add(m[0].replace(/,/g, ''));
  for (const w of words(text)) if (NUMBER_WORDS[w]) out.add(NUMBER_WORDS[w]);
  return out;
}

/*
 * A function word stays a function word after folding. "the" stems to "th"
 * and "have to" folds to "must", and a lookup that misses them weights
 * "the" as heavily as "forty" — which is the bug this whole module exists to
 * fix, reintroduced one layer down.
 */
for (const word of [...FUNCTION_WORDS]) FUNCTION_WORDS.add(canonical(word));

/* ---------------------------------------------------------------- scoring */

const CONTENT_WEIGHT = 1;
const FUNCTION_WEIGHT = 0.25;

function weightOf(token: string): number {
  if (/^\d/.test(token)) return CONTENT_WEIGHT; // a figure is always the point
  return FUNCTION_WORDS.has(token) ? FUNCTION_WEIGHT : CONTENT_WEIGHT;
}

function weigh(tokens: Iterable<string>): number {
  let sum = 0;
  for (const t of tokens) sum += weightOf(t);
  return sum;
}

/** How much of the same thought, weighting the words that carry it. */
function overlap(a: string[], b: string[]): { jaccard: number; containment: number } {
  const setA = new Set(a);
  const setB = new Set(b);
  const shared = [...setA].filter((t) => setB.has(t));
  const sharedWeight = weigh(shared);
  const union = weigh(setA) + weigh(setB) - sharedWeight;
  const smaller = Math.min(weigh(setA), weigh(setB));
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
): RestatementEvidence {
  const a = coreOf(earlierText);
  const b = coreOf(laterText);
  const reasons: string[] = [];

  const contentA = a.tokens.filter((t) => weightOf(t) === CONTENT_WEIGHT);
  const contentB = b.tokens.filter((t) => weightOf(t) === CONTENT_WEIGHT);
  if (
    Math.min(new Set(contentA).size, new Set(contentB).size) < MIN_CONTENT_TOKENS
  ) {
    return { verdict: 'different', score: 0, reasons: ['too little said to compare'] };
  }

  const { jaccard, containment } = overlap(a.tokens, b.tokens);
  const carriesCondition = conditionSide(a.tokens, b.tokens);
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
    return { verdict: 'maybe', score: Math.min(score, 0.7), reasons };
  }

  if (b.sequencing && !b.announced && score < 0.8) {
    return {
      verdict: 'different',
      score: Math.min(score, 0.45),
      reasons: [...reasons, 'the second one moves on to the next item'],
    };
  }

  if (carriesCondition) {
    reasons.push(
      `the ${carriesCondition} one carries a condition the other does not`,
    );
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

/** Which side has a subordinate clause the other side has no trace of. */
function conditionSide(a: string[], b: string[]): 'earlier' | 'later' | undefined {
  const setA = new Set(a);
  const setB = new Set(b);
  const onlyB = [...setB].some((t) => SUBORDINATORS.has(t) && !setA.has(t));
  const onlyA = [...setA].some((t) => SUBORDINATORS.has(t) && !setB.has(t));
  if (onlyB && !onlyA) return 'later';
  if (onlyA && !onlyB) return 'earlier';
  return undefined;
}
