import { describe, expect, it } from 'vitest';
import { applyOperations } from '@/lib/edl/operations';
import { blockStyle, fitScale, resolveWordStyle, wordColor, wordStyle } from '@/lib/captions/paint';
import { CaptionStyleSchema, type Edl } from '@/lib/edl/types';
import { CAPTION_PRESETS } from '@/lib/captions/presets';

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

describe('the guards a tight, scaled-up look needs', () => {
  it('keeps a word space when the line height is below 1', () => {
    /*
     * `gap` rejects a NEGATIVE value by dropping the whole declaration — both
     * the row gap and the column gap. A preset with lineHeight 0.92, which a
     * tight look wants so a nudged word can cross the line above, rendered
     * "THE MOST" as "THEMOST".
     */
    const tight = CaptionStyleSchema.parse({ lineHeight: 0.92 });
    const g = String(blockStyle(tight, { width: 1080, height: 1920 }, 100).gap);
    expect(g.startsWith('-')).toBe(false);
    // The word space must survive: it is the second half of the shorthand.
    expect(g.split(' ')[1]).toBe('26px');
  });

  it('still opens the lines up when the line height is above 1', () => {
    const loose = CaptionStyleSchema.parse({ lineHeight: 1.3 });
    const g = String(blockStyle(loose, { width: 1080, height: 1920 }, 100).gap);
    expect(parseFloat(g)).toBeGreaterThan(0);
  });
});

describe('keeping a scaled word inside the frame', () => {
  const fits = { text: 'powerful', fontSize: 130, maxWidthPx: 994, group: 'script' };

  it('leaves a scale that fits exactly as asked', () => {
    expect(fitScale({ ...fits, requested: 1 })).toBe(1);
  });

  it('pulls back a scale that would run off the frame', () => {
    // 1.7 put an eight-letter script word wider than a 1080 frame, and it
    // rendered cropped through the first and last letters.
    const s = fitScale({ ...fits, requested: 1.7 });
    expect(s).toBeLessThan(1.7);
    expect(s * fits.text.length * fits.fontSize * 0.62).toBeLessThanOrEqual(fits.maxWidthPx + 1);
  });

  it('never shrinks a highlight below the line it is highlighting', () => {
    // Smaller than its neighbours is not a highlight; at that point the preset
    // is wrong rather than the word.
    expect(fitScale({ ...fits, text: 'extraordinarily', requested: 3 })).toBeGreaterThanOrEqual(1);
  });

  it('allows a condensed face more letters than a script', () => {
    const script = fitScale({ ...fits, requested: 2, group: 'script' });
    const condensed = fitScale({ ...fits, requested: 2, group: 'condensed' });
    expect(condensed).toBeGreaterThan(script);
  });
});

describe('a style’s own rule for emphasised words', () => {
  const rule = { fontFamily: 'Yellowtail', scale: 1.35, uppercase: false };
  const styled = CaptionStyleSchema.parse({ emphasisStyle: rule });

  it('applies to a word the director marked, with no hand-styling at all', () => {
    // Without this a preset whose whole character is what it does to ONE word
    // produced a plain line, and the highlight had to be applied to every
    // video by hand — the same as not having it.
    expect(resolveWordStyle(styled, null, true)).toEqual(rule);
  });

  it('leaves ordinary words alone', () => {
    expect(resolveWordStyle(styled, null, false)).toBeNull();
  });

  it('lets a hand-set choice win over the rule, field by field', () => {
    // Taking a preset's highlight and changing only its colour must not throw
    // away its face and size.
    const merged = resolveWordStyle(styled, { color: '#FF0000' }, true);
    expect(merged).toMatchObject({ color: '#FF0000', fontFamily: 'Yellowtail', scale: 1.35 });
  });

  it('treats an unset field as unsaid rather than as a reset', () => {
    const merged = resolveWordStyle(styled, { color: '#FF0000', scale: null }, true);
    expect(merged?.scale).toBe(1.35);
  });

  it('returns the word’s own style untouched when there is no rule', () => {
    const plain = CaptionStyleSchema.parse({});
    expect(resolveWordStyle(plain, { color: '#FF0000' }, true)).toEqual({ color: '#FF0000' });
  });

  it('is what makes the Spotlight preset different from a plain caps preset', () => {
    const spotlight = CAPTION_PRESETS.find((p) => p.id === 'spotlight')!;
    const applied = resolveWordStyle(spotlight.style, null, true);
    expect(applied?.fontFamily).toBe('Yellowtail');
    // Lowercase, or a brush script is a row of disconnected shapes.
    expect(applied?.uppercase).toBe(false);
    expect(applied?.gradient).toBeTruthy();
  });
});

describe('a styled word’s box', () => {
  /*
   * The bug this guards: a CSS `filter` crops its element to a region based on
   * the element's BOX, not on how far the ink reaches. Spotlight sets
   * lineHeight 0.92 so a nudged word can ride over the line above — and a
   * brush script's Y dives far below the baseline. The result in a finished
   * video was every blue word sliced through, top and bottom.
   */
  it('is tall enough for a brush script even when the line is tight', () => {
    const tight = CaptionStyleSchema.parse({ lineHeight: 0.92 });
    const styled = wordStyle(tight, {
      fontStack: 'X',
      fontSize: 62,
      color: '#fff',
      emphasis: true,
      word: { fontFamily: 'Yellowtail', gradient: { from: '#2AB9FB', to: '#24F6FF', angle: 180 } },
    });
    expect(Number(styled.lineHeight)).toBeGreaterThanOrEqual(1.4);
  });

  it('leaves a plain word on the line’s own leading', () => {
    // Tight leading is the whole point of a preset like Spotlight, and nothing
    // clips a plain word because it goes through no filter.
    const tight = CaptionStyleSchema.parse({ lineHeight: 0.92 });
    const plain = wordStyle(tight, { fontStack: 'X', fontSize: 62, color: '#fff', emphasis: false });
    expect(plain.lineHeight).toBe(0.92);
  });

  it('keeps the space between words when the line is tighter than 1', () => {
    // A negative `gap` is dropped whole — row AND column — so "THE MOST"
    // rendered as "THEMOST".
    const gap = String(blockStyle(CaptionStyleSchema.parse({ lineHeight: 0.92 }), { width: 1080, height: 1920 }, 62).gap);
    const [row, column] = gap.split(' ');
    expect(parseFloat(row)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(column)).toBeGreaterThan(0);
  });
});
