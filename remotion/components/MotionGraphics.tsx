import React from 'react';
import { interpolate, Easing } from 'remotion';
import type { GraphicElement } from '../../src/lib/edl/types';
import { FONT_FAMILY } from '../lib/fonts';
import { ramp, pop } from '../lib/timing';
import { Chrome, formatCount, type RenderContext } from './Graphics';

/**
 * The graphics whose whole point is the movement.
 *
 * A stat card animates in and then holds still: the card is the content and
 * the entrance is packaging. These are the other kind — the number running up,
 * the ring filling, the bars growing, the ticks landing. The movement IS the
 * content, and it has to finish on the word that earns it, so every one of
 * them is written against `ctx.frame` from its own first frame rather than
 * being handed a finished value to fade in.
 *
 * ── One rule they all obey ──────────────────────────────────────────────
 *
 * Nothing here animates a property that costs a layout or a filter. Bars grow
 * with `scaleY`, not `height`; the underline is a `scaleX`; the ring moves a
 * dash offset; everything else is `transform` and `opacity`. The editor draws
 * these thirty times a second next to a playing video, and the last thing that
 * preview needs is another full-frame repaint — see the film grain in
 * `Overlays.tsx` for what that costs when you get it wrong.
 */

/**
 * Split a bar's label from its value.
 *
 * The director writes these as free text, and it does not write them the same
 * way twice: "Before 20", "This quarter 63K", "Revenue: $1.2M", "Churn 8%".
 * A parser that only took bare digits read "This quarter 63K" as a label with
 * no number, which drew every bar the same height — a chart that is confidently
 * wrong, which is worse than no chart. So the value is the LAST number in the
 * string, its magnitude suffix is honoured, and a currency mark in front of it
 * is ignored.
 */
export function splitLabelled(item: string): {
  label: string;
  /** Real magnitude, for how tall the bar is drawn. */
  value: number;
  /** How it was written, so the readout says "63K" and not "63,000". */
  scale: number;
  unit: string;
} {
  const match = item.match(/^(.*?)[\s:]*[$€£]?\s*(-?[\d][\d.,]*)\s*(k|m|b|bn|%|x)?\s*$/i);
  if (!match || !match[2]) return { label: item.trim(), value: 1, scale: 1, unit: '' };

  const unit = match[3] ?? '';
  const scale = { k: 1e3, m: 1e6, b: 1e9, bn: 1e9 }[unit.toLowerCase()] ?? 1;
  const value = parseFloat(match[2].replace(/,/g, '')) * scale;
  const label = match[1].replace(/[\s:]+$/, '').trim();
  return {
    label: label || item.trim(),
    value: Number.isFinite(value) ? value : 1,
    scale,
    unit,
  };
}

/** A number, running up to what it says, with nothing around it. */
export const Counter: React.FC<{ graphic: GraphicElement; ctx: RenderContext }> = ({ graphic, ctx }) => {
  const target = parseFloat(graphic.text.replace(/[^\d.-]/g, ''));
  const suffix = graphic.text.replace(/^[\d.,\s-]+/, '');
  // Out-cubic: fast at first, then easing into its final value, which is what
  // makes a counter read as arriving somewhere rather than just stopping.
  const run = ramp(ctx.frame, 0, Math.round(ctx.fps * 0.9), Easing.out(Easing.cubic));
  const land = pop(ctx.frame, ctx.fps, Math.round(ctx.fps * 0.9), true);
  const display = Number.isFinite(target) ? formatCount(target * run, target) + suffix : graphic.text;

  return (
    <div style={{ textAlign: 'center', transform: `scale(${1 + land * 0.06})` }}>
      <div
        style={{
          fontFamily: FONT_FAMILY,
          fontSize: ctx.unit * 112,
          fontWeight: 800,
          letterSpacing: '-0.05em',
          lineHeight: 0.95,
          color: graphic.color,
          textShadow: `0 ${ctx.unit * 6}px ${ctx.unit * 28}px rgba(0,0,0,0.55)`,
        }}
      >
        {display}
      </div>
      {graphic.subtext ? (
        <div
          style={{
            marginTop: ctx.unit * 8,
            fontSize: ctx.unit * 28,
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: '#F5F5F7',
          }}
        >
          {graphic.subtext}
        </div>
      ) : null}
    </div>
  );
};

