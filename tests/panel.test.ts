import { describe, expect, it } from 'vitest';
import { sanitisePanel } from '@/lib/director/panel';

/**
 * The shapes a model actually returns, and what has to survive them.
 *
 * Every case here is one that came back from the live model while this was
 * being built — the alias shapes especially. A pass that silently yields
 * zero scenes is the worst failure this layer has: the panel is simply
 * absent, the render succeeds, and the video is a talking head with a grey
 * strip over its head.
 */

describe('reading back what the model wrote', () => {
  it('takes the field names it was asked for', () => {
    const [scene] = sanitisePanel(
      [{ startSec: 0, endSec: 2, kind: 'counter', eyebrowA: 'die zahl', eyebrowB: 'der apps', figure: '1500' }],
      10,
    );
    expect(scene.kind).toBe('counter');
    expect(scene.eyebrow).toEqual(['DIE ZAHL', 'DER APPS']);
    expect(scene.figure).toBe('1500');
  });

  it('takes the field names it used instead', () => {
    // Opus through this endpoint ignores `strict` and answers with `start`,
    // `end` and a two-item `eyebrow`. Both shapes have to parse.
    const [scene] = sanitisePanel(
      [{ start: 0, end: 2, kind: 'counter', eyebrow: ['Die Zahl', 'der Apps'], figure: 1500 } as never],
      10,
    );
    expect(scene.outStartSec).toBe(0);
    expect(scene.eyebrow).toEqual(['DIE ZAHL', 'DER APPS']);
    expect(scene.figure).toBe('1500');
  });

  it('leaves no gap in the strip', () => {
    // A gap is not a pause here — it is the top 42% of the frame going
    // blank, which reads as a bug rather than as a beat.
    const scenes = sanitisePanel(
      [
        { start: 0, end: 2, kind: 'list-panel', items: ['a', 'b'] },
        { start: 4.5, end: 6, kind: 'chat-card', items: ['x'] },
        { start: 8, end: 9, kind: 'list-panel', items: ['y'] },
      ] as never,
      12,
    );
    expect(scenes.length).toBe(3);
    for (let i = 1; i < scenes.length; i++) {
      expect(scenes[i].outStartSec).toBe(scenes[i - 1].outEndSec);
    }
    expect(scenes[0].outStartSec).toBe(0);
    expect(scenes.at(-1)!.outEndSec).toBe(12);
  });

  it('caps a scene that was given half the video', () => {
    const scenes = sanitisePanel([{ start: 0, end: 30, kind: 'list-panel', items: ['a'] }] as never, 30);
    // The last one is stretched to the end on purpose; what must not happen
    // is a 30-second exhibit in the middle of a run.
    const middle = sanitisePanel(
      [
        { start: 0, end: 30, kind: 'list-panel', items: ['a'] },
        { start: 30, end: 32, kind: 'chat-card', items: ['b'] },
      ] as never,
      32,
    );
    expect(middle[0].outEndSec - middle[0].outStartSec).toBeLessThanOrEqual(3.2);
    expect(scenes).toHaveLength(1);
  });
});

describe('the kinds that cannot render what they were given', () => {
  it('demotes a hub with nothing to connect to', () => {
    // It still renders — as one tile in an empty panel with no lines going
    // anywhere, which is the kind of failure nobody sees until the export.
    const [scene] = sanitisePanel(
      [{ start: 0, end: 2, kind: 'icon-hub', icons: ['instagram'], items: ['Vorher', 'Nachher'] }] as never,
      4,
    );
    expect(scene.kind).toBe('toggle-pair');
  });

  it('demotes a switch with only one side', () => {
    const [scene] = sanitisePanel(
      [{ start: 0, end: 2, kind: 'toggle-pair', items: ['Nur eins'] }] as never,
      4,
    );
    expect(scene.kind).toBe('list-panel');
  });

  it('demotes a hero with nothing to draw', () => {
    const [scene] = sanitisePanel([{ start: 0, end: 2, kind: 'hero-image', items: ['a'] }] as never, 4);
    expect(scene.kind).toBe('list-panel');
  });

  it('keeps a hub that has its icons', () => {
    const [scene] = sanitisePanel(
      [{ start: 0, end: 2, kind: 'icon-hub', icons: ['instagram', 'linkedin', 'youtube'] }] as never,
      4,
    );
    expect(scene.kind).toBe('icon-hub');
    expect(scene.icons).toEqual(['instagram', 'linkedin', 'youtube']);
  });
});

describe('words on a panel are labels', () => {
  it('cuts an item down to a label', () => {
    const [scene] = sanitisePanel(
      [
        {
          start: 0,
          end: 2,
          kind: 'list-panel',
          items: ['Er liest deine kompletten Kommentare und sortiert sie nach Thema'],
        },
      ] as never,
      4,
    );
    expect(scene.items[0].split(/\s+/)).toHaveLength(4);
  });

  it('upper-cases the eyebrow and the chip, which are set in caps', () => {
    const [scene] = sanitisePanel(
      [{ start: 0, end: 2, kind: 'list-panel', items: ['a'], eyebrow: ['die zahlen', 'aus deinen reels'], chip: 'holt sich alles selbst' }] as never,
      4,
    );
    expect(scene.eyebrow[0]).toBe('DIE ZAHLEN');
    expect(scene.chip).toBe('HOLT SICH ALLES SELBST');
  });
});
