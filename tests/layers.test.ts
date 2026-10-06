import { describe, expect, it } from 'vitest';
import { trimToWords } from '@/lib/text';
import { LAYER_NAMES, allLayersOn, parseLayersOff, stripLayers } from '@/lib/edl/layers';
import { EdlSchema, type Edl } from '@/lib/edl/types';
import { CLIP_TRACKS, applyOperations } from '@/lib/edl/operations';
import { SAMPLE_EDL } from '../remotion/sample-edl';

/** A document with something on every switchable track. */
const full = () =>
  ({
    captions: [{ id: 'c' }],
    broll: [{ id: 'b' }],
    graphics: [{ id: 'g' }],
    scenes: [{ id: 'sc' }],
    sfx: [{ id: 's' }],
    punchIns: [{ id: 'p' }],
    transitions: [{ id: 't' }],
    music: { url: 'm', gainDb: -20, duckDb: -8 },
  }) as unknown as Edl;

describe('declining a layer', () => {
  it('empties the track rather than flagging it', () => {
    const edl = stripLayers(full(), ['broll']);
    expect(edl.broll).toEqual([]);
    expect(edl.captions).toHaveLength(1);
  });

  it('removes the music by nulling it, not by emptying an array', () => {
    expect(stripLayers(full(), ['music']).music).toBeNull();
  });

  it('can take every layer', () => {
    const edl = stripLayers(full(), LAYER_NAMES);
    expect(edl.captions).toEqual([]);
    expect(edl.broll).toEqual([]);
    expect(edl.graphics).toEqual([]);
    expect(edl.sfx).toEqual([]);
    expect(edl.punchIns).toEqual([]);
    expect(edl.transitions).toEqual([]);
    expect(edl.music).toBeNull();
  });

  it('is the same document when nothing was declined', () => {
    const edl = full();
    expect(stripLayers(edl, [])).toBe(edl);
  });

  it('covers every name it advertises', () => {
    // A name in the list the strip does not handle is a switch that does
    // nothing — the bug this list exists to make impossible.
    for (const name of LAYER_NAMES) {
      const edl = stripLayers(full(), [name]);
      const changed = LAYER_NAMES.some((other) => {
        const before = (full() as Record<string, unknown>)[other];
        const after = (edl as unknown as Record<string, unknown>)[other];
        return JSON.stringify(before) !== JSON.stringify(after);
      });
      expect(changed, `${name} did nothing`).toBe(true);
    }
  });
});

describe('reading stored refusals', () => {
  it('reads a list back', () => {
    expect(parseLayersOff('["music","broll"]')).toEqual(['music', 'broll']);
  });

  it('ignores names it does not know', () => {
    expect(parseLayersOff('["music","dragons"]')).toEqual(['music']);
  });

  it('treats nonsense as nothing declined', () => {
    expect(parseLayersOff(null)).toEqual([]);
    expect(parseLayersOff('')).toEqual([]);
    expect(parseLayersOff('not json')).toEqual([]);
    expect(parseLayersOff('{"music":false}')).toEqual([]);
  });

  it('starts with everything on', () => {
    const on = allLayersOn();
    expect(Object.keys(on).sort()).toEqual([...LAYER_NAMES].sort());
    expect(Object.values(on).every(Boolean)).toBe(true);
  });
});

describe('the animated scenes layer', () => {
  it('can be declined like any other layer', () => {
    // It is the most expensive layer to produce and the most intrusive when it
    // lands badly, so "no thanks" has to actually mean something.
    expect(LAYER_NAMES).toContain('scenes');
  });

  it('is emptied from the document when declined', () => {
    expect(stripLayers(full(), ['scenes']).scenes).toEqual([]);
  });

  it('is left alone when something else is declined', () => {
    expect(stripLayers(full(), ['music']).scenes).toHaveLength(1);
  });
});

describe('a chapter card is still one capped line', () => {
  it('caps a title the director wrote too long', () => {
    // The pill holds its final width from frame one, so a title that would
    // have run off the frame has to be cut upstream — the ellipsis in the
    // renderer is a backstop, not the mechanism.
    const long = 'A chapter title that simply keeps going and going past anything sensible';
    expect(trimToWords(long, 52).length).toBeLessThanOrEqual(52);
  });
});

describe('the notes beside the speaker are a layer like any other', () => {
  const edl = EdlSchema.parse({
    ...SAMPLE_EDL,
    annotations: [
      {
        id: 'note-0', outStartSec: 2, outEndSec: 7, kind: 'checklist', side: 'right',
        x: 0.62, y: 0.24, title: 'What it does',
        items: [{ offsetSec: 0, text: 'Reads your inbox' }],
        reason: 'a list of 1',
      },
    ],
  }) as Edl;

  it('can be declined on its own, without taking the scenes with it', () => {
    // The same content at two weights: somebody who does not want the frame
    // taken away may still want the quietest layer in the video.
    expect(stripLayers(edl, ['annotations']).annotations).toHaveLength(0);
    expect(stripLayers(edl, ['annotations']).scenes).toEqual(edl.scenes);
    expect(stripLayers(edl, ['scenes']).annotations).toHaveLength(1);
  });

  it('survives a layer refusal that is not about it', () => {
    expect(stripLayers(edl, ['music', 'sfx']).annotations).toHaveLength(1);
  });

  it('can be moved, trimmed and deleted from the timeline', () => {
    expect(CLIP_TRACKS).toContain('annotations');
    // Inside the sample's ten seconds: a move past the end is clamped, which
    // is correct and would make this assert the clamp rather than the move.
    const moved = applyOperations(edl, [
      { op: 'clip.move', track: 'annotations', id: 'note-0', outStartSec: 4 },
    ]).edl;
    expect(moved.annotations[0].outStartSec).toBeCloseTo(4, 1);
    // The span travels with it: the lines keep their spacing because their
    // offsets are relative to the clip.
    expect(moved.annotations[0].outEndSec - moved.annotations[0].outStartSec).toBeCloseTo(5, 1);

    const gone = applyOperations(edl, [{ op: 'clip.delete', track: 'annotations', id: 'note-0' }]).edl;
    expect(gone.annotations).toHaveLength(0);
  });

  it('adds a note rather than an overlay when one is asked for', () => {
    // The generic tail of `clip.add` makes a lower third, so a track without
    // its own branch quietly gets one on the wrong list.
    const added = applyOperations(edl, [
      { op: 'clip.add', track: 'annotations', atSec: 0.2, durationSec: 1.5, value: 'Three things', id: 'note-1' },
    ]).edl;
    expect(added.annotations).toHaveLength(2);
    expect(added.annotations[1].title).toBe('Three things');
    expect(added.overlays.length).toBe(edl.overlays.length);
  });
});
