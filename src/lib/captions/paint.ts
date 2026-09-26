import type React from 'react';
import type { CaptionStyle, CaptionWordStyle } from '../edl/types';

/**
 * How a caption is painted, as plain CSS.
 *
 * Two things draw captions: the Remotion renderer, which makes the video, and
 * the style picker, which shows you what you are choosing. If those two carry
 * their own copies of "what a stroke means" they drift, and the drift is
 * invisible until someone picks a look, exports it, and gets something else.
 * So everything about a caption that does not depend on the clock lives here
 * and both sides import it.
 *
 * Nothing in this file knows about time. Arrival animations — the pop, the
 * slide, the karaoke highlight — stay in the renderer, because they are the
 * half that genuinely differs: the preview shows one held frame.
 */

/** text-shadow does the work of shadow and glow together. */
export function buildTextShadow(style: CaptionStyle, fontSize: number): string | undefined {
  const layers: string[] = [];

  if (style.glow) {
    // Two passes: a tight core and a wide bloom. One pass reads as a blur.
    layers.push(`0 0 ${style.glow.blur * 0.4}px ${style.glow.color}`);
    layers.push(`0 0 ${style.glow.blur}px ${style.glow.color}`);
  }
  if (style.shadow) {
    const { offsetX, offsetY, blur, color } = style.shadow;
    // Offsets are authored against a 1080-tall frame, so they scale with type
    // rather than vanishing on a 4K render.
    const k = fontSize / 62;
    layers.push(`${offsetX * k}px ${offsetY * k}px ${blur * k}px ${color}`);
  }

  return layers.length ? layers.join(', ') : undefined;
}

/**
 * Stroke.
 *
 * `-webkit-text-stroke` centres the stroke on the outline, so half of it eats
 * into the glyph — a 10px stroke on a bold face closes the counters and the
 * word turns into a blob. `paint-order: stroke fill` draws the stroke first and
 * the fill on top, which puts the whole width outside the letterform. Widths in
 * the presets assume that, and the width scales with the type for the same
 * reason the shadow does.
 */
export function strokeStyle(style: CaptionStyle, fontSize: number): React.CSSProperties {
  if (!style.stroke) return {};
  return {
    WebkitTextStroke: `${style.stroke.width * (fontSize / 62)}px ${style.stroke.color}`,
    paintOrder: 'stroke fill',
  };
}

/**
 * Outline, glow and drop shadow for glyphs filled with a GRADIENT.
 *
 * ── Two things a gradient breaks, both found in a rendered frame ─────────
 *
 * A gradient fill is not a fill. It is a background image clipped to the
 * glyphs, with `color: transparent` so it shows through. That breaks the two
 * tools this file otherwise uses:
 *
 *  1. `-webkit-text-stroke` draws centred on the letter's outline, half inside
 *     the glyph. Normally the fill paints over that inner half; a transparent
 *     fill hides nothing, so the stroke eats inward until a bold face is a
 *     dark blob with slivers of gradient left in the middle.
 *
 *  2. `text-shadow` is painted BETWEEN the element's background and its text.
 *     So shadow copies land ON TOP of the clipped gradient and hide it
 *     completely — swapping the stroke for shadow offsets turned the blob into
 *     a solid slab, which is how this was diagnosed.
 *
 * `drop-shadow` is the one that works: it is a filter over the element as
 * already painted — gradient included — and it composites underneath. Repeated
 * at eight offsets it makes an outline that follows the letterform without
 * touching it. Four offsets is visibly square on a curve; sixteen costs paint
 * time for a difference invisible at caption size.
 *
 * This applies to the `gradient` preset too, which has carried the first bug
 * since long before per-word styling existed.
 */
function gradientFilter(
  style: CaptionStyle,
  fontSize: number,
  /** This word's own glow, which replaces the line's. */
  glowOverride?: { color: string; blur: number } | null,
): string | undefined {
  const k = fontSize / 62;
  const parts: string[] = [];
  const glow = glowOverride ?? style.glow;

  if (style.stroke) {
    /*
     * HALF the width, and that halving is the difference between matching the
     * line above and looking like a sticker.
     *
     * `-webkit-text-stroke` is centred on the outline, so a width of 8 puts
     * only 4 outside the glyph. `drop-shadow` expands the silhouette by its
     * full radius. Using the authored width directly made a gradient word's
     * outline twice as heavy as the identical outline on the words beside it,
     * which is obvious the moment the two sit on the same frame.
     */
    const r = Math.max(0.5, (style.stroke.width / 2) * k);
    const d = r * 0.7071; // diagonals, so the ring is round rather than a plus
    const c = style.stroke.color;
    parts.push(
      `drop-shadow(${r}px 0 0 ${c})`, `drop-shadow(${-r}px 0 0 ${c})`,
      `drop-shadow(0 ${r}px 0 ${c})`, `drop-shadow(0 ${-r}px 0 ${c})`,
      `drop-shadow(${d}px ${d}px 0 ${c})`, `drop-shadow(${-d}px ${d}px 0 ${c})`,
      `drop-shadow(${d}px ${-d}px 0 ${c})`, `drop-shadow(${-d}px ${-d}px 0 ${c})`,
    );
  }
  if (glow) {
    // Two passes: a tight core and a wide bloom. One pass reads as a blur.
    parts.push(`drop-shadow(0 0 ${glow.blur * 0.4 * k}px ${glow.color})`);
    parts.push(`drop-shadow(0 0 ${glow.blur * k}px ${glow.color})`);
  }
  if (style.shadow) {
    const { offsetX, offsetY, blur, color } = style.shadow;
    parts.push(`drop-shadow(${offsetX * k}px ${offsetY * k}px ${blur * k}px ${color})`);
  }

  return parts.length ? parts.join(' ') : undefined;
}

