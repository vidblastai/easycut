import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { LOOK_META } from '../../src/lib/scenes/looks';
import type { Look, LookContext } from './contract';
import { Glyph, ringPoints, ringRadius, wordGroups } from './contract';
import { countUp, easeOutCubic, ghosts, kf, popIn, riseIn, slideIn, stagger, transformOf } from '../lib/motion';

/**
 * `gallery` — the bright fogged colonnade.
 *
 * Modelled on the third reference: white marble columns behind a haze, one
 * plinth centre frame, and objects that arrive on it by sliding in hard from
 * the right and stopping dead.
 *
 * The carousel is the whole look, and the detail that makes it work is the
 * motion blur on the way in. The reference smears heavily for about four
 * frames. We do NOT reproduce that with a CSS or SVG blur: a filter on a
 * moving element re-rasterises it every frame, and this renderer has already
 * paid for that mistake once with ten frames a second in the editor. Five
 * ghost copies trailing back along the direction of travel read as the same
 * thing at 30fps and cost five transforms — see `ghosts()`.
 *
 * The colonnade parallaxes at about a fifth of the object's speed, which is
 * what gives the frame its depth without a 3D renderer.
 */

const INK = '#22222A';
const DIM = '#7C7C88';

const Ground: React.FC<{ ctx: LookContext }> = ({ ctx }) => {
  const frame = useCurrentFrame();
  const columnWidth = ctx.unit * 132;
  // A fifth of the object speed, and it never resets — the pattern is
  // oversized so it can slide forever without showing an edge.
  const parallax = (frame * 0.9) % columnWidth;

  return (
    <AbsoluteFill style={{ background: '#E7E8EC', overflow: 'hidden' }}>
      {/* The colonnade.
          Four stops per column rather than two: a flat pair of stripes reads
          as wallpaper, and it is the bright edge next to the dark reveal that
          makes a cylinder out of a rectangle. The whole band is oversized and
          slid, so it is painted once. */}
      <div
        style={{
          position: 'absolute',
          inset: `-${columnWidth * 2}px`,
          backgroundImage: `repeating-linear-gradient(90deg,
            #B9BCC6 0px,
            #CED1D9 ${columnWidth * 0.10}px,
            #FBFBFD ${columnWidth * 0.30}px,
            #E4E6EC ${columnWidth * 0.58}px,
            #ACAFBA ${columnWidth * 0.74}px,
            #8E919C ${columnWidth * 0.80}px,
            #B9BCC6 ${columnWidth}px)`,
          transform: `translate3d(${-parallax.toFixed(1)}px, 0, 0)`,
        }}
      />
      {/* Entablature and floor, so the columns read as architecture and stand
          on something rather than running off the bottom of the frame. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: ctx.unit * 96,
          background: 'linear-gradient(180deg, #F4F5F8 0%, #DCDEE5 58%, #B8BAC4 100%)',
          boxShadow: `0 ${ctx.unit * 6}px ${ctx.unit * 20}px rgba(0,0,0,0.12)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: ctx.height * 0.3,
          background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, #EFF0F4 42%, #DFE1E7 100%)',
        }}
      />
      {/* Fog: one painted gradient, drifting. Not a blur of anything — a blur
          over a full-frame layer is the repaint this renderer will not pay
          for. Heavy on purpose: the haze is what puts the colonnade behind
          the subject instead of beside it. */}
      <div
        style={{
          position: 'absolute',
          inset: '-14%',
          background:
            'radial-gradient(ellipse 72% 52% at 46% 66%, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.86) 30%, rgba(255,255,255,0.34) 58%, rgba(255,255,255,0) 78%)',
          transform: `translate3d(${(Math.sin(frame / 80) * ctx.unit * 34).toFixed(1)}px, ${(
            Math.cos(frame / 110) * ctx.unit * 12
          ).toFixed(1)}px, 0)`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at 50% 46%, rgba(255,255,255,0) 44%, rgba(150,152,162,0.20) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};

/** The plinth the objects land on. Drawn, not imported. */
const Plinth: React.FC<{ ctx: LookContext; width: number }> = ({ ctx, width }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: ctx.unit * 8 }}>
    {/* The contact shadow is what puts the object ON the plinth rather than
        floating above it, and it costs one ellipse. */}
    <div
      style={{
        width: width * 0.9,
        height: ctx.unit * 16,
        borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(40,42,52,0.30) 0%, rgba(40,42,52,0) 70%)',
        marginBottom: ctx.unit * -6,
      }}
    />
    <div
      style={{
        width: width * 1.3,
        height: ctx.unit * 26,
        borderRadius: ctx.unit * 5,
        background: 'linear-gradient(180deg, #FFFFFF 0%, #EDEEF3 42%, #C6C8D1 100%)',
        boxShadow: `0 ${ctx.unit * 8}px ${ctx.unit * 22}px rgba(40,42,52,0.16)`,
      }}
    />
    <div
      style={{
        width,
        height: ctx.unit * 260,
        background: `linear-gradient(90deg, #BFC1CB 0%, #F7F8FA 26%, #E3E5EB 62%, #A9ABB6 100%)`,
        maskImage: 'linear-gradient(180deg, #000 0%, #000 42%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(180deg, #000 0%, #000 42%, transparent 100%)',
      }}
    />
  </div>
);

/**
 * One object arriving on the plinth.
 *
 * Split out because it is the only place in the renderer that draws ghosts,
 * and because every arrangement in this look is some number of these.
 */