/** A ring that fills to a percentage, with the figure in the middle of it. */
export const ProgressRing: React.FC<{ graphic: GraphicElement; ctx: RenderContext }> = ({ graphic, ctx }) => {
  const pct = Math.max(0, Math.min(100, parseFloat(graphic.text.replace(/[^\d.-]/g, '')) || 0));
  const size = ctx.unit * 260;
  const stroke = ctx.unit * 26;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const run = ramp(ctx.frame, 0, Math.round(ctx.fps * 0.9), Easing.out(Easing.cubic));

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={graphic.color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - (pct / 100) * run)}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: FONT_FAMILY,
          color: '#F5F5F7',
        }}
      >
        <div style={{ fontSize: ctx.unit * 62, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}>
          {Math.round(pct * run)}%
        </div>
        {graphic.subtext ? (
          <div style={{ marginTop: ctx.unit * 4, fontSize: ctx.unit * 20, fontWeight: 600, color: '#A5A5B3' }}>
            {graphic.subtext}
          </div>
        ) : null}
      </div>
    </div>
  );
};

/** Two to four bars, growing from the floor, one after another. */
export const BarChart: React.FC<{ graphic: GraphicElement; ctx: RenderContext }> = ({ graphic, ctx }) => {
  const bars = graphic.items.slice(0, 4).map(splitLabelled);
  const peak = Math.max(1, ...bars.map((b) => Math.abs(b.value)));
  const height = ctx.unit * 230;

  return (
    <Chrome ctx={ctx} accent={graphic.color}>
      {graphic.text ? (
        <div style={{ fontSize: ctx.unit * 26, fontWeight: 700, color: '#F5F5F7' }}>{graphic.text}</div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: ctx.unit * 22, height }}>
        {bars.map((bar, i) => {
          const from = Math.round(ctx.fps * (0.12 + i * 0.12));
          const grow = ramp(ctx.frame, from, from + Math.round(ctx.fps * 0.55), Easing.out(Easing.cubic));
          return (
            <div
              key={i}
              style={{
                // Full height, filled from the bottom. Letting the column be
                // as tall as its contents meant the tallest bar pushed its own
                // readout up through the top of the card and into the heading.
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: ctx.unit * 8,
              }}
            >
              <div style={{ fontSize: ctx.unit * 22, fontWeight: 800, color: graphic.color }}>
                {/* Counted in the units it was written in: "63K", not "63,000". */}
                {formatCount((bar.value / bar.scale) * grow, bar.value / bar.scale) + bar.unit}
              </div>
              <div
                style={{
                  // Full height, scaled from the floor — a growing `height`
                  // would lay the row out again on every frame.
                  width: ctx.unit * 70,
                  height: Math.max(2, (height - ctx.unit * 110) * (Math.abs(bar.value) / peak)),
                  transformOrigin: '50% 100%',
                  transform: `scaleY(${grow})`,
                  borderRadius: ctx.unit * 10,
                  background: i === bars.length - 1
                    ? graphic.color
                    : `color-mix(in srgb, ${graphic.color} 34%, #19191F)`,
                }}
              />
              <div style={{ fontSize: ctx.unit * 19, fontWeight: 600, color: '#A5A5B3', maxWidth: ctx.unit * 90, textAlign: 'center' }}>
                {bar.label}
              </div>
            </div>
          );
        })}
      </div>
    </Chrome>
  );
};

