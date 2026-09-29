import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { seeded } from '../lib/timing';
import type { BrollOverlay as OverlayName } from '../../src/lib/edl/types';

/**
 * What an insert wears.
 *
 * ── Drawn, not a plate ──────────────────────────────────────────────────
 *
 * The usual way to do this is a library of 4K ProRes overlays screen-blended
 * over the picture. That is gigabytes to store and serve, a licence per plate,
 * a fixed length that has to be looped or trimmed to fit a 2.4-second insert,
 * and a look nobody can adjust after the fact. Drawn from the clip's own seed
 * they cost nothing, they are exactly as long as the insert, they scale to any
 * aspect, and their strength is a number somebody can change.
 *
 * ── Scoped to the clip, which is the whole point ────────────────────────
 *
 * This renders INSIDE the insert's frame, so it stops where the insert stops.
 * Grain over the B-roll and not over the speaker is an edit; grain over both
 * is a filter, and the `overlays` layer is where a filter on the whole video
 * belongs. Getting that backwards is how a treatment ends up looking like a
 * mistake in the export settings.
 *
 * ── Rules every one of these obeys ──────────────────────────────────────
 *
 * 1. **Seeded, never random.** A resumed or chunked cloud render must produce
 *    identical pixels, and `Math.random()` in here is a seam down the middle
 *    of a finished video where one worker's noise met another's.
 * 2. **It runs for the length of an insert, not the video.** That is what
 *    makes a per-frame blend affordable here and unaffordable in `Overlays`,
 *    which learned it the expensive way — see the note on `MovingGrain`.
 * 3. **`cheap` drops the blend modes, not the effect.** A `mix-blend-mode`
 *    forces the browser to read the composited picture back and blend it by
 *    hand every frame, which is what a preview cannot afford while also
 *    playing video. The editor gets the same shapes at a flatter opacity.
 */
export const BrollOverlay: React.FC<{
  type: OverlayName;
  /** The clip's id: the seed, so the same insert grains the same way twice. */
  seed: string;
  /** 0..1 across the insert's life, for the ones that travel. */
  progress: number;
  cheap: boolean;
}> = ({ type, seed, progress, cheap }) => {
  if (type === 'none') return null;

  switch (type) {
    case 'dust':
      return <Dust seed={seed} cheap={cheap} />;
    case 'grain':
      return <Grain seed={seed} cheap={cheap} />;
    case 'light-leak':
      return <LightLeak progress={progress} cheap={cheap} />;
    case 'scanlines':
      return <Scanlines progress={progress} cheap={cheap} />;
    case 'prism':
      return <Prism cheap={cheap} />;
    case 'vignette':
      return <Vignette />;
    default:
      return null;
  }
};

const COVER: React.CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' };

/* ------------------------------------------------------------------- dust */

/** How many specks are in the air. Enough to read as a field, few enough to draw. */
const MOTES = 120;

/**
 * Particles drifting through the light.
 *
 * Two things make this read as dust rather than as snow, and both were wrong
 * in the first version. Motes are OUT OF FOCUS by different amounts — a real
 * speck near the lens is a soft disc and one further away is a hard point, and
 * a field of identically sharp dots reads as a texture rather than as air. And
 * they drift at their own speeds on their own paths: a shared clock makes
 * forty-six specks move in formation, which looks far worse than no dust.
 *
 * The drift is slow on purpose — about a tenth of the frame over a whole
 * insert. Dust that visibly travels is snow.
 */
