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

describe('putting the highlighted word on its own line', () => {
  const mapper = () => new TimeMapper(layoutSegments([{ sourceStartSec: 0, sourceEndSec: 5 }]));
  const spec: Array<[string, number, number]> = [
    ['watching', 0.1, 0.5],
    ['was', 0.5, 0.8],
    ['entirely', 0.8, 1.4],
    ['free', 1.4, 1.8],
  ];

  it('ends the card on the highlighted word, so it lands last', () => {
    // The style renders the highlight beneath the plain words. That only reads
    // as "WATCHING WAS / entirely" if the highlight is the card's LAST word —
    // one in the middle would strand the rest of the sentence below it.
    const cues = buildCaptions({
      words: words(spec),
      mapper: mapper(),
      style: CaptionStyleSchema.parse({ maxWordsPerCue: 4, emphasisOwnLine: true }),
      emphasis: [{ startSec: 0.8, endSec: 1.4 }],
      outputDurationSec: 5,
    });

    const card = cues.find((c) => c.words.some((w) => w.emphasis))!;
    expect(card.words[card.words.length - 1].text).toBe('entirely');
  });

  it('leaves the word where it fell for styles that only recolour it', () => {
    // Breaking every card early would shorten them all for no visual gain.
    const cues = buildCaptions({
      words: words(spec),
      mapper: mapper(),
      style: CaptionStyleSchema.parse({ maxWordsPerCue: 4 }),
      emphasis: [{ startSec: 0.8, endSec: 1.4 }],
      outputDurationSec: 5,
    });

    expect(cues).toHaveLength(1);
    expect(cues[0].words.map((w) => w.text)).toEqual(['watching', 'was', 'entirely', 'free']);
  });
});

describe('a highlight that would open a card', () => {
  it('goes back onto the card before it instead of leading one', () => {
    // What shipped: "right NOW", the script word first and inline. A highlight
    // that opens a card has nothing above it to sit under, so the rule that
    // puts it on the line below silently did nothing.
    const mapper = new TimeMapper(layoutSegments([{ sourceStartSec: 0, sourceEndSec: 6 }]));
    const cues = buildCaptions({
      words: words([
        ['you', 0.1, 0.35],
        ['can', 0.35, 0.6],
        ['start', 0.6, 0.95],
        ['right', 0.95, 1.3],
        ['now', 1.3, 1.7],
      ]),
      mapper,
      style: CaptionStyleSchema.parse({ maxWordsPerCue: 3, emphasisOwnLine: true }),
      emphasis: [{ startSec: 0.95, endSec: 1.3 }],
      outputDurationSec: 6,
    });

    const card = cues.find((c) => c.words.some((w) => w.emphasis))!;
    expect(card.words.map((w) => w.text)).toEqual(['you', 'can', 'start', 'right']);
    // And nothing plain may follow it on that card.
    expect(card.words[card.words.length - 1].emphasis).toBe(true);
  });

  it('leaves it alone on its own card when it cannot go back', () => {
    // A cut between the two: joining them would put a card across the splice.
    const mapper = new TimeMapper(
      layoutSegments([
        { sourceStartSec: 0, sourceEndSec: 1 },
        { sourceStartSec: 5, sourceEndSec: 7 },
      ]),
    );
    const cues = buildCaptions({
      words: words([
        ['you', 0.1, 0.4],
        ['can', 0.4, 0.9],
        ['right', 5.05, 5.4],
        ['now', 5.4, 5.9],
      ]),
      mapper,
      style: CaptionStyleSchema.parse({ maxWordsPerCue: 3, emphasisOwnLine: true }),
      emphasis: [{ startSec: 5.05, endSec: 5.4 }],
      outputDurationSec: 7,
    });

    const card = cues.find((c) => c.words.some((w) => w.emphasis))!;
    expect(card.words.map((w) => w.text)).toEqual(['right']);
  });
});

describe('which word gets the highlight', () => {
  const mapper = () => new TimeMapper(layoutSegments([{ sourceStartSec: 0, sourceEndSec: 6 }]));
  const spoken: Array<[string, number, number]> = [
    ['you', 0.1, 0.35],
    ['have', 0.35, 0.6],
    ['to', 0.6, 0.75],
    ['commit', 0.75, 1.3],
  ];
  const ownLine = (over: object = {}) =>
    CaptionStyleSchema.parse({ maxWordsPerCue: 4, emphasisOwnLine: true, ...over });

  it('never spends a whole line on a two-letter word', () => {
    // "to" set in a brush script under the sentence reads as a glitch.
    const cues = buildCaptions({
      words: words(spoken),
      mapper: mapper(),
      style: ownLine(),
      emphasis: [{ startSec: 0.6, endSec: 0.75 }],
      outputDurationSec: 6,
    });
    expect(cues.flatMap((c) => c.words).filter((w) => w.emphasis)).toEqual([]);
  });

  it('takes the longest word of the phrase the director marked', () => {
    const cues = buildCaptions({
      words: words(spoken),
      mapper: mapper(),
      style: ownLine(),
      emphasis: [{ startSec: 0.6, endSec: 1.3 }],
      outputDurationSec: 6,
    });
    const lit = cues.flatMap((c) => c.words).filter((w) => w.emphasis);
    expect(lit.map((w) => w.text)).toEqual(['commit']);
  });

  it('counts letters, not punctuation', () => {
    const cues = buildCaptions({
      words: words([['scale.', 0.1, 0.7]]),
      mapper: mapper(),
      style: ownLine({ emphasisMinChars: 6 }),
      emphasis: [{ startSec: 0.1, endSec: 0.7 }],
      outputDurationSec: 6,
    });
    // "scale." is six characters but five letters, so it misses the bar.
    expect(cues.flatMap((c) => c.words).some((w) => w.emphasis)).toBe(false);
  });

  it('still colours the whole phrase for a preset that only recolours', () => {
    const cues = buildCaptions({
      words: words(spoken),
      mapper: mapper(),
      style: CaptionStyleSchema.parse({ maxWordsPerCue: 4 }),
      emphasis: [{ startSec: 0.6, endSec: 1.3 }],
      outputDurationSec: 6,
    });
    const lit = cues.flatMap((c) => c.words).filter((w) => w.emphasis);
    expect(lit.map((w) => w.text)).toEqual(['to', 'commit']);
  });
});
