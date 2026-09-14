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

function build(planOverrides: Parameters<typeof DirectorPlanSchema.parse>[0]) {
  return buildEdl({
    projectId: 'test',
    style: getStyle('punchy'),
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
