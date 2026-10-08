/**
 * What the editor needs to know about a language.
 *
 * ── Why this is a data structure and not four copies of the detector ────
 *
 * Almost nothing in the pipeline cares what language the footage is in. The
 * silence detector measures audio. The stammer detector compares a word to
 * the next one. The reframer looks at faces. Those work in Hungarian today
 * and nobody wrote a line of Hungarian for them.
 *
 * What does care is the part that reads MEANING: which words are filler,
 * which are grammar, how a sentence announces that it is being said again,
 * and how to strip inflection off a word so two forms of it match. That is
 * this file, four times over, and adding a fifth language is adding a table
 * rather than editing a detector.
 *
 * Each pack is deliberately small. It holds the words that do editorial work
 * — fillers, function words, restatement frames, sequencing openers, numbers,
 * subordinators, and the handful of near-synonyms a speaker swaps between
 * takes. It is not a dictionary and must not grow into one: every synonym is
 * a chance to call two different sentences the same.
 */

export type LanguageCode = 'en' | 'de' | 'fr' | 'es';

export interface LanguagePack {
  code: LanguageCode;
  /** For the UI, in English — the app's own language. */
  name: string;
  /** What the speaker would call it. */
  endonym: string;

  /**
   * Sounds that mean nothing. In English the ASR has to be asked for these
   * and hands back "um"/"uh"; in the other three they are real words it
   * transcribes without being asked — "also", "ben", "bueno" — which makes
   * this list do MORE work outside English, not less.
   */
  fillers: Set<string>;

  /** Multi-word hedges: cut only when the director agrees. */
  hedgePhrases: string[][];

  /** Grammar rather than meaning. Weighted down, never removed. */
  functionWords: Set<string>;

  /** Said out loud before a reworded line. The strongest signal there is. */
  strongFrames: string[];

  /** Discourse padding that opens any sentence. Stripped, but earns nothing. */
  weakFrames: string[];

  /** "…, I think" — noise on the end of a claim. */
  trailingHedges: string[];

  /** Openers that mean the speaker moved on to the next item. */
  sequencingOpeners: string[];

  /**
   * "and", "or" — what joins the last item of a list to the ones before it.
   *
   * Used to recognise an enumeration, which is the one long sentence that
   * must NOT be broken at its commas: "it reads your inbox, checks the
   * calendar, plans your day, and gives you the time back" is a single claim
   * with four parts, and it is also the sentence the checklist layer is
   * looking for. Split it and the list disappears.
   */
  coordinators: string[];

  /** Conditions and causes. What follows one of these is not decoration. */
  subordinators: Set<string>;

  /**
   * Negation.
   *
   * "You are not competing on features" and "you are competing on how
   * quickly someone understands" share four words out of six and are
   * opposite claims. Weighting "not" as a function word — which it is,
   * grammatically — makes it almost invisible to the overlap measure, so it
   * is checked on its own.
   */
  negations: Set<string>;

  /** Spoken numbers, so "forty percent" and "40%" are one figure. */
  numberWords: Record<string, string>;

  /** Near-equivalents a speaker swaps without noticing. Keep it short. */
  synonyms: Record<string, string>;

  /** Forms no suffix rule will join: "made" → "make", "ging" → "gehen". */
  irregulars: Record<string, string>;

  /** Two-word forms worth one word of meaning: "have to" → "must". */
  phrases: Array<[string[], string[]]>;

  /**
   * The unwritten frame: a short lead-in clause that ends in the copula.
   * "The whole reason this works is…", "Was ich eigentlich sagen will ist…",
   * "Lo que quiero decir es…". Every language has too many of these to list
   * and they all have one shape — an opener, a few words, the copula.
   *
   * `maxGap` is how many words may sit in between. German and French need
   * more than English does, because the verb goes to the end and the
   * clitics count as words.
   */
  genericFrame: { openers: string[]; copulas: string[]; maxGap: number };

  /**
   * What makes a sentence worth a camera move.
   *
   * The zoom placer reads the script for four things — a figure, an absolute
   * claim, a sentence that turns, a question — and three of those are
   * idioms, not grammar. "But here's the thing nobody tells you" has a
   * German equivalent that shares not one word with it, so a detector
   * written in English finds nothing in German footage and the camera sits
   * still for ten minutes.
   */
  punch: {
    /** A figure the sentence is built on: digits, or the big scale words. */
    figure: RegExp;
    /** The sentence turns, signalled at the front. */
    pivotOpens: RegExp;
    /** The sentence turns, signalled anywhere in it. */
    pivotAnywhere: RegExp;
    /** An absolute claim: never, always, nobody, the only. */
    superlative: RegExp;
  };

  /** Inflection off, meaning intact. */
  stem(word: string): string;

  /**
   * True when an apostrophe joins two words rather than living inside one.
   * French "qu'il" is two tokens; English "don't" is one.
   */
  elision: boolean;

  /**
   * Words so common in this language and so rare in the others that counting
   * them identifies the language. Used by `detectLanguage`.
   */
  markers: string[];

  /**
   * Passed to the ASR, and not always the same as `code` — a provider may
   * want a region ("es-419") or reject a bare code.
   */
  asrCode: string;

  /**
   * Deepgram's `smart_format` is safe in English and actively wrong in
   * French and Spanish, where it reads "pour cent" and "por ciento" as the
   * numeral 100 and puts "40 pour 100" on screen. Measured, not assumed.
   */
  smartFormat: boolean;
}

/** Strip the accents a speaker may or may not have had transcribed. */
export function deaccent(word: string): string {
  return word.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
