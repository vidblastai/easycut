import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { styleGuideFor } from '../../src/lib/scenes/style-guides';
import type { SceneLook } from '../../src/lib/edl/types';
import type { LookContext } from './contract';

/**
 * The ground a scene sits on, when it has asked for a particular one.
 *
 * ── Texture here, tone from the look ────────────────────────────────────
 *
 * Every colour below is derived from `styleGuideFor(scene.look)` rather than
 * written down, and that is the whole design. A dark surface picked inside a
 * light look would put that look's ink onto its own colour and every title in
 * the scene would disappear — so the backdrop never chooses the tone, only
 * what the surface is MADE of. `paper` is cream in `studio` and charcoal in
 * `neon`, and both are reachable by choosing the look.
 *
 * ── Why it replaces the look's ground rather than sitting under it ──────
 *
 * Because a background drawn over a background is two backgrounds. The same
 * mistake the drawn scenes already document: the look's decorative ground
 * showing through a second one reads as a panel floating on somebody else's
 * wallpaper.
 *
 * ── Why none of this is an image ────────────────────────────────────────
 *
 * Paper is a photograph of paper, normally. Here it is three stacked CSS
 * gradients, because a full-frame bitmap is a decode on every frame of every
 * scene and the editor has to play this back while a video is running. The
 * tooth comes from two misaligned dot lattices at low alpha, which is enough
 * to kill the flatness without ever being a thing you look at.
 */
export type SurfaceTone = {
  /** The look's own ground colour. The surface never picks its own. */
  ground: string;
  /** Whether that ground needs light marks drawn on it. */
  dark: boolean;
  /** An `rgba(r,g,b,` prefix; the caller closes it with an alpha. */
  mark: string;
  /** Alpha for the paper tooth. */
  tooth: number;
  /** Alpha for a ruled line. */
  rule: number;
};

/**
 * What a surface is made of, for one look.
 *
 * Ink on a light ground reads at a much lower alpha than the same marks on a
 * dark one — the eye is reading a contrast ratio, not an opacity — so a single
 * figure tuned on white turns to mud on black and one tuned on black is
 * invisible on white. Both figures live here rather than in the component so
 * the decision can be checked against every look without a renderer.
 */
export function surfaceTone(look: SceneLook): SurfaceTone {
  const ground = styleGuideFor(look).ground;
  const dark = isDark(ground);
  return {
    ground,
    dark,
    mark: dark ? 'rgba(255,255,255,' : 'rgba(13,13,16,',
    tooth: dark ? 0.035 : 0.055,
    rule: dark ? 0.085 : 0.075,
  };
}

