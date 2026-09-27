import React from 'react';
import { AbsoluteFill, Sequence, interpolate, Easing, useCurrentFrame, useVideoConfig } from 'remotion';
import type { AnimatedScene, Edl, SceneBackdrop } from '../../src/lib/edl/types';
import { FONT_FAMILY } from '../lib/fonts';
import { pop, ramp } from '../lib/timing';

/**
 * Faceless animation: the scenes that replace the picture.
 *
 * Every other layer in this renderer decorates the speaker. This one takes the
 * frame away from them. For the seconds a scene is on, there is no footage —
 * there is a made picture with its own background, assembled out of the words
 * being said over it, and the speaker is reduced to the voice explaining it.
 *
 * That is the whole shape of a faceless channel, and it is why this sits above
 * the video and the B-roll rather than beside them: a scene that let the
 * speaker show through the gaps would be an overlay, which is a different
 * thing and one this renderer already has six of.
 *
 * ── The six kinds ───────────────────────────────────────────────────────
 *
 * Each one is a SHAPE an explanation can have, not a decoration:
 *
 *   kinetic-text  the phrase itself, landing word by word
 *   journey       a path across the frame, waypoints lighting up in turn
 *   compare       the frame split down the middle: this against that
 *   orbit         one idea in the centre, its parts arriving around it
 *   stack         layers settling onto each other
 *   big-number    one figure, filling the frame
 *
 * Choosing between them is the interesting decision, and it is a model's job
 * (see `director/scenes.ts`). Drawing them well is this file's job, once.
 *
 * ── The rule everything here obeys ──────────────────────────────────────
 *
 * Backdrops are static paint moved by `transform`; content arrives by
 * `transform` and `opacity`. No filters, no blend modes, nothing that asks the
 * browser to repaint the whole frame on every tick — a full-frame layer is
 * exactly where that mistake costs the most.
 */

export const Scenes: React.FC<{ edl: Edl }> = ({ edl }) => {
  const { fps } = useVideoConfig();

  return (
    <>
      {edl.scenes.map((scene) => {
        const from = Math.round(scene.outStartSec * fps);
        const durationInFrames = Math.max(1, Math.round((scene.outEndSec - scene.outStartSec) * fps));
        return (
          <Sequence key={scene.id} from={from} durationInFrames={durationInFrames} name={`scene · ${scene.kind}`}>
            <SceneView scene={scene} durationInFrames={durationInFrames} />
          </Sequence>
        );
      })}
    </>
  );
};

/** In and out, so a scene arrives and leaves rather than being switched on. */
const FADE_SEC = 0.25;

const SceneView: React.FC<{ scene: AnimatedScene; durationInFrames: number }> = ({ scene, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = Math.round(fps * FADE_SEC);

  const opacity = interpolate(
    frame,
    [0, fade, durationInFrames - fade, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) },
  );

  return (
    <AbsoluteFill style={{ opacity, fontFamily: FONT_FAMILY }}>
      <Backdrop kind={scene.backdrop} accent={scene.accent} />
      <SceneBody scene={scene} durationInFrames={durationInFrames} />
    </AbsoluteFill>
  );
};

/* --------------------------------------------------------------- backdrop */

/**
 * The ground the scene stands on.
 *
 * Each of these is one static painted layer, oversized and then translated or
 * rotated. A grid that actually re-tiled per frame, or a gradient whose stops
 * moved, would repaint the whole frame thirty times a second for a background
 * nobody is looking at.
 */
