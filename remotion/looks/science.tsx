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
 * sits on: deep navy, a field of stars, a huge planet edge cropped at the
 * bottom with a lit rim, and dust drifting at a different rate from the stars
 * so the frame has depth even before anything arrives.
 *
 * Everything else about the world lives in the style guide, which the drawing
 * and composition prompts read.
 */

const GUIDE = STYLE_GUIDES.science;
const STARS = 46;

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
      {Array.from({ length: STARS }, (_, i) => {
        const x = seeded(`${ctx.scene.id}-sx`, i) * width;
        const y = seeded(`${ctx.scene.id}-sy`, i) * height * 0.8;
        const size = unit * (2 + seeded(`${ctx.scene.id}-ss`, i) * 4);
        const twinkle = 0.45 + 0.35 * Math.sin(frame / (18 + (i % 7) * 5) + i);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y - frame * unit * 0.08,
              width: size,
              height: size,
              borderRadius: '50%',
              background: i % 5 === 0 ? GUIDE.palette[1].hex : GUIDE.palette[0].hex,
              opacity: twinkle,
            }}
          />
        );
      })}
      {/* The planet edge: wider than the frame, lit along its upper rim. */}
      <div
        style={{
          position: 'absolute',
          left: width * -0.4,
          top: height * 0.7,
          width: width * 1.8,
          height: width * 1.8,
          borderRadius: '50%',
          background: `radial-gradient(circle at 40% 8%, ${GUIDE.palette[2].hex} 0%, ${GUIDE.palette[4].hex} 22%, ${GUIDE.palette[5].hex} 55%)`,
          boxShadow: `0 ${-unit * 6}px ${unit * 40}px ${GUIDE.palette[2].hex}55`,
          transform: `translate3d(0, ${(-frame * unit * 0.25).toFixed(1)}px, 0)`,
        }}
      />
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
