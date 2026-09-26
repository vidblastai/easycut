import { describe, expect, it } from 'vitest';
import { applyOperations } from '@/lib/edl/operations';
import { wordColor, wordStyle } from '@/lib/captions/paint';
import { CaptionStyleSchema, type Edl } from '@/lib/edl/types';

/**
 * Styling one word differently from the rest of its line.
 *
 * The rule under all of this: an override is a PATCH over the line's style, and
 * a word without one must render exactly as it did before per-word styling
 * existed. Both halves matter — the second is what makes this safe to ship
 * against every caption already in the database.
 */

const style = CaptionStyleSchema.parse({});

const edl = () =>
  ({
    version: '1.0',
    projectId: 'p',
    styleId: 'punchy',
    format: { aspect: '9:16', width: 1080, height: 1920, fps: 30, durationSec: 10 },
    source: { url: 's', durationSec: 10 },
    segments: [{ id: 's1', outStartSec: 0, outEndSec: 10, srcStartSec: 0, srcEndSec: 10, speed: 1 }],
    broll: [],
    graphics: [],
    overlays: [],
    transitions: [],
    punchIns: [],
    sfx: [],
    captionStyle: style,
    captions: [
      {
        id: 'c1',
        startSec: 0,
        endSec: 2,
        words: [
          { text: 'the', startSec: 0, endSec: 0.4, emphasis: false },
          { text: 'most', startSec: 0.4, endSec: 0.8, emphasis: false },
          { text: 'powerful', startSec: 0.8, endSec: 1.6, emphasis: true },
        ],
      },
    ],
  }) as unknown as Edl;

describe('setting one word’s style', () => {
  it('touches that word and no other', () => {
    const { edl: next } = applyOperations(edl(), [
      { op: 'caption.wordStyle', id: 'c1', wordIndex: 2, style: { color: '#2E9BFF' } },
    ]);
    expect(next.captions[0].words[2].style?.color).toBe('#2E9BFF');
    expect(next.captions[0].words[0].style).toBeFalsy();
    expect(next.captions[0].words[1].style).toBeFalsy();
  });

  it('merges a second decision instead of overwriting the first', () => {
    // "Make it blue" then "make it bigger" must leave it blue AND bigger —
    // the whole reason the operation carries a patch rather than a style.
    let next = applyOperations(edl(), [
      { op: 'caption.wordStyle', id: 'c1', wordIndex: 2, style: { color: '#2E9BFF' } },
    ]).edl;
    next = applyOperations(next, [
      { op: 'caption.wordStyle', id: 'c1', wordIndex: 2, style: { scale: 1.4 } },
    ]).edl;
    expect(next.captions[0].words[2].style).toMatchObject({ color: '#2E9BFF', scale: 1.4 });
  });

  it('clears everything when the style is null', () => {
    let next = applyOperations(edl(), [
      { op: 'caption.wordStyle', id: 'c1', wordIndex: 2, style: { color: '#2E9BFF', scale: 1.4 } },
    ]).edl;
    next = applyOperations(next, [
      { op: 'caption.wordStyle', id: 'c1', wordIndex: 2, style: null },
    ]).edl;
    expect(next.captions[0].words[2].style).toBeNull();
  });

  it('leaves other cues alone', () => {
    const two = edl();
    // A second cue LATER in the video: two at the same instant is not a thing
    // a real track contains, and normalisation is free to reorder them.
    two.captions.push({
      ...two.captions[0],
      id: 'c2',
      startSec: 3,
      endSec: 5,
      words: two.captions[0].words.map((w) => ({ ...w })),
    });
    const { edl: next } = applyOperations(two, [
      { op: 'caption.wordStyle', id: 'c2', wordIndex: 0, style: { color: '#FFF' } },
    ]);
    expect(next.captions[0].words[0].style).toBeFalsy();
    expect(next.captions[1].words[0].style?.color).toBe('#FFF');
  });
});

