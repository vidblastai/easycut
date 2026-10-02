import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { framedPositionX, framedPositionY, framedWidthRatio, sceneHasText, type CaptionCue, type CaptionStyle, type CaptionWord, type Edl } from '../../src/lib/edl/types';
import { ensureCaptionFont } from '../lib/fonts';
import { pop } from '../lib/timing';
import { easeOutCubic, kf } from '../lib/motion';

/**
 * How dim a word is before it is spoken, and how long it takes to warm.
 *
 * Both measured off a reference edit at 15fps: an unspoken word sits at a
 * little under half, and a word takes two to three frames to come up. Below
 * about 0.3 the future of the line stops being readable, which loses the
 * whole point — the viewer is meant to see where the sentence is going.
 */
const DIM = 0.42;
const FILL_FRAMES = 3;
import {
  blockStyle,
  fitScale,
  justifyFor,
  resolveWordStyle,
  splitLineIndex,
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
/** How far ahead the next card is drawn, invisibly, to be rasterised. */
const PREWARM_SEC = 0.8;

export const Captions: React.FC<{ edl: Edl; positionY?: number | null; lowDetail?: boolean }> = ({
  edl,
  positionY = null,
  lowDetail = false,
}) => {
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
  /*
   * Built once per track, not once per frame.
   *
   * Two reasons, and the second is the expensive one. Walking every word of
   * every cue thirty times a second is work that grows with the length of the
   * video — a five-minute edit has a couple of thousand words, so this was
   * tens of thousands of lookups a second to arrive at the same four faces.
   * And the Map was a NEW object every frame, which is a changed prop on the
   * caption card, which re-reconciles every word in it — gradients,
   * drop-shadow chains and all — on frames where nothing about the card
   * changed. Memoised, the card only re-renders when the card really moves.
   */
  const overrideFonts = React.useMemo(() => {
    const map = new Map<string, string>();
    const want = (family: string | null | undefined) => {
      if (family && !map.has(family)) map.set(family, ensureCaptionFont(family));
    };
    // The style's own emphasis rule counts: with it, a preset can name a face
    // that no individual word mentions, and it would otherwise be requested for
    // the first time on the frame the first emphasised word appears.
    want(edl.captionStyle.emphasisStyle?.fontFamily);
    want(edl.captionStyle.lineTwoStyle?.fontFamily);
    for (const cue of edl.captions) for (const word of cue.words) want(word.style?.fontFamily);
    return map;
  }, [edl.captions, edl.captionStyle.emphasisStyle?.fontFamily, edl.captionStyle.lineTwoStyle?.fontFamily]);

  /*
   * Captions stand down while a scene is doing the talking.
   *
   * A kinetic-text scene IS the sentence, set large in the middle of the
   * frame; running the caption band underneath it puts the same words on
   * screen twice, half a beat out of step, and the eye cannot read either. A
   * scene made only of shapes and icons has no such quarrel, so it does not
   * take the captions away — see `sceneHasText`.
   *
   * Decided here rather than baked into the document, because a scene can be
   * moved, trimmed or deleted in the editor and the captions underneath it
   * have to come straight back.
   */
  const covered = React.useMemo(
    () => edl.scenes.filter(sceneHasText).map((s) => [s.outStartSec, s.outEndSec] as const),
    [edl.scenes],
  );
  const silenced = covered.some(([from, to]) => outSec >= from && outSec < to);

  const cue = silenced
    ? undefined
    : edl.captions.find((c) => outSec >= c.startSec && outSec < c.endSec);

  /*
   * The card AFTER this one, drawn early and almost invisibly.
   *
   * A caption card is heavy to paint the first time: every word is gradient
   * text under a chain of drop-shadows, and the browser rasterises all of it
   * the moment the card appears. Cards change at cuts — the card builder ends
   * one at every splice — so that cost lands on the same frame as everything
   * else the cut asks for, and it is visible as a hitch.
   *
   * Drawing it a beat early at four thousandths of opacity does the
   * rasterising then, off the critical frame. It is not visible, it cannot be
   * interacted with, and when the card's real moment comes the browser already
   * has the pixels.
   */
  const upcoming = lowDetail
    ? edl.captions.find((c) => c.startSec > outSec && c.startSec - outSec <= PREWARM_SEC)
    : undefined;

  if (!cue && !upcoming) return null;

  /*
   * A split screen decides where the words go, not the caption preset: the
   * seam is the one band that covers neither the face above it nor the picture
   * below. Everywhere else the preset chooses — inside the caption band.
   *
   * The band exists because the presets had drifted from the middle of the
   * frame to hard against the bottom edge, and where a video's words live
   * should not change when somebody tries a different caption look. See
   * `framedPositionY`.
   */
  /*
   * A hand-placed caption outranks the layout's band too.
   *
   * `positionY` arrives non-null from a split layout, which reserves the one
   * strip covering neither the face above nor the picture below — a good rule,
   * and still a rule. Somebody dragging the words is looking at the frame
   * while they do it, so if they put the words somewhere the layout would not
   * have, they can see exactly what that costs and can drag them back. A drag
   * that silently does nothing on one layout is the worse outcome.
   */
  const style =
    positionY === null || edl.captionStyle.placement
      ? { ...edl.captionStyle, positionY: framedPositionY(edl.captionStyle) }
      : { ...edl.captionStyle, positionY };

  return (
    <>
      {cue ? (
        <CaptionCard
          cue={cue}
          style={style}
          fontStack={fontStack}
          overrideFonts={overrideFonts}
          lowDetail={lowDetail}
        />
      ) : null}
      {upcoming ? (
        <div
          aria-hidden
          style={{ position: 'absolute', inset: 0, opacity: 0.004, pointerEvents: 'none' }}
        >
          <CaptionCard
            cue={upcoming}
            style={style}
            fontStack={fontStack}
            overrideFonts={overrideFonts}
            lowDetail={lowDetail}
            frozen
          />
        </div>
      ) : null}
    </>
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
  lowDetail?: boolean;
  /** Draw the card as it will look once it has settled. See PREWARM_SEC. */
  frozen?: boolean;
}> = ({ cue, style, fontStack, overrideFonts, lowDetail = false, frozen = false }) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const outSec = frozen ? cue.endSec - 0.01 : frame / fps;
  const cueStartFrame = cue.startSec * fps;
  const sinceCue = frozen ? fps * 2 : frame - cueStartFrame;

  /*
   * The type shrinks with the column, and only ever for a placed caption.
   *
   * A caption dragged toward an edge gets a narrower column — it has to, or
   * half of it hangs off the frame, since the anchor is the column's centre.
   * But a narrower column does not shrink a WORD: flex wrapping only breaks
   * between words, so "everything" at a 111px weight is 600 pixels wide
   * whatever `maxWidth` says, and it simply overflowed and ran off the left
   * edge. Scaling the size by how much the column gave up keeps the block
   * inside its own box.
   *
   * Floored, because there is a size below which the words stop being the
   * point of the frame. Somebody who drags a caption right into the corner
   * gets small type; they do not get type they cannot read.
   */
  const columnRatio = framedWidthRatio(style);
  const fontSize = height * style.fontSizeRatio * Math.max(0.6, Math.min(1, columnRatio / style.widthRatio));

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

  /*
   * Where the card breaks into its two lines, for a style that asks for two.
   *
   * Computed once for the card rather than per word, because every word has to
   * agree about it: the break goes in front of one word and the colour goes on
   * that word and everything after it.
   */
  const splitAt = style.splitLines
    ? splitLineIndex(cue.words, findCaptionFont(style.fontFamily)?.group)
    : null;

  /*
   * Where the block hangs from.
   *
   * Two layouts, and the difference is whether anybody has moved the words.
   * Unplaced, they are laid out by `align` — a left-aligned style gets a
   * margin from the frame edge, which is not the same thing as a centre point
   * and is why `framedPositionX` returns null rather than 0.5 for it. Placed,
   * the anchor IS the centre of the column, so the caption stays where it was
   * put when its words change length.
   */
  const placedX = framedPositionX(style);

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: justify }}>
      <div
        style={{
          position: 'absolute',
          top: height * style.positionY,
          left: placedX !== null ? width * placedX : style.align === 'left' ? width * 0.06 : undefined,
          right: placedX !== null ? undefined : style.align === 'right' ? width * 0.06 : undefined,
          transform: `${placedX !== null ? 'translateX(-50%) ' : ''}translateY(-50%) translateY(${cardTranslateY}px) scale(${cardScale})`,
          opacity: cardOpacity,
          ...blockStyle(style, { width, height }, fontSize),
          // After the block's own style, because a placed column near an edge
          // has to be narrower than the look asked for or half of it hangs off
          // the frame — it is centred on an anchor that is already near the
          // edge. See `framedWidthRatio`.
          maxWidth: width * columnRatio,
        }}
      >
        {cue.words.map((word, index) => (
          <React.Fragment key={`${cue.id}-${index}`}>
            {/*
              * A full-width, zero-height break.
              *
              * The block is a wrapping flex row, and this is how you force a
              * wrap inside one: an item that is already 100% wide leaves no
              * room beside it, so the next item starts a new line. Not a
              * `<br>`, which flex ignores, and not a second block, which would
              * need its own alignment and gap to stay in step with the first.
              *
              * Only before an emphasised word, only when the style asks, and
              * never as the first item — a break there would open an empty
              * line above the caption.
              */}
            {(style.emphasisOwnLine && word.emphasis && index > 0) || index === splitAt ? (
              <span aria-hidden style={{ flexBasis: '100%', height: 0 }} />
            ) : null}
            <Word
            word={word}
            index={index}
            lineTwo={splitAt !== null && index >= splitAt}
            style={style}
            fontStack={fontStack}
            overrideFonts={overrideFonts}
            fontSize={fontSize}
            maxWidthPx={width * columnRatio}
            outSec={outSec}
            frame={frame}
            fps={fps}
            sinceCue={sinceCue}
            lowDetail={lowDetail}
            frozen={frozen}
          />
          </React.Fragment>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Word: React.FC<{
  word: CaptionWord;
  index: number;
  /** This word is on the card's second line, which a split style colours. */
  lineTwo?: boolean;
  style: CaptionStyle;
  fontStack: string;
  overrideFonts: Map<string, string>;
  fontSize: number;
  maxWidthPx: number;
  outSec: number;
  frame: number;
  fps: number;
  sinceCue: number;
  /** Draw the cheap version of the effects. See `gradientFilter`. */
  lowDetail?: boolean;
  /** Skip the arrival animation: this word is being drawn ahead of time. */
  frozen?: boolean;
}> = ({
  word, index, lineTwo = false, style, fontStack, overrideFonts, fontSize, maxWidthPx,
  outSec, frame, fps, sinceCue, lowDetail = false, frozen = false,
}) => {
  /* The word's own choices over the style's emphasis rule — see
     resolveWordStyle. Computed once, and everything below reads it. */
  const lineStyle = lineTwo ? style.lineTwoStyle : null;
  /* The line's rule first, then the word's own on top: somebody who recolours
     one word of the coloured line keeps their colour. */
  const applied = resolveWordStyle(
    style,
    lineStyle ? { ...lineStyle, ...(word.style ?? {}) } : word.style,
    word.emphasis,
  );

  const isActive = !frozen && outSec >= word.startSec && outSec < word.endSec;
  const hasArrived = frozen || outSec >= word.startSec;

  let opacity = 1;
  let scale = 1;
  let translateY = 0;
  let rotate = 0;
  /*
   * A word that has not been spoken yet still takes up its space.
   *
   * The card is centred, so a word that is absent from the layout and then
   * added shoves everything already on screen sideways: the first word appeared
   * in the middle, slid left when the second arrived, slid again for the third.
   * Watching it, the line never stops moving and the eye never settles.
   *
   * Holding the space means every word appears where it will stay. Hidden
   * rather than transparent, because a glow or a stroke drawn at zero opacity
   * still costs a composited layer per word.
   */
  let waiting = false;
  const color = wordColor(style, {
    active: isActive,
    emphasis: word.emphasis,
    word: applied,
  });
  let boxed = false;

  switch (style.animation) {
    case 'karaoke': {
      /*
       * Whole line visible; the active word lights up — and it RAMPS there.
       *
       * This used to be a bare ternary, stepping a word from 0.45 to 1 on one
       * frame. At 30fps a jump that size is a flicker: the eye catches the
       * change rather than the word, which is the opposite of what a karaoke
       * fill is for. Three frames is the figure measured off a reference edit,
       * and it is the same ramp `word-fill` uses — the two differ in the
       * scale pulse below, not in how the tone moves.
       */
      const warmed = frozen
        ? 1
        : kf(frame, [[word.startSec * fps, 0], [word.startSec * fps + FILL_FRAMES, 1]], easeOutCubic);
      opacity = 0.45 + 0.55 * warmed;
      scale = isActive ? 1.04 : 1;
      break;
    }

    /*
     * The same idea, measured off a reference edit frame by frame, and
     * different from `karaoke` in the two places that decide whether type
     * reads as considered or as a template.
     *
     * `karaoke` steps a word from 0.45 to 1 on a single frame, and at 30fps a
     * step that size is a flicker — the eye catches the change rather than
     * the word. The reference ramps each one across about three frames, which
     * is slow enough to read as the line WARMING and fast enough to stay on
     * the syllable.
     *
     * And nothing scales. `karaoke` pulses the active word 4% larger, which
     * on a line of eight words is eight pulses a sentence; the reference
     * holds the line perfectly still and changes only the tone. Stillness is
     * what lets the picture behind it be the thing that moves.
     */
    case 'word-fill': {
      const warmed = frozen
        ? 1
        : kf(frame, [[word.startSec * fps, 0], [word.startSec * fps + FILL_FRAMES, 1]], easeOutCubic);
      opacity = DIM + (1 - DIM) * warmed;
      break;
    }

    case 'word-box':
      // Whole line visible; the active word gets a plate under it. The plate is
      // what makes this readable over busy footage, not the colour change.
      boxed = isActive && !!style.wordBox;
      opacity = hasArrived ? 1 : 0.5;
      break;

    case 'word-pop':
    case 'bounce': {
      waiting = !hasArrived;
      const s = frozen ? 1 : pop(frame - word.startSec * fps, fps, 0, style.animation === 'bounce');
      scale = 0.72 + s * 0.28 + (word.emphasis ? 0.08 : 0);
      opacity = Math.min(1, s * 1.6);
      translateY = (1 - s) * fontSize * 0.28;
      break;
    }

    case 'shake': {
      waiting = !hasArrived;
      const s = frozen ? 1 : pop(frame - word.startSec * fps, fps, 0, true);
      scale = 0.8 + s * 0.2;
      opacity = Math.min(1, s * 1.8);
      // Emphasis words land crooked and settle. Every word doing it is noise.
      if (word.emphasis) rotate = (1 - s) * (index % 2 === 0 ? -7 : 7);
      break;
    }

    case 'typewriter':
      waiting = !hasArrived;
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
          cheap: lowDetail,
          group: findCaptionFont(applied?.fontFamily ?? style.fontFamily)?.group,
          overrideFontStack: applied?.fontFamily
            ? (overrideFonts.get(applied.fontFamily) ?? null)
            : null,
        }),
        opacity,
        ...(waiting ? { visibility: 'hidden' as const } : {}),
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
