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
  /** The video's accent, for the ones that recolour rather than cover. */
  accent: string;
  cheap: boolean;
}> = ({ type, seed, progress, accent, cheap }) => {
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

    case 'bloom':
      return <Bloom cheap={cheap} />;
    case 'bokeh':
      return <Bokeh seed={seed} cheap={cheap} />;
    case 'crt':
      return <Crt cheap={cheap} />;
    case 'vhs':
      return <Vhs seed={seed} progress={progress} cheap={cheap} />;
    case 'super8':
      return <Super8 seed={seed} cheap={cheap} />;
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

/* ══════════════════════════════════════════════════════ the loud ones ══ */

/*
 * Everything below changes how the picture LOOKS rather than adding something
 * over it, and none of these has the source pixels to work with — the overlay
 * is a sibling of the image, not a filter on it. That constraint is why they
 * are built out of blend modes: `color` takes hue from the layer and luminance
 * from the picture underneath, `difference` inverts what it covers, `multiply`
 * darkens by it. A blend mode is the only way to reach the backdrop from a
 * layer above it, and it is why these cost more per frame than the quiet six —
 * the browser has to read the composited picture back and blend it by hand.
 *
 * Affordable because an insert is two and a half seconds. It would not be
 * affordable across a whole video, which is what the `overlays` layer learned.
 */

/* ------------------------------------------------------------------ bokeh */

/**
 * Dust, but the lens is wide open and the lights are behind the subject.
 *
 * Same field of motes and a completely different look, from three numbers:
 * an order of magnitude bigger, much softer, and tinted rather than white.
 * Real bokeh is not white — it is whatever light made it — so each orb takes
 * a hue off its own seed, which is what stops a field of them reading as
 * smudges on the lens.
 */
const Bokeh: React.FC<{ seed: string; cheap: boolean }> = ({ seed, cheap }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const short = Math.min(width, height);
  const t = frame / fps;

  const orbs = React.useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) => {
        const near = seeded(`${seed}-bk`, i);
        return {
          x: seeded(`${seed}-bx`, i),
          y: seeded(`${seed}-by`, i),
          size: short * (0.16 + near * 0.38),
          // A real out-of-focus highlight is brighter at its rim than its
          // middle — that is the aperture blades, and it is the whole tell.
          hue: 20 + seeded(`${seed}-bh`, i) * 300,
          opacity: 0.34 + (1 - near) * 0.5,
          driftX: (seeded(`${seed}-bdx`, i) - 0.5) * 0.06,
          driftY: -0.015 - seeded(`${seed}-bdy`, i) * 0.03,
        };
      }),
    [seed, short],
  );

  return (
    <div style={{ ...COVER, ...(cheap ? null : { mixBlendMode: 'screen' as const }) }}>
      {orbs.map((o, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: o.size,
            height: o.size,
            borderRadius: '50%',
            background: `radial-gradient(circle, hsla(${o.hue.toFixed(0)},90%,70%,0.7) 52%, hsla(${o.hue.toFixed(0)},100%,82%,1) 80%, hsla(${o.hue.toFixed(0)},100%,82%,0) 100%)`,
            opacity: cheap ? o.opacity * 0.7 : o.opacity,
            transform: `translate3d(${(o.x + o.driftX * t) * width}px, ${(o.y + o.driftY * t) * height}px, 0)`,
            ...(cheap ? null : { filter: 'blur(14px)' }),
          }}
        />
      ))}
    </div>
  );
};

/* -------------------------------------------------------------------- vhs */

/**
 * A tape the machine cannot quite track.
 *
 * A WORN tape, not a broken one, and that distinction is the whole tuning.
 * The first version had five tracking tears jumping nine per cent of the width
 * every third frame, which is a cassette the machine has given up on — very
 * visible, and not a thing anybody puts under their own footage. Two small
 * ones, drifting slowly, is a tape that has been played a lot. The look is in
 * the colour and the line structure; the tearing is punctuation.
 *
 * Three characteristics, stacked:
 *
 *  - **Tracking tears.** Bands that jump sideways, re-rolled every third frame
 *    so they stutter rather than crawl. Every third rather than every frame
 *    because a tear that changes 30 times a second is static, and a tape drops
 *    tracking in bursts.
 *  - **Chroma bleed.** The colour signal has less bandwidth than the
 *    luminance, so colour smears to the RIGHT of an edge and never to the
 *    left. Two offset tints, one direction.
 *  - **Head switching noise.** The band of hash along the very bottom of every
 *    VHS frame, which is the single most recognisable thing about the format
 *    and the one everybody forgets.
 */
