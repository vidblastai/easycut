import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { LOOK_META } from '../../src/lib/scenes/looks';
import type { Look, LookContext } from './contract';
import { Glyph, ringPoints, ringRadius, wordGroups } from './contract';
import { countUp, drift, easeOutCubic, kf, popIn, riseIn, stagger, transformOf } from '../lib/motion';

/**
 * `archive` — the cinematic documentary world.
 *
 * Modelled on the fourth reference: warm amber over near-black, sprocket-hole
 * film bars top and bottom, and the whole frame sitting on a slight
 * perspective tilt that drifts.
 *
 * The thing that actually sells this look is not the colour, it is that the
 * push-in never stops. A documentary insert that settles reads instantly as a
 * still image with text on it; one that is still creeping forward at the cut
 * reads as footage. So `drift()` here has no keyframes on purpose.
 *
 * It is also the one look that fades rather than cuts. A dissolve normally
 * wastes a quarter of a two-second insert, but this world has no hard edges
 * anywhere else either, and a cut into it looks like a mistake.
 */

const CREAM = '#F6EAD2';
const GOLD = '#E0A94E';

const Ground: React.FC<{ ctx: LookContext }> = ({ ctx }) => {
  const frame = useCurrentFrame();
  const push = drift(frame, 0.0011, 1.04);
  // A degree or two of tilt, drifting. Enough to stop the frame reading flat,
  // small enough that nobody consciously notices it.
  const tilt = Math.sin(frame / 90) * 1.1;

  return (
    <AbsoluteFill style={{ background: '#05040A', overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: '-8%',
          background: `radial-gradient(ellipse at 62% 40%, ${GOLD}66 0%, #2A1606 34%, #08050C 72%)`,
          transform: `scale(${push.toFixed(4)}) rotate(${tilt.toFixed(3)}deg)`,
        }}
      />
      {/* Embers: static paint, moved. Nothing here is regenerated per frame. */}
      <div
        style={{
          position: 'absolute',
          inset: '-20%',
          backgroundImage: `radial-gradient(circle, ${GOLD}55 1.6px, transparent 2px)`,
          backgroundSize: `${ctx.unit * 90}px ${ctx.unit * 120}px`,
          opacity: 0.35,
          transform: `translate3d(0, ${(-frame * 0.35).toFixed(1)}px, 0)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: 'radial-gradient(ellipse at 50% 48%, rgba(0,0,0,0) 34%, rgba(0,0,0,0.88) 100%)',
        }}
      />
      <FilmBars ctx={ctx} />
    </AbsoluteFill>
  );
};

/** The sprocket bars. One repeating gradient each, painted once, never moved. */
const FilmBars: React.FC<{ ctx: LookContext }> = ({ ctx }) => {
  const height = ctx.unit * 34;
  const bar: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    height,
    background: '#05040A',
    backgroundImage: `repeating-linear-gradient(90deg, rgba(246,234,210,0.20) 0 ${ctx.unit * 16}px, transparent ${
      ctx.unit * 16
    }px ${ctx.unit * 44}px)`,
    backgroundSize: `100% ${height * 0.5}px`,
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  };
  return (
    <>
      <div style={{ ...bar, top: 0 }} />
      <div style={{ ...bar, bottom: 0 }} />
    </>
  );
};

const headlineType = (ctx: LookContext, size: number): React.CSSProperties => ({
  fontSize: size,
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.01em',
  lineHeight: 0.98,
  backgroundImage: `linear-gradient(180deg, ${CREAM} 0%, ${GOLD} 100%)`,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
  textShadow: `0 ${ctx.unit * 6}px ${ctx.unit * 18}px rgba(0,0,0,0.75)`,
});

const Title: React.FC<{ ctx: LookContext; text: string; at: number; hero?: boolean }> = ({ ctx, text, at, hero }) => {
  const frame = useCurrentFrame();
  // A word group at a time, six frames apart. Letter by letter on a
  // two-second insert is unreadable, and the reference does not do it either.
  const groups = wordGroups(text, hero ? 1 : 2);
  const size = ctx.unit * (hero ? 88 : 54);

  /*
   * Wrapping, not stacking.
   *
   * A column of one-word rows is what you get for free and it is wrong: six
   * short words become six lines and the frame reads as a list. A wrapping row
   * lets the line break where the width runs out, which is where a designer
   * would have broken it.
   */
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        justifyContent: 'center',
        // In ems, not units: the gap between groups IS the space between words,
        // and a fixed pixel gap reads as a double space at small sizes and as a
        // missing one at large.
        gap: `${ctx.unit * 2}px 0.3em`,
        maxWidth: ctx.width * 0.86,
      }}
    >
      {groups.map((group, i) => {
        const entry = riseIn(frame, at + stagger(i, 6), ctx.unit * 18, 10);
        return (
          <span
            key={`${group}-${i}`}
            style={{
              ...headlineType(ctx, size),
              opacity: entry.opacity,
              transform: transformOf(entry),
            }}
          >
            {group}
          </span>
        );
      })}
    </div>
  );
};

const Figure: React.FC<{ ctx: LookContext; value: string; label: string; at: number }> = ({ ctx, value, label, at }) => {
  const frame = useCurrentFrame();
  const entry = popIn(frame, at, 14, 0.88);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: ctx.unit * 4,
        opacity: entry.opacity,
        transform: transformOf(entry),
      }}
    >
      <span style={{ ...headlineType(ctx, ctx.unit * 190), fontVariantNumeric: 'tabular-nums' }}>
        {/* The count lands as the crossfade finishes, not after it. */}
        {countUp(frame, at, 16, value)}
      </span>
      {label ? (
        <span
          style={{
            fontSize: ctx.unit * 38,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: CREAM,
            opacity: kf(frame, [[at + 8, 0], [at + 18, 0.82]], easeOutCubic),
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
  const chip = ctx.unit * 100;

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
            marginLeft: -chip,
            marginTop: -chip,
            width: chip * 2,
            height: chip * 2,
            borderRadius: '50%',
            border: `${ctx.unit * 2}px solid ${GOLD}88`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: transformOf(popIn(frame, at, 14, 0.6)),
          }}
        >
          <Glyph svg={icons[0] ?? null} size={chip} color={GOLD} />
        </div>
        {points.map((point, i) => {
          const entry = popIn(frame, at + 8 + stagger(i, 6), 12, 0.5);
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
              <Glyph svg={icons[i + 1] ?? null} size={chip * 0.6} color={CREAM} />
              <span
                style={{
                  fontSize: ctx.unit * 22,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: CREAM,
                  textAlign: 'center',
                }}
              >
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
        alignItems: horizontal ? 'center' : 'flex-start',
        gap: ctx.unit * 30,
      }}
    >
      {items.map((item, i) => {
        const entry = riseIn(frame, at + stagger(i, 6), ctx.unit * 20, 10);
        return (
          <div
            key={`${item}-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: ctx.unit * 16,
              opacity: entry.opacity,
              transform: transformOf(entry),
            }}
          >
            <div style={{ width: ctx.unit * 6, height: ctx.unit * 46, background: GOLD }} />
            <Glyph svg={icons[i] ?? null} size={ctx.unit * 48} color={GOLD} />
            <span style={{ ...headlineType(ctx, ctx.unit * 40), whiteSpace: 'nowrap' }}>{item}</span>
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
}) => (
  <Group ctx={ctx} items={items} icons={icons} arrange="column" at={at} />
);

export const archive: Look = {
  ...LOOK_META.archive,
  Ground,
  Title,
  Figure,
  Group,
  Rows,
};
