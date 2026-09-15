'use client';

import React from 'react';
import type { CaptionStyle } from '@/lib/edl/types';
import { blockStyle, justifyFor, wordColor, wordStyle } from '@/lib/captions/paint';
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
 * `activeWord` fakes the karaoke playhead so the lit state is visible at rest.
 * Without it the two animations that light a word previewed with nothing lit,
 * which made them look identical to the ones that don't.
 */
export function CaptionPreview({
  style,
  text,
  width,
  height,
  activeWord = 1,
  emphasisWord = -1,
  className,
  children,
}: {
  style: CaptionStyle;
  text: string;
  /** The preview frame in CSS pixels. Type scales off `height`, as in a render. */
  width: number;
  height: number;
  activeWord?: number;
  emphasisWord?: number;
  className?: string;
  /** The footage behind the captions, if there is any. */
  children?: React.ReactNode;
}) {
  const words = React.useMemo(() => splitForPreview(text, style.maxWordsPerCue), [text, style.maxWordsPerCue]);
  const fontSize = height * style.fontSizeRatio;
  const fontStack = fontStackFor(style.fontFamily);

  return (
    <div
      className={className}
      style={{ position: 'relative', width, height, overflow: 'hidden' }}
    >
      {children}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: justifyFor(style),
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: height * style.positionY,
            left: style.align === 'left' ? width * 0.06 : undefined,
            right: style.align === 'right' ? width * 0.06 : undefined,
            transform: 'translateY(-50%)',
            ...blockStyle(style, { width, height }, fontSize),
          }}
        >
          {words.map((word, index) => {
            const active = index === activeWord;
            const emphasis = index === emphasisWord;
            return (
              <span
                key={index}
                style={wordStyle(style, {
                  fontStack,
                  fontSize,
                  color: wordColor(style, { active, emphasis }),
                  emphasis,
                  boxed: active && style.animation === 'word-box' && Boolean(style.wordBox),
                })}
              >
                {style.uppercase ? word.toUpperCase() : word}
              </span>
            );
          })}
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
