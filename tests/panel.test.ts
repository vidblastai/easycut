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
    // Which kind it lands on is the renderable list's business; what matters
    // is that it is not one that would draw half a switch.
    expect(scene.kind).not.toBe('toggle-pair');
    expect(scene.items).toEqual(['Nur eins']);
  });

  it('demotes a hero with nothing to draw', () => {
    const [scene] = sanitisePanel([{ start: 0, end: 2, kind: 'hero-image', items: ['a'] }] as never, 4);
    expect(scene.kind).not.toBe('hero-image');
  });

  it('never draws the same exhibit twice running', () => {
    // Neither reference repeats a kind back to back in 45 scenes, and a model
    // left to itself returned seventeen `list-panel` out of thirty-eight.
    const scenes = sanitisePanel(
      Array.from({ length: 6 }, (_, i) => ({
        start: i * 2,
        end: i * 2 + 2,
        kind: 'list-panel',
        items: ['Eins', 'Zwei'],
      })) as never,
      12,
    );
    for (let i = 1; i < scenes.length; i++) {
      expect(scenes[i].kind, `scene ${i}`).not.toBe(scenes[i - 1].kind);
    }
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

/**
 * What the panel looked like on a real upload, and why.
 *
 * Sixteen of eighteen exhibits came back with no `icons` at all, so every
 * `toggle-pair` in the video drew the same two orange starbursts — the
 * fallback tile — and the whole panel read as one template repeating. Three
 * more came back with nothing in them and rendered as blank white cards.
 */
describe('an exhibit that would draw nothing', () => {
  it('gives a toggle-pair its items as icons when the model named none', () => {
    const [scene] = sanitisePanel(
      [{ startSec: 0, endSec: 2, kind: 'toggle-pair', items: ['Video editor', 'Cloud Code'], icons: [] }],
      4,
    );
    // The two things a toggle names ARE its items, and the icon resolver
    // answers "video editor" as readily as it answers "instagram".
    expect(scene.icons).toEqual(['video editor', 'cloud code']);
  });

  it('leaves the icons the model did name alone', () => {
    const [scene] = sanitisePanel(
      [{ startSec: 0, endSec: 2, kind: 'toggle-pair', items: ['Before', 'After'], icons: ['figma', 'notion'] }],
      4,
    );
    expect(scene.icons).toEqual(['figma', 'notion']);
  });

  it('drops a scene with nothing to draw rather than showing a blank card', () => {
    const scenes = sanitisePanel(
      [
        { startSec: 0, endSec: 2, kind: 'list-panel', eyebrowA: 'THE OLD WAY', eyebrowB: 'HUMAN EDITORS' },
        { startSec: 2, endSec: 4, kind: 'chat-card', label: 'Claude', items: ['edit my video'] },
      ],
      4,
    );
    expect(scenes).toHaveLength(1);
    expect(scenes[0].kind).toBe('chat-card');
    // And the survivor still covers the whole runtime.
    expect(scenes[0].outStartSec).toBe(0);
    expect(scenes[0].outEndSec).toBe(4);
  });

  it('still butts the survivors together when one in the middle is dropped', () => {
    const scenes = sanitisePanel(
      [
        { startSec: 0, endSec: 2, kind: 'list-panel', items: ['a', 'b'] },
        { startSec: 2, endSec: 4, kind: 'list-panel' },
        { startSec: 4, endSec: 6, kind: 'chat-card', items: ['c'] },
      ],
      6,
    );
    expect(scenes).toHaveLength(2);
    expect(scenes[0].outEndSec).toBeCloseTo(scenes[1].outStartSec, 2);
    expect(scenes[scenes.length - 1].outEndSec).toBe(6);
  });
});

describe('what does not get an icon lookup', () => {
  it('leaves a chat-card alone — its items are lines of a message', () => {
    const [scene] = sanitisePanel(
      [{ startSec: 0, endSec: 2, kind: 'chat-card', label: 'Claude', items: ['Need more time', 'Sending revisions'] }],
      4,
    );
    expect(scene.kind).toBe('chat-card');
    // Asking an icon library for "need more time" is a round trip for a
    // picture nothing on this card renders.
    expect(scene.icons).toEqual([]);
  });

  it('leaves a list-panel alone for the same reason', () => {
    const [scene] = sanitisePanel(
      [{ startSec: 0, endSec: 2, kind: 'list-panel', items: ['clip_01.mp4', 'clip_02.mp4'] }],
      4,
    );
    expect(scene.icons).toEqual([]);
  });
});