export const Surface: React.FC<{ ctx: LookContext }> = ({ ctx }) => {
  const frame = useCurrentFrame();
  const { scene, unit } = ctx;
  const { ground, dark, mark, tooth, rule } = surfaceTone(scene.look);

  const cell = unit * 34;
  // Slid rather than re-tiled, so the pattern drifts without an edge ever
  // showing and without costing a layout pass. Same trick as the looks' own
  // grounds, and slow enough that it reads as the camera, not the paper.
  const slide = (frame * 0.1) % cell;

  return (
    <AbsoluteFill style={{ background: ground, overflow: 'hidden' }}>
      {scene.backdrop === 'paper' || scene.backdrop === 'paper-grid' ? (
        <Tooth mark={mark} alpha={tooth} unit={unit} slide={slide} />
      ) : null}

      {scene.backdrop === 'paper-grid' || scene.backdrop === 'grid' ? (
        <Ruled mark={mark} alpha={rule} cell={cell} slide={slide} heavyEvery={5} />
      ) : null}

      {scene.backdrop === 'dots' ? (
        <div
          style={{
            position: 'absolute',
            inset: `-${cell * 2}px`,
            backgroundImage: `radial-gradient(circle, ${mark}${dark ? 0.16 : 0.1}) 1.4px, transparent 1.5px)`,
            backgroundSize: `${cell}px ${cell}px`,
            transform: `translate3d(${slide}px, ${slide * 0.6}px, 0)`,
          }}
        />
      ) : null}

      {scene.backdrop === 'rays' ? <Rays accent={scene.accent} unit={unit} frame={frame} /> : null}

      {/* The accent arrives as one bled glow on every surface but `solid`.
          A tinted ground would stop the paper reading as paper. */}
      {scene.backdrop === 'solid' ? null : (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '54%',
            width: unit * 680,
            height: unit * 680,
            marginLeft: unit * -340,
            marginTop: unit * -340,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${scene.accent}${dark ? '33' : '26'} 0%, transparent 64%)`,
            transform: `scale(${1 + Math.sin(frame / 40) * 0.04})`,
          }}
        />
      )}

      {/* A vignette on every one of them. It is what stops a flat colour
          reading as a flat colour, and it is the cheapest depth there is. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse at 50% 46%, transparent 42%, ${dark ? 'rgba(0,0,0,0.55)' : 'rgba(13,13,16,0.10)'} 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * The tooth of the stock: two dot lattices that do not line up.
 *
 * One lattice on its own is a halftone, which is a printing effect rather than
 * a paper. Two at different sizes and offsets never repeat into a figure the
 * eye can lock onto, which is what fibre does.
 */
const Tooth: React.FC<{ mark: string; alpha: number; unit: number; slide: number }> = ({
  mark, alpha, unit, slide,
}) => (
  <>
    <div
      style={{
        position: 'absolute',
        inset: `-${unit * 40}px`,
        backgroundImage: `radial-gradient(circle, ${mark}${alpha}) 0.9px, transparent 1px)`,
        backgroundSize: `${unit * 5}px ${unit * 5}px`,
        transform: `translate3d(${slide * 0.3}px, 0, 0)`,
      }}
    />
    <div
      style={{
        position: 'absolute',
        inset: `-${unit * 40}px`,
        backgroundImage: `radial-gradient(circle, ${mark}${alpha * 0.7}) 1.3px, transparent 1.4px)`,
        backgroundSize: `${unit * 8.5}px ${unit * 7}px`,
        transform: `translate3d(${slide * -0.2}px, ${slide * 0.2}px, 0)`,
      }}
    />
  </>
);

/**
 * Ruling. Every fifth line is heavier, the way squared paper is printed.
 *
 * Without that the grid is a wireframe — an even mesh with no hierarchy reads
 * as a diagram overlay rather than as the page under one.
 */
const Ruled: React.FC<{
  mark: string;
  alpha: number;
  cell: number;
  slide: number;
  heavyEvery: number;
}> = ({ mark, alpha, cell, slide, heavyEvery }) => (
  <>
    <div
      style={{
        position: 'absolute',
        inset: `-${cell * 2}px`,
        backgroundImage:
          `linear-gradient(${mark}${alpha}) 1px, transparent 1px), ` +
          `linear-gradient(90deg, ${mark}${alpha}) 1px, transparent 1px)`,
        backgroundSize: `${cell}px ${cell}px`,
        transform: `translate3d(${slide}px, ${slide * 0.6}px, 0)`,
      }}
    />
    <div
      style={{
        position: 'absolute',
        inset: `-${cell * heavyEvery}px`,
        backgroundImage:
          `linear-gradient(${mark}${alpha * 1.8}) 1.5px, transparent 1.5px), ` +
          `linear-gradient(90deg, ${mark}${alpha * 1.8}) 1.5px, transparent 1.5px)`,
        backgroundSize: `${cell * heavyEvery}px ${cell * heavyEvery}px`,
        transform: `translate3d(${slide}px, ${slide * 0.6}px, 0)`,
      }}
    />
  </>
);

/** Light thrown from one corner, turning slowly. */
const Rays: React.FC<{ accent: string; unit: number; frame: number }> = ({ accent, unit, frame }) => (
  <div
    style={{
      position: 'absolute',
      inset: `-${unit * 200}px`,
      background:
        `conic-gradient(from ${frame * 0.12}deg at 22% 12%, ` +
        `${accent}00 0deg, ${accent}24 26deg, ${accent}00 62deg, ` +
        `${accent}00 180deg, ${accent}1C 212deg, ${accent}00 250deg, ${accent}00 360deg)`,
    }}
  />
);

/** Whether a hex ground is dark enough to need light marks on it. */
export function isDark(hex: string): boolean {
  const value = hex.replace('#', '');
  if (value.length < 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  // Rec. 601 luma: green carries most of the perceived brightness, and a
  // straight average calls a saturated blue ground light when it is not.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}