describe('painting a word with an override', () => {
  const base = { fontStack: 'X', fontSize: 100, color: '#FFFFFF', emphasis: false };

  it('renders identically to before when the word has none', () => {
    const plain = wordStyle(style, base);
    const withNull = wordStyle(style, { ...base, word: null });
    expect(withNull).toEqual(plain);
  });

  it('scales the type, and the shadow with it', () => {
    const big = wordStyle(style, { ...base, word: { scale: 1.5 } });
    expect(big.fontSize).toBe(150);
    // A shadow left at the line's size would sit visibly wrong under a word
    // half again as large.
    expect(big.textShadow).not.toEqual(wordStyle(style, base).textShadow);
  });

  it('puts a gradient on one word without the line having one', () => {
    const g = wordStyle(style, {
      ...base,
      word: { gradient: { from: '#7DD3FC', to: '#2563EB', angle: 180 } },
    });
    expect(g.backgroundImage).toContain('#7DD3FC');
    // A clipped gradient needs transparent glyphs to show through.
    expect(g.color).toBe('transparent');
  });

  it('composes the slant and the nudge into one transform', () => {
    const t = wordStyle(style, { ...base, word: { rotate: -6, offsetY: -0.12 } });
    expect(t.transform).toContain('rotate(-6deg)');
    expect(t.transform).toContain('translateY(-0.12em)');
    // It has to leave the text flow to move without shoving its neighbours.
    expect(t.display).toBe('inline-block');
  });

  it('takes a hand-set face over the line’s', () => {
    const f = wordStyle(style, { ...base, word: { fontFamily: 'Anton' }, overrideFontStack: 'Anton, sans-serif' });
    expect(f.fontFamily).toBe('Anton, sans-serif');
  });
});

describe('which colour wins', () => {
  it('prefers a hand-set colour over the emphasis rule', () => {
    const c = wordColor(style, { active: false, emphasis: true, word: { color: '#2E9BFF' } });
    expect(c).toBe('#2E9BFF');
  });

  it('prefers a hand-set colour over the karaoke highlight', () => {
    const karaoke = CaptionStyleSchema.parse({ animation: 'karaoke' });
    const c = wordColor(karaoke, { active: true, emphasis: false, word: { color: '#2E9BFF' } });
    expect(c).toBe('#2E9BFF');
  });

  it('falls back to the old rules when the word says nothing', () => {
    expect(wordColor(style, { active: false, emphasis: true })).toBe(style.emphasisColor);
    expect(wordColor(style, { active: false, emphasis: false })).toBe(style.color);
  });
});

describe('a gradient changes how the outline has to be drawn', () => {
  const base = { fontStack: 'X', fontSize: 62, color: '#FFFFFF', emphasis: false };
  const outlined = CaptionStyleSchema.parse({ stroke: { width: 8, color: '#000000' } });

  it('uses a real stroke when the glyphs have a solid fill', () => {
    const s = wordStyle(outlined, base);
    expect(s.WebkitTextStroke).toBe('8px #000000');
    expect(s.filter).toBeUndefined();
  });

  it('drops the real stroke once a gradient fills the glyphs', () => {
    // A centred stroke over a TRANSPARENT fill eats inward with nothing to
    // cover it, and a bold face becomes a dark blob. Found in a rendered frame.
    const s = wordStyle(outlined, {
      ...base,
      word: { gradient: { from: '#7DD3FC', to: '#2563EB', angle: 180 } },
    });
    expect(s.WebkitTextStroke).toBeUndefined();
    expect(String(s.filter)).toContain('drop-shadow');
  });

  it('moves the shadow out of text-shadow, which would cover the gradient', () => {
    // `text-shadow` paints BETWEEN the background and the text, so on clipped
    // glyphs it hides the gradient completely.
    const s = wordStyle(outlined, {
      ...base,
      word: { gradient: { from: '#7DD3FC', to: '#2563EB', angle: 180 } },
    });
    expect(s.textShadow).toBeUndefined();
  });

  it('halves the width, because drop-shadow expands by its full radius', () => {
    // A centred 8px stroke puts 4px outside the glyph. Using 8 here made a
    // gradient word twice as heavy as the identical outline beside it.
    const s = wordStyle(outlined, {
      ...base,
      word: { gradient: { from: '#7DD3FC', to: '#2563EB', angle: 180 } },
    });
    expect(String(s.filter)).toContain('drop-shadow(4px 0 0 #000000)');
  });

  it('applies to a line-level gradient too, not only a word’s', () => {
    // The `gradient` preset carried this bug since long before per-word styling.
    const g = CaptionStyleSchema.parse({
      stroke: { width: 8, color: '#000000' },
      gradient: { from: '#A', to: '#B', angle: 180 },
    });
    const s = wordStyle(g, base);
    expect(s.WebkitTextStroke).toBeUndefined();
    expect(String(s.filter)).toContain('drop-shadow');
  });
});
