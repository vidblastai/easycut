import { describe, expect, it } from 'vitest';

/**
 * The timeline's speech bars.
 *
 * The drawing itself lives inside TimelineEditor, but the arithmetic is worth
 * pinning here: it was rewritten from a scan-from-the-start into a single
 * forward cursor, and a cursor that advances one step too eagerly produces a
 * waveform that is subtly wrong rather than obviously broken — bars drawn
 * against the next word instead of the current one, on a control people trim
 * against. Nothing else in the suite would notice.
 */

interface Word { startSec: number; endSec: number; emphasis?: boolean }

/** The shape the component builds, extracted so it can be asserted on. */
function bars(words: Word[], durationSec: number, count: number): number[] {
  let cursor = 0;
  return Array.from({ length: count }, (_, i) => {
    const at = (i / count) * durationSec;
    while (cursor < words.length && words[cursor].endSec + 0.02 < at) cursor += 1;

    const word = words[cursor];
    if (!word || at < word.startSec - 0.02) return 0.1;

    const through = (at - word.startSec) / Math.max(0.05, word.endSec - word.startSec);
    return 0.35 + Math.sin(through * Math.PI) * 0.55 + (word.emphasis ? 0.1 : 0);
  });
}

/** What it replaced: correct, and quadratic. */
function barsByScan(words: Word[], durationSec: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const at = (i / count) * durationSec;
    const word = words.find((w) => at >= w.startSec - 0.02 && at <= w.endSec + 0.02);
    if (!word) return 0.1;
    const through = (at - word.startSec) / Math.max(0.05, word.endSec - word.startSec);
    return 0.35 + Math.sin(through * Math.PI) * 0.55 + (word.emphasis ? 0.1 : 0);
  });
}

function speech(count: number, gapEvery: number): { words: Word[]; durationSec: number } {
  const words: Word[] = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    const dur = 0.22 + ((i * 13) % 9) / 40;
    words.push({ startSec: +t.toFixed(3), endSec: +(t + dur * 0.82).toFixed(3), emphasis: i % 17 === 0 });
    t += dur;
    // The gaps the silence cutter leaves behind — the interesting case, because
    // that is where the cursor has to stop advancing and report quiet.
    if (i % gapEvery === gapEvery - 1) t += 1.4;
  }
  return { words, durationSec: t };
}

describe('timeline speech bars', () => {
  it('matches a plain scan on a short video', () => {
    const { words, durationSec } = speech(36, 4);
    expect(bars(words, durationSec, 220)).toEqual(barsByScan(words, durationSec, 220));
  });

  it('matches a plain scan across ten minutes of speech', () => {
    // 2,400 words is what a real 600-second transcript produces.
    const { words, durationSec } = speech(2400, 8);
    expect(bars(words, durationSec, 1400)).toEqual(barsByScan(words, durationSec, 1400));
  });

  it('draws quiet in the gaps rather than the next word', () => {
    const words: Word[] = [
      { startSec: 0, endSec: 0.5 },
      { startSec: 4, endSec: 4.5 },
    ];
    // 10 bars over 5s: bar 4 sits at 2.0s, squarely in the gap.
    const out = bars(words, 5, 10);
    expect(out[4]).toBe(0.1);
    expect(out[0]).toBeGreaterThan(0.1);
    expect(out[8]).toBeGreaterThan(0.1);
  });

  it('is linear, not quadratic', () => {
    const { words, durationSec } = speech(3600, 6);
    const started = performance.now();
    bars(words, durationSec, 1400);
    // The scan version takes >100ms on this input. Ten is a ceiling that fails
    // loudly if the flatten or the scan ever creeps back inside the loop.
    expect(performance.now() - started).toBeLessThan(10);
  });
});
