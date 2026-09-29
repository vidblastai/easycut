import { describe, expect, it } from 'vitest';
import { buildEdl, placeScenes } from '@/lib/edl/builder';
import { EdlSchema, framedPositionY, iconRowPlacement } from '@/lib/edl/types';
import { DirectorPlanSchema } from '@/lib/director/schema';
import { getStyle, parseTransitions, sanitiseTransitions, styleFor } from '@/lib/styles/presets';
import type { StylePreset } from '@/lib/styles/presets';
import { TimeMapper, layoutSegments } from '@/lib/timeline/time-mapper';
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
  return buildWithStyle(planOverrides, getStyle(styleId));
}

/** The same, for the cases that need a style the preset list does not hold. */
function buildWithStyle(
  planOverrides: Parameters<typeof DirectorPlanSchema.parse>[0],
  style: StylePreset,
) {
  return buildEdl({
    projectId: 'test',
    style,
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

  it('puts a sound on the B-roll transition, and names what it came from', () => {
    const edl = build({
      broll: [{ atSec: 10, durationSec: 4, query: 'coffee', intent: '', kind: 'stock-video' }],
    });
    const clip = edl.broll[0];
    // The style picks the transition; guard the assumption rather than letting
    // the test quietly pass on a style change that removed the sound entirely.
    expect(clip.enter).not.toBe('cut');
    expect(clip.enter).not.toBe('fade');

    const enter = edl.sfx.find((c) => Math.abs(c.atSec - clip.outStartSec) < 0.02);
    expect(enter).toBeDefined();
    // Named, because the person deleting it in the editor needs to know that
    // the transition survives the deletion.
    expect(enter!.reason).toBe(`${clip.enter} in · coffee`);
  });

  it('starts the exit sound before the clip ends, not on its last frame', () => {
    const edl = build({
      broll: [{ atSec: 10, durationSec: 4, query: 'coffee', intent: '', kind: 'stock-video' }],
    });
    const clip = edl.broll[0];
    expect(clip.exit).not.toBe('cut');
    const exit = edl.sfx.find((c) => c.reason === `${clip.exit} out · coffee`);
    expect(exit).toBeDefined();
    // One transition-length early: the whoosh scores the picture leaving, not
    // the shot that replaced it.
    expect(exit!.atSec).toBeLessThan(clip.outEndSec);
    expect(exit!.atSec).toBeGreaterThan(clip.outStartSec);
  });

  it('gives every icon card its own swipe, not one for the row', () => {
    const edl = build({
      icons: [
        { atSec: 20, word: 'banana', query: 'banana' },
        { atSec: 20.4, word: 'apple', query: 'apple' },
      ],
    });
    const cards = edl.icons.flatMap((cue) => cue.cards);
    expect(cards.length).toBeGreaterThan(1);
    for (const card of cards) {
      const at = edl.icons.find((c) => c.cards.includes(card))!.outStartSec + card.offsetSec;
      const cue = edl.sfx.find((c) => Math.abs(c.atSec - at) < 0.02);
      expect(cue, `no sound for ${card.word}`).toBeDefined();
      expect(cue!.reason).toContain(card.word);
    }
  });

  it('mixes an icon swipe below a full-frame transition', () => {
    const edl = build({
      broll: [{ atSec: 10, durationSec: 4, query: 'coffee', intent: '', kind: 'stock-video' }],
      icons: [{ atSec: 20, word: 'banana', query: 'banana' }],
    });
    const icon = edl.sfx.find((c) => c.reason.startsWith('icon card'))!;
    const full = edl.sfx.find((c) => c.reason.endsWith('in · coffee'))!;
    expect(icon.gainDb).toBeLessThan(full.gainDb);
  });

  it('leaves the sound track alone when the director asked for no inserts', () => {
    // No B-roll and no icons means nothing moved, so nothing should whoosh.
    expect(build({}).sfx.filter((c) => c.reason)).toHaveLength(0);
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

/**
 * Rows of icon cards.
 *
 * The grouping is bookkeeping with an exact answer — which is precisely why it
 * is done here and not asked of the director, and why it is worth pinning
 * down. "Bananas and apples" has to come out as ONE row that arrives twice and
 * leaves once; two rows would put the banana away before the apple appears.
 */
describe('icon cards', () => {
  it('groups nouns said close together into one row that leaves together', () => {
    const edl = build({
      icons: [
        { atSec: 5, word: 'word10', query: 'banana' },
        { atSec: 6, word: 'word12', query: 'red apple' },
      ],
    });

    expect(edl.icons).toHaveLength(1);
    expect(edl.icons[0].cards.map((c) => c.query)).toEqual(['banana', 'red apple']);
    // They arrive one at a time…
    expect(edl.icons[0].cards[0].offsetSec).toBeLessThan(edl.icons[0].cards[1].offsetSec);
    // …the first one opens the row…
    expect(edl.icons[0].cards[0].offsetSec).toBe(0);
    // …and there is one exit for the pair.
    expect(edl.icons[0].outEndSec).toBeGreaterThan(
      edl.icons[0].outStartSec + edl.icons[0].cards[1].offsetSec,
    );
  });

  it('starts a new row when the next noun is a separate thought', () => {
    const edl = build({
      icons: [
        { atSec: 4, word: 'word8', query: 'banana' },
        { atSec: 14, word: 'word28', query: 'hourglass' },
      ],
    });
    expect(edl.icons).toHaveLength(2);
  });

  it('never keeps a row on screen once the next one has arrived', () => {
    const edl = build({
      icons: [
        { atSec: 4, word: 'word8', query: 'banana' },
        { atSec: 9, word: 'word18', query: 'hourglass' },
      ],
    });
    for (let i = 1; i < edl.icons.length; i++) {
      expect(edl.icons[i - 1].outEndSec).toBeLessThanOrEqual(edl.icons[i].outStartSec);
    }
  });

  it('holds a row to three cards, so a fourth noun opens a new one', () => {
    const edl = build({
      icons: [
        { atSec: 4, word: 'word8', query: 'banana' },
        { atSec: 5, word: 'word10', query: 'red apple' },
        { atSec: 6, word: 'word12', query: 'grapes' },
        { atSec: 7, word: 'word14', query: 'hourglass' },
      ],
    });
    expect(edl.icons[0].cards).toHaveLength(3);
    expect(edl.icons).toHaveLength(2);
  });

  it('snaps each card to the real timing of the word it names', () => {
    // The fixture speaks word20 at 10.0s; the director guessed 10.4.
    const edl = build({ icons: [{ atSec: 10.4, word: 'word20', query: 'banana' }] });
    expect(edl.icons[0].outStartSec).toBeCloseTo(10, 2);
  });

  it('drops a card that would land on top of a layer that owns the frame', () => {
    // B-roll covers 9–13s. A card there is a second focal point competing with
    // the first, and the insert wins.
    const edl = build({
      broll: [{ atSec: 9, durationSec: 4, query: 'a', intent: '', kind: 'stock-video' }],
      icons: [{ atSec: 11, word: 'word22', query: 'banana' }],
    });
    expect(edl.icons).toHaveLength(0);
  });

  it('carries the video-s tone, so the tile is white or near-black to match', () => {
    const light = build({ icons: [{ atSec: 5, word: 'word10', query: 'banana' }] }, 'clean');
    const dark = build({ icons: [{ atSec: 5, word: 'word10', query: 'banana' }] }, 'punchy');
    expect(light.icons[0].tone).toBe('light');
    expect(dark.icons[0].tone).toBe('dark');
  });

  it('puts every row BELOW the captions, where the face is not', () => {
    const edl = build({ icons: [{ atSec: 5, word: 'word10', query: 'banana' }] });
    const { card } = iconRowPlacement(1, edl.format.width, edl.format.height);
    const rowTop = edl.icons[0].y - card / edl.format.height / 2;

    // Under the words, and in the lower half — the upper half of a vertical
    // frame is where the speaker's face is, which is what this used to cover.
    //
    // Against the FRAMED position, not the style's raw one: the renderer
    // clamps every preset into the caption band, so the raw number is not
    // where the words end up.
    expect(rowTop).toBeGreaterThan(framedPositionY(edl.captionStyle));
    expect(edl.icons[0].y).toBeGreaterThan(0.5);
    // And on screen: a card hanging off the bottom is the failure that comes
    // with sizing it to anything but the room it has.
    expect(edl.icons[0].y + card / edl.format.height / 2).toBeLessThanOrEqual(1);
  });
});

/**
 * How full-frame clips arrive and leave.
 *
 * One transition on every insert reads as a template; a different one every
 * time reads as random. The cycling is what gets variety out of a coherent
 * set, and the determinism is what makes re-running the same footage produce
 * the same edit.
 */
describe('clip transitions', () => {
  const inserts = [
    { atSec: 3, durationSec: 2, query: 'a', intent: '', kind: 'stock-video' as const },
    { atSec: 8, durationSec: 2, query: 'b', intent: '', kind: 'stock-video' as const },
    { atSec: 13, durationSec: 2, query: 'c', intent: '', kind: 'stock-video' as const },
    { atSec: 18, durationSec: 2, query: 'd', intent: '', kind: 'stock-video' as const },
  ];

  it('gives consecutive inserts different moves from the style-s own set', () => {
    const edl = build({ broll: inserts }, 'punchy');
    const used = edl.broll.map((clip) => clip.enter);
    const vocabulary = getStyle('punchy').clipTransitions;

    expect(edl.broll.length).toBeGreaterThan(2);
    expect(new Set(used).size).toBeGreaterThan(1);
    for (const move of used) expect(vocabulary).toContain(move);
    // Back to back, they differ.
    for (let i = 1; i < used.length; i++) expect(used[i]).not.toBe(used[i - 1]);
  });

  it('cycles the set the user picked, in the order they picked it', () => {
    /*
     * The order is the choice, not incidental.
     *
     * `placeBroll` walks the vocabulary per insert, so glitch-then-zoom and
     * zoom-then-glitch are two different edits — which is why the picker
     * appends in click order and why nothing between there and here is allowed
     * to sort it into the canonical list.
     */
    const style = styleFor('punchy', null, null, ['zoom', 'glitch']);
    expect(style.clipTransitions).toEqual(['zoom', 'glitch']);

    const edl = buildWithStyle({ broll: inserts }, style);
    expect(edl.broll.map((c) => c.enter)).toEqual(['zoom', 'glitch', 'zoom', 'glitch']);
  });

  it('drops a name it has never heard of rather than failing the render', () => {
    // A stale id in a months-old project should cost you a preference, not
    // the video — and a pick that is ENTIRELY stale reads as no pick at all,
    // because "nothing I recognise" is not a request for no transitions.
    expect(styleFor('punchy', null, null, ['zoom', 'wormhole']).clipTransitions).toEqual(['zoom']);
    expect(styleFor('punchy', null, null, ['wormhole']).clipTransitions).toEqual(
      getStyle('punchy').clipTransitions,
    );
    expect(styleFor('punchy', null, null, []).clipTransitions).toEqual(getStyle('punchy').clipTransitions);
  });

  it('reads back what it stored, and shrugs off what it cannot', () => {
    expect(parseTransitions(JSON.stringify(['whip', 'fade']))).toEqual(['whip', 'fade']);
    expect(parseTransitions('not json')).toBeNull();
    expect(parseTransitions('{"a":1}')).toBeNull();
    expect(parseTransitions(null)).toBeNull();
    // Duplicates collapse: the builder cycles the list, so the same name twice
    // would silently weight one transition over the others.
    expect(sanitiseTransitions(['fade', 'fade', 'zoom'])).toEqual(['fade', 'zoom']);
  });

  it('is deterministic, so the same footage cuts the same way twice', () => {
    const first = build({ broll: inserts }, 'punchy').broll.map((c) => c.enter);
    const second = build({ broll: inserts }, 'punchy').broll.map((c) => c.enter);
    expect(first).toEqual(second);
  });

  it('sends an insert out the way it came, so it crosses in one direction', () => {
    for (const clip of build({ broll: inserts }, 'news').broll) {
      expect(clip.exit).toBe(clip.enter);
    }
  });

  it('takes its vocabulary from the style, so a calm one never glitches', () => {
    const calm = build({ broll: inserts }, 'clean').broll.map((c) => c.enter);
    expect(calm).not.toContain('glitch');
    expect(calm).not.toContain('whip');
  });

  it('gives a scene the style-s signature, not a rotating move', () => {
    // Two or three scenes in a video should arrive the same way as each other;
    // an insert is punctuation and can vary.
    const placed = placeScenes(
      [
        { startSec: 4, endSec: 8, kind: 'kinetic-text', backdrop: 'gradient', headline: 'one', items: [], iconQueries: [], reason: '' },
        { startSec: 14, endSec: 18, kind: 'kinetic-text', backdrop: 'gradient', headline: 'two', items: [], iconQueries: [], reason: '' },
      ] as never,
      new TimeMapper(segments),
      30,
      [],
      '#9B7BFF',
      'neon',
      'glitch',
    );

    expect(placed.length).toBe(2);
    for (const scene of placed) {
      expect(scene.enter).toBe('glitch');
      expect(scene.exit).toBe('glitch');
    }
  });

  it('leaves a rescued scene to its look, which is the only one nobody chose', () => {
    // The fallback scene exists because nothing else did. It should not also
    // be the one that arrives differently from the rest of the style.
    const edl = build({ broll: [] }, 'punchy');
    for (const scene of edl.scenes) expect(scene.enter).toBeNull();
  });

  it('cuts where the layout gives B-roll a permanent half', () => {
    // A split screen's B-roll slot is on screen from the first frame, so there
    // is nothing for it to transition INTO.
    const edl = build({ broll: inserts }, 'split');
    for (const clip of edl.broll) expect(clip.enter).toBe('cut');
  });
});
