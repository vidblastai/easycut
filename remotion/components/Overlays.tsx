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
export const Overlays: React.FC<{ edl: Edl; cheap?: boolean }> = ({ edl, cheap = false }) => {
  const { fps } = useVideoConfig();

  return (
    <>
      {edl.overlays.map((overlay) => {
        const from = Math.round(overlay.outStartSec * fps);
        const durationInFrames = Math.max(1, Math.round((overlay.outEndSec - overlay.outStartSec) * fps));
        return (
          // Laid out rather than `layout="none"`, so the Player premounts it a
          // second early instead of building it on the frame it appears.
          <Sequence key={overlay.id} from={from} durationInFrames={durationInFrames}>
            <OverlayView overlay={overlay} durationInFrames={durationInFrames} edl={edl} cheap={cheap} />
          </Sequence>
        );
      })}
    </>
  );
};

const OverlayView: React.FC<{ overlay: OverlayElement; durationInFrames: number; edl: Edl; cheap: boolean }> = ({
  overlay,
  durationInFrames,
  edl,
  cheap,
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
      return <Grain opacity={overlay.opacity} cheap={cheap} />;
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
          // Full width, scaled down — not a width that grows. A changing width
          // is a layout pass and a repaint of the bar's glow on every frame of
          // the video; the same bar drawn once and scaled from its left edge
          // never leaves the compositor.
          width: '100%',
          transformOrigin: '0 50%',
          transform: `scaleX(${progress})`,
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
const Grain: React.FC<{ opacity: number; cheap: boolean }> = ({ opacity, cheap }) =>
  cheap ? <GrainField opacity={opacity * 0.5} seedFrame={0} blend={false} /> : <MovingGrain opacity={opacity} />;

/**
 * The export's grain: re-rolled every other frame, and blended.
 *
 * Split out so the editor's still version does not read the frame at all. A
 * component that subscribes to the clock re-renders thirty times a second even
 * when it has decided to draw the same thing, and this overlay is on for the
 * whole video.
 */
const MovingGrain: React.FC<{ opacity: number }> = ({ opacity }) => {
  const frame = useCurrentFrame();
  // Re-roll only every other frame: 60 Hz noise strobes, 15 Hz noise reads as film.
  return <GrainField opacity={opacity} seedFrame={Math.floor(frame / 2)} blend />;
};

const GrainField: React.FC<{ opacity: number; seedFrame: number; blend: boolean }> = ({
  opacity,
  seedFrame,
  blend,
}) => {
  const { width, height } = useVideoConfig();
  const count = 180;

  /*
   * Why the editor's version holds still, and is not blended.
   *
   * This overlay runs for the WHOLE video, not for a moment, and moving grain
   * is the most expensive thing on the composition: a hundred and eighty SVG
   * circles given four new attributes fifteen times a second, inside a layer
   * whose `mix-blend-mode` forces the browser to read back the picture — the
   * playing video included — and blend it by hand on every single frame. That
   * is a video the compositor can no longer hand straight to the screen, which
   * is felt everywhere and worst at a cut, where there is a new frame to blend
   * and a new caption to draw in the same 33 milliseconds.
   *
   * So the preview draws the field once, at a fixed seed, with no blend mode:
   * a still dusting of grain, memoised, that costs one rasterisation for the
   * whole session. The export still gets moving, blended film grain.
   */
  const dots = React.useMemo(
    () =>
      Array.from({ length: count }, (_, i) => (
        <circle
          key={i}
          cx={seeded(`grain-x-${seedFrame}`, i) * width}
          cy={seeded(`grain-y-${seedFrame}`, i) * height}
          r={1 + seeded(`grain-r-${seedFrame}`, i) * 1.4}
          fill="#ffffff"
          opacity={0.25 + seeded(`grain-o-${seedFrame}`, i) * 0.5}
        />
      )),
    [seedFrame, width, height],
  );

  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        opacity,
        ...(blend ? { mixBlendMode: 'overlay' as const } : null),
      }}
    >
      <svg width={width} height={height}>{dots}</svg>
    </AbsoluteFill>
  );
};
