import type { Transcript, TranscriptWord } from '@/lib/transcribe/types';

export interface Interval {
  startSec: number;
  endSec: number;
}

export interface SilenceOptions {
  /** Gaps shorter than this are never touched — speech needs to breathe. */
  minSilenceSec: number;
  /** Leave this much silence on each side of a kept span, so cuts aren't jarring. */
  paddingSec: number;
  /** Never let a removal leave less than this much audible runway. */
  minKeepSec: number;
}

export const SILENCE_PRESETS: Record<'aggressive' | 'balanced' | 'gentle' | 'micro', SilenceOptions> = {
  // Short-form raw footage: rip out everything that isn't a word.
  aggressive: { minSilenceSec: 0.22, paddingSec: 0.05, minKeepSec: 0.12 },
  // Default for raw long-form.
  balanced: { minSilenceSec: 0.4, paddingSec: 0.11, minKeepSec: 0.2 },
  // Thoughtful / documentary delivery, where pauses carry meaning.
  gentle: { minSilenceSec: 0.75, paddingSec: 0.2, minKeepSec: 0.3 },
  // For footage the user already edited — only truly dead air.
  micro: { minSilenceSec: 1.1, paddingSec: 0.25, minKeepSec: 0.4 },
};

/**
 * The ASR's word boundaries are approximate. ffmpeg's are not.
 *
 * This used to look for gaps BETWEEN words and then ask the acoustic detector
 * to confirm them, and on real footage that missed most of the pauses. Three
 * measured from a 40s take:
 *
 *   - 0.57s of silence at 3.65–4.21, where the transcript's gap is 0.16s. The
 *     word before it is "not…", timed to 3.92: Deepgram pushed the boundary a
 *     quarter-second past the last audible sound, so the gap never cleared the
 *     0.22s floor and the pause was never a candidate.
 *   - 0.34s at 30.13–30.47, straddling a sentence boundary whose transcript
 *     gap is 0.08s.
 *   - 0.25s at 34.15–34.40, sitting INSIDE the word "and" — one word given a
 *     0.64s span because the speaker paused in the middle of saying it. There
 *     is no gap there at all to find.
 *
 * Together that is 1.9s of dead air in a 40s video, which is the difference
 * between an edit that feels cut and one that does not. So the acoustic
 * signal leads now: `silencedetect` at -50dB does not trip on room tone or
 * breathing, and where it says there is no sound, cutting removes nothing
 * audible — whatever the word timings claim.
 *
 * The transcript's job is the veto, not the proposal. A laugh, a sigh or a
 * prop reveal is not silent, so it never appears here in the first place; and
 * a stretch the ASR puts the CENTRE of a word inside is one where the two
 * signals genuinely disagree, so it is left alone. That invariant is what
 * keeps the division of labour honest: this pass removes silence and can
 * never remove a word. Cleanup removes words.
 */
export function detectRemovableSilence(
  transcript: Transcript,
  acousticSilence: Interval[],
  options: SilenceOptions,
): Interval[] {
  const words = transcript.words;
  if (!words.length) return [];

  const candidates: Interval[] = [];

  if (acousticSilence.length) {
    for (const quiet of acousticSilence) {
      // The two signals disagree about this stretch: ffmpeg heard nothing,
      // the ASR heard the middle of a word. Nothing gets cut on a
      // disagreement — a dropped word is a far worse edit than a kept pause.
      if (holdsAWord(quiet, words)) continue;
      candidates.push(quiet);
    }
  } else {
    /*
     * No acoustic data — `silencedetect` failed or was never run. Fall back to
     * the transcript's own gaps, which is what this function did for every
     * stretch before the acoustic signal led. Worse, and still an edit.
     */
    if (words[0].startSec > options.minSilenceSec) {
      candidates.push({ startSec: 0, endSec: words[0].startSec });
    }
    for (let i = 1; i < words.length; i++) {
      if (words[i].startSec - words[i - 1].endSec >= options.minSilenceSec) {
        candidates.push({ startSec: words[i - 1].endSec, endSec: words[i].startSec });
      }
    }
  }

  /*
   * The tail is always transcript-driven.
   *
   * `silencedetect` reports a `silence_start` and waits for the sound to come
   * back before reporting the end of the interval — and on a take that ends
   * in silence it never does, so the last interval is dropped at EOF. That is
   * the one stretch the parser cannot see and the one most likely to be
   * several seconds long: somebody reaching for the stop button.
   */
  const lastWord = words[words.length - 1];
  if (transcript.durationSec - lastWord.endSec > options.minSilenceSec) {
    candidates.push({ startSec: lastWord.endSec, endSec: transcript.durationSec });
  }

  const confirmed: Interval[] = [];
  for (const quiet of mergeIntervals(candidates)) {
    if (quiet.endSec - quiet.startSec < options.minSilenceSec) continue;

    // Shrink by the padding so the cut keeps a natural breath on each side.
    const start = quiet.startSec + options.paddingSec;
    // Except at the very end, where there is nothing left to breathe before.
    const atEnd = quiet.endSec >= transcript.durationSec - 0.01;
    const end = atEnd ? quiet.endSec : quiet.endSec - options.paddingSec;
    if (end - start >= options.minKeepSec) {
      confirmed.push({ startSec: start, endSec: end });
    }
  }

  return mergeIntervals(confirmed);
}

