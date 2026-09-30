import { describe, expect, it } from 'vitest';
import { relayoutIconRows } from '@/lib/edl/icon-rows';
import { applyOperations } from '@/lib/edl/operations';
import { EdlSchema, type Edl } from '@/lib/edl/types';
import { layoutSegments } from '@/lib/timeline/time-mapper';
import { ICON_ROW_BELOW_COUNT, IconCueSchema, iconRowPlacement, type IconCue } from '@/lib/edl/types';

/**
 * What happens to a row after some of its icons failed to arrive.
 *
 * The builder lays rows out for the cards the DIRECTOR asked for, because at
 * that point nothing has been fetched. By the time the icons come back, some of
 * those words have no icon and the row is a different size from the one that
 * was placed — which is a layout problem, not just a missing picture.
 */

const WIDE = { width: 1920, height: 1080 };
const TALL = { width: 1080, height: 1920 };

function row(side: 'below' | 'left' | 'right', cards: number): IconCue {
  /*
   * Built past the schema when empty, deliberately.
   *
   * `IconCueSchema` requires at least one card, so a row with none cannot be
   * parsed — but the asset stage strips cards from a parsed row and hands the
   * result here BEFORE anything re-parses, so zero is a state this function
   * really sees and really has to handle.
   */
  if (cards === 0) {
    return { id: `r-${side}-0`, outStartSec: 4, outEndSec: 8, side, x: 0.5, y: 0.8, tone: 'light', cards: [] } as unknown as IconCue;
  }
  return IconCueSchema.parse({
    id: `r-${side}-${cards}`,
    outStartSec: 4, outEndSec: 8, side,
    cards: Array.from({ length: cards }, (_, i) => ({
      offsetSec: i * 0.4, word: `w${i}`, query: `q${i}`, markup: '<svg/>', iconId: `i${i}`,
    })),
  });
}

describe('a row that arrived intact', () => {
  it('keeps its side', () => {
    expect(relayoutIconRows([row('below', 3)], WIDE)[0].side).toBe('below');
    expect(relayoutIconRows([row('right', 2)], WIDE)[0].side).toBe('right');
  });

  it('is placed where that side and that count belong', () => {
    const [placed] = relayoutIconRows([row('right', 2)], WIDE);
    const want = iconRowPlacement(2, WIDE.width, WIDE.height, 'right');
    expect(placed.x).toBeCloseTo(want.x, 6);
    expect(placed.y).toBeCloseTo(want.y, 6);
  });

  it('does not drag a side column down into the caption band', () => {
    /*
     * The bug this pins: the re-layout called `iconRowPlacement` without a
     * side, so every row was recomputed with the BELOW geometry. A column out
     * in the margin had its y pulled from the middle of the frame down to 0.81
     * while its x stayed at 0.78, and it rendered in the bottom corner.
     */
    const [placed] = relayoutIconRows([row('right', 1)], WIDE);
    const below = iconRowPlacement(1, WIDE.width, WIDE.height, 'below');
    expect(placed.y).not.toBeCloseTo(below.y, 2);
    expect(placed.y).toBeGreaterThan(0.35);
    expect(placed.y).toBeLessThan(0.65);
  });
});

describe('a row that lost a card', () => {
  it('moves a short floor row out to the side rather than showing a pair', () => {
    // The builder guarantees three from the floor. A failed lookup must not be
    // able to break that after the fact — two climbing out of the floor is
    // literally "a third that failed to load".
    const [placed] = relayoutIconRows([row('below', 2)], WIDE);
    expect(placed.side).not.toBe('below');
    expect(placed.cards).toHaveLength(2);
  });

  it('moves a lone survivor out too', () => {
    expect(relayoutIconRows([row('below', 1)], WIDE)[0].side).not.toBe('below');
  });

  it('drops it where the frame has no margin to move it into', () => {
    // A vertical picture: the subject fills it, so there is nowhere to go.
    expect(relayoutIconRows([row('below', 2)], TALL)).toHaveLength(0);
    expect(relayoutIconRows([row('below', 1)], TALL)).toHaveLength(0);
  });

  it('leaves a full floor row exactly where it was, in either frame', () => {
    for (const frame of [WIDE, TALL]) {
      const [placed] = relayoutIconRows([row('below', ICON_ROW_BELOW_COUNT)], frame);
      expect(placed.side).toBe('below');
      expect(placed.x).toBe(0.5);
    }
  });

  it('re-sizes for the cards that survived, not the ones that were asked for', () => {
    // A card's size depends on how many share its row, so a column that lost
    // one has to be re-measured or it sits at the coordinates a different
    // layout needed.
    const [three] = relayoutIconRows([row('right', 3)], WIDE);
    const [two] = relayoutIconRows([row('right', 2)], WIDE);
    expect(two.y).toBeCloseTo(three.y, 6);
    expect(iconRowPlacement(2, WIDE.width, WIDE.height, 'right').card)
      .toBeGreaterThan(iconRowPlacement(3, WIDE.width, WIDE.height, 'right').card);
  });
});

describe('a row that lost everything', () => {
  it('goes with them', () => {
    expect(relayoutIconRows([row('below', 0)], WIDE)).toHaveLength(0);
    expect(relayoutIconRows([row('right', 0)], WIDE)).toHaveLength(0);
  });

  it('does not take the rows around it', () => {
    const kept = relayoutIconRows([row('below', 3), row('right', 0), row('right', 1)], WIDE);
    expect(kept).toHaveLength(2);
  });
});


/* ------------------------------------------------- moving one by hand ----- */

function edlWith(cue: IconCue): Edl {
  return EdlSchema.parse({
    version: '1.0', projectId: 't', styleId: 'clean',
    format: { aspect: '16:9', width: 1920, height: 1080, fps: 30, durationSec: 30 },
    source: { assetId: 's', url: 'f', width: 1920, height: 1080, fps: 30, durationSec: 30, hasAudio: true },
    segments: layoutSegments([{ sourceStartSec: 0, sourceEndSec: 30 }]),
    captions: [], captionStyle: {}, icons: [cue], audio: {}, deliverable: {},
  });
}

describe('moving a row from the editor', () => {
  /*
   * `clip.update` only writes whitelisted fields, and a field left off the list
   * is dropped in silence — the control in the inspector would look like it had
   * worked and the row would not move. That is the failure this covers.
   */
  it('actually changes the side', () => {
    const { edl } = applyOperations(edlWith(row('right', 1)), [
      { op: 'clip.update', track: 'icons', id: 'r-right-1', patch: { side: 'left', x: 0.22, y: 0.51 } },
    ]);
    expect(edl.icons[0].side).toBe('left');
  });

  it('carries the coordinates with it', () => {
    // The side is not the position: the renderer reads x and y, and those were
    // computed for the layout the row used to have.
    const want = iconRowPlacement(1, 1920, 1080, 'left');
    const { edl } = applyOperations(edlWith(row('right', 1)), [
      { op: 'clip.update', track: 'icons', id: 'r-right-1', patch: { side: 'left', x: want.x, y: want.y } },
    ]);
    expect(edl.icons[0].x).toBeCloseTo(want.x, 6);
    expect(edl.icons[0].y).toBeCloseTo(want.y, 6);
  });

  it('survives a round trip through the schema', () => {
    const { edl } = applyOperations(edlWith(row('below', 3)), [
      { op: 'clip.update', track: 'icons', id: 'r-below-3', patch: { side: 'left' } },
    ]);
    expect(EdlSchema.parse(edl).icons[0].side).toBe('left');
  });
});
