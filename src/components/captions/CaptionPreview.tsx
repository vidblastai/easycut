'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { CaptionStyle } from '@/lib/edl/types';
import {
  blockStyle,
  justifyFor,
  resolveWordStyle,
  wordColor,
  wordStyle,
} from '@/lib/captions/paint';
import { fontStackFor } from '@/lib/captions/fonts';

/**
 * One held frame of a caption, drawn exactly as the renderer would draw it.
 *
 * The preview is the whole point of the picker — a grid of style names teaches
 * nobody anything — so it imports the same paint module the Remotion renderer
 * uses. What it cannot show is arrival: the pop, the slide, the typewriter.
 * It shows the frame those animations arrive AT, which is the frame that is on
 * screen for most of a cue's life and therefore the one worth choosing on.
 *
 * It draws at the video's REAL pixel dimensions and then scales the whole thing
 * down to whatever space it has been given. Laying out at the display size
 * instead would be subtly wrong in a way that matters here: a stroke width and
 * a shadow blur are absolute pixel values authored against a 1080-tall frame,
 * so at 168px tall they round to nothing and every heavy preset previews as a
 * plain one. Scaling a correct frame is exact; re-deriving it is not.
 *
 * `activeWord` fakes the karaoke playhead so the lit state is visible at rest.
 * Without it the two animations that light a word previewed with nothing lit,
 * which made them look identical to the ones that don't.
 */
export function CaptionPreview({
  style,
  text,
  frameWidth,
  frameHeight,
  activeWord = 1,
  emphasisWord = -1,
  className,
  children,
}: {
  style: CaptionStyle;
  text: string;
  /** The video's real output size. The preview scales to fit its container. */
  frameWidth: number;
  frameHeight: number;
  activeWord?: number;
  /**
   * Which word carries the style's emphasis treatment.
   *
   * `'last'` rather than an index, because the preview truncates the sample
   * text to the preset's own `maxWordsPerCue` — so a fixed index points at a
   * word that a three-word preset has already cut, and the treatment silently
   * does not appear. That is exactly how a script-highlight preset ended up
   * looking identical to four plain ones in the picker.
   */
  emphasisWord?: number | 'last';
  className?: string;
  /** The footage behind the captions, if there is any. */
  children?: React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const apply = () => setScale(host.getBoundingClientRect().width / frameWidth);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(host);
    return () => observer.disconnect();
  }, [frameWidth]);

  const words = React.useMemo(() => splitForPreview(text, style.maxWordsPerCue), [text, style.maxWordsPerCue]);
  const fontSize = frameHeight * style.fontSizeRatio;
  const fontStack = fontStackFor(style.fontFamily);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ position: 'relative', width: '100%', aspectRatio: `${frameWidth} / ${frameHeight}`, overflow: 'hidden' }}
    >
      {children}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: frameWidth,
          height: frameHeight,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
          // Until the first measurement lands, scale is 0 and the frame would
          // paint at full size for one frame — a flash of enormous type.
          visibility: scale > 0 ? 'visible' : 'hidden',
        }}
      >
        {/* The same two-box arrangement the renderer uses: an absolutely
            positioned block inside a flex parent, so a centred caption is
            centred by the parent's alignItems exactly as it is in the video. */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'flex-start', alignItems: justifyFor(style) }}>
          <div
            style={{
              position: 'absolute',
              top: frameHeight * style.positionY,
              left: style.align === 'left' ? frameWidth * 0.06 : undefined,
              right: style.align === 'right' ? frameWidth * 0.06 : undefined,
              transform: 'translateY(-50%)',
              ...blockStyle(style, { width: frameWidth, height: frameHeight }, fontSize),
            }}
          >
            {words.map((word, index) => {
              const active = index === activeWord;
              const emphasisAt = emphasisWord === 'last' ? words.length - 1 : emphasisWord;
              const emphasis = index === emphasisAt;
              /*
               * The style's emphasis rule applies HERE too.
               *
               * Without it the picker showed a preset whose whole character
               * is what it does to one word as if it did nothing at all —
               * the tile for a script-highlight preset was indistinguishable
               * from four plain ones beside it, so the thing you were
               * choosing was invisible at the moment of choosing.
               */
              const applied = resolveWordStyle(style, null, emphasis);
              const caps = applied?.uppercase ?? style.uppercase;
              return (
                <React.Fragment key={index}>
                  {/* The same break the renderer makes — see Captions.tsx. A
                      picker that shows the highlight inline would be showing a
                      layout the export does not produce. */}
                  {style.emphasisOwnLine && emphasis && index > 0 ? (
                    <span aria-hidden style={{ flexBasis: '100%', height: 0 }} />
                  ) : null}
                <span
                  style={wordStyle(style, {
                    fontStack,
                    fontSize,
                    color: wordColor(style, { active, emphasis, word: applied }),
                    emphasis,
                    boxed: active && style.animation === 'word-box' && Boolean(style.wordBox),
                    word: applied,
                    overrideFontStack: applied?.fontFamily ? fontStackFor(applied.fontFamily) : null,
                  })}
                >
                  {caps ? word.toUpperCase() : word}
                </span>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * As many words as this style would actually put in one cue.
 *
 * Previewing a fixed six words made the tight presets look like they wrapped
 * and the loose ones look sparse — the exact opposite of what they do.
 */
function splitForPreview(text: string, maxWords: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  return words.slice(0, Math.max(2, Math.min(maxWords, words.length)));
}

/**
 * A wide window onto the strip of frame where the captions sit.
 *
 * A full 9:16 preview is four hundred pixels tall, which makes a grid of them
 * unscannable and a sidebar card absurd. Faking a short frame instead would be
 * wrong in a way that is easy to miss: type size and vertical position are both
 * fractions of the frame HEIGHT, so a made-up height moves the captions and
 * resizes them at once. This keeps the real frame and crops it, and the
 * percentage translate is relative to the frame's own height — `-78%` puts
 * positionY 0.78 on the window's centre line, so the crop follows the style.
 */
export function CaptionBand({
  style,
  text,
  frameWidth,
  frameHeight,
  aspect = '16 / 10',
  activeWord = 1,
  emphasisWord = -1,
  backdrop,
  className,
}: {
  style: CaptionStyle;
  text: string;
  frameWidth: number;
  frameHeight: number;
  /** The window's own shape, independent of the video's. */
  aspect?: string;
  activeWord?: number;
  /** Which word shows the style's emphasis treatment. `'last'` or -1 for none. */
  emphasisWord?: number | 'last';
  backdrop?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className} style={{ position: 'relative', overflow: 'hidden', aspectRatio: aspect }}>
      {backdrop}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          transform: `translateY(-${style.positionY * 100}%)`,
        }}
      >
        <CaptionPreview
          style={style}
          text={text}
          frameWidth={frameWidth}
          frameHeight={frameHeight}
          activeWord={activeWord}
          emphasisWord={emphasisWord}
        />
      </div>
    </div>
  );
}
