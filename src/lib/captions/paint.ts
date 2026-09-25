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
    // Row gap carries the line height; column gap is the word space.
    gap: `${fontSize * (style.lineHeight - 1) * 0.9}px ${fontSize * 0.26}px`,
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
    lineHeight: style.lineHeight,
    letterSpacing: `${style.letterSpacing}em`,
    textShadow: buildTextShadow(style, scaled),
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
