import type { BrollSource } from './ai-broll';

/**
 * Which source each individual insert comes from.
 *
 * ── Why one setting for a whole video was the wrong shape ───────────────
 *
 * The wizard asked once — stock, AI pictures, or AI video — and then every
 * cue in the edit came from that one place. Both ends of that are wrong in
 * the same way, and you can see it in any reference edit: "a developer at a
 * desk" is a thing a stock library has ten thousand of, shot properly, for
 * nothing, and generating it is paying to get something worse; "your inbox at
 * 4am with 117 unread" is a thing no library has, and searching for it
 * returns a stranger smiling at a laptop.
 *
 * So the choice belongs to the CUE, not to the video. `mixed` is the default
 * and the other three stay as overrides, because somebody who wants a
 * consistent look — or who has no generation key, or no budget — is making a
 * real choice and should keep it.
 *
 * ── It is a property of the words, so it is decided here ────────────────
 *
 * Same reasoning as the icon-row grouping and the punch-in placement: the
 * question "could a camera have been pointed at this?" has an exact answer
 * most of the time, it is cheap to compute, and asking a model per cue buys
 * variance and latency rather than judgement.
 */

/**
 * The things stock libraries are deep in.
 *
 * Not a list of nouns — a list of the SUBJECTS that get shot commercially
 * over and over: people at work, places, weather, food, hands doing things.
 * A query that lands in here will find a real, well-lit, well-shot clip, and
 * a generated one would be a worse version of something free.
 */
const STOCK_RICH = [
  // people, and what they are doing
  'person', 'people', 'man', 'woman', 'team', 'meeting', 'crowd', 'customer',
  'student', 'teacher', 'doctor', 'chef', 'worker', 'developer', 'designer',
  'talking', 'walking', 'running', 'working', 'typing', 'writing', 'reading',
  'cooking', 'driving', 'shopping', 'training', 'handshake', 'presentation',
  // places
  'office', 'desk', 'city', 'street', 'studio', 'kitchen', 'cafe', 'coffee',
  'gym', 'beach', 'forest', 'mountain', 'ocean', 'road', 'airport', 'shop',
  'warehouse', 'factory', 'classroom', 'library', 'home', 'garden', 'park',
  // things a camera finds easily
  'laptop', 'computer', 'phone', 'screen', 'camera', 'notebook', 'whiteboard',
  'money', 'cash', 'clock', 'calendar', 'book', 'car', 'train', 'plane',
  'sunset', 'sunrise', 'rain', 'snow', 'sky', 'water', 'fire', 'plant', 'tree',
  'food', 'dog', 'cat',
];

/**
 * The words that mean a camera was never going to find this.
 *
 * Two kinds, and they fail differently. An ABSTRACTION ("momentum", "the
 * algorithm") sends the searcher looking for a mood and it returns a model
 * looking thoughtful. A SPECIFIC ("your inbox at 4am", "a chart showing
 * churn") is a real picture that simply does not exist in a library, and the
 * search comes back with the nearest generic thing instead.
 */
const NEEDS_MAKING = [
  'concept', 'idea', 'strategy', 'mindset', 'algorithm', 'future', 'growth',
  'momentum', 'potential', 'freedom', 'chaos', 'overwhelm', 'burnout',
  'workflow', 'pipeline', 'dashboard', 'interface', 'notification', 'inbox',
  'diagram', 'chart', 'graph', 'illustration', 'abstract', 'surreal',
  'glowing', 'floating', 'futuristic', 'holographic', 'robot', 'android',
];

/**
 * Long enough to be a described PICTURE rather than a subject.
 *
 * Only ever consulted for a query with no concrete anchor in it. "A team
 * meeting in an office" is six words and a stock library has ten thousand of
 * them; length on its own is not evidence of anything, which is what the
 * first version of this got wrong.
 */
const DESCRIBED_SCENE_WORDS = 7;

export interface MixOptions {
  /** What the wizard chose. Anything but `mixed` is returned unchanged. */
  chosen: BrollSource;
  /** Sources this deployment can actually reach. */
  available: (source: BrollSource) => boolean;
}

/**
 * The source for one insert.
 *
 * Falls back along the same path the asset stage already takes — a source
 * that is not configured becomes stock rather than a hole — so this can be
 * asked before anything is known about keys and still answer usefully.
 */
export function sourceForQuery(query: string, options: MixOptions): BrollSource {
  const { chosen, available } = options;
  if (chosen !== 'mixed') return available(chosen) ? chosen : 'stock';

  const want = wantsMaking(query) ? 'ai-image' : 'stock';
  return available(want) ? want : 'stock';
}

/** Whether this subject is better made than found. */
export function wantsMaking(query: string): boolean {
  const words = query.toLowerCase().match(/[a-z]+/g) ?? [];
  if (!words.length) return false;

  /*
   * Making needs a POSITIVE reason. Searching is the default.
   *
   * The first version had this the other way round — anything without a word
   * from the stock list got generated — and the list is a few dozen nouns
   * against a language, so "a bridge" and "a violin" were being made at three
   * cents apiece while the library had them for nothing. The bias belongs
   * this way: stock is free and instant, so an uncertain call should cost
   * nothing rather than money and ten seconds of waiting.
   */
  if (words.some((w) => NEEDS_MAKING.includes(w))) return true;

  // A long query with nothing concrete in it is somebody describing a picture
  // they imagined. With a concrete anchor it is just a well-specified shot,
  // and the library is full of those.
  const anchored = words.some((w) => STOCK_RICH.includes(w));
  return !anchored && words.length >= DESCRIBED_SCENE_WORDS;
}

/**
 * The share of a video's inserts that will be made rather than found.
 *
 * The wizard quotes money before anything is cut, and with `mixed` the count
 * is no longer "all of them" — so it needs this to avoid quoting a generated
 * price for an edit that will mostly search.
 */
export function makingShare(queries: string[]): number {
  if (!queries.length) return 0;
  return queries.filter(wantsMaking).length / queries.length;
}
