import { describe, expect, it } from 'vitest';
import { buildEdl } from '@/lib/edl/builder';
import { EdlSchema } from '@/lib/edl/types';
import { DirectorPlanSchema } from '@/lib/director/schema';
import { getStyle } from '@/lib/styles/presets';
import { layoutSegments } from '@/lib/timeline/time-mapper';
import { deriveSentences, type Transcript, type TranscriptWord } from '@/lib/transcribe/types';

function makeTranscript(): Transcript {
  const words: TranscriptWord[] = Array.from({ length: 60 }, (_, i) => ({
    text: `word${i}${i % 9 === 8 ? '.' : ''}`,
    startSec: i * 0.5,
    endSec: i * 0.5 + 0.4,
    confidence: 1,
    speaker: 0,
    isFiller: false,
    endsSentence: i % 9 === 8,
  }));
  return {
    provider: 'test',
    language: 'en',
    durationSec: 30,
    text: words.map((w) => w.text).join(' '),
    words,
    sentences: deriveSentences(words),
  };
}

const segments = layoutSegments([{ sourceStartSec: 0, sourceEndSec: 30 }]);

function build(
  planOverrides: Parameters<typeof DirectorPlanSchema.parse>[0],
  styleId = 'punchy',
) {
  return buildEdl({
    projectId: 'test',
    style: getStyle(styleId),
    mode: 'short',
    aspect: '9:16',
    fps: 30,
    transcript: makeTranscript(),
    plan: DirectorPlanSchema.parse(planOverrides),
    segments,
    source: {
      assetId: 'src',
      url: 'file://source.mp4',
      width: 1920,
      height: 1080,
      fps: 30,
      durationSec: 30,
      hasAudio: true,
    },
    reframe: null,
    degraded: [],
  });
}

describe('EDL builder', () => {
  it('produces a document that validates against the schema', () => {
    expect(() => EdlSchema.parse(build({}))).not.toThrow();
  });

  it('never lets two B-roll inserts overlap', () => {
    const edl = build({
      broll: [
        { atSec: 10, durationSec: 4, query: 'a', intent: '', kind: 'stock-video' },
        { atSec: 11, durationSec: 4, query: 'b', intent: '', kind: 'stock-video' },
        { atSec: 20, durationSec: 2, query: 'c', intent: '', kind: 'stock-video' },
      ],
    });

    for (let i = 1; i < edl.broll.length; i++) {
      expect(edl.broll[i].outStartSec).toBeGreaterThanOrEqual(edl.broll[i - 1].outEndSec);
    }
  });

  it('refuses to cut away from the speaker in the opening seconds', () => {
    const edl = build({
      broll: [{ atSec: 0.2, durationSec: 2, query: 'a', intent: '', kind: 'stock-video' }],
    });
    // The viewer has to see who is talking before we cover them.
    expect(edl.broll).toHaveLength(0);
  });

  it('does not place a graphic on top of a B-roll insert', () => {
    const edl = build({
      broll: [{ atSec: 12, durationSec: 3, query: 'a', intent: '', kind: 'stock-video' }],
      graphics: [
        { atSec: 13, durationSec: 2, type: 'icon', text: 'x', subtext: '', items: [], iconQuery: 'x', imagePrompt: '' },
      ],
    });
    expect(edl.graphics).toHaveLength(0);
  });

  it('moves a title card to the very start regardless of its timestamp', () => {
    const edl = build({ titleCard: { text: 'Hello', subtext: '' } });
    const title = edl.graphics.find((g) => g.type === 'title-card');
    expect(title?.outStartSec).toBe(0);
  });

  it('places no decorated transition when there are no visible cuts', () => {
    // One continuous segment: any transition would be decorating nothing.
    expect(build({}).transitions).toHaveLength(0);
  });

  it('never stacks two sound effects close enough to click', () => {
    const edl = build({
      sfx: [
        { atSec: 5, sound: 'pop' },
        { atSec: 5.05, sound: 'whoosh' },
        { atSec: 9, sound: 'ding' },
      ],
    });
    for (let i = 1; i < edl.sfx.length; i++) {
      expect(edl.sfx[i].atSec - edl.sfx[i - 1].atSec).toBeGreaterThanOrEqual(0.15);
    }
  });

  it('keeps punch-ins clear of B-roll and of each other', () => {
    const edl = build({
      broll: [{ atSec: 10, durationSec: 3, query: 'a', intent: '', kind: 'stock-video' }],
      punchIns: [
        { atSec: 11, durationSec: 2, intensity: 'medium' },   // inside the insert
        { atSec: 18, durationSec: 3, intensity: 'strong' },
        { atSec: 19, durationSec: 3, intensity: 'subtle' },   // overlaps the previous
      ],
    });
    expect(edl.punchIns).toHaveLength(1);
    expect(edl.punchIns[0].outStartSec).toBe(18);
  });
});

/**
 * A permanent B-roll slot that is ever empty is a black half of the screen.
 *
 * This is the invariant `alwaysOn` exists for, and it was untested — the only
 * check anywhere was a proxy in the style tests asserting a fast enough
 * B-roll cadence, which is not what guarantees coverage. The filler is: it
 * replays the nearest placed clip across every gap. So the cadence controls
 * VARIETY and the filler controls COVERAGE, and conflating the two meant
 * slowing a style down to something that looks better would have "failed" a
 * test for a reason that was never real.
 */
describe('a layout whose B-roll slot is on screen throughout', () => {
  /** The largest hole in the B-roll track, in seconds. */
  const biggestGap = (edl: ReturnType<typeof build>) => {
    const clips = [...edl.broll].sort((a, b) => a.outStartSec - b.outStartSec);
    let worst = 0;
    let covered = 0;
    for (const clip of clips) {
      worst = Math.max(worst, clip.outStartSec - covered);
      covered = Math.max(covered, clip.outEndSec);
    }
    return Math.max(worst, edl.format.durationSec - covered);
  };

  const withCues = (n: number) => ({
    broll: Array.from({ length: n }, (_, i) => ({
      atSec: 2 + i * 7,
      query: `thing ${i}`,
      intent: 'illustrating',
    })),
  });

  for (const styleId of ['split', 'commentary', 'sidebar']) {
    it(`leaves no hole for ${styleId}`, () => {
      const edl = build(withCues(3), styleId);
      expect(edl.broll.length).toBeGreaterThan(3);
      // A frame or two of slack for rounding; anything more is visible.
      expect(biggestGap(edl), `${styleId} gap`).toBeLessThan(0.5);
    });
  }

  it('covers the whole video from a single director cue', () => {
    // The worst realistic case: the director named one thing, and the rest of
    // the video still has a half of the screen to fill.
    const edl = build(withCues(1), 'split');
    expect(biggestGap(edl)).toBeLessThan(0.5);
  });

  it('does not fill anything on a layout that has no permanent slot', () => {
    // On a full-frame layout an empty moment is the speaker, which is correct.
    const edl = build(withCues(1), 'punchy');
    expect(edl.broll.length).toBe(1);
  });

  it('still gives a permanent slot several different clips to show', () => {
    // Coverage is not enough on its own: one stock shot replayed for a whole
    // video is covered and unwatchable.
    const edl = build(withCues(3), 'split');
    const runs = edl.broll.length;
    expect(runs).toBeGreaterThanOrEqual(4);
  });
});
