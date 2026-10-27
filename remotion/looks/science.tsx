import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { LOOK_META } from '../../src/lib/scenes/looks';
import { STYLE_GUIDES } from '../../src/lib/scenes/style-guides';
import { seeded } from '../lib/timing';
import type { Look, LookContext } from './contract';
import { neon } from './neon';

/**
 * `science` — the flat-vector science-explainer world.
 *
 * Its slots are `neon`'s, for the same reason `editorial` borrows them: bright
 * type on a dark ground reads the same in both, and a scene that is drawn —
 * which is most of them, and all of them on the HyperFrames path — brings its
 * own picture anyway. What this file owns is the GROUND the fallback layout
 * sits on: deep navy with a lighter pool where the subject goes, large blurred
 * shapes far behind, and soft dust drifting at different rates so the frame
 * has depth even before anything arrives. Abstract on purpose — a backdrop
 * that is a place (space, a planet) puts a subject in every scene that the
 * scene is not about.
 *
 * Everything else about the world lives in the style guide, which the drawing
 * and composition prompts read.
 */

const GUIDE = STYLE_GUIDES.science;
const DUST = 22;
const BLURS = 3;

const Ground: React.FC<{ ctx: LookContext }> = ({ ctx }) => {
  const frame = useCurrentFrame();
  const { width, height, unit } = ctx;

  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        background: `radial-gradient(ellipse at 50% 30%, ${GUIDE.palette[5].hex} 0%, ${GUIDE.ground} 70%)`,
      }}
    >
      {Array.from({ length: BLURS }, (_, i) => {
        const size = width * (0.55 + seeded(`${ctx.scene.id}-bs`, i) * 0.35);
        const x = seeded(`${ctx.scene.id}-bx`, i) * width - size / 2;
        const y = (0.15 + seeded(`${ctx.scene.id}-by`, i) * 0.75) * height - size / 2;
        return (
          <div
            key={`b${i}`}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: '50%',
              background: i === 0 ? GUIDE.palette[2].hex : GUIDE.palette[4].hex,
              opacity: i === 0 ? 0.12 : 0.35,
              filter: `blur(${unit * 30}px)`,
              transform: `translate3d(0, ${(-frame * unit * (0.05 + i * 0.04)).toFixed(1)}px, 0)`,
            }}
          />
        );
      })}
      {Array.from({ length: DUST }, (_, i) => {
        const x = seeded(`${ctx.scene.id}-sx`, i) * width;
        const y = seeded(`${ctx.scene.id}-sy`, i) * height;
        const size = unit * (3 + seeded(`${ctx.scene.id}-ss`, i) * 6);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y - frame * unit * (0.1 + (i % 3) * 0.06),
              width: size,
              height: size,
              borderRadius: '50%',
              background: i % 4 === 0 ? GUIDE.palette[1].hex : GUIDE.palette[0].hex,
              opacity: 0.18,
              filter: `blur(${unit * 1.5}px)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

export const science: Look = {
  ...LOOK_META.science,
  Ground,
  Title: neon.Title,
  Figure: neon.Figure,
  Group: neon.Group,
  Rows: neon.Rows,
};
