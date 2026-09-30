import { describe, expect, it } from 'vitest';
import { runHeuristicDirector } from '@/lib/director/heuristic';
import { cuesForDensity, thinCues, transitionCues } from '@/lib/edl/sfx-cues';
import { BrollClipSchema } from '@/lib/edl/types';
import { STYLE_LIST, pacingFor, type FormatMode } from '@/lib/styles/presets';
import { deriveSentences, type Transcript, type TranscriptWord } from '@/lib/transcribe/types';

/**
 * Every style, in every format it claims, through the rule-based director.
 *
 * This exists because four styles say "never punch in" by writing
 * `punchInEverySec: [0, 0]`, and the loop that reads it stepped by the cadence.
 * A step of zero does not mean never — it means `t` stops advancing, the
 * condition stays true, and the array grows until the process dies. Eight
 * style-and-format combinations hung and took the heap with them, and because
 * this director is the fallback when no model key is configured, that was the
 * DEFAULT path for a third of the catalogue.
 *
 * A unit test on the guard would have passed while the catalogue stayed broken,
 * so the test is the catalogue: build every combination and require it to
 * finish.
 */

function transcript(durationSec: number): Transcript {
  const n = Math.floor(durationSec * 2.2);
  const words: TranscriptWord[] = Array.from({ length: n }, (_, i) => ({
    text: ['pricing', 'is', 'a', 'positioning', 'decision', '40%', 'banana', 'deadline'][i % 8],
    startSec: (i * durationSec) / n,
    endSec: (i * durationSec) / n + 0.3,
    confidence: 1,
    speaker: 0,
    isFiller: false,
    endsSentence: i % 11 === 10,
  }));
  return {
    provider: 'test', language: 'en', durationSec,
    text: words.map((w) => w.text).join(' '),
    words, sentences: deriveSentences(words),
  };
}

const COMBINATIONS = STYLE_LIST.flatMap((style) =>
  (['short', 'long'] as FormatMode[])
    .filter((mode) => style.formats.includes(mode))
    .map((mode) => ({ style, mode })),
);

describe('the rule-based director, across the whole catalogue', () => {
  it('covers both formats somewhere in the list', () => {
    expect(COMBINATIONS.some((c) => c.mode === 'long')).toBe(true);
    expect(COMBINATIONS.some((c) => c.mode === 'short')).toBe(true);
  });

  it.each(COMBINATIONS.map((c) => [`${c.style.id} · ${c.mode}`, c] as const))(
    'finishes for %s',
    (_label, { style, mode }) => {
      const durationSec = mode === 'short' ? 55 : 600;
      const tr = transcript(durationSec);
      const plan = runHeuristicDirector({
        transcript: tr, style, mode, inputMode: 'raw',
        windowStartSec: 0, windowEndSec: durationSec,
        totalDurationSec: durationSec, targetDurationSec: durationSec,
      });

      // Finishing is most of the point, but a plan that finished by emitting
      // nothing at all would pass a bare "did not hang" check.
      const cadence = (pacingFor(style, mode).punchInEverySec[0] + pacingFor(style, mode).punchInEverySec[1]) / 2;
      if (cadence <= 0) {
        // "Never punch in" has to mean none, not one, not a million.
        expect(plan.punchIns).toHaveLength(0);
      } else {
        expect(plan.punchIns.length).toBeLessThan(durationSec / cadence + 2);
      }
      // Nothing may run away: a 10-minute video is not 10,000 inserts.
      expect(plan.broll.length).toBeLessThan(400);
      expect(plan.graphics.length).toBeLessThan(400);
      expect(plan.sfx.length).toBeLessThan(800);
    },
    20_000,
  );
});

describe('a pacing interval of zero', () => {
  it('is spelled the same way by every style that means never', () => {
    // If a style ever wants "no B-roll" or "no graphics", it has to say it the
    // same way, because that is the only spelling the guards understand.
    for (const style of STYLE_LIST) {
      for (const mode of ['short', 'long'] as FormatMode[]) {
        if (!style.formats.includes(mode)) continue;
        const p = pacingFor(style, mode);
        expect(p.brollEverySec, `${style.id}/${mode}`).toBeGreaterThanOrEqual(0);
        expect(p.graphicEverySec, `${style.id}/${mode}`).toBeGreaterThanOrEqual(0);
        expect(p.punchInEverySec[0], `${style.id}/${mode}`).toBeGreaterThanOrEqual(0);
        expect(p.punchInEverySec[1], `${style.id}/${mode}`).toBeGreaterThanOrEqual(p.punchInEverySec[0]);
      }
    }
  });

  it('asks for less of everything in long form than in short', () => {
    // Not a style rule, a format one: the same style in long form should be
    // calmer than in short, and this is what makes the sound effects thin out
    // without a single `mode` check in the cue placement.
    for (const style of STYLE_LIST) {
      if (!style.formats.includes('short') || !style.formats.includes('long')) continue;
      const short = pacingFor(style, 'short');
      const long = pacingFor(style, 'long');
      expect(long.brollEverySec, `${style.id} b-roll`).toBeGreaterThanOrEqual(short.brollEverySec);
      expect(long.sfxDensity, `${style.id} sfx`).toBeLessThanOrEqual(short.sfxDensity);
    }
  });
});


describe('every style makes some sound', () => {
  /*
   * A style picks its own clip transitions and its own sfx density, and the two
   * are set in different places by different judgements. Cross them and a style
   * can end up with every transition it uses below the floor its density
   * clears — which is exactly what happened to documentary in long form, where
   * film burn, light leak, zoom and a deliberately silent fade added up to a
   * video with no transition sounds at all.
   *
   * The pairing is what has to be tested, because neither half is wrong alone.
   */
  it.each(COMBINATIONS.map((c) => [`${c.style.id} · ${c.mode}`, c] as const))(
    'has at least one audible transition in %s',
    (_label, { style, mode }) => {
      const density = pacingFor(style, mode).sfxDensity;
      const frame = mode === 'short'
        ? { width: 1080, height: 1920 }
        : { width: 1920, height: 1080 };

      // One insert per transition the style is allowed to use.
      const broll = style.clipTransitions.map((transition, i) =>
        BrollClipSchema.parse({
          id: `b-${i}`, outStartSec: 2 + i * 6, outEndSec: 6 + i * 6,
          kind: 'stock-video', url: 'u', query: 'thing',
          enter: transition, exit: transition,
        }),
      );

      const kept = thinCues(cuesForDensity(transitionCues(broll, [], frame), density));
      expect(
        kept.length,
        `${style.id}/${mode} (density ${density}) uses ${style.clipTransitions.join(', ')} and makes no sound`,
      ).toBeGreaterThan(0);
    },
  );
});