const Dust: React.FC<{ seed: string; cheap: boolean }> = ({ seed, cheap }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const short = Math.min(width, height);
  const t = frame / fps;

  const motes = React.useMemo(
    () =>
      Array.from({ length: MOTES }, (_, i) => {
        const near = seeded(`${seed}-near`, i);
        return {
          x: seeded(`${seed}-x`, i),
          y: seeded(`${seed}-y`, i),
          // Near motes are bigger, softer and dimmer — depth, in three numbers.
          size: short * (0.003 + near * 0.022),
          blur: near * near * 9,
          opacity: 0.3 + (1 - near) * 0.6,
          driftX: (seeded(`${seed}-dx`, i) - 0.5) * 0.05,
          driftY: -0.02 - seeded(`${seed}-dy`, i) * 0.05,
          // Its own phase, or the whole field breathes in unison.
          phase: seeded(`${seed}-p`, i) * Math.PI * 2,
          sway: (0.004 + seeded(`${seed}-s`, i) * 0.01),
        };
      }),
    [seed, short],
  );

  return (
    <div style={{ ...COVER, ...(cheap ? null : { mixBlendMode: 'screen' as const }) }}>
      {motes.map((m, i) => {
        const x = (m.x + m.driftX * t + Math.sin(t * 0.6 + m.phase) * m.sway) * width;
        const y = (m.y + m.driftY * t) * height;
        return (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: m.size,
              height: m.size,
              borderRadius: '50%',
              background: '#FFFDF5',
              opacity: cheap ? m.opacity * 0.6 : m.opacity,
              // `translate3d` rather than left/top: a transform is composited,
              // and forty-six elements changing `left` is forty-six layout
              // invalidations on every frame of every insert.
              transform: `translate3d(${x}px, ${y}px, 0)`,
              ...(cheap ? null : { filter: `blur(${m.blur}px)` }),
            }}
          />
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------------ grain */

/**
 * 16mm grain, as per-pixel noise.
 *
 * The first version drew 220 white circles, which is how the grain in this
 * codebase's full-frame `Overlays` layer works — and at 1080x1920 that is one
 * speck per nine thousand pixels. It was invisible at native resolution and
 * gone entirely once the video was scaled to a phone. Grain is not a sparse
 * field of dots; it is a property of every pixel, and the only primitive that
 * can say that in one pass is `feTurbulence`.
 *
 * `fractalNoise` rather than `turbulence`: turbulence takes the absolute value
 * of the noise, which biases it dark and clumps it into smoke. `numOctaves=1`
 * keeps it fine rather than cloudy. The colour matrix flattens it to
 * monochrome — coloured grain is a sensor fault, not film — and drops the
 * alpha so it composites as a veil rather than a wall.
 *
 * Re-seeded every OTHER frame. Not an optimisation: noise re-rolled at 60Hz
 * strobes and reads as digital sparkle, and at about 15Hz it reads as film.
 * That number came from watching it, not from reasoning about it.
 */
const Grain: React.FC<{ seed: string; cheap: boolean }> = ({ seed, cheap }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  // The editor holds one field still: a preview that has to play video cannot
  // also rasterise a full-frame noise pass thirty times a second.
  const roll = cheap ? 7 : Math.floor(frame / 2) + 7;
  const id = `grain-${seed}-${roll}`;

  return (
    <svg
      width={width}
      height={height}
      style={{ ...COVER, ...(cheap ? null : { mixBlendMode: 'overlay' as const }), opacity: cheap ? 0.3 : 0.5 }}
      aria-hidden="true"
    >
      <defs>
        <filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          {/* Scaled off the frame, so grain is the same SIZE relative to the
              picture at any resolution. A fixed frequency gives a 4K export
              four times finer grain than a 1080 one, which is the bug where an
              effect tuned in preview vanishes in the export. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency={(0.9 * (1080 / width)).toFixed(4)}
            numOctaves={1}
            seed={roll}
            result="noise"
          />
          <feColorMatrix
            in="noise"
            type="matrix"
            values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  1 0 0 0 0"
          />
        </filter>
      </defs>
      <rect width={width} height={height} filter={`url(#${id})`} />
    </svg>
  );
};

/* ------------------------------------------------------------- light leak */

/**
 * A warm bloom crossing the frame over the whole insert.
 *
 * Deliberately slower and weaker than the `light-leak` TRANSITION, which is a
 * different instrument: that one covers a cut in a third of a second and is
 * supposed to be seen. This runs for the insert's whole life and is supposed
 * to be felt — it crosses once, never repeats, and never reaches full strength
 * at the edges where it would look like a gradient somebody left on.
 */
const LightLeak: React.FC<{ progress: number; cheap: boolean }> = ({ progress, cheap }) => {
  // -20%..120%: off-frame at both ends, so it enters and leaves rather than
  // being parked in view when the insert starts.
  const at = -20 + progress * 140;
  // Strongest in the middle of the pass and gone at both ends.
  const strength = Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI);
  const screen = cheap ? null : { mixBlendMode: 'screen' as const };

  return (
    <>
      <div
        style={{
          ...COVER,
          opacity: strength * 0.72,
          background: `radial-gradient(ellipse 55% 130% at ${at.toFixed(1)}% 42%, rgba(255,214,158,0.8) 0%, rgba(255,158,74,0.32) 40%, rgba(0,0,0,0) 74%)`,
          ...screen,
        }}
      />
      <div
        style={{
          ...COVER,
          opacity: strength * 0.48,
          background: `radial-gradient(ellipse 14% 80% at ${(at - 12).toFixed(1)}% 56%, rgba(255,120,190,0.55) 0%, rgba(0,0,0,0) 70%)`,
          ...screen,
        }}
      />
    </>
  );
};

/* -------------------------------------------------------------- scanlines */

/**
 * A screen, not a filter.
 *
 * Three parts, and the third is the one that sells it. The line structure is
 * static and costs one rasterisation. The rolling band is the vertical hold
 * drifting, which is what a CRT actually does. And the phosphor tint — a very
 * slight green-cyan lift — is why a broadcast monitor never looks neutral.
 *
 * The lines are sized off the frame HEIGHT rather than fixed pixels, or a
 * vertical export gets twice as many lines as a widescreen one and stops
 * reading as scanlines at all.
 */
const Scanlines: React.FC<{ progress: number; cheap: boolean }> = ({ progress, cheap }) => {
  const { height } = useVideoConfig();
  const pitch = Math.max(2, height / 340);

  return (
    <>
      <div
        style={{
          ...COVER,
          opacity: 0.3,
          background: `repeating-linear-gradient(180deg, rgba(0,0,0,0.55) 0px, rgba(0,0,0,0.55) ${(pitch / 2).toFixed(2)}px, rgba(0,0,0,0) ${(pitch / 2).toFixed(2)}px, rgba(0,0,0,0) ${pitch.toFixed(2)}px)`,
        }}
      />
      {/* The vertical hold, drifting down once across the insert. */}
      <div
        style={{
          ...COVER,
          top: `${(progress * 140 - 20).toFixed(1)}%`,
          height: '18%',
          opacity: 0.16,
          background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0) 100%)',
          ...(cheap ? null : { mixBlendMode: 'overlay' as const }),
        }}
      />
      <div
        style={{
          ...COVER,
          opacity: 0.1,
          background: 'linear-gradient(180deg, rgba(90,255,210,0.5) 0%, rgba(80,190,255,0.35) 100%)',
          ...(cheap ? null : { mixBlendMode: 'screen' as const }),
        }}
      />
    </>
  );
};

/* ------------------------------------------------------------------ prism */

/**
 * Chromatic fringe at the edges, the way a fast lens does it.
 *
 * At the EDGES specifically, and that is the whole difference between this and
 * the cheap "RGB split" everybody recognises: a real lens is sharp in the
 * middle and disperses toward the corners, so a fringe that runs across the
 * centre of the frame reads as a broken video rather than as glass. The radial
 * mask is what keeps it honest, and the vignette under it is the same lens
 * falling off.
 */
const Prism: React.FC<{ cheap: boolean }> = ({ cheap }) => (
  <>
    <div
      style={{
        ...COVER,
        opacity: cheap ? 0.26 : 0.42,
        background:
          'radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(255,40,90,0.55) 84%, rgba(255,40,90,0.75) 100%)',
        ...(cheap ? null : { mixBlendMode: 'screen' as const }),
      }}
    />
    <div
      style={{
        ...COVER,
        opacity: cheap ? 0.22 : 0.36,
        // Offset by a per cent, which is what makes it a SPLIT rather than a
        // tint: the two fringes have to disagree about where the edge is.
        transform: 'translateX(-1.6%)',
        background:
          'radial-gradient(ellipse at center, rgba(0,0,0,0) 54%, rgba(40,150,255,0.55) 86%, rgba(40,150,255,0.8) 100%)',
        ...(cheap ? null : { mixBlendMode: 'screen' as const }),
      }}
    />
    <Vignette />
  </>
);

/* --------------------------------------------------------------- vignette */

/** The quiet one. Corners down, nothing else. */
const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      pointerEvents: 'none',
      background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 38%, rgba(0,0,0,0.62) 100%)',
    }}
  />
);
