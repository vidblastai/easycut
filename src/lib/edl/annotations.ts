import type { TranscriptSentence, TranscriptWord } from '@/lib/transcribe/types';
import { listedThings } from './scene-fallback';
import { trimToWords } from '@/lib/text';
import type { Annotation } from './types';

/**
 * Lists the speaker can stand next to.
 *
 * ── The decision this encodes ───────────────────────────────────────────
 *
 * When somebody names three things in one breath, this renderer's instinct
 * was an `orbit` scene: take the frame away, draw the three things as chips
 * around a centre, give it back. Counted off a reference edit, that instinct
 * is wrong most of the time — there, a list is written down the right-hand
 * third in ticked lines while the speaker keeps talking, and the full-screen
 * treatment is saved for four moments in nearly three minutes.
 *
 * The content is identical; what differs is whether the viewer loses the
 * face. Keeping it is almost always better: the list is a thing he is SAYING,
 * and watching him say it is the video.
 *
 * ── Why this does not fight the scene pass ──────────────────────────────
 *
 * It runs after it and takes only what is left. A sentence the director
 * chose for a full-frame scene keeps it — that pass saw the whole transcript
 * and had a reason — and this fills in the many more lists it passed over,
 * which previously got nothing at all.
 */

/** A list shorter than this is two things and a conjunction, not a list. */
const MIN_ITEMS = 3;

/**
 * And longer than this does not fit beside a head.
 *
 * Five ticked lines at the column's type size is about a third of the frame's
 * height. Six starts reaching into the caption band, and a list nobody can
 * hold in their head is a wall of text either way.
 */
const MAX_ITEMS = 5;

/** Each line is a label, not a sentence. */
const MAX_ITEM_CHARS = 34;

/** A beat after the last line lands, so the finished list can be read. */
const HOLD_SEC = 1.6;

/** Two of these in quick succession is a list of lists. */
const GAP_SEC = 12;

export interface Busy {
  outStartSec: number;
  outEndSec: number;
}

export interface AnnotationPlacement {
  /** Sentences already mapped into OUTPUT seconds. */
  sentences: TranscriptSentence[];
  /** All of the transcript's words, in OUTPUT seconds, for per-item timing. */
  words: Array<{ text: string; startSec: number }>;
  /** Anything that takes the frame off the speaker. */
  busy: Busy[];
  durationSec: number;
  hookSec: number;
  /** False in a vertical frame, where the subject fills it. */
  hasRoom: boolean;
}

export function placeAnnotations(options: AnnotationPlacement): Annotation[] {
  const { sentences, words, busy, durationSec, hookSec, hasRoom } = options;
  if (!hasRoom) return [];

  const placed: Annotation[] = [];

  for (const sentence of sentences) {
    if (sentence.startSec < hookSec) continue;
    if (sentence.endSec > durationSec - HOLD_SEC) continue;
    if (placed.length && sentence.startSec - placed[placed.length - 1].outEndSec < GAP_SEC) continue;

    /*
     * The speaker has to be on screen for the whole of it.
     *
     * Not just at the start: the block builds across the sentence and then
     * holds, so an insert landing halfway through would cover a list that is
     * still arriving — worse than one that was never there, because the
     * viewer watched it start.
     */
    const covered = busy.some(
      (b) => sentence.startSec < b.outEndSec + 0.3 && sentence.endSec + HOLD_SEC > b.outStartSec - 0.3,
    );
    if (covered) continue;

    const listed = listedThings(sentence.text);
    if (!listed) continue;

    /*
     * A front stem belongs to the first line, not to the title.
     *
     * `listedThings` peels "it reads your" off "it reads your inbox, checks
     * the calendar, plans your day", which is right for an orbit — the chips
     * are nouns and the stem frames them. On a checklist it is wrong twice
     * over: it leaves a first line reading "inbox" where the others are verb
     * phrases, and it puts a fragment in the title pill.
     *
     * A trailing clause is a different thing and does belong up there, so the
     * test is where the headline sat in the sentence it came from.
     */
    const framedFromBehind =
      Boolean(listed.headline) && !sentence.text.trim().toLowerCase().startsWith(listed.headline.trim().toLowerCase());

    const lines = framedFromBehind
      ? listed.items
      : [[listed.headline, listed.items[0]].filter(Boolean).join(' '), ...listed.items.slice(1)];

    const items = lines
      .map((item) => trimToWords(item, MAX_ITEM_CHARS))
      .filter((item) => item.length > 1)
      .slice(0, MAX_ITEMS);
    if (items.length < MIN_ITEMS) continue;

    /*
     * Each line lands on the word that names it.
     *
     * Looked up in the transcript rather than spread evenly across the
     * sentence: a list is said unevenly — "the captions, the B-roll, and
     * ALL of the effects" — and lines arriving on a metronome while the
     * voice does not is the thing that reads as automated.
     */
    const offsets = items.map((item, i) => {
      const at = wordTimeFor(words, item, sentence.startSec, sentence.endSec);
      // Falling back to an even spread is better than stacking two lines on
      // one frame, which is what a missed lookup would otherwise do.
      return at ?? sentence.startSec + ((sentence.endSec - sentence.startSec) * (i + 1)) / (items.length + 1);
    });

    const outStartSec = sentence.startSec;
    const last = Math.max(...offsets);

    placed.push({
      id: `note-${placed.length}`,
      outStartSec,
      outEndSec: Math.min(last + HOLD_SEC, durationSec - 0.1),
      kind: 'checklist',
      // Alternating, so two lists in one video do not both stack in the same
      // margin — the same rule the short icon rows follow.
      side: placed.length % 2 === 0 ? 'right' : 'left',
      x: placed.length % 2 === 0 ? 0.62 : 0.38,
      y: 0.24,
      title: framedFromBehind ? trimToWords(listed.headline, 28) : '',
      items: items.map((text, i) => ({ offsetSec: Math.max(0, offsets[i] - outStartSec), text })),
      reason: `a list of ${items.length} · ${trimToWords(sentence.text, 42)}`,
    });
  }

  return placed;
}

/**
 * When the speaker says this thing, within the sentence that contains it.
 *
 * Matched on the item's first word with any leading article dropped — "the
 * calendar" is spoken as two words and the one that carries it is the second.
 */
function wordTimeFor(
  words: Array<{ text: string; startSec: number }>,
  item: string,
  from: number,
  to: number,
): number | null {
  const head = item
    .toLowerCase()
    .replace(/^(the|a|an|your|my|our|their|its)\s+/, '')
    .match(/[a-z']+/)?.[0];
  if (!head) return null;

  const hit = words.find(
    (w) => w.startSec >= from && w.startSec <= to && w.text.toLowerCase().replace(/[^a-z']/g, '') === head,
  );
  return hit ? hit.startSec : null;
}

/** Narrows the transcript's words to the two fields this needs. */
export function outputWords(
  words: TranscriptWord[],
  toOutput: (sec: number) => number | null,
): Array<{ text: string; startSec: number }> {
  return words
    .map((w) => ({ text: w.text, startSec: toOutput(w.startSec) }))
    .filter((w): w is { text: string; startSec: number } => w.startSec !== null);
}