const Arriving: React.FC<{ ctx: LookContext; at: number; children: React.ReactNode }> = ({ ctx, at, children }) => {
  const frame = useCurrentFrame();
  const entry = slideIn(frame, at, ctx.width * 0.9, 5);
  const trail = ghosts(entry.x);

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {trail.map((ghost, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: ghost.opacity * entry.opacity,
            transform: `translate3d(${(entry.x + ghost.x).toFixed(2)}px, 0, 0)`,
          }}
        >
          {children}
        </div>
      ))}
      <div style={{ opacity: entry.opacity, transform: transformOf(entry) }}>{children}</div>
    </div>
  );
};

const Title: React.FC<{ ctx: LookContext; text: string; at: number; hero?: boolean }> = ({ ctx, text, at, hero }) => {
  const frame = useCurrentFrame();
  const groups = wordGroups(text, hero ? 1 : 3);
  const size = ctx.unit * (hero ? 78 : 40);

  // Wrapping, not stacking: a column of one-word rows turns a six-word line
  // into six lines and the frame reads as a list instead of a sentence.
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
        maxWidth: ctx.width * 0.84,
      }}
    >
      {groups.map((group, i) => {
        const entry = riseIn(frame, at + stagger(i, 5), ctx.unit * 16, 9);
        return (
          <span
            key={`${group}-${i}`}
            style={{
              fontSize: size,
              fontWeight: 800,
              letterSpacing: '-0.03em',
              lineHeight: 1.04,
              color: INK,
              textAlign: 'center',
              textShadow: '0 2px 20px rgba(255,255,255,0.9)',
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Arriving ctx={ctx} at={at}>
        <span
          style={{
            fontSize: ctx.unit * 200,
            fontWeight: 900,
            letterSpacing: '-0.05em',
            color: INK,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            textShadow: '0 8px 30px rgba(0,0,0,0.14)',
          }}
        >
          {countUp(frame, at + 5, 18, value)}
        </span>
      </Arriving>
      {label ? (
        <span
          style={{
            fontSize: ctx.unit * 34,
            fontWeight: 700,
            color: DIM,
            letterSpacing: '0.02em',
            opacity: kf(frame, [[at + 8, 0], [at + 18, 1]], easeOutCubic),
          }}
        >
          {label}
        </span>
      ) : null}
      <Plinth ctx={ctx} width={ctx.unit * 200} />
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
  const chip = ctx.unit * 150;

  if (arrange === 'ring') {
    const radius = ringRadius(ctx, ctx.unit * 230);
    const points = ringPoints(items.length, radius);
    return (
      <div style={{ position: 'relative', width: radius * 2, height: radius * 2 }}>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            marginLeft: -chip / 2,
            marginTop: -chip / 2,
            transform: transformOf(popIn(frame, at, 12, 0.5)),
          }}
        >
          <Glyph svg={icons[0] ?? null} size={chip} color={INK} />
        </div>
        {points.map((point, i) => {
          const entry = popIn(frame, at + 6 + stagger(i, 5), 11, 0.45);
          return (
            <div
              key={`${items[i]}-${i}`}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                marginLeft: point.x - chip * 0.35,
                marginTop: point.y - chip * 0.35,
                width: chip * 0.7,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: ctx.unit * 6,
                opacity: entry.opacity,
                transform: transformOf(entry),
              }}
            >
              <Glyph svg={icons[i + 1] ?? null} size={chip * 0.6} color={INK} />
              <span style={{ fontSize: ctx.unit * 22, fontWeight: 700, color: DIM, textAlign: 'center' }}>
                {items[i]}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  // The carousel: each object slides in seven frames behind the last, and the
  // one before it has already stopped. That beat is what makes it read as a
  // sequence of arrivals rather than a group fading up together.
  const horizontal = arrange !== 'column';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: horizontal ? 'row' : 'column',
        alignItems: horizontal ? 'flex-end' : 'center',
        justifyContent: 'center',
        gap: ctx.unit * (arrange === 'duo' ? 70 : 40),
      }}
    >
      {items.map((item, i) => (
        <div key={`${item}-${i}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Arriving ctx={ctx} at={at + stagger(i, 7)}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: ctx.unit * 10 }}>
              <Glyph svg={icons[i] ?? null} size={chip} color={INK} />
              <span
                style={{
                  fontSize: ctx.unit * 32,
                  fontWeight: 800,
                  color: INK,
                  letterSpacing: '-0.02em',
                  textAlign: 'center',
                  maxWidth: chip * 1.8,
                }}
              >
                {item}
              </span>
            </div>
          </Arriving>
          <Plinth ctx={ctx} width={chip * 0.9} />
        </div>
      ))}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: ctx.unit * 16, width: ctx.width * 0.74 }}>
      {items.map((item, i) => {
        const entry = riseIn(frame, at + stagger(i, 5), ctx.unit * 18, 9);
        return (
          <div
            key={`${item}-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: ctx.unit * 18,
              padding: `${ctx.unit * 18}px ${ctx.unit * 24}px`,
              borderRadius: ctx.unit * 18,
              background: 'rgba(255,255,255,0.86)',
              border: '1px solid rgba(0,0,0,0.06)',
              boxShadow: '0 12px 30px rgba(0,0,0,0.08)',
              opacity: entry.opacity,
              transform: transformOf(entry),
            }}
          >
            <Glyph svg={icons[i] ?? null} size={ctx.unit * 52} color={INK} />
            <span style={{ fontSize: ctx.unit * 34, fontWeight: 700, color: INK, letterSpacing: '-0.02em' }}>
              {item}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export const gallery: Look = {
  ...LOOK_META.gallery,
  Ground,
  Title,
  Figure,
  Group,
  Rows,
};