const Backdrop: React.FC<{ kind: SceneBackdrop; accent: string }> = ({ kind, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  if (kind === 'solid') {
    return <AbsoluteFill style={{ background: '#0D0D10' }} />;
  }

  if (kind === 'grid' || kind === 'dots') {
    const cell = kind === 'grid' ? 90 : 64;
    const paint =
      kind === 'grid'
        ? `repeating-linear-gradient(0deg, ${accent}1F 0 1px, transparent 1px ${cell}px),
           repeating-linear-gradient(90deg, ${accent}1F 0 1px, transparent 1px ${cell}px)`
        : `radial-gradient(circle, ${accent}33 1.6px, transparent 1.7px)`;
    return (
      <AbsoluteFill style={{ background: '#0D0D10', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            // Oversized and slid, so the pattern never has to be re-tiled to
            // keep moving and never shows an edge.
            inset: `-${cell * 2}px`,
            background: paint,
            backgroundSize: kind === 'dots' ? `${cell}px ${cell}px` : undefined,
            transform: `translate(${(t * 9) % cell}px, ${(t * 6) % cell}px)`,
          }}
        />
        <AbsoluteFill
          style={{ background: 'radial-gradient(ellipse at 50% 42%, rgba(0,0,0,0) 30%, rgba(13,13,16,0.82) 100%)' }}
        />
      </AbsoluteFill>
    );
  }

  if (kind === 'rays') {
    return (
      <AbsoluteFill style={{ background: '#0D0D10', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: '260%',
            height: '260%',
            marginLeft: '-130%',
            marginTop: '-130%',
            background: `repeating-conic-gradient(from 0deg at 50% 50%, ${accent}22 0deg 7deg, transparent 7deg 22deg)`,
            transform: `rotate(${t * 4}deg)`,
          }}
        />
        <AbsoluteFill
          style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(13,13,16,0.35) 0%, rgba(13,13,16,0.94) 72%)' }}
        />
      </AbsoluteFill>
    );
  }

  // gradient
  return (
    <AbsoluteFill style={{ background: '#0D0D10', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: '-30%',
          background: `radial-gradient(circle at 32% 28%, ${accent}66 0%, transparent 52%),
                       radial-gradient(circle at 72% 74%, ${accent}33 0%, transparent 56%)`,
          transform: `translate(${Math.sin(t * 0.5) * 3}%, ${Math.cos(t * 0.4) * 3}%) scale(1.06)`,
        }}
      />
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ bodies */

const SceneBody: React.FC<{ scene: AnimatedScene; durationInFrames: number }> = ({ scene, durationInFrames }) => {
  switch (scene.kind) {
    case 'journey': return <Journey scene={scene} durationInFrames={durationInFrames} />;
    case 'compare': return <Compare scene={scene} durationInFrames={durationInFrames} />;
    case 'orbit': return <Orbit scene={scene} durationInFrames={durationInFrames} />;
    case 'stack': return <Stack scene={scene} durationInFrames={durationInFrames} />;
    case 'big-number': return <BigNumber scene={scene} durationInFrames={durationInFrames} />;
    case 'kinetic-text':
    default: return <KineticText scene={scene} durationInFrames={durationInFrames} />;
  }
};

/** How far through its own life the scene is, 0→1. */
function useBeats(durationInFrames: number, count: number) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const unit = height * 0.001;
  // Everything lands inside the first two thirds, so the scene has a beat to
  // sit finished before it leaves.
  const span = Math.max(1, durationInFrames * 0.66);
  const at = (i: number) => (count <= 1 ? 0 : (i / count) * span);
  return { frame, fps, unit, width, height, at };
}

/**
 * An icon, drawn from markup we already hold.
 *
 * `dangerouslySetInnerHTML` is the point rather than a shortcut: the markup was
 * fetched and stripped of everything executable in `assets/icons.ts` before it
 * reached the document, and inlining it means the renderer never has to load
 * or decode an image — which is the one thing that reliably kills a frame.
 */
const Glyph: React.FC<{ svg: string; size: number }> = ({ svg, size }) => (
  <span
    style={{ width: size, height: size, display: 'block' }}
    dangerouslySetInnerHTML={{ __html: svg.replace(/<svg /i, `<svg width="${size}" height="${size}" `) }}
  />
);

const Chip: React.FC<{
  label: string;
  iconSvg?: string | null;
  accent: string;
  unit: number;
  enter: number;
}> = ({ label, iconSvg, accent, unit, enter }) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: unit * 12,
      opacity: enter,
      transform: `scale(${0.82 + enter * 0.18})`,
    }}
  >
    <div
      style={{
        width: unit * 118,
        height: unit * 118,
        borderRadius: unit * 30,
        background: '#19191F',
        border: `${Math.max(1, unit * 2)}px solid ${accent}66`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `0 ${unit * 18}px ${unit * 44}px -${unit * 16}px ${accent}`,
      }}
    >
      {iconSvg ? (
        <Glyph svg={iconSvg} size={unit * 62} />
      ) : (
        <div style={{ width: unit * 40, height: unit * 40, borderRadius: '50%', background: accent }} />
      )}
    </div>
    <div
      style={{
        fontSize: unit * 24,
        fontWeight: 700,
        color: '#F5F5F7',
        textAlign: 'center',
        maxWidth: unit * 190,
        lineHeight: 1.2,
      }}
    >
      {label}
    </div>
  </div>
);