/**
 * A gradient fill has to be clipped to the glyphs, which means no flat colour.
 *
 * `override` is a word's own gradient, which wins over the line's — that is
 * what puts one word in a different gradient from its neighbours.
 */
export function fillStyle(
  style: CaptionStyle,
  color: string,
  override?: { from: string; to: string; angle: number } | null,
): React.CSSProperties {
  const gradient = override ?? style.gradient;
  if (!gradient) return { color };
  return {
    backgroundImage: `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    // The stroke still needs a colour to draw against; transparent text plus a
    // clipped background is what makes the gradient visible through it.
    color: 'transparent',
  };
}

export function justifyFor(style: CaptionStyle): 'flex-start' | 'flex-end' | 'center' {
  return style.align === 'left' ? 'flex-start' : style.align === 'right' ? 'flex-end' : 'center';
}

/**
 * The block the words flow inside.
 *
 * No maxHeight. Capping the pixels cropped the last line through the middle of
 * its letters, which looks broken in a way an extra line never does. `maxLines`
 * is enforced where it belongs — in how many words go into a cue — so by the
 * time a cue reaches here it already fits.
 */
export function blockStyle(
  style: CaptionStyle,
  frame: { width: number; height: number },
  fontSize: number,
): React.CSSProperties {
  return {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: justifyFor(style),
    alignItems: 'baseline',
    /*
     * Row gap carries the line height; column gap is the word space.
     *
     * CLAMPED AT ZERO, and that clamp is not cosmetic. A `lineHeight` below 1
     * — which a tight preset wants, so a nudged word can cross the line above
     * — made this negative, and `gap` rejects a negative value by dropping the
     * WHOLE declaration. Both gaps went, so the words in a line ran together:
     * "THE MOST" rendered as "THEMOST". Leading below 1 is applied by
     * `lineHeight` on the words themselves, where it belongs.
     */
    gap: `${Math.max(0, fontSize * (style.lineHeight - 1) * 0.9)}px ${fontSize * 0.26}px`,
    maxWidth: frame.width * style.widthRatio,
    textAlign: style.align,
    ...(style.background
      ? {
          backgroundColor: style.background.color,
          padding: `${style.background.padding}px ${style.background.padding * 1.6}px`,
          borderRadius: style.background.radius,
        }
      : {}),
  };
}

/**
 * What actually applies to this word.
 *
 * A word's own style is a deliberate choice about THIS word, so it outranks
 * the style's rule about emphasised words in general. The rule fills in
 * whatever the choice left unsaid, which is what lets somebody take a preset's
 * highlight and change only its colour.
 */
export function resolveWordStyle(
  style: CaptionStyle,
  word: CaptionWordStyle | null | undefined,
  emphasis: boolean,
): CaptionWordStyle | null {
  const rule = emphasis ? style.emphasisStyle : null;
  if (!word) return rule;
  if (!rule) return word;
  // Only the fields the word actually set win; `undefined` and `null` both
  // mean "nothing said here", so the rule shows through.
  const merged: Record<string, unknown> = { ...rule };
  for (const [k, v] of Object.entries(word)) if (v != null) merged[k] = v;
  return merged as CaptionWordStyle;
}

/**
 * How wide a word will be, near enough to keep it on screen.
 *
 * ── Why an estimate rather than a measurement ────────────────────────────
 *
 * Neither caller can measure. The renderer lays this out in a headless browser
 * one frame at a time, and reading a width back would mean a layout pass per
 * word per frame; the picker draws at a fraction of the real size, so its
 * measurements are not the render's anyway.
 *
 * The estimate only has to be good enough to catch the case that actually
 * ruins a frame: a word scaled up past the edge and cropped mid-letter. The
 * first render of the script look did exactly that — "powerful" at 1.7× ran
 * off BOTH sides and lost its first and last letters. A conservative average
 * advance per face, rounded up, catches that while never shrinking a word that
 * would have fitted.
 */
/**
 * Enough leading to contain an expressive face's ascenders and descenders.
 *
 * 1.45 is measured against the worst of the script faces in the registry, not
 * guessed: Yellowtail's ink runs about 1.38em from the top of its ascenders to
 * the bottom of its descenders. The margin above that absorbs the outline and
 * the first stop of the glow, which are also inside the filter region.
 */
const GLYPH_SAFE_LINE_HEIGHT = 1.45;

/**
 * Room around a styled word for ink the line box does not account for.
 *
 * Leading alone was not enough, and the reason is worth writing down: a
 * gradient word is painted by clipping a background to its letters
 * (`background-clip: text`), and a background is painted over the element's
 * PADDING BOX. A filter's region is measured from the same box. Neither has
 * any idea how far the letters actually reach — that comes from the font's
 * declared metrics, which a brush script overshoots in both directions. Where
 * the box stops, the gradient stops, and the letter is simply cut off: in a
 * finished video the tail of a `g` ended in a straight horizontal edge.
 *
 * So a styled word carries padding, and cancels it again with an equal
 * negative margin. The box the browser paints into grows; the space the word
 * occupies on the line does not move by a pixel.
 *
 * 0.6em is measured, not guessed. Rendering the five script faces in the
 * registry at rising bleeds and measuring the ink each one puts on screen:
 * Yellowtail's "right" was 174px wide at 0.14em and 185px from 0.45em
 * upward — the 11px missing were the tail of its `t`, sliced off by a
 * straight vertical edge. Nothing in any face grows past 0.45em, through
 * 0.6, 0.8 and 1.2, so 0.6 is the measured ceiling plus a third again.
 */
const GLYPH_BLEED_EM = { block: 0.6, inline: 0.6 };

const AVG_ADVANCE: Record<string, number> = {
  // Scripts are wide and their swashes overhang; assume the worst.
  script: 0.62,
  condensed: 0.42,
  display: 0.56,
  default: 0.54,
};

export function fitScale(opts: {
  text: string;
  fontSize: number;
  requested: number;
  maxWidthPx: number;
  /** The font's group, which is what decides how wide its letters run. */
  group?: string;
}): number {
  const { text, fontSize, requested, maxWidthPx, group } = opts;
  if (!text.length || maxWidthPx <= 0) return requested;
  const advance = AVG_ADVANCE[group ?? 'default'] ?? AVG_ADVANCE.default;
  if (text.length * fontSize * requested * advance <= maxWidthPx) return requested;
  // Never below the line's own size: a highlight word smaller than its
  // neighbours is not a highlight, and at that point the preset is wrong
  // rather than the word.
  return Math.max(1, maxWidthPx / (text.length * fontSize * advance));
}

/**
 * Everything about one word that does not move.
 *
 * ── The override is resolved HERE, in one place ──────────────────────────
 *
 * Both the Remotion renderer and the picker's live preview call this, which is
 * what keeps the README's promise that what you pick is what exports. A word's
 * own font, size, colour, gradient, slant or nudge would otherwise have to be
 * applied twice, in two files, identically — and "identically" is a thing that
 * survives about one refactor.
 *
 * Every override falls back to the line's value, so a word without one renders
 * byte for byte as it did before per-word styling existed.
 */
export function wordStyle(
  style: CaptionStyle,
  opts: {
    fontStack: string;
    fontSize: number;
    color: string;
    emphasis: boolean;
    /** The word is sitting on its own plate, which replaces the stroke. */
    boxed?: boolean;
    /** This word's hand-set overrides, if it has any. */
    word?: CaptionWordStyle | null;
    /**
     * The font stack for `word.fontFamily`, resolved by the caller.
     *
     * Resolving it here would mean this file importing the font registry, and
     * the two callers already load faces differently — the renderer from disk,
     * the preview from the page. So the caller, which knows, passes it.
     */
    overrideFontStack?: string | null;
  },
): React.CSSProperties {
  const { fontStack, fontSize, color, emphasis, boxed = false, word, overrideFontStack } = opts;

  // Size first: the slant, the nudge and the plate are all expressed relative
  // to the size this word actually ends up at, not the line's.
  const scaled = fontSize * (word?.scale ?? 1);
  const box = word?.box ?? (boxed ? style.wordBox : null);

  /*
   * A gradient — the line's or this word's — changes how the outline has to be
   * drawn. See `fauxStroke`. Deciding it here, once, is what keeps the two
   * callers (the renderer and the live preview) showing the same thing.
   */
  const gradient = word?.gradient ?? style.gradient;

  const transforms = [
    word?.offsetY != null ? `translateY(${word.offsetY}em)` : '',
    word?.rotate != null ? `rotate(${word.rotate}deg)` : '',
  ].filter(Boolean);

  return {
    fontFamily: overrideFontStack ?? fontStack,
    fontWeight:
      word?.fontWeight ?? (emphasis ? Math.min(900, style.fontWeight + 100) : style.fontWeight),
    fontStyle: (word?.italic ?? style.italic) ? 'italic' : 'normal',
    fontSize: scaled,
    /*
     * A styled word needs a box tall enough to hold its own letters.
     *
     * ── Why this clips, which is not obvious ────────────────────────────
     *
     * A CSS `filter` establishes a filter region, and Chromium's is the
     * element's box plus a margin — NOT however far the ink happens to
     * stretch. Every gradient or glowing word goes through `filter`, so its
     * paint is cropped to that region.
     *
     * The line's own `lineHeight` can be well under 1 (Spotlight uses 0.92 so
     * a nudged word can cross the line above), and a brush script has huge
     * ascenders and a descender that dives far below the baseline. Box 0.92em
     * tall, ink perhaps 1.6em: the filter region sliced the top and bottom off
     * every letter. In a finished video "BY" rendered with the Y cut through
     * at both ends.
     *
     * So a word with its own styling gets a box sized to its glyphs rather
     * than to the line's leading. Plain words are untouched — their leading is
     * the whole point of a tight preset, and nothing clips them because they
     * have no filter.
     */
    lineHeight: word ? Math.max(style.lineHeight, GLYPH_SAFE_LINE_HEIGHT) : style.lineHeight,
    letterSpacing: `${style.letterSpacing}em`,
    // A gradient moves the shadow, glow and outline out of `text-shadow` and
    // into a `filter` chain — see gradientFilter for the two reasons why.
    ...(gradient
      ? { filter: gradientFilter(style, scaled, word?.glow) }
      : word?.glow
        ? {
            // A glow on a flat-filled word still has to be a filter: a
            // text-shadow glow would sit under the stroke rather than around
            // the finished letter.
            filter: `drop-shadow(0 0 ${word.glow.blur * 0.4 * (scaled / 62)}px ${word.glow.color}) drop-shadow(0 0 ${word.glow.blur * (scaled / 62)}px ${word.glow.color})`,
            textShadow: buildTextShadow(style, scaled),
          }
        : { textShadow: buildTextShadow(style, scaled) }),
    whiteSpace: 'pre',
    ...(transforms.length
      ? {
          transform: transforms.join(' '),
          // The word leaves the line's flow visually but not its layout, which
          // is exactly what makes an overlapping word possible without
          // shoving its neighbours sideways.
          display: 'inline-block',
        }
      : {}),
    /*
     * See GLYPH_BLEED_EM. Only for a word with styling of its own — a plain
     * word is painted with a flat fill that cannot be clipped this way — and
     * never with a plate, whose own padding IS its size.
     */
    ...(word && !box
      ? {
          padding: `${GLYPH_BLEED_EM.block}em ${GLYPH_BLEED_EM.inline}em`,
          margin: `${-GLYPH_BLEED_EM.block}em ${-GLYPH_BLEED_EM.inline}em`,
        }
      : {}),
    ...(box
      ? {
          backgroundColor: box.color,
          borderRadius: box.radius,
          padding: `${box.padding * 0.55}px ${box.padding}px`,
          margin: `${-box.padding * 0.55}px ${-box.padding * 0.35}px`,
          // A plate under the word does the job a stroke was doing; both at
          // once reads as a mistake.
          WebkitTextStroke: undefined,
        }
      : gradient
        ? // The outline is already in the text-shadow above; a real stroke on
          // top of it would be the blob this exists to avoid.
          {}
        : strokeStyle(style, scaled)),
    ...fillStyle(style, word?.color ?? color, word?.gradient),
  };
}

/**
 * A word's colour at rest, before any animation touches it.
 *
 * `karaoke` and `word-box` light the word being spoken; every other animation
 * leaves colour alone and moves the word instead. Keeping that decision here
 * means the preview can show the lit state without reimplementing the rule.
 */
export function wordColor(
  style: CaptionStyle,
  opts: { active: boolean; emphasis: boolean; word?: CaptionWordStyle | null },
): string {
  // A colour somebody set by hand is not a suggestion — it outranks both the
  // emphasis rule and the karaoke highlight, because they chose it FOR this
  // word and the other two are defaults about words in general.
  if (opts.word?.color) return opts.word.color;
  const activeColor = style.activeColor ?? style.emphasisColor;
  if (style.animation === 'karaoke' || style.animation === 'word-box') {
    if (opts.active) return activeColor;
  }
  return opts.emphasis ? style.emphasisColor : style.color;
}