const Vhs: React.FC<{ seed: string; progress: number; cheap: boolean }> = ({ seed, progress, cheap }) => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  const roll = Math.floor(frame / 5);
  const pitch = Math.max(2, height / 300);

  const tears = React.useMemo(
    () =>
      Array.from({ length: 2 }, (_, i) => ({
        top: seeded(`${seed}-vt-${roll}`, i) * 100,
        h: 0.4 + seeded(`${seed}-vh-${roll}`, i) * 1.6,
        shift: (seeded(`${seed}-vs-${roll}`, i) - 0.5) * 3.5,
      })),
    [seed, roll],
  );

  return (
    <>
      <div
        style={{
          ...COVER,
          opacity: 0.36,
          background: `repeating-linear-gradient(180deg, rgba(0,0,0,0.6) 0px, rgba(0,0,0,0.6) ${(pitch / 2).toFixed(2)}px, rgba(0,0,0,0) ${(pitch / 2).toFixed(2)}px, rgba(0,0,0,0) ${pitch.toFixed(2)}px)`,
        }}
      />
      {/* Chroma bleed: to the right of the edge only, because that is the
          direction the colour subcarrier lags. */}
      <div
        style={{
          ...COVER,
          opacity: cheap ? 0.16 : 0.28,
          transform: 'translateX(1.1%)',
          background: 'linear-gradient(90deg, rgba(255,0,110,0.45), rgba(255,0,110,0.1))',
          ...(cheap ? null : { mixBlendMode: 'screen' as const }),
        }}
      />
      <div
        style={{
          ...COVER,
          opacity: cheap ? 0.14 : 0.24,
          transform: 'translateX(-0.8%)',
          background: 'linear-gradient(90deg, rgba(0,200,255,0.1), rgba(0,200,255,0.45))',
          ...(cheap ? null : { mixBlendMode: 'screen' as const }),
        }}
      />
      {tears.map((tear, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: `${tear.top.toFixed(1)}%`,
            height: `${tear.h.toFixed(2)}%`,
            transform: `translateX(${tear.shift.toFixed(2)}%)`,
            background: 'rgba(255,255,255,0.4)',
            ...(cheap ? null : { mixBlendMode: 'overlay' as const }),
          }}
        />
      ))}
      {/* The vertical hold, drifting once across the insert. */}
      <div
        style={{
          ...COVER,
          top: `${(progress * 150 - 25).toFixed(1)}%`,
          height: '12%',
          opacity: 0.14,
          background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0) 100%)',
          ...(cheap ? null : { mixBlendMode: 'overlay' as const }),
        }}
      />
      {/* Head-switching noise, always at the very bottom. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '1.5%',
          opacity: 0.7,
          transform: `translateX(${((seeded(`${seed}-hs`, roll) - 0.5) * 6).toFixed(2)}%)`,
          background:
            'repeating-linear-gradient(90deg, rgba(255,255,255,0.7) 0px, rgba(0,0,0,0.8) 3px, rgba(190,190,190,0.5) 6px, rgba(20,20,20,0.9) 9px)',
        }}
      />
    </>
  );
};

/* ------------------------------------------------------------------- crt */

/**
 * An old television, which is four things and not one.
 *
 * Scanlines gets you the line structure and stops. What actually makes a
 * picture read as a CRT is the GLASS:
 *
 *  1. **The tube is not rectangular.** Its corners are radiused and the
 *     picture stops short of them. One rounded mask does more for this look
 *     than any amount of line work.
 *  2. **An aperture grille**, vertical RGB stripes, under the horizontal
 *     scanlines. Together they make the dot pitch you can see if you put your
 *     nose against an old monitor, and it is the thing nobody thinks to add.
 *  3. **Bloom off the phosphor.** A CRT's highlights glow into their
 *     neighbours because the phosphor is physically lit, so the whole picture
 *     sits slightly soft and slightly bright.
 *  4. **Falloff at the edges**, because the electron beam is travelling
 *     further and hitting at an angle.
 *
 * The stripe and line pitches are both sized off the frame, or a 4K export
 * gets four times the structure of a 1080 one and reads as a fine mesh.
 */
const Crt: React.FC<{ cheap: boolean }> = ({ cheap }) => {
  const { width, height } = useVideoConfig();
  const line = Math.max(2, height / 260);
  const stripe = Math.max(2, width / 320);

  return (
    <>
      {/* Phosphor bloom: the picture lifts and softens before anything else
          is drawn over it, which is the order it happens in the tube. */}
      <div
        style={{
          ...COVER,
          opacity: 0.16,
          background: 'radial-gradient(ellipse at 50% 42%, rgba(210,255,240,0.9) 0%, rgba(150,220,255,0.25) 60%, rgba(0,0,0,0) 100%)',
          ...(cheap ? null : { mixBlendMode: 'screen' as const }),
        }}
      />
      {/* Horizontal scan structure. */}
      <div
        style={{
          ...COVER,
          opacity: 0.34,
          background: `repeating-linear-gradient(180deg, rgba(0,0,0,0.6) 0px, rgba(0,0,0,0.6) ${(line / 2).toFixed(2)}px, rgba(0,0,0,0) ${(line / 2).toFixed(2)}px, rgba(0,0,0,0) ${line.toFixed(2)}px)`,
        }}
      />
      {/* The aperture grille. Low opacity on purpose — at full strength it is
          a colour filter, and at this strength it is dot pitch. */}
      <div
        style={{
          ...COVER,
          opacity: cheap ? 0.12 : 0.2,
          background: `repeating-linear-gradient(90deg, rgba(255,60,60,0.55) 0px, rgba(255,60,60,0.55) ${(stripe / 3).toFixed(2)}px, rgba(60,255,120,0.55) ${(stripe / 3).toFixed(2)}px, rgba(60,255,120,0.55) ${((stripe * 2) / 3).toFixed(2)}px, rgba(80,120,255,0.55) ${((stripe * 2) / 3).toFixed(2)}px, rgba(80,120,255,0.55) ${stripe.toFixed(2)}px)`,
          ...(cheap ? null : { mixBlendMode: 'screen' as const }),
        }}
      />
      {/* Beam falloff toward the edges. */}
      <div
        style={{
          ...COVER,
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)',
        }}
      />
      {/*
        The glass itself: a rounded mask painted in black OUTSIDE a radius.
        A border with a huge radius and a spread shadow is the cheapest way to
        say "the picture does not reach the corner" without clipping the
        element, which would take the other layers with it.
      */}
      <div
        style={{
          ...COVER,
          borderRadius: `${Math.round(Math.min(width, height) * 0.09)}px`,
          boxShadow: `0 0 0 ${Math.round(Math.min(width, height) * 0.12)}px #000`,
        }}
      />
    </>
  );
};

