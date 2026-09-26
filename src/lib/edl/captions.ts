import type { TimeMapper } from '@/lib/timeline/time-mapper';
import type { TranscriptWord } from '@/lib/transcribe/types';
import type { CaptionCue, CaptionStyle, CaptionWord } from './types';

/**
 * Builds caption cards from surviving words.
 *
 * The grouping rules below are the difference between captions that read and
 * captions that merely exist:
 *
 *  - **Never split across a cut.** A card whose words come from either side of a
 *    splice would be on screen while the picture jumps, which reads as a bug.
 *  - **Break on punctuation first**, word count second. "So, here's the thing" /
 *    "that nobody tells you" beats a mechanical every-3-words chop.
 *  - **Never strand one word.** A trailing single-word card looks like an error;
 *    it gets pulled back into the previous card.
 *  - **Hold a minimum duration.** A word that lasted 90 ms still needs ~300 ms on
 *    screen to be readable, so cards borrow from the gap that follows.
 */

export interface BuildCaptionsOptions {
  words: TranscriptWord[];
  mapper: TimeMapper;
  style: CaptionStyle;
  /** Source-time spans the director marked for emphasis. */
  emphasis: Array<{ startSec: number; endSec: number }>;
  outputDurationSec: number;
}

const MIN_CUE_SEC = 0.36;
const MAX_CUE_SEC = 4.0;
/** A pause this long ends a card even mid-sentence — it's a natural beat. */
const BREATH_GAP_SEC = 0.45;

export function buildCaptions(options: BuildCaptionsOptions): CaptionCue[] {
  const { words, mapper, style, emphasis } = options;

  // 1. Map every surviving word onto output time, dropping the cut ones.
  const placed: Array<CaptionWord & { segmentKey: string }> = [];
  for (const word of words) {
    const start = mapper.toOutput(word.startSec);
    const end = mapper.toOutput(word.endSec);
    if (start === null || end === null || end <= start) continue;

    const segment = mapper.segmentAt(start);
    placed.push({
      /*
       * The word is stored AS SPOKEN, not as displayed.
       *
       * Casing is a styling decision, so the renderer makes it — and it has to
       * be able to make it per word: a brush-script highlight opts out of the
       * line's uppercase, and text already flattened to caps here could never
       * be opted back out. It also means the description and the SRT read as
       * sentences rather than as SHOUTING.
       */
      text: word.text,
      startSec: start,
      endSec: end,
      emphasis: emphasis.some((e) => word.startSec >= e.startSec - 0.02 && word.endSec <= e.endSec + 0.02),
      segmentKey: segment?.id ?? 'none',
    });
  }
  if (!placed.length) return [];

  placed.sort((a, b) => a.startSec - b.startSec);

  // 2. Group into cards.
  const cues: CaptionCue[] = [];
  let bucket: typeof placed = [];

  const flush = () => {
    if (!bucket.length) return;
    cues.push({
      id: `cue-${cues.length}`,
      startSec: bucket[0].startSec,
      endSec: bucket[bucket.length - 1].endSec,
      words: bucket.map(({ text, startSec, endSec, emphasis: isEmphasis }) => ({
        text,
        startSec,
        endSec,
        emphasis: isEmphasis,
      })),
    });
    bucket = [];
  };

  for (let i = 0; i < placed.length; i++) {
    const word = placed[i];
    const previous = bucket[bucket.length - 1];

    // A cut, a long pause, or an over-long card forces a break before this word.
    if (previous) {
      const crossesCut = previous.segmentKey !== word.segmentKey;
      const gap = word.startSec - previous.endSec;
      const cardLength = word.endSec - bucket[0].startSec;

      if (crossesCut || gap > BREATH_GAP_SEC || cardLength > MAX_CUE_SEC) {
        flush();
      }
    }

    bucket.push(word);

    /*
     * A highlighted word ends its card.
     *
     * The style can put the emphasised word on a line of its own, underneath
     * the plain ones — "WATCHING WAS / entirely". That only reads if the word
     * is LAST: an emphasised word in the middle leaves the rest of the
     * sentence stranded below it, which is the opposite of the shape being
     * aimed for.
     *
     * Only when the style actually asks. Presets that merely recolour an
     * emphasised word want it to stay where it fell in the sentence, and
     * breaking their cards early would shorten every card for nothing.
     */
    if (style.emphasisOwnLine && word.emphasis) {
      if (bucket.length > 1) {
        flush();
        continue;
      }
      /*
       * It opened the card, so there is nothing above it to sit under.
       *
       * Left alone it would head a card and the plain words would follow it
       * ACROSS the line — which is what shipped: "right NOW", the script word
       * first and inline, the one shape this rule exists to prevent. So it
       * goes back onto the card in front of it, where it becomes that card's
       * last word and lands on the line below. If it cannot (a cut between
       * them, too long a pause, a card already full or already ending on a
       * highlight) it stays a card of its own — one word alone reads fine;
       * one word leading a line does not.
       */
      const target = cues[cues.length - 1];
      const before = placed[i - 1];
      const fits =
        target &&
        before &&
        before.segmentKey === word.segmentKey &&
        word.startSec - target.endSec <= BREATH_GAP_SEC &&
        word.endSec - target.startSec <= MAX_CUE_SEC + 0.5 &&
        // The highlight sits on a line of its own, so the plain line still
        // holds no more words than the style asked for — one over the card
        // limit here costs the reader nothing.
        target.words.length <= style.maxWordsPerCue &&
        !target.words[target.words.length - 1].emphasis;

      if (fits) {
        target.words.push({
          text: word.text,
          startSec: word.startSec,
          endSec: word.endSec,
          emphasis: true,
        });
        target.endSec = word.endSec;
        bucket = [];
      } else {
        flush();
      }
      continue;
    }

    const endsClause = /[,.!?;:]$/.test(word.text);
    const atWordLimit = bucket.length >= style.maxWordsPerCue;
    // Break on a clause boundary as soon as the card has some substance, so
    // punctuation wins over the raw word count.
    if (atWordLimit || (endsClause && bucket.length >= Math.max(2, style.maxWordsPerCue - 2))) {
      flush();
    }
  }
  flush();

  // 3. Repair: no orphan single-word cards, and enforce a readable minimum.
  return repair(cues, options.outputDurationSec, style);
}

