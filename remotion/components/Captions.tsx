import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CaptionCue, CaptionStyle, CaptionWord, Edl } from '../../src/lib/edl/types';
import { ensureCaptionFont } from '../lib/fonts';
import { pop } from '../lib/timing';

/**
 * Captions.
 *
 * This is the layer that earns the product its money: most short-form is
 * watched muted, so the captions ARE the video.
 *
 * Every animation shares one layout. A style swap changes how the words arrive,
 * their face, their colour and their decoration — never where the block sits or
 * how many words are in it, because those come from the cue timing the ASR
 * produced and re-flowing them would desynchronise the whole track.
 */
export const Captions: React.FC<{ edl: Edl }> = ({ edl }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const outSec = frame / fps;

  // Asking for the font here rather than inside the card means it starts
  // loading on frame 0, not on the frame the first cue happens to land on.
  const fontStack = ensureCaptionFont(edl.captionStyle.fontFamily);

  const cue = edl.captions.find((c) => outSec >= c.startSec && outSec < c.endSec);
  if (!cue) return null;

  return <CaptionCard cue={cue} style={edl.captionStyle} fontStack={fontStack} />;
};

/* ------------------------------------------------------------------ paint */

/** text-shadow does the work of shadow, glow and stroke-softening together. */
function buildTextShadow(style: CaptionStyle, fontSize: number): string | undefined {
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
function strokeStyle(style: CaptionStyle, fontSize: number): React.CSSProperties {
  if (!style.stroke) return {};
  return {
    WebkitTextStroke: `${style.stroke.width * (fontSize / 62)}px ${style.stroke.color}`,
    paintOrder: 'stroke fill',
  };
}

/** A gradient fill has to be clipped to the glyphs, which means no flat colour. */
function fillStyle(style: CaptionStyle, color: string): React.CSSProperties {
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

/* ----------------------------------------------------------------- render */

const CaptionCard: React.FC<{ cue: CaptionCue; style: CaptionStyle; fontStack: string }> = ({
  cue,
  style,
  fontStack,
}) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const outSec = frame / fps;
  const cueStartFrame = cue.startSec * fps;
  const sinceCue = frame - cueStartFrame;

  const fontSize = height * style.fontSizeRatio;
  const textShadow = buildTextShadow(style, fontSize);
  const stroke = strokeStyle(style, fontSize);

  /* ---- how the whole block arrives ---- */
  let cardOpacity = 1;
  let cardScale = 1;
  let cardTranslateY = 0;

  switch (style.animation) {
    case 'slide-up': {
      const s = pop(sinceCue, fps, 0, false);
      cardTranslateY = (1 - s) * fontSize * 0.9;
      cardOpacity = Math.min(1, s * 2);
      break;
    }
    case 'scale-in': {
      const s = pop(sinceCue, fps, 0, true);
      cardScale = 0.82 + s * 0.18;
      cardOpacity = Math.min(1, s * 2);
      break;
    }
    case 'bounce':
    case 'word-pop':
      // The card itself barely moves; the words do the arriving.
      cardScale = 0.94 + pop(sinceCue, fps, 0, style.animation === 'bounce') * 0.06;
      break;
    default:
      break;
  }

  const justify =
    style.align === 'left' ? 'flex-start' : style.align === 'right' ? 'flex-end' : 'center';

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: justify }}>
      <div
        style={{
          position: 'absolute',
          top: height * style.positionY,
          left: style.align === 'left' ? width * 0.06 : undefined,
          right: style.align === 'right' ? width * 0.06 : undefined,
          transform: `translateY(-50%) translateY(${cardTranslateY}px) scale(${cardScale})`,
          opacity: cardOpacity,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: justify,
          alignItems: 'baseline',
          // Row gap carries the line height; column gap is the word space.
          gap: `${fontSize * (style.lineHeight - 1) * 0.9}px ${fontSize * 0.26}px`,
          maxWidth: width * style.widthRatio,
          // No maxHeight. Capping the pixels cropped the last line through the
          // middle of its letters, which looks broken in a way an extra line
          // never does. maxLines is enforced where it belongs — in how many
          // words go into a cue — so by the time a cue reaches here it already
          // fits.
          textAlign: style.align,
          ...(style.background
            ? {
                backgroundColor: style.background.color,
                padding: `${style.background.padding}px ${style.background.padding * 1.6}px`,
                borderRadius: style.background.radius,
              }
            : {}),
        }}
      >
        {cue.words.map((word, index) => (
          <Word
            key={`${cue.id}-${index}`}
            word={word}
            index={index}
            style={style}
            fontStack={fontStack}
            fontSize={fontSize}
            outSec={outSec}
            frame={frame}
            fps={fps}
            sinceCue={sinceCue}
            textShadow={textShadow}
            strokeCss={stroke}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Word: React.FC<{
  word: CaptionWord;
  index: number;
  style: CaptionStyle;
  fontStack: string;
  fontSize: number;
  outSec: number;
  frame: number;
  fps: number;
  sinceCue: number;
  textShadow: string | undefined;
  strokeCss: React.CSSProperties;
}> = ({ word, index, style, fontStack, fontSize, outSec, frame, fps, sinceCue, textShadow, strokeCss }) => {
  const isActive = outSec >= word.startSec && outSec < word.endSec;
  const hasArrived = outSec >= word.startSec;
  const activeColor = style.activeColor ?? style.emphasisColor;

  let opacity = 1;
  let scale = 1;
  let translateY = 0;
  let rotate = 0;
  let color = word.emphasis ? style.emphasisColor : style.color;
  let boxed = false;

  switch (style.animation) {
    case 'karaoke':
      // Whole line visible; the active word lights up.
      color = isActive || word.emphasis ? activeColor : style.color;
      opacity = hasArrived ? 1 : 0.45;
      scale = isActive ? 1.04 : 1;
      break;

    case 'word-box':
      // Whole line visible; the active word gets a plate under it. The plate is
      // what makes this readable over busy footage, not the colour change.
      boxed = isActive && !!style.wordBox;
      color = boxed ? activeColor : word.emphasis ? style.emphasisColor : style.color;
      opacity = hasArrived ? 1 : 0.5;
      break;

    case 'word-pop':
    case 'bounce': {
      if (!hasArrived) return null;
      const s = pop(frame - word.startSec * fps, fps, 0, style.animation === 'bounce');
      scale = 0.72 + s * 0.28 + (word.emphasis ? 0.08 : 0);
      opacity = Math.min(1, s * 1.6);
      translateY = (1 - s) * fontSize * 0.28;
      break;
    }

    case 'shake': {
      if (!hasArrived) return null;
      const s = pop(frame - word.startSec * fps, fps, 0, true);
      scale = 0.8 + s * 0.2;
      opacity = Math.min(1, s * 1.8);
      // Emphasis words land crooked and settle. Every word doing it is noise.
      if (word.emphasis) rotate = (1 - s) * (index % 2 === 0 ? -7 : 7);
      break;
    }

    case 'typewriter':
      if (!hasArrived) return null;
      break;

    case 'line-fade':
    case 'slide-up':
    case 'scale-in':
      // The block animates as one; the words inside it just sit there.
      opacity = interpolate(sinceCue, [0, fps * 0.22], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
      break;
  }

  // A caps-only face gets uppercased regardless — lowercase in the EDL would
  // otherwise render as caps anyway and the editor would be describing a
  // setting that does nothing.
  const text = style.uppercase ? word.text.toUpperCase() : word.text;

  return (
    <span
      style={{
        fontFamily: fontStack,
        fontWeight: word.emphasis ? Math.min(900, style.fontWeight + 100) : style.fontWeight,
        fontStyle: style.italic ? 'italic' : 'normal',
        fontSize,
        lineHeight: style.lineHeight,
        letterSpacing: `${style.letterSpacing}em`,
        opacity,
        transform: `scale(${scale}) translateY(${translateY}px) rotate(${rotate}deg)`,
        transformOrigin: 'center bottom',
        textShadow,
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
          : strokeCss),
        ...fillStyle(style, color),
      }}
    >
      {text}
    </span>
  );
};
