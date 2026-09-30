import { describe, expect, it } from 'vitest';
import { hasSideRoom, iconRowPlacement, ICON_ROW_BELOW_COUNT } from '@/lib/edl/types';
import { buildEdl } from '@/lib/edl/builder';
import { DirectorPlanSchema } from '@/lib/director/schema';
import { getStyle } from '@/lib/styles/presets';
import { layoutSegments } from '@/lib/timeline/time-mapper';
import { deriveSentences, type TranscriptWord } from '@/lib/transcribe/types';

/**
 * Where things go when the subject is not filling the frame.
 *
 * A talking head is framed centrally whatever the aspect, so a widescreen
 * picture has two empty columns beside them and a vertical one has none. Every
 * rule below follows from that single fact, which is why it is read off the
 * frame rather than off the format: it is a claim about where the subject is,
 * not about which platform the video is for.
 */

const WIDE = { width: 1920, height: 1080 };
const TALL = { width: 1080, height: 1920 };

describe('which frames have room beside the subject', () => {
  it('says a widescreen frame does and a vertical one does not', () => {
    expect(hasSideRoom(WIDE.width, WIDE.height)).toBe(true);
    expect(hasSideRoom(TALL.width, TALL.height)).toBe(false);
  });

  it('says a square one does not, because a centred subject fills it', () => {
    expect(hasSideRoom(1080, 1080)).toBe(false);
  });
});

describe('a column in the margin', () => {
  const column = (count: number) => iconRowPlacement(count, WIDE.width, WIDE.height, 'right');

  it('sits out at the side, not over the middle of the frame', () => {
    expect(column(3).x).toBeGreaterThan(0.7);
  });

  it('mirrors exactly when it goes to the other side', () => {
    const right = column(3);
    const left = iconRowPlacement(3, WIDE.width, WIDE.height, 'left');
    expect(left.x).toBeCloseTo(1 - right.x, 6);
    expect(left.card).toBe(right.card);
  });

  it('is BIGGER than the same cards squeezed under the captions', () => {
    // The whole reason to move them out there. The band under a line of words
    // had to give up size to avoid competing with it; the margin does not.
    const below = iconRowPlacement(3, WIDE.width, WIDE.height, 'below');
    expect(column(3).card).toBeGreaterThan(below.card);
  });

  it('gives a single card the full reference size', () => {
    // 0.30 of the short edge, which is what the reference clip measured.
    expect(column(1).card).toBeCloseTo(1080 * 0.3, 0);
  });

  it('shrinks as cards are added, rather than running off the frame', () => {
    expect(column(3).card).toBeLessThan(column(1).card);
  });

  it('keeps the whole column inside the picture', () => {
    for (const count of [1, 2, 3]) {
      const { x, y, card, gap } = column(count);
      const span = count * card + (count - 1) * gap;
      expect(y - span / 2 / WIDE.height, `${count} cards run off the top`).toBeGreaterThan(0);
      expect(y + span / 2 / WIDE.height, `${count} cards run off the bottom`).toBeLessThan(1);
      expect(x - card / 2 / WIDE.width, `${count} cards run off the left`).toBeGreaterThan(0);
      expect(x + card / 2 / WIDE.width, `${count} cards run off the right`).toBeLessThan(1);
    }
  });
});

describe('a row from the floor', () => {
  it('stays centred across the frame, because that is what "from below" means', () => {
    expect(iconRowPlacement(ICON_ROW_BELOW_COUNT, TALL.width, TALL.height, 'below').x).toBe(0.5);
  });

  it('still fits three across a vertical frame', () => {
    const { card, gap } = iconRowPlacement(3, TALL.width, TALL.height, 'below');
    expect(3 * card + 2 * gap).toBeLessThanOrEqual(TALL.width);
  });

  it('is what a vertical frame gets, since it has no margin to use', () => {
    expect(hasSideRoom(TALL.width, TALL.height)).toBe(false);
  });
});


/* ------------------------------------------------------- through the builder */

const DUR = 30;

function build(mode: 'short' | 'long', icons: Array<{ atSec: number; word: string; query: string }>) {
  const words: TranscriptWord[] = Array.from({ length: 60 }, (_, i) => ({
    text: `word${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4,
    confidence: 1, speaker: 0, isFiller: false, endsSentence: i % 9 === 8,
  }));
  const transcript = {
    provider: 't', language: 'en', durationSec: DUR,
    text: '', words, sentences: deriveSentences(words),
  };
  return buildEdl({
    projectId: 't', style: getStyle('clean'), mode,
    aspect: mode === 'short' ? '9:16' : '16:9', fps: 30,
    transcript,
    plan: DirectorPlanSchema.parse({
      icons,
      graphics: [{ atSec: 6, durationSec: 3, type: 'stat', text: '40%', subtext: 'of it' }],
    }),
    segments: layoutSegments([{ sourceStartSec: 0, sourceEndSec: DUR }]),
    source: { assetId: 's', url: 'f', width: 1920, height: 1080, fps: 30, durationSec: DUR, hasAudio: true },
    reframe: null, degraded: [],
  });
}

const THREE = [
  { atSec: 10, word: 'word20', query: 'banana' },
  { atSec: 11, word: 'word22', query: 'red apple' },
  { atSec: 12, word: 'word24', query: 'grapes' },
];

describe('what the builder does with each shape', () => {
  it('sends a widescreen row out to the margin', () => {
    const edl = build('long', THREE);
    expect(edl.icons[0].side).toBe('right');
    expect(edl.icons[0].x).toBeGreaterThan(0.7);
  });

  it('keeps a vertical row under the captions', () => {
    const edl = build('short', THREE);
    expect(edl.icons[0].side).toBe('below');
    expect(edl.icons[0].x).toBe(0.5);
    expect(edl.icons[0].y).toBeGreaterThan(0.5);
  });

  it('lets a widescreen column hold one card, where a floor row could not', () => {
    // The three-card rule is about rising from a floor. A single big card in
    // an empty margin is a deliberate-looking thing on its own.
    const one = [{ atSec: 10, word: 'word20', query: 'banana' }];
    expect(build('long', one).icons).toHaveLength(1);
    expect(build('short', one).icons).toHaveLength(0);
  });

  it('moves the number off the subject in a widescreen frame', () => {
    const wide = build('long', []).graphics.find((g) => g.type === 'stat')!;
    const tall = build('short', []).graphics.find((g) => g.type === 'stat')!;
    expect(wide.x).toBeGreaterThan(0.7);
    expect(tall.x).toBe(0.5);
  });

  it('leaves a block of text centred, where its line length is the point', () => {
    const words: TranscriptWord[] = Array.from({ length: 60 }, (_, i) => ({
      text: `word${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4,
      confidence: 1, speaker: 0, isFiller: false, endsSentence: i % 9 === 8,
    }));
    const edl = buildEdl({
      projectId: 't', style: getStyle('clean'), mode: 'long', aspect: '16:9', fps: 30,
      transcript: { provider: 't', language: 'en', durationSec: DUR, text: '', words, sentences: deriveSentences(words) },
      plan: DirectorPlanSchema.parse({
        graphics: [{ atSec: 6, durationSec: 3, type: 'quote', text: 'a line somebody said' }],
      }),
      segments: layoutSegments([{ sourceStartSec: 0, sourceEndSec: DUR }]),
      source: { assetId: 's', url: 'f', width: 1920, height: 1080, fps: 30, durationSec: DUR, hasAudio: true },
      reframe: null, degraded: [],
    });
    expect(edl.graphics.find((g) => g.type === 'quote')!.x).toBe(0.5);
  });
});
