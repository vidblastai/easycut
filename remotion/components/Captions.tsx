import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CaptionCue, CaptionStyle, CaptionWord, Edl } from '../../src/lib/edl/types';
import { ensureCaptionFont } from '../lib/fonts';
import { pop } from '../lib/timing';
import {
  blockStyle,
  fitScale,
  justifyFor,
  resolveWordStyle,
  wordColor,
  wordStyle,
} from '../../src/lib/captions/paint';
import { findCaptionFont } from '../../src/lib/captions/fonts';

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
export const Captions: React.FC<{ edl: Edl; positionY?: number | null }> = ({ edl, positionY = null }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const outSec = frame / fps;

  // Asking for the font here rather than inside the card means it starts
  // loading on frame 0, not on the frame the first cue happens to land on.
  const fontStack = ensureCaptionFont(edl.captionStyle.fontFamily);

  /*
   * And the same for every face a WORD asks for.
   *
   * A word can carry its own family, and a face requested at the moment its
   * cue appears is a face that renders as a fallback for the first frames —
   * on a server render that is a permanent artefact in the file, not a flash
   * somebody might miss. So every family used anywhere in the track is
   * requested here, before a single frame is drawn.
   */
  const overrideFonts = new Map<string, string>();
  const want = (family: string | null | undefined) => {
    if (family && !overrideFonts.has(family)) overrideFonts.set(family, ensureCaptionFont(family));
  };
  // The style's own emphasis rule counts: with it, a preset can name a face
  // that no individual word mentions, and it would otherwise be requested for
  // the first time on the frame the first emphasised word appears.
  want(edl.captionStyle.emphasisStyle?.fontFamily);
  for (const cue of edl.captions) for (const word of cue.words) want(word.style?.fontFamily);

  const cue = edl.captions.find((c) => outSec >= c.startSec && outSec < c.endSec);
  if (!cue) return null;

  // A split screen decides where the words go, not the caption preset: the seam
  // is the one band that covers neither the face above it nor the picture
  // below. Everywhere else the preset's own choice stands.
  const style = positionY === null ? edl.captionStyle : { ...edl.captionStyle, positionY };

  return (
    <CaptionCard cue={cue} style={style} fontStack={fontStack} overrideFonts={overrideFonts} />
  );
};

/* ------------------------------------------------------------------ paint */

/* How a caption is painted lives in src/lib/captions/paint.ts, because the
   style picker draws the same thing and two copies of "what a stroke means"
   drift silently. What stays here is the half that depends on the clock. */

/* ----------------------------------------------------------------- render */

const CaptionCard: React.FC<{
  cue: CaptionCue;
  style: CaptionStyle;
  fontStack: string;
  overrideFonts: Map<string, string>;
}> = ({ cue, style, fontStack, overrideFonts }) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const outSec = frame / fps;
  const cueStartFrame = cue.startSec * fps;
  const sinceCue = frame - cueStartFrame;

  const fontSize = height * style.fontSizeRatio;

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

  const justify = justifyFor(style);

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
          ...blockStyle(style, { width, height }, fontSize),
        }}
      >
        {cue.words.map((word, index) => (
          <Word
            key={`${cue.id}-${index}`}
            word={word}
            index={index}
            style={style}
            fontStack={fontStack}
            overrideFonts={overrideFonts}
            fontSize={fontSize}
            maxWidthPx={width * style.widthRatio}
            outSec={outSec}
            frame={frame}
            fps={fps}
            sinceCue={sinceCue}
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
  overrideFonts: Map<string, string>;
  fontSize: number;
  maxWidthPx: number;
  outSec: number;
  frame: number;
  fps: number;
  sinceCue: number;
}> = ({
  word, index, style, fontStack, overrideFonts, fontSize, maxWidthPx,
  outSec, frame, fps, sinceCue,
}) => {
  /* The word's own choices over the style's emphasis rule — see
     resolveWordStyle. Computed once, and everything below reads it. */
  const applied = resolveWordStyle(style, word.style, word.emphasis);

  const isActive = outSec >= word.startSec && outSec < word.endSec;
  const hasArrived = outSec >= word.startSec;

  let opacity = 1;
  let scale = 1;
  let translateY = 0;
  let rotate = 0;
  const color = wordColor(style, {
    active: isActive,
    emphasis: word.emphasis,
    word: applied,
  });
  let boxed = false;

  switch (style.animation) {
    case 'karaoke':
      // Whole line visible; the active word lights up.
      opacity = hasArrived ? 1 : 0.45;
      scale = isActive ? 1.04 : 1;
      break;

    case 'word-box':
      // Whole line visible; the active word gets a plate under it. The plate is
      // what makes this readable over busy footage, not the colour change.
      boxed = isActive && !!style.wordBox;
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

  /*
   * A word may opt out of the line's uppercase.
   *
   * A brush script in ALL CAPS is not the same look with different letters: a
   * script is made of the strokes that JOIN lowercase letters, and capitals
   * have none of them. So a script word set in caps looks broken, and the
   * whole point of the highlight is lost.
   */
  const caps = applied?.uppercase ?? style.uppercase;
  const text = caps ? word.text.toUpperCase() : word.text;

  /* And it may not run off the frame. See `fitScale`. */
  const scaled = applied?.scale
    ? fitScale({
        text,
        fontSize,
        requested: applied.scale,
        maxWidthPx,
        group: findCaptionFont(applied.fontFamily ?? style.fontFamily)?.group,
      })
    : undefined;
  const wordOverride = scaled != null ? { ...applied, scale: scaled } : applied;

  return (
    <span
      style={{
        ...wordStyle(style, {
          fontStack,
          fontSize,
          color,
          emphasis: word.emphasis,
          boxed,
          word: wordOverride,
          overrideFontStack: applied?.fontFamily
            ? (overrideFonts.get(applied.fontFamily) ?? null)
            : null,
        }),
        opacity,
        /*
         * The animation's transform and the word's own are composed HERE,
         * rather than one overwriting the other.
         *
         * `wordStyle` returns the hand-set slant and nudge as a transform, and
         * this line used to replace whatever it returned — so a word given a
         * rotation rendered straight the moment any animation was playing,
         * which is every caption. Order matters too: the static placement is
         * applied first so the animation happens around where the word sits,
         * not around where it would have sat.
         */
        transform: [
          applied?.offsetY != null ? `translateY(${applied.offsetY}em)` : '',
          applied?.rotate != null ? `rotate(${applied.rotate}deg)` : '',
          `scale(${scale})`,
          `translateY(${translateY}px)`,
          `rotate(${rotate}deg)`,
        ]
          .filter(Boolean)
          .join(' '),
        transformOrigin: 'center bottom',
      }}
    >
      {text}
    </span>
  );
};
