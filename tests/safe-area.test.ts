import { describe, expect, it } from 'vitest';
import {
  ACTION_SAFE_INSET, PLAYER_CHROME_INSET, TITLE_SAFE_INSET,
  clampToSafe, floorFor, hasPlayerChrome, titleSafe,
} from '@/lib/edl/safe-area';
import { iconRowPlacement } from '@/lib/edl/types';
import { buildEdl } from '@/lib/edl/builder';
import { DirectorPlanSchema } from '@/lib/director/schema';
import { getStyle, STYLE_LIST } from '@/lib/styles/presets';
import { layoutSegments } from '@/lib/timeline/time-mapper';
import { deriveSentences, type TranscriptWord } from '@/lib/transcribe/types';

/**
 * The parts of the frame nothing may be put in.
 *
 * Two different things. Title safe is a convention inherited from overscan and
 * kept because type hard against an edge looks wrong. The player's controls are
 * not a convention at all — they are where the buttons are, drawn over the
 * bottom of a widescreen picture every time somebody moves the mouse.
 */

const WIDE = { width: 1920, height: 1080 };
const TALL = { width: 1080, height: 1920 };

describe('which frames have controls over them', () => {
  it('says a widescreen one does and a vertical one does not', () => {
    // A widescreen video is scrubbed through in a player; a vertical one sits
    // in a feed, where the UI is a different shape in every app.
    expect(hasPlayerChrome(WIDE.width, WIDE.height)).toBe(true);
    expect(hasPlayerChrome(TALL.width, TALL.height)).toBe(false);
  });
});

