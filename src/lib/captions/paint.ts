import type React from 'react';
import type { CaptionStyle } from '../edl/types';

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

/** A gradient fill has to be clipped to the glyphs, which means no flat colour. */
export function fillStyle(style: CaptionStyle, color: string): React.CSSProperties {
  if (!style.gradient) return { color };
  return {
    backgroundImage: `linear-gradient(${style.gradient.angle}deg, ${style.gradient.from}, ${style.gradient.to})`,
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

/** Everything about one word that does not move. */
export function wordStyle(
  style: CaptionStyle,
  opts: {
    fontStack: string;
    fontSize: number;
    color: string;
    emphasis: boolean;
    /** The word is sitting on its own plate, which replaces the stroke. */
    boxed?: boolean;
  },
): React.CSSProperties {
  const { fontStack, fontSize, color, emphasis, boxed = false } = opts;

  return {
    fontFamily: fontStack,
    fontWeight: emphasis ? Math.min(900, style.fontWeight + 100) : style.fontWeight,
    fontStyle: style.italic ? 'italic' : 'normal',
    fontSize,
    lineHeight: style.lineHeight,
    letterSpacing: `${style.letterSpacing}em`,
    textShadow: buildTextShadow(style, fontSize),
    whiteSpace: 'pre',
    ...(boxed && style.wordBox
      ? {
          backgroundColor: style.wordBox.color,
          borderRadius: style.wordBox.radius,
          padding: `${style.wordBox.padding * 0.55}px ${style.wordBox.padding}px`,
          margin: `${-style.wordBox.padding * 0.55}px ${-style.wordBox.padding * 0.35}px`,
          // A plate under the word does the job a stroke was doing; both at
          // once reads as a mistake.
          WebkitTextStroke: undefined,
        }
      : strokeStyle(style, fontSize)),
    ...fillStyle(style, color),
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
  opts: { active: boolean; emphasis: boolean },
): string {
  const activeColor = style.activeColor ?? style.emphasisColor;
  if (style.animation === 'karaoke' || style.animation === 'word-box') {
    if (opts.active) return activeColor;
  }
  return opts.emphasis ? style.emphasisColor : style.color;
}