/** Ticks that land one at a time, each with its line. */
export const Checklist: React.FC<{ graphic: GraphicElement; ctx: RenderContext }> = ({ graphic, ctx }) => {
  const items = graphic.items.slice(0, 5);
  const box = ctx.unit * 34;

  return (
    <Chrome ctx={ctx} accent={graphic.color}>
      {graphic.text ? (
        <div style={{ fontSize: ctx.unit * 26, fontWeight: 700, color: '#F5F5F7', marginBottom: ctx.unit * 4 }}>
          {graphic.text}
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: ctx.unit * 14, alignItems: 'flex-start' }}>
        {items.map((item, i) => {
          const from = Math.round(ctx.fps * (0.1 + i * 0.22));
          const enter = pop(ctx.frame, ctx.fps, from, true);
          const draw = ramp(ctx.frame, from + 2, from + Math.round(ctx.fps * 0.28));
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: ctx.unit * 14,
                opacity: enter,
                transform: `translateX(${(1 - enter) * ctx.unit * 26}px)`,
              }}
            >
              <svg width={box} height={box} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="none" stroke={graphic.color} strokeWidth="2" opacity="0.5" />
                <path
                  d="M6.5 12.5l3.6 3.6L17.5 8.5"
                  fill="none"
                  stroke={graphic.color}
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  // 17 is roughly the drawn length of that path; the dash walks
                  // along it so the tick is written rather than switched on.
                  strokeDasharray={17}
                  strokeDashoffset={17 * (1 - draw)}
                />
              </svg>
              <span
                style={{
                  fontSize: ctx.unit * 26,
                  fontWeight: 600,
                  color: '#F5F5F7',
                  // Left, so the lines start where the ticks do. Centred text
                  // beside a fixed column of boxes leaves a ragged edge that
                  // reads as a mistake.
                  textAlign: 'left',
                  maxWidth: ctx.unit * 300,
                }}
              >
                {item}
              </span>
            </div>
          );
        })}
      </div>
    </Chrome>
  );
};

/** A pill that snaps in and settles. */
export const Badge: React.FC<{ graphic: GraphicElement; ctx: RenderContext }> = ({ graphic, ctx }) => {
  const enter = pop(ctx.frame, ctx.fps, 0, true);
  const tilt = interpolate(enter, [0, 1], [-8, 0], { extrapolateRight: 'clamp' });

  return (
    <div
      style={{
        fontFamily: FONT_FAMILY,
        display: 'inline-flex',
        alignItems: 'center',
        gap: ctx.unit * 10,
        padding: `${ctx.unit * 14}px ${ctx.unit * 30}px`,
        borderRadius: 999,
        background: graphic.color,
        color: '#0D0D10',
        fontSize: ctx.unit * 34,
        fontWeight: 800,
        letterSpacing: '0.02em',
        textTransform: 'uppercase',
        boxShadow: `0 ${ctx.unit * 14}px ${ctx.unit * 40}px -${ctx.unit * 12}px ${graphic.color}`,
        transform: `scale(${enter}) rotate(${tilt}deg)`,
      }}
    >
      {graphic.text}
    </div>
  );
};

/** A stroke drawn under whatever it is pointed at. */
export const Underline: React.FC<{ graphic: GraphicElement; ctx: RenderContext }> = ({ graphic, ctx }) => {
  const draw = ramp(ctx.frame, 0, Math.round(ctx.fps * 0.45), Easing.out(Easing.cubic));
  const width = ctx.unit * 420;

  return (
    <div style={{ width, textAlign: 'center' }}>
      {graphic.text ? (
        <div
          style={{
            fontFamily: FONT_FAMILY,
            fontSize: ctx.unit * 30,
            fontWeight: 700,
            color: '#F5F5F7',
            marginBottom: ctx.unit * 8,
          }}
        >
          {graphic.text}
        </div>
      ) : null}
      <div
        style={{
          height: ctx.unit * 12,
          borderRadius: 999,
          background: graphic.color,
          transformOrigin: '0% 50%',
          transform: `scaleX(${draw})`,
          boxShadow: `0 0 ${ctx.unit * 22}px ${graphic.color}`,
        }}
      />
    </div>
  );
};