/* ----------------------------------------------------------------- bloom */

/**
 * A diffusion filter on the lens, which is the most-used look on this list.
 *
 * Not a glow drawn on top — a real one takes the picture's own highlights and
 * spreads them. `backdrop-filter` is the one CSS property that can read what
 * is UNDER a layer, so a full-cover div that blurs and brightens its backdrop,
 * composited back at a third, is genuinely the shot's own light bleeding into
 * its shadows. That is what a Pro-Mist does and it is why it flatters
 * everything: contrast comes down, highlights bloom, and nothing is added.
 *
 * The second layer lifts the blacks a little, because diffusion also fogs —
 * a bloom with crushed shadows under it looks like a glow effect rather than
 * like glass.
 */
const Bloom: React.FC<{ cheap: boolean }> = ({ cheap }) => {
  const { height } = useVideoConfig();
  const radius = Math.round(height * 0.012);

  return (
    <>
      <div
        style={{
          ...COVER,
          opacity: cheap ? 0.24 : 0.38,
          // Scaled off the frame like everything else: a fixed blur is a
          // different effect at 4K than at 1080.
          backdropFilter: `blur(${radius}px) brightness(1.35) saturate(1.1)`,
          WebkitBackdropFilter: `blur(${radius}px) brightness(1.35) saturate(1.1)`,
        }}
      />
      <div
        style={{
          ...COVER,
          opacity: 0.1,
          background: 'linear-gradient(180deg, rgba(255,240,225,1), rgba(225,235,255,1))',
          ...(cheap ? null : { mixBlendMode: 'screen' as const }),
        }}
      />
    </>
  );
};

/* ---------------------------------------------------------------- super 8 */

/**
 * 8mm stock: warm, faded, and never quite steady.
 *
 * The grade is two layers and the order matters. Blacks lift first — old
 * reversal stock has no true black left in it — and then the whole thing takes
 * an amber cast, because that is what happens to dye over forty years.
 *
 * The flicker is the tell. A Super 8 camera's shutter and the film's exposure
 * never quite agree frame to frame, so brightness wanders by a few per cent at
 * around four hertz. Small enough to be nowhere near a photosensitivity
 * threshold, and it is the single thing that separates "warm colour grade"
 * from "this was shot on film".
 *
 * And the gate is dirty: a hair or a scratch that holds for a few frames and
 * then is gone, never the same one twice.
 */
const Super8: React.FC<{ seed: string; cheap: boolean }> = ({ seed, cheap }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;

  // Two out-of-phase waves, so the wander never finds a rhythm.
  const flicker = 1 + Math.sin(t * 25) * 0.028 + Math.sin(t * 9.3) * 0.02;

  // A hair in the gate, for about a third of a second at a time.
  const hairSlot = Math.floor(t * 3);
  const hairOn = seeded(`${seed}-hair`, hairSlot) > 0.62;
  const hairX = seeded(`${seed}-hx`, hairSlot);

  return (
    <>
      {/* Lifted blacks first. */}
      <div
        style={{
          ...COVER,
          opacity: 0.3 * flicker,
          background: 'linear-gradient(180deg, rgba(120,96,64,1), rgba(96,80,72,1))',
          ...(cheap ? null : { mixBlendMode: 'screen' as const }),
        }}
      />
      {/* Then the amber cast over everything. */}
      <div
        style={{
          ...COVER,
          opacity: cheap ? 0.36 : 0.5,
          background: 'linear-gradient(150deg, #FFB74D 0%, #FF8A3D 45%, #B9683F 100%)',
          ...(cheap ? null : { mixBlendMode: 'soft-light' as const }),
        }}
      />
      {/* The heavy soft vignette of a tiny, cheap lens. */}
      <div
        style={{
          ...COVER,
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 28%, rgba(48,22,8,0.78) 100%)',
        }}
      />
      {hairOn && !cheap ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${(hairX * 100).toFixed(1)}%`,
            width: Math.max(1, width / 900),
            background: 'rgba(255,248,232,0.5)',
          }}
        />
      ) : null}
    </>
  );
};
