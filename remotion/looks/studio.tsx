import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { LOOK_META } from '../../src/lib/scenes/looks';
import type { Look, LookContext } from './contract';
import { Glyph, ringPoints, ringRadius, wordGroups } from './contract';
import { countUp, drawOn, easeOutCubic, kf, popIn, riseIn, stagger, transformOf } from '../lib/motion';

/**
 * `studio` — the clean product-UI world.
 *
 * Modelled frame by frame on the first reference edit. What makes that edit
 * read as real screen recording rather than as motion graphics is a single
 * discipline: **nothing slides in from off-frame.** Elements grow, in place,
 * out of the thing that was already there. A pill widens to admit an avatar,
 * then the pill itself becomes a card, then rows fill it.
 *
 * Three measured numbers carry the whole look and are worth not tuning by
 * feel: the stagger is four frames, the pill→card morph is fourteen, and the
 * second pass (badges, sub-labels) starts eight frames after the row it
 * belongs to. Everything else follows from those.
 */

const INK = '#0D0D10';
const DIM = '#8A8A96';
const CARD = '#FFFFFF';
const LINE = '#EBEBF0';
const GROUND = '#FCFCFD';

/** The card chrome every slot in this look sits in. */
const surface = (radius: number): React.CSSProperties => ({
  background: CARD,
  border: `1px solid ${LINE}`,
  borderRadius: radius,
  boxShadow: '0 18px 44px rgba(13,13,16,0.07), 0 2px 6px rgba(13,13,16,0.04)',
});