function repair(cues: CaptionCue[], durationSec: number, style: CaptionStyle): CaptionCue[] {
  const maxWords = style.maxWordsPerCue;
  const result: CaptionCue[] = [];
  /*
   * A short word held back because it could not join the card in front of it.
   * It joins the next card instead, which is the only other place it can go
   * without undoing the rule that put it here.
   */
  let carried: CaptionCue['words'] = [];

  for (const cue of cues) {
    const words = carried.length ? [...carried, ...cue.words] : [...cue.words];
    carried = [];

    const previous = result[result.length - 1];
    const isOrphan = words.length === 1 && words[0].text.length <= 4;
    const canMerge =
      previous &&
      previous.words.length < maxWords + 1 &&
      cue.startSec - previous.endSec < BREATH_GAP_SEC &&
      cue.endSec - previous.startSec < MAX_CUE_SEC + 0.5;
    /*
     * Never tack a word onto a card whose highlight is meant to sit alone
     * underneath. Doing so puts a plain word after the highlight, which is the
     * exact shape the flush in step 2 exists to avoid — the merge that tidies
     * an orphan would quietly undo it on the very cards it matters for.
     */
    const wouldStrandTheHighlight =
      style.emphasisOwnLine && !!previous?.words[previous.words.length - 1]?.emphasis;

    if (isOrphan && canMerge && !wouldStrandTheHighlight) {
      previous!.words.push(...words);
      previous!.endSec = cue.endSec;
      continue;
    }
    if (isOrphan && wouldStrandTheHighlight) {
      carried = words;
      continue;
    }
    // A carried word starts earlier than the card it joined, so the card has
    // to come up when its first word is spoken.
    result.push({ ...cue, startSec: words[0].startSec, words });
  }
  if (carried.length) {
    result.push({
      id: `cue-${result.length}`,
      startSec: carried[0].startSec,
      endSec: carried[carried.length - 1].endSec,
      words: carried,
    });
  }

  // Extend short cards into the gap that follows them, never over the next card.
  for (let i = 0; i < result.length; i++) {
    const cue = result[i];
    const ceiling = result[i + 1]?.startSec ?? durationSec;
    if (cue.endSec - cue.startSec < MIN_CUE_SEC) {
      cue.endSec = Math.min(ceiling - 0.01, cue.startSec + MIN_CUE_SEC);
    }
    // A tiny hold after the last word stops cards from flickering out mid-read.
    cue.endSec = Math.min(ceiling, cue.endSec + 0.08);
  }

  return result.filter((c) => c.endSec > c.startSec && c.words.length > 0);
}

/** Plain text of the finished edit — used for the description and SEO. */
export function captionsToText(cues: CaptionCue[]): string {
  return cues
    .map((c) => c.words.map((w) => w.text).join(' '))
    .join(' ')
    .replace(/\s+([,.!?;:])/g, '$1');
}
