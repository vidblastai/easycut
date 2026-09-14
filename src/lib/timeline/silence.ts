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
 * Finds the silent stretches worth removing.
 *
 * Two signals, deliberately combined:
 *  - **transcript gaps** know where words aren't, but a gap can contain a laugh,
 *    a sigh, a prop reveal or a beat that carries the joke;
 *  - **acoustic silence** (ffmpeg `silencedetect`) knows where there is genuinely
 *    no sound.
 *
 * We only cut where both agree. That single rule is what stops an automated
 * editor from butchering delivery, and it costs nothing.
 */
export function detectRemovableSilence(
  transcript: Transcript,
  acousticSilence: Interval[],
  options: SilenceOptions,
): Interval[] {
  const words = transcript.words;
  if (!words.length) return [];

  const gaps: Interval[] = [];

  // Head: dead air before the first word (someone walking back to the camera).
  if (words[0].startSec > options.minSilenceSec) {
    gaps.push({ startSec: 0, endSec: words[0].startSec });
  }

  for (let i = 1; i < words.length; i++) {
    const gap = words[i].startSec - words[i - 1].endSec;
    if (gap >= options.minSilenceSec) {
      gaps.push({ startSec: words[i - 1].endSec, endSec: words[i].startSec });
    }
  }

  // Tail: trailing silence after the last word (reaching for the stop button).
  const lastWord = words[words.length - 1];
  if (transcript.durationSec - lastWord.endSec > options.minSilenceSec) {
    gaps.push({ startSec: lastWord.endSec, endSec: transcript.durationSec });
  }

  const confirmed: Interval[] = [];
  for (const gap of gaps) {
    // How much of this gap is acoustically silent?
    const quiet = acousticSilence.length
      ? intersectionLength(gap, acousticSilence)
      : gap.endSec - gap.startSec; // no acoustic data → trust the transcript

    const gapLength = gap.endSec - gap.startSec;
    // Less than 60 % quiet means something is happening in there. Leave it.
    if (quiet / gapLength < 0.6) continue;

    // Shrink by the padding so the cut keeps a natural breath on each side.
    const start = gap.startSec + options.paddingSec;
    const end = gap.endSec - options.paddingSec;
    if (end - start >= options.minKeepSec) {
      confirmed.push({ startSec: start, endSec: end });
    }
  }

  return mergeIntervals(confirmed);
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