describe('the title-safe box', () => {
  it('keeps text inside the middle 80%', () => {
    const safe = titleSafe(TALL.width, TALL.height);
    expect(safe.left).toBe(TITLE_SAFE_INSET);
    expect(safe.right).toBe(TITLE_SAFE_INSET);
    expect(1 - safe.left - safe.right).toBeCloseTo(0.8, 6);
  });

  it('is action safe that sits wider, not title safe', () => {
    expect(ACTION_SAFE_INSET).toBeLessThan(TITLE_SAFE_INSET);
  });

  it('takes the deeper of the two at the bottom of a widescreen frame', () => {
    expect(titleSafe(WIDE.width, WIDE.height).bottom).toBe(Math.max(TITLE_SAFE_INSET, PLAYER_CHROME_INSET));
  });

  it('pulls a point back inside', () => {
    expect(clampToSafe({ x: 0.98, y: 0.99 }, WIDE.width, WIDE.height).x).toBeCloseTo(0.9, 6);
    expect(clampToSafe({ x: 0.01, y: 0.5 }, WIDE.width, WIDE.height).x).toBeCloseTo(0.1, 6);
  });

  it('leaves a point that is already inside alone', () => {
    expect(clampToSafe({ x: 0.5, y: 0.5 }, WIDE.width, WIDE.height)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe('the floor a thing may rest on', () => {
  it('is the controls in a widescreen frame, when they reach further up', () => {
    expect(floorFor(WIDE.width, WIDE.height, 0.02)).toBeCloseTo(1 - PLAYER_CHROME_INSET, 6);
  });

  it('is the row own margin where that is deeper', () => {
    expect(floorFor(WIDE.width, WIDE.height, 0.2)).toBeCloseTo(0.8, 6);
  });

  it('ignores the controls in a vertical frame', () => {
    expect(floorFor(TALL.width, TALL.height, 0.07)).toBeCloseTo(0.93, 6);
  });
});

describe('what actually sits near the bottom', () => {
  it('keeps a row of icon cards out of the controls', () => {
    /*
     * The card used to rest on its own 7% margin, which put its bottom edge at
     * 0.93 — three per cent INTO the band the scrubber and buttons cover.
     */
    const { y, card } = iconRowPlacement(3, WIDE.width, WIDE.height, 'below');
    const bottomEdge = y + card / WIDE.height / 2;
    expect(bottomEdge).toBeLessThanOrEqual(1 - PLAYER_CHROME_INSET + 1e-9);
  });

  it('does not take that room away from a vertical frame, which has no controls', () => {
    // The row there is limited by how big a card may be, not by the floor — so
    // the claim is about the FLOOR, which is the thing the controls move.
    expect(floorFor(TALL.width, TALL.height, 0.07))
      .toBeGreaterThan(floorFor(WIDE.width, WIDE.height, 0.07));
  });
});

/* ------------------------------------------------- the duplicate scrubber -- */

function build(mode: 'short' | 'long', styleId: string) {
  const words: TranscriptWord[] = Array.from({ length: 60 }, (_, i) => ({
    text: `word${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4,
    confidence: 1, speaker: 0, isFiller: false, endsSentence: i % 9 === 8,
  }));
  return buildEdl({
    projectId: 't', style: getStyle(styleId), mode,
    aspect: mode === 'short' ? '9:16' : '16:9', fps: 30,
    transcript: { provider: 't', language: 'en', durationSec: 30, text: '', words, sentences: deriveSentences(words) },
    plan: DirectorPlanSchema.parse({}),
    segments: layoutSegments([{ sourceStartSec: 0, sourceEndSec: 30 }]),
    source: { assetId: 's', url: 'f', width: 1920, height: 1080, fps: 30, durationSec: 30, hasAudio: true },
    reframe: null, degraded: [],
  });
}

describe('the burned-in progress bar', () => {
  /*
   * It is a SHORT-form device. A vertical feed has no scrubber, so drawing one
   * buys real retention. A widescreen video is watched in a player that already
   * has one, in the same place, over the same pixels — so the second bar is a
   * duplicate under YouTube's own, covered the moment the controls appear.
   */
  const wantsOne = STYLE_LIST.filter((s) => s.overlays.progressBar);

  it('is something several styles ask for, or this proves nothing', () => {
    expect(wantsOne.length).toBeGreaterThan(3);
  });

  it('is drawn in a vertical frame', () => {
    const style = wantsOne.find((s) => s.formats.includes('short'))!;
    expect(build('short', style.id).overlays.some((o) => o.type === 'progress-bar')).toBe(true);
  });

  it('is never drawn in a widescreen one', () => {
    for (const style of wantsOne.filter((s) => s.formats.includes('long'))) {
      expect(
        build('long', style.id).overlays.some((o) => o.type === 'progress-bar'),
        `${style.id} drew a second scrubber under the player's own`,
      ).toBe(false);
    }
  });

  it('does not take the other overlays with it', () => {
    const style = STYLE_LIST.find((s) => s.overlays.progressBar && s.overlays.vignette && s.formats.includes('long'));
    if (!style) return;
    expect(build('long', style.id).overlays.some((o) => o.type === 'vignette')).toBe(true);
  });
});


describe('chapter cards', () => {
  /*
   * A section break is how somebody navigates twenty minutes. In a forty-second
   * short it is a title card interrupting the only thought the video has — and
   * the schema the AI director answers against happily allows chapters in one.
   */
  function withChapters(mode: 'short' | 'long') {
    const words: TranscriptWord[] = Array.from({ length: 120 }, (_, i) => ({
      text: `word${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4,
      confidence: 1, speaker: 0, isFiller: false, endsSentence: i % 9 === 8,
    }));
    return buildEdl({
      projectId: 't', style: getStyle('clean'), mode,
      aspect: mode === 'short' ? '9:16' : '16:9', fps: 30,
      transcript: { provider: 't', language: 'en', durationSec: 60, text: '', words, sentences: deriveSentences(words) },
      plan: DirectorPlanSchema.parse({
        chapters: [
          { atSec: 12, title: 'Why the first number is the one that sticks' },
          {
            atSec: 30,
            title: 'An enormously long chapter heading that nobody would ever write but the schema allows anyway and the card cannot wrap',
          },
        ],
      }),
      segments: layoutSegments([{ sourceStartSec: 0, sourceEndSec: 60 }]),
      source: { assetId: 's', url: 'f', width: 1920, height: 1080, fps: 30, durationSec: 60, hasAudio: true },
      reframe: null, degraded: [],
    });
  }

  const cards = (mode: 'short' | 'long') =>
    withChapters(mode).overlays.filter((o) => o.type === 'chapter-card');

  it('are drawn in long form', () => {
    expect(cards('long').length).toBeGreaterThan(0);
  });

  it('are never drawn in a short', () => {
    expect(cards('short')).toHaveLength(0);
  });

  it('cap a title that would run off the frame', () => {
    // The card is one line by design, so a title it cannot wrap has to be cut
    // before it gets there — and cut on a word, like all the others.
    const long = cards('long').find((o) => o.text.endsWith('…'));
    expect(long, 'the over-long title was not capped').toBeDefined();
    expect(long!.text.length).toBeLessThanOrEqual(52);
  });

  it('leave a title that fits exactly as it was', () => {
    expect(cards('long')[0].text).toBe('Why the first number is the one that sticks');
  });
});
