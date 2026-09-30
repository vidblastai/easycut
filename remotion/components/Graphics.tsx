import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { FONT_FAMILY } from '../lib/fonts';
import type { Edl, GraphicElement } from '../../src/lib/edl/types';
import { Badge, BarChart, Checklist, Counter, ProgressRing, Underline } from './MotionGraphics';
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
          // No `layout="none"`: in the Player a Sequence that lays itself out is
          // premounted a second early, so a graphic's image is decoded and its
          // text laid out before the frame it cuts in on — which is usually a
          // cut, where there is no budget left to do it.
          <Sequence key={graphic.id} from={from} durationInFrames={durationInFrames}>
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
  // Overshoot for the entrances that are meant to land with weight; a linear
  // ease for the ones that are meant to arrive quietly.
  const springy = ['pop', 'spin-in', 'bounce', 'pulse'].includes(graphic.animation);
  const entry = pop(frame, fps, 0, springy);
  const unit = height * 0.001; // one "unit" scales layout across aspect ratios

  const enterTransform = (() => {
    switch (graphic.animation) {
      case 'slide-up':
        return `translateY(${(1 - entry) * height * 0.06}px) scale(${0.96 + entry * 0.04})`;
      case 'slide-left':
        return `translateX(${(1 - entry) * width * 0.06}px)`;
      case 'fade':
        // Empty, NOT `none`. This string is concatenated into a longer
        // `transform`, and `none` is only legal as the whole value — so
        // `translate(-50%,-50%) none scale(1)` is invalid, the browser throws
        // the entire declaration away, and the graphic loses its centring and
        // renders off the side of the frame. It fails silently and only for
        // the animations that have nothing to add.
        return '';
      case 'spin-in':
        // A flat pop makes an icon read as a sticker dropped on the frame; a
        // little rotation on the way in makes it read as arriving.
        return `scale(${0.6 + entry * 0.4}) rotate(${(1 - entry) * -140}deg)`;
      case 'bounce':
        return `translateY(${(1 - entry) * height * 0.09}px) scale(${0.88 + entry * 0.12})`;
      case 'pulse': {
        // Lands, holds, then breathes once — the second beat is what brings
        // the eye back to it after it has read the words.
        const beat = Math.sin(Math.max(0, (frame - fps * 0.9) / fps) * Math.PI * 2.2);
        const breathe = frame > fps * 0.9 ? 1 + Math.max(0, beat) * 0.05 : 1;
        return `scale(${(0.7 + entry * 0.3) * breathe})`;
      }
      case 'wipe':
        return `scale(${0.98 + entry * 0.02})`;
      default:
        return `scale(${0.7 + entry * 0.3})`;
    }
  })();

  // `wipe` is the one entrance that is a reveal rather than a move.
  const clip = graphic.animation === 'wipe' ? `inset(0 ${(1 - entry) * 100}% 0 0)` : undefined;

  return (
    <AbsoluteFill style={{ opacity, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: `${graphic.x * 100}%`,
          top: `${graphic.y * 100}%`,
          transform: `translate(-50%, -50%) ${enterTransform} scale(${graphic.scale})`.replace(/\s+/g, ' '),
          transformOrigin: 'center center',
          clipPath: clip,
          fontFamily: FONT_FAMILY,
          color: '#F5F5F7',
          textAlign: 'center',
          /*
           * As wide as its position allows, not a flat 80% of the frame.
           *
           * The box is centred on `x`, so it reaches `x` either way — a
           * graphic parked out in the side margin of a widescreen frame at
           * x=0.79 has only 21% of the width to its right, and a flat 80%
           * maxWidth let it run off the edge. Doubling the smaller side is
           * what keeps it inside the picture wherever it has been put, and it
           * still leaves a centred graphic the 80% it always had.
           */
          maxWidth: Math.min(width * 0.8, 2 * Math.min(graphic.x, 1 - graphic.x) * width * 0.92),
        }}
      >
        {renderBody(graphic, { frame, fps, unit, durationInFrames, edl })}
      </div>
    </AbsoluteFill>
  );
};

export interface RenderContext {
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
    case 'counter':
      return <Counter graphic={graphic} ctx={ctx} />;
    case 'progress-ring':
      return <ProgressRing graphic={graphic} ctx={ctx} />;
    case 'bar-chart':
      return <BarChart graphic={graphic} ctx={ctx} />;
    case 'checklist':
      return <Checklist graphic={graphic} ctx={ctx} />;
    case 'badge':
      return <Badge graphic={graphic} ctx={ctx} />;
    case 'underline':
      return <Underline graphic={graphic} ctx={ctx} />;
    case 'icon':
    default:
      return <IconChip graphic={graphic} ctx={ctx} />;
  }
}

/* ------------------------------------------------------------------ parts */

export const Chrome: React.FC<{ ctx: RenderContext; accent: string; children: React.ReactNode }> = ({ ctx, accent, children }) => (
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
      // No backdrop filter: the plate behind it is already 92% opaque, so the
      // blur was invisible and the per-frame readback it costs was not.

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

export function formatCount(value: number, target: number): string {
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
