import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { LOOK_META } from '../../src/lib/scenes/looks';
import type { Look, LookContext } from './contract';
import { Glyph, ringPoints, ringRadius, wordGroups } from './contract';
import { countUp, easeOutCubic, kf, popIn, riseIn, stagger, transformOf } from '../lib/motion';
import { seeded } from '../lib/timing';

/**
 * `neon` — the dark glow world.
 *
 * Modelled on the second reference: a near-black frame with one lit glyph in
 * the middle and a huge condensed title over it, with oversized props drifting
 * half out of frame at the corners.
 *
 * Two things in that edit are worth copying exactly, and both are restraint
 * rather than effect. The title does not fly in — it arrives already wide and
 * *unwinds* a perspective tilt over twenty frames while its gradient slides
 * violet to magenta, which reads as weight rather than as animation. And the
 * scene starts on a hard cut with the subject already at full size, so the
 * first frame is the loudest one.
 */

const INK = '#FFFFFF';
const DIM = '#9AA3C4';

const Ground: React.FC<{ ctx: LookContext }> = ({ ctx }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: '#000006', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: '-20%',
          background:
            'radial-gradient(ellipse at 50% 44%, #1B2557 0%, #0A0E28 34%, #03040E 62%, #000006 84%)',
          transform: `scale(${1 + Math.sin(frame / 70) * 0.02})`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '46%',
          width: ctx.unit * 460,
          height: ctx.unit * 460,
          marginLeft: ctx.unit * -230,
          marginTop: ctx.unit * -230,
          borderRadius: '50%',
          // Tighter than it looks like it should be: a wide accent wash turns
          // the whole frame lilac and the glyph stops reading as lit.
          background: `radial-gradient(circle, ${ctx.scene.accent}44 0%, transparent 52%)`,
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * The drifting corner props.
 *
 * Atmosphere, never information: they are oversized, half off-frame and
 * unlabelled on purpose, so nothing a viewer needs can be lost behind them.
 * Positions come from a seeded hash rather than Math.random so a resumed
 * render lines up.
 */
export const NeonProps: React.FC<{ ctx: LookContext; icons: Array<string | null> }> = ({ ctx, icons }) => {
  const frame = useCurrentFrame();
  const picks = icons.filter(Boolean).slice(0, 4);
  if (!picks.length) return null;

  return (
    <AbsoluteFill style={{ overflow: 'hidden', pointerEvents: 'none' }}>
      {picks.map((svg, i) => {
        const seed = seeded(ctx.scene.id, i);
        const left = i % 2 === 0 ? -ctx.unit * 40 : ctx.width - ctx.unit * 130;
        const top = ctx.height * (0.18 + 0.58 * seed);
        const entry = popIn(frame, 6 + stagger(i, 6), 18, 0.5);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left,
              top,
              opacity: entry.opacity * 0.9,
              transform: transformOf({
                ...entry,
                y: Math.sin((frame + i * 20) / 46) * ctx.unit * 10,
              }),
            }}
          >
            <Glyph svg={svg} size={ctx.unit * 170} color="#5BE08A" />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const Title: React.FC<{ ctx: LookContext; text: string; at: number; hero?: boolean }> = ({ ctx, text, at, hero }) => {
  const frame = useCurrentFrame();
  const groups = wordGroups(text, 2);
  // The settle: a perspective tilt unwinding, and a small scale change. The
  // gradient rides the same curve so colour and geometry land together.
  const settle = kf(frame, [[at, 0], [at + 20, 1]], easeOutCubic);
  const tilt = (1 - settle) * 26;
  const shift = 100 - settle * 60;
  const size = ctx.unit * (hero ? 92 : 52);

  return (
    <div style={{ perspective: ctx.unit * 900, maxWidth: ctx.width * 0.9 }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: ctx.unit * 2,
          transform: `rotateX(${tilt.toFixed(2)}deg) scale(${(1.06 - settle * 0.06).toFixed(4)})`,
        }}
      >
        {groups.map((group, i) => {
          const entry = riseIn(frame, at + stagger(i, 5), ctx.unit * 14, 10);
          return (
            <span
              key={`${group}-${i}`}
              style={{
                fontSize: size,
                fontWeight: 900,
                textTransform: 'uppercase',
                letterSpacing: '-0.02em',
                lineHeight: 0.96,
                textAlign: 'center',
                // Painted gradient rather than a blend mode: a blend mode over
                // a full-frame layer costs a readback on every tick.
                backgroundImage: `linear-gradient(${shift}deg, #7B4BFF 0%, #B14BFF 44%, #FF5BD8 100%)`,
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
                // The glow is a text-shadow on the element, not a filter on the
                // layer, so it never asks for a repaint of anything else.
                textShadow: `0 0 ${ctx.unit * 30}px rgba(150,80,255,0.55), 0 ${ctx.unit * 5}px 0 rgba(10,4,40,0.9)`,
                opacity: entry.opacity,
                transform: transformOf(entry),
              }}
            >
              {group}
            </span>
          );
        })}
      </div>
    </div>
  );
};

const Figure: React.FC<{ ctx: LookContext; value: string; label: string; at: number }> = ({ ctx, value, label, at }) => {
  const frame = useCurrentFrame();
  const entry = popIn(frame, at, 12, 0.7);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: ctx.unit * 10,
        opacity: entry.opacity,
        transform: transformOf(entry),
      }}
    >
      <span
        style={{
          fontSize: ctx.unit * 200,
          fontWeight: 900,
          lineHeight: 0.9,
          color: INK,
          letterSpacing: '-0.05em',
          fontVariantNumeric: 'tabular-nums',
          textShadow: `0 0 ${ctx.unit * 46}px ${ctx.scene.accent}AA`,
        }}
      >
        {countUp(frame, at, 20, value)}
      </span>
      {label ? (
        <span
          style={{
            fontSize: ctx.unit * 32,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.16em',
            color: DIM,
          }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
};

const Group: React.FC<{
  ctx: LookContext;
  items: string[];
  icons: Array<string | null>;
  arrange: 'ring' | 'row' | 'column' | 'duo' | 'plinth';
  at: number;
}> = ({ ctx, items, icons, arrange, at }) => {
  const frame = useCurrentFrame();
  const chip = ctx.unit * 110;

  if (arrange === 'ring') {
    const radius = ringRadius(ctx, ctx.unit * 240);
    const points = ringPoints(items.length, radius);
    return (
      <div style={{ position: 'relative', width: radius * 2, height: radius * 2 }}>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: chip * 2,
            height: chip * 2,
            marginLeft: chip * -1,
            marginTop: chip * -1,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${ctx.scene.accent}55 0%, transparent 70%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: transformOf(popIn(frame, at, 12, 0.4)),
          }}
        >
          <Glyph svg={icons[0] ?? null} size={chip} color={INK} />
        </div>
        {points.map((point, i) => {
          const entry = popIn(frame, at + 6 + stagger(i, 5), 11, 0.4);
          return (
            <div
              key={`${items[i]}-${i}`}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                marginLeft: point.x - chip / 2,
                marginTop: point.y - chip / 2,
                width: chip,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: ctx.unit * 8,
                opacity: entry.opacity,
                transform: transformOf(entry),
              }}
            >
              <Glyph svg={icons[i + 1] ?? null} size={chip * 0.62} color={ctx.scene.accent} />
              <span style={{ fontSize: ctx.unit * 22, color: DIM, fontWeight: 700, textAlign: 'center' }}>
                {items[i]}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  const horizontal = arrange === 'row' || arrange === 'duo';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: horizontal ? 'row' : 'column',
        alignItems: 'center',
        gap: ctx.unit * 34,
      }}
    >
      {items.map((item, i) => {
        const entry = riseIn(frame, at + stagger(i), ctx.unit * 24, 10);
        return (
          <div
            key={`${item}-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: ctx.unit * 18,
              opacity: entry.opacity,
              transform: transformOf(entry),
            }}
          >
            <Glyph svg={icons[i] ?? null} size={ctx.unit * 56} color={ctx.scene.accent} />
            <span
              style={{
                fontSize: ctx.unit * 44,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '-0.01em',
                color: INK,
                textShadow: `0 0 ${ctx.unit * 22}px ${ctx.scene.accent}66`,
              }}
            >
              {item}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const Rows: React.FC<{ ctx: LookContext; items: string[]; icons: Array<string | null>; at: number }> = ({
  ctx,
  items,
  icons,
  at,
}) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: ctx.unit * 18, width: ctx.width * 0.76 }}>
      {items.map((item, i) => {
        const entry = riseIn(frame, at + stagger(i), ctx.unit * 20, 9);
        const bar = kf(frame, [[at + stagger(i) + 4, 0], [at + stagger(i) + 20, 1]], easeOutCubic);
        return (
          <div
            key={`${item}-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: ctx.unit * 16,
              padding: `${ctx.unit * 16}px ${ctx.unit * 22}px`,
              borderRadius: ctx.unit * 18,
              border: `1px solid ${ctx.scene.accent}44`,
              background: 'rgba(12,18,52,0.72)',
              position: 'relative',
              overflow: 'hidden',
              opacity: entry.opacity,
              transform: transformOf(entry),
            }}
          >
            {/* The fill is a scaleX, not a width — a width change relays out
                the row's contents on every frame. */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: `linear-gradient(90deg, ${ctx.scene.accent}33, transparent)`,
                transformOrigin: 'left center',
                transform: `scaleX(${bar.toFixed(4)})`,
              }}
            />
            <Glyph svg={icons[i] ?? null} size={ctx.unit * 44} color={ctx.scene.accent} />
            <span
              style={{
                position: 'relative',
                fontSize: ctx.unit * 36,
                fontWeight: 800,
                color: INK,
                textTransform: 'uppercase',
              }}
            >
              {item}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export const neon: Look = {
  ...LOOK_META.neon,
  Ground,
  Title,
  Figure,
  Group,
  Rows,
};
