import React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { FONT_FAMILY } from '../lib/fonts';
import type { Edl, OverlayElement } from '../../src/lib/edl/types';
import { lifecycleOpacity, pop, seeded } from '../lib/timing';

/**
 * Full-frame furniture: progress bar, lower third, chapter cards, vignette and
 * grain. These sit above everything, including B-roll, because they are the
 * video's own chrome rather than part of its content.
 */
export const Overlays: React.FC<{ edl: Edl }> = ({ edl }) => {
  const { fps } = useVideoConfig();

  return (
    <>
      {edl.overlays.map((overlay) => {
        const from = Math.round(overlay.outStartSec * fps);
        const durationInFrames = Math.max(1, Math.round((overlay.outEndSec - overlay.outStartSec) * fps));
        return (
          <Sequence key={overlay.id} from={from} durationInFrames={durationInFrames} layout="none">
            <OverlayView overlay={overlay} durationInFrames={durationInFrames} edl={edl} />
          </Sequence>
        );
      })}
    </>
  );
};

const OverlayView: React.FC<{ overlay: OverlayElement; durationInFrames: number; edl: Edl }> = ({
  overlay,
  durationInFrames,
  edl,
}) => {
  switch (overlay.type) {
    case 'progress-bar':
      return <ProgressBar overlay={overlay} edl={edl} />;
    case 'lower-third':
      return <LowerThird overlay={overlay} durationInFrames={durationInFrames} />;
    case 'chapter-card':
      return <ChapterCard overlay={overlay} durationInFrames={durationInFrames} />;
    case 'end-card':
      return <EndCard overlay={overlay} durationInFrames={durationInFrames} />;
    case 'vignette':
      return <Vignette opacity={overlay.opacity} />;
    case 'grain':
      return <Grain opacity={overlay.opacity} />;
    default:
      return null;
  }
};

/** Short-form retention trick: a visible "how much is left" bar. */
const ProgressBar: React.FC<{ overlay: OverlayElement; edl: Edl }> = ({ overlay, edl }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const progress = Math.min(1, frame / fps / Math.max(0.1, edl.format.durationSec));

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: `${progress * 100}%`,
          height: Math.max(4, height * 0.006),
          background: overlay.color,
          opacity: overlay.opacity,
          boxShadow: `0 0 ${height * 0.02}px ${overlay.color}`,
        }}
      />
    </AbsoluteFill>
  );
};

const LowerThird: React.FC<{ overlay: OverlayElement; durationInFrames: number }> = ({ overlay, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const enter = pop(frame, fps, 0, false);
  const opacity = lifecycleOpacity(frame, durationInFrames, Math.round(fps * 0.3));
  const unit = height * 0.001;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity }}>
      <div
        style={{
          position: 'absolute',
          left: width * 0.07,
          bottom: height * 0.14,
          transform: `translateX(${(1 - enter) * -width * 0.05}px)`,
          display: 'flex',
          alignItems: 'stretch',
          gap: unit * 16,
        }}
      >
        <div style={{ width: unit * 6, borderRadius: 99, background: overlay.color }} />
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: unit * 4 }}>
          <div
            style={{
              fontFamily: FONT_FAMILY,
              fontSize: unit * 40,
              fontWeight: 800,
              letterSpacing: '-0.03em',
              color: '#F5F5F7',
              textShadow: '0 6px 30px rgba(0,0,0,0.8)',
            }}
          >
            {overlay.text}
          </div>
          {overlay.subtext ? (
            <div
              style={{
                fontFamily: FONT_FAMILY,
                fontSize: unit * 24,
                fontWeight: 500,
                color: '#A5A5B3',
                textShadow: '0 4px 20px rgba(0,0,0,0.8)',
              }}
            >
              {overlay.subtext}
            </div>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const ChapterCard: React.FC<{ overlay: OverlayElement; durationInFrames: number }> = ({ overlay, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const opacity = lifecycleOpacity(frame, durationInFrames, Math.round(fps * 0.35));
  const wipe = interpolate(frame, [0, fps * 0.4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const unit = height * 0.001;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity }}>
      <div
        style={{
          position: 'absolute',
          top: height * 0.1,
          left: width * 0.07,
          padding: `${unit * 14}px ${unit * 26}px`,
          background: 'rgba(13,13,16,0.86)',
          borderLeft: `${unit * 5}px solid ${overlay.color}`,
          borderRadius: unit * 10,
          clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`,
        }}
      >
        <div
          style={{
            fontFamily: FONT_FAMILY,
            fontSize: unit * 30,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: '#F5F5F7',
            whiteSpace: 'nowrap',
          }}
        >
          {overlay.text}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const EndCard: React.FC<{ overlay: OverlayElement; durationInFrames: number }> = ({ overlay, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const opacity = lifecycleOpacity(frame, durationInFrames, Math.round(fps * 0.4));
  const unit = height * 0.001;

  return (
    <AbsoluteFill
      style={{
        opacity,
        background: 'rgba(13,13,16,0.9)',
        justifyContent: 'center',
        alignItems: 'center',
        gap: unit * 16,
        fontFamily: FONT_FAMILY,
      }}
    >
      <div style={{ fontSize: unit * 56, fontWeight: 800, letterSpacing: '-0.035em', color: '#F5F5F7' }}>
        {overlay.text}
      </div>
      {overlay.subtext ? (
        <div style={{ fontSize: unit * 28, color: overlay.color, fontWeight: 600 }}>{overlay.subtext}</div>
      ) : null}
    </AbsoluteFill>
  );
};

const Vignette: React.FC<{ opacity: number }> = ({ opacity }) => (
  <AbsoluteFill
    style={{
      pointerEvents: 'none',
      background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${opacity}) 100%)`,
    }}
  />
);

/**
 * Film grain, drawn as a sparse field of dots rather than a noise texture.
 * The seed is deterministic so a chunked cloud render doesn't show a seam where
 * one worker's noise pattern meets another's.
 */
const Grain: React.FC<{ opacity: number }> = ({ opacity }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  // Re-roll only every other frame: 60 Hz noise strobes, 15 Hz noise reads as film.
  const seedFrame = Math.floor(frame / 2);
  const count = 180;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity, mixBlendMode: 'overlay' }}>
      <svg width={width} height={height}>
        {Array.from({ length: count }).map((_, i) => (
          <circle
            key={i}
            cx={seeded(`grain-x-${seedFrame}`, i) * width}
            cy={seeded(`grain-y-${seedFrame}`, i) * height}
            r={1 + seeded(`grain-r-${seedFrame}`, i) * 1.4}
            fill="#ffffff"
            opacity={0.25 + seeded(`grain-o-${seedFrame}`, i) * 0.5}
          />
        ))}
      </svg>
    </AbsoluteFill>
  );
};