const Ground: React.FC<{ ctx: LookContext }> = ({ ctx }) => {
  const frame = useCurrentFrame();
  const cell = ctx.unit * 34;
  // Oversized and slid, so the pattern keeps moving without ever being
  // re-tiled and without showing an edge.
  const slide = (frame * 0.12) % cell;

  return (
    <AbsoluteFill style={{ background: GROUND, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: `-${cell * 2}px`,
          backgroundImage: `radial-gradient(circle, rgba(13,13,16,0.10) 1.4px, transparent 1.5px)`,
          backgroundSize: `${cell}px ${cell}px`,
          transform: `translate3d(${slide}px, ${slide * 0.6}px, 0)`,
        }}
      />
      {/* The colour in this world arrives as one soft bled glow, never as a
          filled background — a tinted ground would stop it reading as UI. */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '54%',
          width: ctx.unit * 620,
          height: ctx.unit * 620,
          marginLeft: ctx.unit * -310,
          marginTop: ctx.unit * -310,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${ctx.scene.accent}2E 0%, transparent 62%)`,
          transform: `scale(${1 + Math.sin(frame / 40) * 0.04})`,
        }}
      />
    </AbsoluteFill>
  );
};

const Title: React.FC<{ ctx: LookContext; text: string; at: number; hero?: boolean }> = ({ ctx, text, at, hero }) => {
  const frame = useCurrentFrame();
  const groups = wordGroups(text);
  const size = hero ? ctx.unit * 82 : ctx.unit * 40;
  // The underline is drawn on after the last word has landed, the way someone
  // marking up a page would do it.
  const lastLanded = at + stagger(groups.length - 1) + 9;
  /*
   * Sized off the LONGEST LINE, not the whole string.
   *
   * A headline that wraps to three lines is nowhere near as wide as its
   * character count suggests, and scaling the rule by the full length is how
   * it ended up running off the left edge of the frame. Capped to the text
   * column either way.
   */
  const longest = groups.reduce((most, word) => Math.max(most, word.length), 0);
  const width = Math.min(ctx.width * 0.8, ctx.unit * 34 * Math.max(6, Math.min(18, longest + 4)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: ctx.unit * 6 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          // In ems, not units: the gap between words IS the space between them,
          // and a fixed pixel gap reads as a double space at small sizes.
          gap: `${ctx.unit * 4}px 0.28em`,
          maxWidth: ctx.width * 0.82,
        }}
      >
        {groups.map((word, i) => {
          const entry = riseIn(frame, at + stagger(i), ctx.unit * 22);
          return (
            <span
              key={`${word}-${i}`}
              style={{
                fontSize: size,
                fontWeight: 800,
                letterSpacing: '-0.035em',
                lineHeight: 1.05,
                color: INK,
                opacity: entry.opacity,
                transform: transformOf(entry),
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
      {hero ? (
        <svg width={width} height={ctx.unit * 22} viewBox={`0 0 ${width} 24`} style={{ overflow: 'visible' }}>
          <path
            d={`M4 15 Q ${width / 2} 3 ${width - 4} 13`}
            fill="none"
            stroke={ctx.scene.accent}
            strokeWidth={ctx.unit * 5}
            strokeLinecap="round"
            strokeDasharray={width}
            strokeDashoffset={drawOn(frame, lastLanded, 11, width)}
          />
        </svg>
      ) : null}
    </div>
  );
};

const Figure: React.FC<{ ctx: LookContext; value: string; label: string; at: number }> = ({ ctx, value, label, at }) => {
  const frame = useCurrentFrame();
  const entry = popIn(frame, at, 12, 0.82);
  const dial = kf(frame, [[at + 4, 0], [at + 26, 1]], easeOutCubic);
  const size = ctx.unit * 300;

  return (
    <div
      style={{
        ...surface(size / 2),
        width: size,
        height: size,
        // Without this the inner face below positions itself against the whole
        // frame — which is what turned a 576px dial into a full-screen white
        // rectangle, and is invisible in the diff.
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: ctx.unit * 6,
        opacity: entry.opacity,
        transform: transformOf(entry),
        // A conic ring reads as a progress dial without a second element, and
        // it is painted once — the sweep is a stop position, not a repaint.
        backgroundImage: `conic-gradient(${ctx.scene.accent} ${dial * 360}deg, ${LINE} 0deg)`,
        padding: ctx.unit * 14,
      }}
    >
      <div
        style={{
          ...surface(size / 2),
          position: 'absolute',
          inset: ctx.unit * 14,
          boxShadow: 'none',
        }}
      />
      <span
        style={{
          position: 'relative',
          fontSize: ctx.unit * 86,
          fontWeight: 800,
          letterSpacing: '-0.04em',
          color: INK,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {countUp(frame, at + 2, 22, value)}
      </span>
      {label ? (
        <span style={{ position: 'relative', fontSize: ctx.unit * 26, color: DIM, fontWeight: 600 }}>{label}</span>
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
  const chip = ctx.unit * 96;

  if (arrange === 'ring') {
    const radius = ringRadius(ctx, ctx.unit * 230);
    const points = ringPoints(items.length, radius);
    return (
      <div style={{ position: 'relative', width: radius * 2, height: radius * 2 }}>
        {/* Rings expand out of the centre, each two frames behind the last and
            each fading as it grows — the reference's radar build. */}
        {[0, 1, 2, 3].map((i) => {
          const t = kf(frame, [[at + i * 2, 0], [at + i * 2 + 20, 1]], easeOutCubic);
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                border: `1px solid ${ctx.scene.accent}`,
                opacity: (1 - t) * 0.5,
                transform: `scale(${0.22 + t * 0.82})`,
              }}
            />
          );
        })}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: chip * 1.5,
            height: chip * 1.5,
            marginLeft: chip * -0.75,
            marginTop: chip * -0.75,
            borderRadius: '50%',
            background: ctx.scene.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: transformOf(popIn(frame, at, 10, 0.3)),
            opacity: popIn(frame, at, 10, 0.3).opacity,
          }}
        >
          {icons[0] ? <Glyph svg={icons[0]} size={chip * 0.8} color="#FFFFFF" /> : null}
        </div>
        {points.map((point, i) => {
          const entry = popIn(frame, at + 8 + stagger(i, 5), 10, 0.4);
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
                gap: ctx.unit * 6,
                opacity: entry.opacity,
                transform: transformOf(entry),
              }}
            >
              <div
                style={{
                  width: chip,
                  height: chip,
                  borderRadius: '50%',
                  background: CARD,
                  border: `1px solid ${LINE}`,
                  boxShadow: '0 10px 24px rgba(13,13,16,0.10)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Glyph svg={icons[i + 1] ?? null} size={chip * 0.52} color={ctx.scene.accent} />
              </div>
              <span style={{ fontSize: ctx.unit * 22, color: DIM, fontWeight: 600, textAlign: 'center' }}>
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
        justifyContent: 'center',
        gap: ctx.unit * (arrange === 'duo' ? 54 : 30),
      }}
    >
      {items.map((item, i) => {
        const entry = popIn(frame, at + stagger(i), 11, 0.66);
        return (
          <div
            key={`${item}-${i}`}
            style={{
              ...surface(ctx.unit * 26),
              padding: `${ctx.unit * 26}px ${ctx.unit * 30}px`,
              minWidth: arrange === 'duo' ? ctx.width * 0.34 : undefined,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: ctx.unit * 14,
              opacity: entry.opacity,
              transform: transformOf(entry),
            }}
          >
            <div
              style={{
                width: chip * 0.8,
                height: chip * 0.8,
                borderRadius: '50%',
                background: `${ctx.scene.accent}1A`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Glyph svg={icons[i] ?? null} size={chip * 0.44} color={ctx.scene.accent} />
            </div>
            <span
              style={{
                fontSize: ctx.unit * 30,
                fontWeight: 700,
                color: INK,
                textAlign: 'center',
                letterSpacing: '-0.02em',
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

/**
 * The reference's signature move: a pill that becomes a list.
 *
 * Width, height and radius all travel on the same fourteen-frame curve, so the
 * card is never momentarily the wrong shape, and the rows only begin once the
 * shape has arrived. Badges are a second pass eight frames behind their row.
 */
const Rows: React.FC<{ ctx: LookContext; items: string[]; icons: Array<string | null>; at: number }> = ({
  ctx,
  items,
  icons,
  at,
}) => {
  const frame = useCurrentFrame();
  const morph = kf(frame, [[at, 0], [at + 14, 1]], easeOutCubic);
  const rowsAt = at + 14;

  const pillWidth = ctx.unit * 330;
  const cardWidth = Math.min(ctx.width * 0.78, ctx.unit * 720);
  const rowHeight = ctx.unit * 84;

  return (
    <div
      style={{
        ...surface(ctx.unit * (44 - 26 * morph)),
        width: pillWidth + (cardWidth - pillWidth) * morph,
        padding: ctx.unit * 22,
        display: 'flex',
        flexDirection: 'column',
        gap: ctx.unit * 10,
        overflow: 'hidden',
        opacity: popIn(frame, at, 10, 0.8).opacity,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: ctx.unit * 12, padding: `0 ${ctx.unit * 8}px` }}>
        <Glyph svg={icons[0] ?? null} size={ctx.unit * 32} color={INK} />
        <span style={{ fontSize: ctx.unit * 32, fontWeight: 700, color: INK, letterSpacing: '-0.02em' }}>
          {ctx.scene.headline || 'overview'}
        </span>
      </div>
      <div style={{ height: rowHeight * items.length * morph, overflow: 'hidden' }}>
        {items.map((item, i) => {
          const entry = riseIn(frame, rowsAt + stagger(i), ctx.unit * 14, 9);
          const badge = riseIn(frame, rowsAt + stagger(i) + 8, ctx.unit * 6, 8);
          return (
            <div
              key={`${item}-${i}`}
              style={{
                height: rowHeight,
                display: 'flex',
                alignItems: 'center',
                gap: ctx.unit * 16,
                padding: `0 ${ctx.unit * 8}px`,
                opacity: entry.opacity,
                transform: transformOf(entry),
              }}
            >
              <div
                style={{
                  width: ctx.unit * 52,
                  height: ctx.unit * 52,
                  borderRadius: '50%',
                  background: `${ctx.scene.accent}22`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Glyph svg={icons[i + 1] ?? null} size={ctx.unit * 28} color={ctx.scene.accent} />
              </div>
              <span
                style={{
                  fontSize: ctx.unit * 30,
                  fontWeight: 600,
                  color: INK,
                  letterSpacing: '-0.02em',
                  flex: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {item}
              </span>
              <span
                style={{
                  fontSize: ctx.unit * 20,
                  fontWeight: 700,
                  color: ctx.scene.accent,
                  background: `${ctx.scene.accent}16`,
                  borderRadius: ctx.unit * 10,
                  padding: `${ctx.unit * 6}px ${ctx.unit * 14}px`,
                  opacity: badge.opacity,
                  transform: transformOf(badge),
                  flexShrink: 0,
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const studio: Look = {
  ...LOOK_META.studio,
  Ground,
  Title,
  Figure,
  Group,
  Rows,
};