/**
 * Whether a silent stretch contains the centre of a spoken word.
 *
 * The midpoint rather than any overlap, and that is the same test
 * `wordsOutsideRemovals` uses to decide which words survive a cut — they have
 * to agree, or this pass can propose a removal that silently deletes a word
 * from the captions. Overlap alone would veto almost everything: the ASR runs
 * its boundaries into the silence on both sides of every pause, which is the
 * whole reason this function is needed.
 */
function holdsAWord(quiet: Interval, words: TranscriptWord[]): boolean {
  for (const word of words) {
    const mid = (word.startSec + word.endSec) / 2;
    if (mid > quiet.startSec && mid < quiet.endSec) return true;
  }
  return false;
}

/** Proportion of the timeline that is dead air — drives the raw/roughcut hint. */
export function silenceDensity(transcript: Transcript, acousticSilence: Interval[]): number {
  if (!transcript.durationSec) return 0;
  const silence = detectRemovableSilence(transcript, acousticSilence, SILENCE_PRESETS.balanced);
  const total = silence.reduce((sum, s) => sum + (s.endSec - s.startSec), 0);
  return total / transcript.durationSec;
}

/**
 * Inverts a removal list into the keep list, given the full duration.
 * Everything downstream works in terms of keeps.
 */
export function invertIntervals(removals: Interval[], durationSec: number): Interval[] {
  const sorted = mergeIntervals(removals);
  const keeps: Interval[] = [];
  let cursor = 0;

  for (const r of sorted) {
    if (r.startSec > cursor) keeps.push({ startSec: cursor, endSec: r.startSec });
    cursor = Math.max(cursor, r.endSec);
  }
  if (cursor < durationSec) keeps.push({ startSec: cursor, endSec: durationSec });

  return keeps.filter((k) => k.endSec - k.startSec > 0.01);
}

export function mergeIntervals(intervals: Interval[], gapToleranceSec = 0.02): Interval[] {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.startSec - b.startSec);
  const merged: Interval[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].startSec - last.endSec <= gapToleranceSec) {
      last.endSec = Math.max(last.endSec, sorted[i].endSec);
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}

export function subtractIntervals(base: Interval[], remove: Interval[]): Interval[] {
  let result = [...base];
  for (const r of mergeIntervals(remove)) {
    const next: Interval[] = [];
    for (const b of result) {
      if (r.endSec <= b.startSec || r.startSec >= b.endSec) {
        next.push(b);
        continue;
      }
      if (r.startSec > b.startSec) next.push({ startSec: b.startSec, endSec: r.startSec });
      if (r.endSec < b.endSec) next.push({ startSec: r.endSec, endSec: b.endSec });
    }
    result = next;
  }
  return result.filter((i) => i.endSec - i.startSec > 0.01);
}

function intersectionLength(a: Interval, others: Interval[]): number {
  let total = 0;
  for (const b of others) {
    const lo = Math.max(a.startSec, b.startSec);
    const hi = Math.min(a.endSec, b.endSec);
    if (hi > lo) total += hi - lo;
  }
  return total;
}

/** Words that survive a set of removals — used to rebuild captions after cuts. */
export function wordsOutsideRemovals(words: TranscriptWord[], removals: Interval[]): TranscriptWord[] {
  const merged = mergeIntervals(removals);
  return words.filter((w) => {
    const mid = (w.startSec + w.endSec) / 2;
    return !merged.some((r) => mid >= r.startSec && mid <= r.endSec);
  });
}
