import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { LOOK_META } from '../../src/lib/scenes/looks';
import { STYLE_GUIDES } from '../../src/lib/scenes/style-guides';
import type { Look, LookContext } from './contract';
import { neon } from './neon';

/**
 * `editorial` — near-black and violet, from the reference the user supplied.
 *
 * Its slots are `neon`'s. That is a deliberate reuse rather than a shortcut:
 * both worlds set bright type on near-black, and the place they differ is the
 * GROUND — editorial's signature is one localised violet pool with a huge
 * cropped curve in the foreground, where neon's is an even radial glow. Since
 * a drawn scene supplies its own background anyway, the ground is most of what
 * a separate file here is even for.
 *
 * The rest of the style lives in `src/lib/scenes/style-guides.ts`, which is
 * what the drawing and animation prompts read. Duplicating any of it here
 * would be the drift that file exists to stop.
 */

const GUIDE = STYLE_GUIDES.editorial;

const Ground: React.FC<{ ctx: LookContext }> = ({ ctx }) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: GUIDE.ground, overflow: 'hidden' }}>
      {/* The violet pool. Localised — a wash across the whole frame is the
          thing the reference notes warn about, glow standing in for design. */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '44%',
          width: ctx.unit * 720,
          height: ctx.unit * 720,
          marginLeft: ctx.unit * -360,
          marginTop: ctx.unit * -360,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${GUIDE.palette[2].hex}3D 0%, ${GUIDE.palette[3].hex}22 44%, transparent 68%)`,
          transform: `scale(${1 + Math.sin(frame / 80) * 0.03})`,
        }}
      />
      {/* The cropped foreground curve: wider than the frame, entering from the
          lower left, almost black with one lit edge. */}
      <div
        style={{
          position: 'absolute',
          left: ctx.width * -0.36,
          top: ctx.height * 0.62,
          width: ctx.width * 1.35,
          height: ctx.width * 1.35,
          borderRadius: '50%',
          background: `radial-gradient(circle at 38% 24%, ${GUIDE.palette[3].hex} 0%, ${GUIDE.palette[4].hex} 62%)`,
          borderTop: `${Math.max(1, ctx.unit * 1.5)}px solid ${GUIDE.palette[2].hex}44`,
          transform: `translate3d(0, ${(Math.sin(frame / 110) * ctx.unit * 12).toFixed(1)}px, 0)`,
        }}
      />
      <AbsoluteFill
        style={{ background: 'radial-gradient(ellipse at 50% 46%, rgba(0,0,0,0) 38%, rgba(3,1,5,0.9) 100%)' }}
      />
    </AbsoluteFill>
  );
};

export const editorial: Look = {
  ...LOOK_META.editorial,
  Ground,
  Title: neon.Title,
  Figure: neon.Figure,
  Group: neon.Group,
  Rows: neon.Rows,
};
