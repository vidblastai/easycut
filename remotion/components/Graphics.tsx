import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { FONT_FAMILY } from '../lib/fonts';
import type { Edl, GraphicElement } from '../../src/lib/edl/types';
import { lifecycleOpacity, pop, ramp } from '../lib/timing';

/**
 * Motion graphics: icons, stat cards, building lists, title cards, quotes and
 * pointer arrows.
 *
 * Everything is drawn from data and animated with the shared motion helpers —
 * no per-graphic bespoke code, so a new graphic type is a switch case and a
 * layout, not a new animation system.
 */
export const Graphics: React.FC<{ edl: Edl }> = ({ edl }) => {
  const { fps } = useVideoConfig();

  return (
    <>
      {edl.graphics.map((graphic) => {
        const from = Math.round(graphic.outStartSec * fps);
        const durationInFrames = Math.max(1, Math.round((graphic.outEndSec - graphic.outStartSec) * fps));
        return (
          <Sequence key={graphic.id} from={from} durationInFrames={durationInFrames} layout="none">
            <GraphicElementView graphic={graphic} durationInFrames={durationInFrames} edl={edl} />
          </Sequence>
        );
      })}
    </>
  );
};

const GraphicElementView: React.FC<{ graphic: GraphicElement; durationInFrames: number; edl: Edl }> = ({
  graphic,
  durationInFrames,
  edl,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const opacity = lifecycleOpacity(frame, durationInFrames, Math.round(fps * 0.2));
  const entry = pop(frame, fps, 0, graphic.animation === 'pop');
  const unit = height * 0.001; // one "unit" scales layout across aspect ratios

  const enterTransform = (() => {
    switch (graphic.animation) {
      case 'slide-up':
        return `translateY(${(1 - entry) * height * 0.06}px) scale(${0.96 + entry * 0.04})`;
      case 'slide-left':
        return `translateX(${(1 - entry) * width * 0.06}px)`;
      case 'fade':
        return 'none';
      default:
        return `scale(${0.7 + entry * 0.3})`;
    }
  })();

  return (
    <AbsoluteFill style={{ opacity, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: `${graphic.x * 100}%`,
          top: `${graphic.y * 100}%`,
          transform: `translate(-50%, -50%) ${enterTransform} scale(${graphic.scale})`,
          transformOrigin: 'center center',
          fontFamily: FONT_FAMILY,
          color: '#F5F5F7',
          textAlign: 'center',
          maxWidth: width * 0.8,
        }}
      >
        {renderBody(graphic, { frame, fps, unit, durationInFrames, edl })}
      </div>
    </AbsoluteFill>
  );
};

interface RenderContext {
  frame: number;
  fps: number;
  unit: number;
  durationInFrames: number;
  edl: Edl;
}

function renderBody(graphic: GraphicElement, ctx: RenderContext): React.ReactNode {
  switch (graphic.type) {
    case 'stat':
      return <StatCard graphic={graphic} ctx={ctx} />;
    case 'list':
      return <ListBuild graphic={graphic} ctx={ctx} />;
    case 'title-card':
      return <TitleCard graphic={graphic} ctx={ctx} />;
    case 'quote':
      return <QuoteCard graphic={graphic} ctx={ctx} />;
    case 'arrow':
      return <Arrow graphic={graphic} ctx={ctx} />;
    case 'image':
      return graphic.assetUrl ? (
        <Img
          src={graphic.assetUrl}
          style={{ width: ctx.unit * 460, borderRadius: ctx.unit * 22, boxShadow: '0 30px 80px -30px rgba(0,0,0,0.9)' }}
        />
      ) : null;
    case 'icon':
    default:
      return <IconChip graphic={graphic} ctx={ctx} />;
  }
}

/* ------------------------------------------------------------------ parts */

const Chrome: React.FC<{ ctx: RenderContext; accent: string; children: React.ReactNode }> = ({ ctx, accent, children }) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: ctx.unit * 10,
      padding: `${ctx.unit * 26}px ${ctx.unit * 34}px`,
      background: 'rgba(25,25,31,0.92)',
      border: `${Math.max(1, ctx.unit * 1.6)}px solid ${accent}55`,
      borderRadius: ctx.unit * 22,
      backdropFilter: 'blur(12px)',
      boxShadow: `0 30px 90px -35px rgba(0,0,0,0.95), 0 0 0 ${ctx.unit * 1}px rgba(255,255,255,0.03) inset`,
    }}
  >
    {children}
  </div>
);

const IconChip: React.FC<{ graphic: GraphicElement; ctx: RenderContext }> = ({ graphic, ctx }) => (
  <Chrome ctx={ctx} accent={graphic.color}>
    {graphic.assetUrl ? (
      <Img src={graphic.assetUrl} style={{ width: ctx.unit * 86, height: ctx.unit * 86 }} />
    ) : null}
    {graphic.text ? (
      <div style={{ fontSize: ctx.unit * 30, fontWeight: 700, letterSpacing: '-0.02em', textTransform: 'capitalize' }}>
        {graphic.text}
      </div>
    ) : null}
  </Chrome>
);

