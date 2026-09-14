import { describe, expect, it } from 'vitest';
import { buildCaptions } from '@/lib/edl/captions';
import { CaptionStyleSchema } from '@/lib/edl/types';
import { layoutSegments, TimeMapper } from '@/lib/timeline/time-mapper';
import type { TranscriptWord } from '@/lib/transcribe/types';

const style = CaptionStyleSchema.parse({ maxWordsPerCue: 3 });

function words(spec: Array<[string, number, number]>): TranscriptWord[] {
  return spec.map(([text, startSec, endSec]) => ({
    text,
    startSec,
    endSec,
    confidence: 1,
    speaker: 0,
    isFiller: false,
    endsSentence: /[.!?]$/.test(text),
  }));
}

describe('caption building', () => {
  it('drops words that were cut out of the edit', () => {
    const mapper = new TimeMapper(
      layoutSegments([
        { sourceStartSec: 0, sourceEndSec: 2 },
        { sourceStartSec: 4, sourceEndSec: 6 },
      ]),
    );

    const cues = buildCaptions({
      words: words([
        ['Hello', 0.1, 0.6],
        ['gone', 2.5, 3.0], // inside the removed region
        ['again', 4.1, 4.6],
      ]),
      mapper,
      style,
      emphasis: [],
      outputDurationSec: mapper.outputDuration,
    });

    const text = cues.flatMap((c) => c.words.map((w) => w.text)).join(' ');
    expect(text).toContain('Hello');
    expect(text).toContain('again');
    expect(text).not.toContain('gone');
  });

  it('never puts words from either side of a cut on the same card', () => {
    const mapper = new TimeMapper(
      layoutSegments([
        { sourceStartSec: 0, sourceEndSec: 1 },
        { sourceStartSec: 5, sourceEndSec: 6 },
      ]),
    );

    const cues = buildCaptions({
      words: words([
        ['one', 0.1, 0.4],
        ['two', 0.4, 0.9],
        ['three', 5.05, 5.4],
        ['four', 5.4, 5.9],
      ]),
      mapper,
      style,
      emphasis: [],
      outputDurationSec: mapper.outputDuration,
    });

    // A card straddling the splice would sit on screen while the picture jumps.
    for (const cue of cues) {
      const texts = cue.words.map((w) => w.text);
      const hasBefore = texts.some((t) => ['one', 'two'].includes(t));
      const hasAfter = texts.some((t) => ['three', 'four'].includes(t));
      expect(hasBefore && hasAfter).toBe(false);
    }
  });

  it('marks the words the director emphasised', () => {
    const mapper = new TimeMapper(layoutSegments([{ sourceStartSec: 0, sourceEndSec: 3 }]));
    const cues = buildCaptions({
      words: words([
        ['we', 0.1, 0.3],
        ['grew', 0.3, 0.7],
        ['forty', 0.7, 1.1],
      ]),
      mapper,
      style,
      emphasis: [{ startSec: 0.7, endSec: 1.1 }],
      outputDurationSec: 3,
    });

    const emphasised = cues.flatMap((c) => c.words).filter((w) => w.emphasis);
    expect(emphasised.map((w) => w.text)).toEqual(['forty']);
  });

  it('holds a very short card on screen long enough to read', () => {
    const mapper = new TimeMapper(layoutSegments([{ sourceStartSec: 0, sourceEndSec: 5 }]));
    const cues = buildCaptions({
      words: words([['hi', 0.1, 0.18]]),
      mapper,
      style,
      emphasis: [],
      outputDurationSec: 5,
    });

    expect(cues).toHaveLength(1);
    expect(cues[0].endSec - cues[0].startSec).toBeGreaterThanOrEqual(0.3);
  });

  it('produces nothing at all when there is no transcript', () => {
    const mapper = new TimeMapper(layoutSegments([{ sourceStartSec: 0, sourceEndSec: 5 }]));
    expect(
      buildCaptions({ words: [], mapper, style, emphasis: [], outputDurationSec: 5 }),
    ).toEqual([]);
  });
});
