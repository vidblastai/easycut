import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import type { SceneLook } from '../../src/lib/edl/types';
import { LOOK_META } from '../../src/lib/scenes/looks';
import { STYLE_GUIDES } from '../../src/lib/scenes/style-guides';
import type { Look, LookContext } from './contract';
import { neon } from './neon';
import { studio } from './studio';

/**
 * A look made from its style guide alone.
 *
 * The looks added after the first six — paper, ink, blueprint and the rest —
 * mostly arrive as HyperFrames clips that draw their own world, so what this
 * file supplies is only what the fallback layout needs: a ground in the
 * guide's colours with a soft pool behind the subject and two slow blurred
 * shapes for depth, and slots borrowed from `neon` on a dark ground or
 * `studio` on a light one, so their type stays readable either way.
 */
export function groundedLook(id: SceneLook): Look {
  const guide = STYLE_GUIDES[id];
  const meta = LOOK_META[id];
  const slots = meta.tone === 'dark' ? neon : studio;

  const Ground: React.FC<{ ctx: LookContext }> = ({ ctx }) => {
    const frame = useCurrentFrame();
    const { width, height, unit } = ctx;
    const pool = guide.palette[1]?.hex ?? guide.accent;
    const far = guide.palette[guide.palette.length - 1]?.hex ?? guide.accent;

    return (
      <AbsoluteFill style={{ background: guide.ground, overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            left: width * 0.5 - width * 0.55,
            top: height * 0.36 - width * 0.55,
            width: width * 1.1,
            height: width * 1.1,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${pool}2E 0%, transparent 65%)`,
          }}
        />
        {[0, 1].map((i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: i ? width * 0.55 : width * -0.25,
              top: i ? height * 0.62 : height * 0.08,
              width: width * 0.7,
              height: width * 0.7,
              borderRadius: '50%',
              background: far,
              opacity: 0.12,
              filter: `blur(${unit * 40}px)`,
              transform: `translate3d(0, ${(-frame * unit * (0.06 + i * 0.05)).toFixed(1)}px, 0)`,
            }}
          />
        ))}
      </AbsoluteFill>
    );
  };

  return { ...meta, Ground, Title: slots.Title, Figure: slots.Figure, Group: slots.Group, Rows: slots.Rows };
}
