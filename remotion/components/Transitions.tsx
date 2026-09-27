import React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
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
 *
 * ── Why each one is wrapped in a Sequence ───────────────────────────────
 *
 * Every transition used to read the current frame itself and return null when
 * the frame was outside its window. Correct output, and a tax that grows with
 * the edit: `useCurrentFrame` subscribes, so a five-minute video with a hundred
 * visible cuts re-rendered a hundred components thirty times a second for the
 * whole video to draw nothing. Inside a Sequence a transition does not exist
 * until its own window, so the cost is one effect at a time no matter how many
 * cuts the edit has.
 */
export const Transitions: React.FC<{ edl: Edl; cheap?: boolean }> = ({ edl, cheap = false }) => {
  const { fps } = useVideoConfig();

  return (
    <>
      {edl.transitions.map((cue) => {
        const span = Math.max(1, Math.round(cue.durationSec * fps));
        const from = Math.round(cue.atSec * fps - span / 2);
        return (
          <Sequence key={cue.id} from={from} durationInFrames={span} name={`transition · ${cue.type}`}>
            <TransitionEffect cue={cue} span={span} cheap={cheap} />
          </Sequence>
        );
      })}
    </>
  );
};

/**
 * One effect, drawn over the cut at the middle of its own sequence.
 *
 * `cheap` is the editor. Three of these effects are drawn with properties a
 * browser cannot composite — a full-frame `blur()`, an `inset` box-shadow the
 * height of the frame, `mix-blend-mode` — which means a full repaint of the
 * whole picture on every frame of the transition, landing exactly on the cut
 * where the eye is already looking. The render can afford them; a preview that
 * has to keep time cannot, so it gets the same shapes drawn with opacity and
 * transform, which stay on the compositor.
 */
const TransitionEffect: React.FC<{ cue: TransitionCue; span: number; cheap: boolean }> = ({ cue, span, cheap }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // −1 → 0 → 1 across the transition, so effects can be symmetric about the cut.
  const t = span <= 1 ? 0 : (frame / (span - 1)) * 2 - 1;
  const intensity = 1 - Math.abs(t);

  // Bands that hold still between frames. Seeding on the frame as well used to
  // move every band's `top` and `height` thirty times a second, which is a
  // layout pass per frame for nothing the eye can follow at this speed.
  const bands = React.useMemo(
    () => Array.from({ length: 7 }, (_, i) => seeded(`glitch-${cue.id}`, i)),
    [cue.id],
  );

  switch (cue.type) {
    case 'flash':
      return <AbsoluteFill style={{ background: '#FFFFFF', opacity: intensity * 0.55, pointerEvents: 'none' }} />;

    case 'whip-pan':
      // A directional motion blur streak, plus a shove in the same direction.
      return (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            background: `linear-gradient(${t < 0 ? 90 : 270}deg, rgba(13,13,16,${cheap ? 0.85 : intensity * 0.85}) 0%, rgba(13,13,16,0) 60%)`,
            transform: `translateX(${t * width * 0.06}px)`,
            ...(cheap ? { opacity: intensity } : { filter: `blur(${intensity * 6}px)` }),
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
      return cheap ? (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            opacity: intensity * 0.8,
            background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.85) 100%)',
          }}
        />
      ) : (
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
          {bands.map((band, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: band * height,
                height: height * (0.01 + band * 0.03),
                background: i % 2 === 0 ? 'rgba(155,123,255,0.5)' : 'rgba(245,245,247,0.22)',
                transform: `translateX(${(seeded(`glitch-${cue.id}-${Math.floor(frame)}`, i) - 0.5) * width * 0.12}px)`,
                ...(cheap ? null : { mixBlendMode: 'screen' as const }),
              }}
            />
          ))}
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
            ...(cheap ? null : { mixBlendMode: 'screen' as const }),
          }}
        />
      );

    case 'zoom-blur':
      // The frame appears to rush at the viewer and clear. A real radial blur
      // is not something CSS can do cheaply, so this is the read of one: a
      // bright core thrown outward, scaled past the edges.
      return (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            opacity: intensity * 0.75,
            background: 'radial-gradient(circle at center, rgba(245,245,247,0.55) 0%, rgba(245,245,247,0) 55%)',
            transform: `scale(${1 + intensity * 1.6})`,
            ...(cheap ? null : { filter: `blur(${intensity * 10}px)` }),
          }}
        />
      );

    case 'barn-door':
      // Two panels part from the middle, so the cut looks like it was opened.
      return (
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          {[-1, 1].map((side) => (
            <div
              key={side}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: side < 0 ? 0 : '50%',
                width: '50%',
                background: '#0D0D10',
                transform: `translateX(${(1 - intensity) * side * 100}%)`,
              }}
            />
          ))}
        </AbsoluteFill>
      );

    case 'pixelate':
      // Blocks, not a real mosaic: a grid of squares that flashes over the cut
      // and clears. The grid is fixed, so nothing here lays out per frame.
      return (
        <AbsoluteFill style={{ pointerEvents: 'none', opacity: intensity * 0.85 }}>
          {bands.map((band, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${(i % 4) * 25}%`,
                top: `${Math.floor(i / 4) * 25 + band * 12}%`,
                width: '25%',
                height: '25%',
                background: i % 2 === 0 ? 'rgba(13,13,16,0.85)' : 'rgba(155,123,255,0.35)',
                transform: `scale(${0.6 + intensity * 0.4})`,
              }}
            />
          ))}
        </AbsoluteFill>
      );

    case 'light-leak':
      // A warm streak crossing the frame, the way film does when the back is
      // opened. Static gradient, animated across — no repainted gradient.
      return (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            opacity: intensity * 0.8,
            background:
              'linear-gradient(105deg, rgba(0,0,0,0) 30%, rgba(255,196,120,0.75) 48%, rgba(255,120,60,0.45) 56%, rgba(0,0,0,0) 72%)',
            transform: `translateX(${t * width * 0.9}px)`,
            ...(cheap ? null : { mixBlendMode: 'screen' as const }),
          }}
        />
      );

    case 'push':
      // The outgoing frame is shoved off by the incoming one: one opaque panel
      // travelling the full width of the frame across the cut.
      return (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            background: '#0D0D10',
            transform: `translateX(${t * width}px)`,
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