/** The number counts up — a static figure has no reason to be animated at all. */
const StatCard: React.FC<{ graphic: GraphicElement; ctx: RenderContext }> = ({ graphic, ctx }) => {
  const numeric = parseFloat(graphic.text.replace(/[^\d.-]/g, ''));
  const suffix = graphic.text.replace(/^[\d.,\s-]+/, '');
  const progress = ramp(ctx.frame, 0, Math.round(ctx.fps * 0.7));
  const display = Number.isFinite(numeric)
    ? formatCount(numeric * progress, numeric) + suffix
    : graphic.text;

  return (
    <Chrome ctx={ctx} accent={graphic.color}>
      <div
        style={{
          fontSize: ctx.unit * 92,
          fontWeight: 800,
          letterSpacing: '-0.04em',
          color: graphic.color,
          lineHeight: 1,
        }}
      >
        {display}
      </div>
      {graphic.subtext ? (
        <div style={{ fontSize: ctx.unit * 24, fontWeight: 500, color: '#A5A5B3', maxWidth: ctx.unit * 420 }}>
          {graphic.subtext}
        </div>
      ) : null}
    </Chrome>
  );
};

function formatCount(value: number, target: number): string {
  const decimals = Number.isInteger(target) ? 0 : 1;
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Items land one at a time, spread across the element's life. */
const ListBuild: React.FC<{ graphic: GraphicElement; ctx: RenderContext }> = ({ graphic, ctx }) => {
  const items = graphic.items.length ? graphic.items : graphic.text ? [graphic.text] : [];
  const stagger = Math.min(ctx.fps * 0.34, (ctx.durationInFrames * 0.55) / Math.max(1, items.length));

  return (
    <Chrome ctx={ctx} accent={graphic.color}>
      {graphic.text && graphic.items.length ? (
        <div style={{ fontSize: ctx.unit * 26, fontWeight: 700, color: '#A5A5B3', marginBottom: ctx.unit * 6 }}>
          {graphic.text}
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: ctx.unit * 14, alignItems: 'flex-start' }}>
        {items.map((item, index) => {
          const s = pop(ctx.frame, ctx.fps, index * stagger);
          return (
            <div
              key={index}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: ctx.unit * 14,
                opacity: Math.min(1, s * 1.5),
                transform: `translateX(${(1 - s) * ctx.unit * 26}px)`,
              }}
            >
              <div
                style={{
                  width: ctx.unit * 12,
                  height: ctx.unit * 12,
                  borderRadius: 99,
                  background: graphic.color,
                  flexShrink: 0,
                }}
              />
              <div style={{ fontSize: ctx.unit * 30, fontWeight: 600, letterSpacing: '-0.02em', textAlign: 'left' }}>
                {item}
              </div>
            </div>
          );
        })}
      </div>
    </Chrome>
  );
};

const TitleCard: React.FC<{ graphic: GraphicElement; ctx: RenderContext }> = ({ graphic, ctx }) => {
  const line = interpolate(ctx.frame, [ctx.fps * 0.25, ctx.fps * 0.8], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: ctx.unit * 18 }}>
      <div
        style={{
          fontSize: ctx.unit * 62,
          fontWeight: 800,
          letterSpacing: '-0.035em',
          lineHeight: 1.08,
          textShadow: '0 10px 50px rgba(0,0,0,0.8)',
        }}
      >
        {graphic.text}
      </div>
      <div style={{ height: ctx.unit * 5, width: `${line * 100}%`, maxWidth: ctx.unit * 340, background: graphic.color, borderRadius: 99 }} />
      {graphic.subtext ? (
        <div style={{ fontSize: ctx.unit * 26, color: '#A5A5B3', fontWeight: 500 }}>{graphic.subtext}</div>
      ) : null}
    </div>
  );
};

const QuoteCard: React.FC<{ graphic: GraphicElement; ctx: RenderContext }> = ({ graphic, ctx }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: ctx.unit * 12 }}>
    <div style={{ fontSize: ctx.unit * 90, color: graphic.color, lineHeight: 0.6, fontWeight: 800 }}>&ldquo;</div>
    <div
      style={{
        fontSize: ctx.unit * 40,
        fontWeight: 700,
        letterSpacing: '-0.03em',
        lineHeight: 1.22,
        textShadow: '0 8px 40px rgba(0,0,0,0.85)',
      }}
    >
      {graphic.text}
    </div>
  </div>
);

/** A hand-drawn-feeling pointer: the line draws itself, then the head appears. */
const Arrow: React.FC<{ graphic: GraphicElement; ctx: RenderContext }> = ({ graphic, ctx }) => {
  const draw = ramp(ctx.frame, 0, Math.round(ctx.fps * 0.45));
  const size = ctx.unit * 200;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: ctx.unit * 8 }}>
      <svg width={size} height={size * 0.6} viewBox="0 0 200 120" fill="none">
        <path
          d="M10 100 C 60 100, 120 90, 170 30"
          stroke={graphic.color}
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={220}
          strokeDashoffset={220 * (1 - draw)}
        />
        <path
          d="M170 30 L 146 44 M170 30 L 168 58"
          stroke={graphic.color}
          strokeWidth={9}
          strokeLinecap="round"
          opacity={draw > 0.85 ? 1 : 0}
        />
      </svg>
      {graphic.text ? (
        <div style={{ fontSize: ctx.unit * 28, fontWeight: 700, color: graphic.color }}>{graphic.text}</div>
      ) : null}
    </div>
  );
};
