import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Edl, TransitionCue } from '../../src/lib/edl/types';
import { seeded } from '../lib/timing';

/**
 * Transitions.
 *
 * These are implemented as a full-frame effect layer centred on the cut, not as
 * a cross-fade between two clips. That is a deliberate simplification with a
 * real payoff: the video track stays a flat list of sequences (fast to render,
 * trivially resumable in a chunked cloud render), and a whip pan or flash on a
 * hard cut sells the transition just as well as a true two-source blend.
 *
 * Only the cuts the EDL marked as *visible* get one — see `TimeMapper.cutPoints`.
 */
export const Transitions: React.FC<{ edl: Edl }> = ({ edl }) => (
  <>
    {edl.transitions.map((cue) => (
      <TransitionEffect key={cue.id} cue={cue} />
    ))}
  </>
);

const TransitionEffect: React.FC<{ cue: TransitionCue }> = ({ cue }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const centreFrame = cue.atSec * fps;
  const half = (cue.durationSec * fps) / 2;
  if (frame < centreFrame - half || frame > centreFrame + half) return null;

  // −1 → 0 → 1 across the transition, so effects can be symmetric about the cut.
  const t = (frame - centreFrame) / half;
  const intensity = 1 - Math.abs(t);

  switch (cue.type) {
    case 'flash':
      return <AbsoluteFill style={{ background: '#FFFFFF', opacity: intensity * 0.55, pointerEvents: 'none' }} />;

    case 'whip-pan':
      // A directional motion blur streak, plus a shove in the same direction.
      return (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            background: `linear-gradient(${t < 0 ? 90 : 270}deg, rgba(13,13,16,${intensity * 0.85}) 0%, rgba(13,13,16,0) 60%)`,
            transform: `translateX(${t * width * 0.06}px)`,
            filter: `blur(${intensity * 6}px)`,
          }}
        />
      );

    case 'slide':
      return (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            background: '#0D0D10',
            transform: `translateY(${(t < 0 ? 1 + t : 1 - t) * -height}px)`,
            opacity: 0.95,
          }}
        />
      );

    case 'zoom-punch':
      return (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            boxShadow: `inset 0 0 ${intensity * height * 0.25}px rgba(0,0,0,${intensity * 0.8})`,
          }}
        />
      );

    case 'glitch':
      return (
        <AbsoluteFill style={{ pointerEvents: 'none', opacity: intensity }}>
          {Array.from({ length: 7 }).map((_, i) => {
            const band = seeded(`glitch-${cue.id}-${Math.floor(frame)}`, i);
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: band * height,
                  height: height * (0.01 + band * 0.03),
                  background: i % 2 === 0 ? 'rgba(155,123,255,0.5)' : 'rgba(245,245,247,0.22)',
                  transform: `translateX(${(band - 0.5) * width * 0.12}px)`,
                  mixBlendMode: 'screen',
                }}
              />
            );
          })}
        </AbsoluteFill>
      );

    case 'film-burn':
      return (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            opacity: intensity * 0.7,
            background:
              'radial-gradient(circle at 70% 40%, rgba(255,176,90,0.85) 0%, rgba(255,110,40,0.4) 30%, rgba(0,0,0,0) 65%)',
            mixBlendMode: 'screen',
          }}
        />
      );

    case 'dissolve':
    default:
      return (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            background: '#0D0D10',
            opacity: interpolate(Math.abs(t), [0, 1], [0.6, 0], { extrapolateRight: 'clamp' }),
          }}
        />
      );
  }
};
