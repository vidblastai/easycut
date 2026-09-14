import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CaptionCue, CaptionStyle, Edl } from '../../src/lib/edl/types';
import { FONT_FAMILY } from '../lib/fonts';
import { pop } from '../lib/timing';

/**
 * Captions.
 *
 * This is the layer that earns the product its money: most viewers watch muted,
 * so the captions ARE the video. Five animation modes share one layout so a
 * style swap never changes where the text sits, only how it arrives.
 */
export const Captions: React.FC<{ edl: Edl }> = ({ edl }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const outSec = frame / fps;

  const cue = edl.captions.find((c) => outSec >= c.startSec && outSec < c.endSec);
  if (!cue) return null;

  return <CaptionCard cue={cue} style={edl.captionStyle} edl={edl} />;
};

const CaptionCard: React.FC<{ cue: CaptionCue; style: CaptionStyle; edl: Edl }> = ({ cue, style, edl }) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const outSec = frame / fps;
  const cueStartFrame = cue.startSec * fps;

  const fontSize = height * style.fontSizeRatio;
  // The card enters once; individual words animate inside it.
  const cardSpring = pop(frame - cueStartFrame, fps, 0, style.animation === 'bounce');

  const textShadow = style.shadow ? '0 4px 24px rgba(0,0,0,0.55)' : undefined;
  const stroke = style.stroke
    ? { WebkitTextStroke: `${style.stroke.width}px ${style.stroke.color}`, paintOrder: 'stroke fill' as const }
    : {};

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-start',
        alignItems: 'center',
        paddingLeft: width * 0.07,
        paddingRight: width * 0.07,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: height * style.positionY,
          transform: `translateY(-50%) scale(${0.94 + cardSpring * 0.06})`,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'baseline',
          gap: `${fontSize * 0.1}px ${fontSize * 0.26}px`,
          maxWidth: width * 0.86,
          textAlign: 'center',
          ...(style.background
            ? {
                backgroundColor: style.background.color,
                padding: `${style.background.padding}px ${style.background.padding * 1.6}px`,
                borderRadius: style.background.radius,
              }
            : {}),
        }}
      >
        {cue.words.map((word, index) => {
          const isActive = outSec >= word.startSec && outSec < word.endSec;
          const hasArrived = outSec >= word.startSec;

          let opacity = 1;
          let scale = 1;
          let translateY = 0;
          let color = word.emphasis ? style.emphasisColor : style.color;

          switch (style.animation) {
            case 'karaoke':
              // Whole line visible; the active word lights up.
              color = isActive
                ? style.emphasisColor
                : word.emphasis
                  ? style.emphasisColor
                  : style.color;
              opacity = hasArrived ? 1 : 0.45;
              scale = isActive ? 1.04 : 1;
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

            case 'typewriter':
              if (!hasArrived) return null;
              break;

            case 'line-fade':
              opacity = interpolate(frame - cueStartFrame, [0, fps * 0.22], [0, 1], {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              });
              break;
          }

          return (
            <span
              key={`${cue.id}-${index}`}
              style={{
                // The EDL names a family; the shared stack supplies the fallbacks.
                fontFamily: `"${style.fontFamily}", ${FONT_FAMILY}`,
                fontWeight: word.emphasis ? Math.min(900, style.fontWeight + 100) : style.fontWeight,
                fontSize,
                lineHeight: 1.12,
                letterSpacing: '-0.02em',
                color,
                opacity,
                transform: `scale(${scale}) translateY(${translateY}px)`,
                transformOrigin: 'center bottom',
                textShadow,
                whiteSpace: 'pre',
                ...stroke,
              }}
            >
              {word.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