const Headline: React.FC<{ text: string; unit: number; size?: number; opacity?: number }> = ({
  text, unit, size = 44, opacity = 1,
}) => (
  <div
    style={{
      fontSize: unit * size,
      fontWeight: 800,
      letterSpacing: '-0.02em',
      color: '#F5F5F7',
      textAlign: 'center',
      maxWidth: unit * 820,
      lineHeight: 1.15,
      opacity,
    }}
  >
    {text}
  </div>
);

/** The phrase itself, word by word, in time with it being said. */
const KineticText: React.FC<{ scene: AnimatedScene; durationInFrames: number }> = ({ scene, durationInFrames }) => {
  const { frame, fps, unit } = useBeats(durationInFrames, 1);
  const words = scene.headline.split(/\s+/).filter(Boolean);
  const span = Math.max(1, durationInFrames * 0.6);
  const each = span / Math.max(1, words.length);

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', padding: `0 ${unit * 90}px` }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: `${unit * 14}px ${unit * 22}px`, justifyContent: 'center' }}>
        {words.map((word, i) => {
          const enter = pop(frame, fps, Math.round(each * i), true);
          return (
            <span
              key={i}
              style={{
                fontSize: unit * 96,
                fontWeight: 800,
                letterSpacing: '-0.035em',
                lineHeight: 1,
                color: i === words.length - 1 ? scene.accent : '#F5F5F7',
                opacity: enter,
                transform: `translateY(${(1 - enter) * unit * 40}px) scale(${0.85 + enter * 0.15})`,
                display: 'inline-block',
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/**
 * A path with waypoints lighting up in turn.
 *
 * It runs the way the frame does. Four chips across a vertical frame leaves
 * each one about two hundred pixels wide with its label wrapping to two lines
 * and almost touching its neighbour — legible in a still, unreadable at speed.
 * Down the side, each step gets the full width for its label and the path
 * reads as the sequence it is.
 */
const Journey: React.FC<{ scene: AnimatedScene; durationInFrames: number }> = ({ scene, durationInFrames }) => {
  const items = scene.items.slice(0, 4);
  const { frame, fps, unit, width, height, at } = useBeats(durationInFrames, items.length);
  const drawn = ramp(frame, 0, Math.round(durationInFrames * 0.6), Easing.inOut(Easing.cubic));
  const portrait = height > width;

  if (portrait) {
    const dot = unit * 96;
    return (
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          gap: unit * 54,
          padding: `0 ${unit * 70}px`,
        }}
      >
        <Headline text={scene.headline} unit={unit} />
        <div style={{ position: 'relative', width: '100%' }}>
          {/* The rail, and the part of it that has been travelled. */}
          <div
            style={{
              position: 'absolute',
              left: dot / 2 - unit * 3,
              top: dot / 2,
              bottom: dot / 2,
              width: unit * 6,
              borderRadius: 999,
              background: `${scene.accent}44`,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: dot / 2 - unit * 3,
              top: dot / 2,
              bottom: dot / 2,
              width: unit * 6,
              borderRadius: 999,
              background: scene.accent,
              transformOrigin: '50% 0%',
              transform: `scaleY(${drawn})`,
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: unit * 30 }}>
            {items.map((item, i) => {
              const enter = pop(frame, fps, Math.round(at(i)), true);
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: unit * 26,
                    opacity: enter,
                    transform: `translateX(${(1 - enter) * unit * 34}px)`,
                  }}
                >
                  <div
                    style={{
                      width: dot,
                      height: dot,
                      flexShrink: 0,
                      borderRadius: unit * 26,
                      background: '#19191F',
                      border: `${Math.max(1, unit * 2)}px solid ${scene.accent}88`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: `0 ${unit * 14}px ${unit * 36}px -${unit * 14}px ${scene.accent}`,
                    }}
                  >
                    {scene.iconSvgs[i] ? (
                      <Glyph svg={scene.iconSvgs[i]!} size={unit * 50} />
                    ) : (
                      <div style={{ width: unit * 26, height: unit * 26, borderRadius: '50%', background: scene.accent }} />
                    )}
                  </div>
                  <div style={{ fontSize: unit * 34, fontWeight: 700, color: '#F5F5F7', lineHeight: 1.2 }}>
                    {item}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: unit * 70, padding: `0 ${unit * 60}px` }}>
      <Headline text={scene.headline} unit={unit} />
      <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div
          style={{
            position: 'absolute', left: 0, right: 0, top: unit * 59,
            height: unit * 5, borderRadius: 999, background: `${scene.accent}55`,
          }}
        />
        <div
          style={{
            position: 'absolute', left: 0, right: 0, top: unit * 59,
            height: unit * 5, borderRadius: 999, background: scene.accent,
            transformOrigin: '0% 50%', transform: `scaleX(${drawn})`,
          }}
        />
        {items.map((item, i) => (
          <div key={i} style={{ position: 'relative', zIndex: 1 }}>
            <Chip
              label={item}
              iconSvg={scene.iconSvgs[i]}
              accent={scene.accent}
              unit={unit}
              enter={pop(frame, fps, Math.round(at(i)), true)}
            />
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** Two halves: this against that. */
const Compare: React.FC<{ scene: AnimatedScene; durationInFrames: number }> = ({ scene, durationInFrames }) => {
  const [left, right] = [scene.items[0] ?? '', scene.items[1] ?? ''];
  const { frame, fps, unit } = useBeats(durationInFrames, 2);
  const enterL = pop(frame, fps, Math.round(fps * 0.1), true);
  const enterR = pop(frame, fps, Math.round(fps * 0.45), true);

  const Half: React.FC<{ label: string; icon?: string | null; enter: number; tone: string; from: number }> = ({
    label, icon, enter, tone, from,
  }) => (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: unit * 22,
        opacity: enter,
        transform: `translateX(${(1 - enter) * from * unit * 50}px)`,
      }}
    >
      <div
        style={{
          width: unit * 190,
          height: unit * 190,
          borderRadius: unit * 44,
          background: '#19191F',
          border: `${Math.max(1, unit * 2)}px solid ${tone}77`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon ? (
          <Glyph svg={icon} size={unit * 96} />
        ) : (
          <div style={{ width: unit * 70, height: unit * 70, borderRadius: '50%', background: tone }} />
        )}
      </div>
      <div style={{ fontSize: unit * 34, fontWeight: 800, color: '#F5F5F7', textAlign: 'center', maxWidth: unit * 320 }}>
        {label}
      </div>
    </div>
  );

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: unit * 60, padding: `0 ${unit * 50}px` }}>
      <Headline text={scene.headline} unit={unit} />
      <div style={{ display: 'flex', alignItems: 'stretch', width: '100%', gap: unit * 24 }}>
        <Half label={left} icon={scene.iconSvgs[0]} enter={enterL} tone="#A5A5B3" from={-1} />
        <div style={{ width: Math.max(1, unit * 2), background: `${scene.accent}44`, borderRadius: 999 }} />
        <Half label={right} icon={scene.iconSvgs[1]} enter={enterR} tone={scene.accent} from={1} />
      </div>
    </AbsoluteFill>
  );
};

/** One idea in the middle, its parts arriving around it. */
const Orbit: React.FC<{ scene: AnimatedScene; durationInFrames: number }> = ({ scene, durationInFrames }) => {
  const items = scene.items.slice(0, 5);
  const { frame, fps, unit, width, height, at } = useBeats(durationInFrames, items.length);
  /*
   * An ellipse sized to the frame, not a circle sized to nothing.
   *
   * A fixed radius put the satellites past both edges of a vertical frame,
   * which is where the chips were being cut in half. Horizontally there is
   * room for one chip either side of the core and no more; vertically there is
   * plenty, so the ring is squashed to match the shape it lives in.
   */
  const rx = Math.min(unit * 300, width * 0.32);
  const ry = Math.min(unit * 330, height * 0.21);
  const core = pop(frame, fps, 0, true);

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: rx * 2 + unit * 240, height: ry * 2 + unit * 260 }}>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: `translate(-50%, -50%) scale(${core})`,
            padding: `${unit * 26}px ${unit * 40}px`,
            borderRadius: unit * 28,
            background: scene.accent,
            color: '#0D0D10',
            fontSize: unit * 42,
            fontWeight: 800,
            textAlign: 'center',
            maxWidth: unit * 420,
            boxShadow: `0 ${unit * 22}px ${unit * 60}px -${unit * 18}px ${scene.accent}`,
          }}
        >
          {scene.headline}
        </div>
        {items.map((item, i) => {
          // Spread across the top half and the bottom, clear of the core.
          const angle = (-90 + (360 / Math.max(1, items.length)) * i) * (Math.PI / 180);
          const enter = pop(frame, fps, Math.round(at(i) + fps * 0.2), true);
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `calc(50% + ${Math.cos(angle) * rx}px)`,
                top: `calc(50% + ${Math.sin(angle) * ry}px)`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <Chip label={item} iconSvg={scene.iconSvgs[i]} accent={scene.accent} unit={unit} enter={enter} />
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/** Layers settling onto each other. */
const Stack: React.FC<{ scene: AnimatedScene; durationInFrames: number }> = ({ scene, durationInFrames }) => {
  const items = scene.items.slice(0, 4);
  const { frame, fps, unit, at } = useBeats(durationInFrames, items.length);

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: unit * 44, padding: `0 ${unit * 70}px` }}>
      <Headline text={scene.headline} unit={unit} />
      <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: unit * 16, width: '100%' }}>
        {items.map((item, i) => {
          const enter = pop(frame, fps, Math.round(at(i)), true);
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: unit * 20,
                padding: `${unit * 26}px ${unit * 32}px`,
                borderRadius: unit * 24,
                background: '#19191F',
                border: `${Math.max(1, unit * 2)}px solid ${scene.accent}${i === items.length - 1 ? 'AA' : '44'}`,
                opacity: enter,
                // Drops in from above and settles onto the one below it.
                transform: `translateY(${(1 - enter) * -unit * 70}px)`,
              }}
            >
              {scene.iconSvgs[i] ? (
                <Glyph svg={scene.iconSvgs[i]!} size={unit * 52} />
              ) : (
                <div style={{ width: unit * 18, height: unit * 18, borderRadius: '50%', background: scene.accent, flexShrink: 0 }} />
              )}
              <div style={{ fontSize: unit * 32, fontWeight: 700, color: '#F5F5F7' }}>{item}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/** One figure, filling the frame. */
const BigNumber: React.FC<{ scene: AnimatedScene; durationInFrames: number }> = ({ scene, durationInFrames }) => {
  const { frame, fps, unit, width } = useBeats(durationInFrames, 1);
  const target = parseFloat(scene.headline.replace(/[^\d.-]/g, ''));
  const suffix = scene.headline.replace(/^[\d.,\s-]+/, '').trim();
  const run = ramp(frame, 0, Math.round(durationInFrames * 0.55), Easing.out(Easing.cubic));
  const figure = Number.isFinite(target)
    ? (target * run).toLocaleString('en-US', { maximumFractionDigits: Number.isInteger(target) ? 0 : 1 })
    : scene.headline;
  const land = pop(frame, fps, Math.round(durationInFrames * 0.55), true);

  /*
   * Sized to the frame, not to a constant.
   *
   * "11" and "1,250,000" are the same scene and cannot be the same type size:
   * at a fixed 200 units the second runs off both sides of a vertical frame.
   * The figure is measured at its FINAL value, not its current one, so the
   * type does not shrink while the number counts up.
   */
  const widest = (Number.isFinite(target) ? Math.round(target).toLocaleString('en-US') : scene.headline).length;
  const size = Math.min(unit * 200, (width * 0.86) / Math.max(1, widest) * 1.75);

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: unit * 18, padding: `0 ${unit * 50}px` }}>
      <div
        style={{
          fontSize: size,
          fontWeight: 800,
          letterSpacing: '-0.06em',
          lineHeight: 0.9,
          color: scene.accent,
          transform: `scale(${1 + land * 0.05})`,
          textShadow: `0 ${unit * 10}px ${unit * 50}px rgba(0,0,0,0.6)`,
        }}
      >
        {figure}
      </div>
      {suffix ? (
        <div style={{ fontSize: unit * 52, fontWeight: 800, color: '#F5F5F7', letterSpacing: '-0.02em' }}>
          {suffix}
        </div>
      ) : null}
      {scene.items[0] ? (
        <div
          style={{
            fontSize: unit * 36,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#F5F5F7',
            textAlign: 'center',
            maxWidth: unit * 700,
          }}
        >
          {scene.items[0]}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
