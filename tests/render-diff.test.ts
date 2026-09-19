import { describe, expect, it } from 'vitest';
import { EdlSchema, type Edl } from '@/lib/edl/types';
import { renderDelta, worthSplicing } from '@/lib/render/diff';
import { SAMPLE_EDL } from '../remotion/sample-edl';

/**
 * What has to be drawn again after an edit.
 *
 * The whole value of this is that it says "all" whenever it is not certain.
 * Saying "all" costs a render that would have happened anyway; saying "span"
 * when it should have said "all" ships a video with a seam in it — so every
 * test below that asserts `all` is guarding something more important than the
 * ones that assert a span.
 */

const base: Edl = EdlSchema.parse({
  ...SAMPLE_EDL,
  format: { ...SAMPLE_EDL.format, durationSec: 60 },
  segments: [{ ...SAMPLE_EDL.segments[0], sourceStartSec: 0, sourceEndSec: 60, outStartSec: 0, outEndSec: 60 }],
  captions: [
    { id: 'c1', startSec: 1, endSec: 3, words: [{ text: 'one', startSec: 1, endSec: 3, emphasis: false }] },
    { id: 'c2', startSec: 30, endSec: 32, words: [{ text: 'two', startSec: 30, endSec: 32, emphasis: false }] },
  ],
  graphics: [], broll: [], overlays: [], transitions: [], punchIns: [], sfx: [], music: null,
  deliverable: { ...SAMPLE_EDL.deliverable, durationSec: 60 },
});

/** A copy with one thing different, parsed so it is a real document. */
const change = (patch: Partial<Edl>): Edl => EdlSchema.parse({ ...base, ...patch });

describe('changes that mean every frame', () => {
  const cases: Array<[string, Partial<Edl>]> = [
    ['a different length', { format: { ...base.format, durationSec: 55 } }],
    ['a different shape', { format: { ...base.format, width: 720, height: 1280 } }],
    ['a different layout', { format: { ...base.format, layout: 'split' } }],
    ['a cut moving', {
      segments: [{ ...base.segments[0], outEndSec: 55, sourceEndSec: 55 }],
    }],
    ['a new caption look', { captionStyle: { ...base.captionStyle, fontSizeRatio: 0.09 } }],
    ['the watermark', { watermark: true }],
    ['different footage', { source: { ...base.source, url: 'http://example.test/other.mp4' } }],
  ];

  for (const [what, patch] of cases) {
    it(`redraws everything for ${what}`, () => {
      expect(renderDelta(base, change(patch)).kind).toBe('all');
    });
  }

  /*
   * Audio is the reason an incremental render is safe: the previous track is
   * carried over whole rather than re-mixed, so anything that would change it
   * has to go the long way round. Getting this wrong ships a video whose
   * sound effects are silently the old ones.
   */
  it('redraws everything when a sound effect changes, because the audio is reused', () => {
    const withSfx = change({ sfx: [{ id: 's1', atSec: 12, sound: 'whoosh', gainDb: -8 }] as never });
    expect(renderDelta(base, withSfx).kind).toBe('all');
  });

  it('redraws everything when the music changes', () => {
    const withMusic = change({
      music: {
        id: 'm1', url: 'a.mp3', title: 'A', mood: 'calm', bpm: 90, gainDb: -18,
        duckDb: -12, startAtSec: 0, fadeInSec: 0.8, fadeOutSec: 1.5, attribution: '',
      } as never,
    });
    expect(renderDelta(base, withMusic).kind).toBe('all');
  });
});

describe('changes confined to one stretch', () => {
  it('finds the caption that changed, and only that one', () => {
    const edited = change({
      captions: [
        base.captions[0],
        { ...base.captions[1], words: [{ text: 'TWO', startSec: 30, endSec: 32, emphasis: true }] },
      ],
    });
    const delta = renderDelta(base, edited);
    expect(delta.kind).toBe('span');
    if (delta.kind !== 'span') return;
    expect(delta.fromSec).toBeLessThanOrEqual(30);
    expect(delta.toSec).toBeGreaterThanOrEqual(32);
    // Nowhere near the other caption at 1–3s.
    expect(delta.fromSec).toBeGreaterThan(20);
  });

  it('covers both the old and the new position when a cue moves', () => {
    // Otherwise the frames it used to be on still show it.
    const moved = change({
      captions: [base.captions[0], { ...base.captions[1], startSec: 45, endSec: 47 }],
    });
    const delta = renderDelta(base, moved);
    expect(delta.kind).toBe('span');
    if (delta.kind !== 'span') return;
    expect(delta.fromSec).toBeLessThanOrEqual(30);
    expect(delta.toSec).toBeGreaterThanOrEqual(47);
  });

  it('covers the vacated frames when a cue is deleted', () => {
    const deleted = change({ captions: [base.captions[0]] });
    const delta = renderDelta(base, deleted);
    expect(delta.kind).toBe('span');
    if (delta.kind !== 'span') return;
    expect(delta.fromSec).toBeLessThanOrEqual(30);
    expect(delta.toSec).toBeGreaterThanOrEqual(32);
  });

  it('pads the span, because several layers reach outside their own timing', () => {
    const edited = change({
      captions: [base.captions[0], { ...base.captions[1], words: [{ text: 'x', startSec: 30, endSec: 32, emphasis: false }] }],
    });
    const delta = renderDelta(base, edited);
    if (delta.kind !== 'span') throw new Error('expected a span');
    expect(delta.fromSec).toBeLessThan(30);
    expect(delta.toSec).toBeGreaterThan(32);
  });

  it('never runs past the ends of the video', () => {
    const edited = change({
      captions: [
        { ...base.captions[0], startSec: 0, endSec: 1 },
        { ...base.captions[1], startSec: 59, endSec: 60 },
      ],
    });
    const delta = renderDelta(base, edited);
    if (delta.kind !== 'span') throw new Error('expected a span');
    expect(delta.fromSec).toBeGreaterThanOrEqual(0);
    expect(delta.toSec).toBeLessThanOrEqual(60);
  });
});

describe('changes that do not reach the screen', () => {
  it('needs nothing redrawn for a new title or hashtags', () => {
    const retitled = change({
      deliverable: { ...base.deliverable, title: 'Something else', hashtags: ['#new'] },
    });
    expect(renderDelta(base, retitled).kind).toBe('none');
  });

  it('reports none for an identical document', () => {
    expect(renderDelta(base, change({})).kind).toBe('none');
  });
});

describe('deciding whether the splice is worth it', () => {
  it('takes a short span', () => {
    expect(worthSplicing({ kind: 'span', fromSec: 30, toSec: 33, reason: '' }, 60)).toBe(true);
  });

  it('refuses one that covers most of the video', () => {
    expect(worthSplicing({ kind: 'span', fromSec: 2, toSec: 58, reason: '' }, 60)).toBe(false);
  });

  it('refuses anything that is not a span', () => {
    expect(worthSplicing({ kind: 'all', reason: '' }, 60)).toBe(false);
    expect(worthSplicing({ kind: 'none' }, 60)).toBe(false);
  });

  it('refuses a video of no length rather than dividing by zero', () => {
    expect(worthSplicing({ kind: 'span', fromSec: 0, toSec: 1, reason: '' }, 0)).toBe(false);
  });
});
