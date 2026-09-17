import { describe, expect, it } from 'vitest';
import { LAYER_NAMES, allLayersOn, parseLayersOff, stripLayers } from '@/lib/edl/layers';
import type { Edl } from '@/lib/edl/types';

/** A document with something on every switchable track. */
const full = () =>
  ({
    captions: [{ id: 'c' }],
    broll: [{ id: 'b' }],
    graphics: [{ id: 'g' }],
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
