import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { layoutPlanFor } from '../../src/lib/styles/layouts';
import { Illustration, type Art } from './Illustration';
import { panelIsDrawn, type Edl, type PanelScene } from '../../src/lib/edl/types';
import { easeOutExpo, easeOutQuint, kf, stagger } from '../lib/motion';

/**
 * The explainer panel — the top 42.5% of the frame, above the speaker.
 *
 * ── What this is, measured rather than imagined ─────────────────────────
 *
 * Two reference edits, 87 seconds, 2620 frames read one at a time. Both are
 * the same machine:
 *
 *   - the speaker never leaves, except for one full-frame stretch early on
 *   - the panel above them changes every 1.3 to 2.5 seconds
 *   - every panel scene is a MOCK OF A REAL INTERFACE or a real measurement —
 *     an insights card, a file list, a comment thread, a counter
 *   - every one carries a two-part eyebrow ("DIE ZAHLEN · AUS DEINEN REELS")
 *     and most carry a dark chip underneath that arrives a beat late
 *   - scenes change on a blur-and-fade, never a cut
 *
 * That is the whole format, and the reason it works is worth stating: the
 * viewer believes a claim about a product when they are looking at the
 * product. A drawn icon of a chart says "statistics"; a card that counts
 * 0 → 19.718 while the voice says the number says the thing happened.
 *
 * ── Why it is not a scene ───────────────────────────────────────────────
 *
 * `Scenes` takes the frame away for two to six seconds. This never does. It
 * is a permanent strip, it is never empty, and it changes twenty times in a
 * forty-second video — which no full-frame device could, because twenty
 * cutaways in forty seconds is not an edit, it is a seizure.
 */

/* ------------------------------------------------------------------ chrome */

const GROUND = '#F1F1F3';
const CARD = '#FFFFFF';
const LINE = '#E4E4E9';
const INK = '#15151A';
const MUTED = '#8C8C98';
const GREEN = '#2E9E5B';

/** Frames the blur-and-fade takes at each end. */
const FADE = 7;

/**
 * Every size in here is a number of pixels worked out from the panel's own
 * height, and that is not a style preference — it is the bug this component
 * shipped with.
 *
 * A CSS percentage on `font-size` is a percentage of the PARENT's font size,
 * not of the box, so `fontSize: '4.6%'` against an inherited 16px is 0.7px.
 * Written as percentages the whole panel rendered as a diagram of itself at
 * about a tenth scale and every number in the file was wrong in the same
 * invisible way. Pixels off `u` cannot drift like that, and they still scale
 * with the frame, because `u` comes from the frame.
 */
export const Panel: React.FC<{ edl: Edl }> = ({ edl }) => {
  /*
   * The CANVAS's size, never `edl.format`.
   *
   * They are not the same. The editor composes the preview on a smaller
   * canvas so a browser can keep up — a 1080×1920 export previews at
   * 360×640 — and every size in this file is a multiple of `u`. Measured off
   * the document, `u` came out three times too big inside a box three times
   * too small, so the eyebrow ran off both edges of the panel and the two
   * tiles of a toggle-pair hung over the sides of the frame. It rendered
   * perfectly at export resolution, which is why it survived a review: the
   * only place it was wrong was the only place anybody looks at it.
   *
   * `VideoTrack` carries the same warning for the same reason.
   */
  const { fps, width: canvasWidth, height: canvasHeight } = useVideoConfig();
  const plan = layoutPlanFor(edl);
  const region = plan.panel;
  if (!region || !edl.panel.length) return null;

  const accent = edl.captionStyle.emphasisColor || '#C96442';
  /** A hundredth of the panel's height, in pixels. Every size is a multiple. */
  const u = (canvasHeight * region.h) / 100;
  const pw = canvasWidth * region.w;
  const ph = canvasHeight * region.h;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: `${region.x * 100}%`,
          top: `${region.y * 100}%`,
          width: `${region.w * 100}%`,
          height: `${region.h * 100}%`,
          background: GROUND,
          overflow: 'hidden',
        }}
      >
        {edl.panel.map((scene) => {
          const from = Math.round(scene.outStartSec * fps);
          const frames = Math.max(1, Math.round((scene.outEndSec - scene.outStartSec) * fps));
          return (
            <Sequence key={scene.id} from={from} durationInFrames={frames} layout="none">
              <Stage scene={scene} frames={frames} accent={accent} u={u} pw={pw} ph={ph} />
            </Sequence>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------- stage */

/**
 * The eyebrow, the body and the chip, and the blur that joins one scene to
 * the next.
 *
 * The blur is a `filter` on a full-width element, which the house rule says
 * no to — the exemption is the one `photo-hero` already has. It runs for
 * seven frames at each end of a two-second scene and the radius is zero for
 * everything in between, so the layer is rasterised once and never again. A
 * cut here would be wrong, and it is wrong for a specific reason: the panel
 * is a surface the viewer is reading, and a surface that cuts reads as a
 * different video rather than as the next exhibit.
 */
const Stage: React.FC<{
  scene: PanelScene;
  frames: number;
  accent: string;
  u: number;
  pw: number;
  ph: number;
}> = ({ scene, frames, accent, u, pw, ph }) => {
  const frame = useCurrentFrame();
  const enter = kf(frame, [[0, 0], [FADE, 1]], easeOutQuint);
  const leave = kf(frame, [[frames - FADE, 1], [frames, 0]], easeOutQuint);
  const life = Math.min(enter, leave);
  const blur = (1 - life) * u * 0.9;
  /** A hero fills the strip, so the label and the chip sit on a photograph. */
  const overImage = scene.kind === 'hero-image' && Boolean(scene.imageUrl);

  return (
    <AbsoluteFill
      style={{
        opacity: life,
        filter: blur > 0.3 ? `blur(${blur.toFixed(2)}px)` : undefined,
        transform: `scale(${1 + (1 - enter) * 0.03})`,
      }}
    >
      {/* A hero fills the whole strip — the eyebrow and the chip then sit ON
          the picture, which is what the reference does with its crowd and its
          brain shots. Contained inside the body box it reads as a stock photo
          dropped into a slide. */}
      {scene.kind === 'hero-image' && scene.imageUrl ? (
        <HeroFill scene={scene} frame={frame} frames={frames} />
      ) : null}
      {/*
        A drawing is the exhibit, so it takes the whole strip rather than
        sitting in the body box — the eyebrow and the chip then ride ON it,
        which is what the reference edits do with their generated frames. It
        goes UNDER the eyebrow for that reason.

        Behind the eyebrow rather than in the box below it because a drawing
        inset in a box is a picture of an exhibit; the exhibit is supposed to
        BE the panel.
      */}
      {panelIsDrawn(scene) ? (
        <Illustration
          art={scene.art as Art}
          at={0}
          width={pw}
          height={ph}
          durationInFrames={frames}
          seed={scene.id}
        />
      ) : null}
      <Eyebrow parts={scene.eyebrow} frame={frame} u={u} onImage={overImage} />
      <div
        style={{
          position: 'absolute',
          left: u * 7,
          right: u * 7,
          top: u * 17,
          bottom: u * 15,
          /*
           * A column, so children stretch across.
           *
           * As a row they were flex items with `width: 100%` and
           * `flex-shrink: 1`, which resolved to the width of their own text —
           * so a card with two words in it rendered a third of the panel wide
           * and the whole format read as a slide deck with a sizing bug.
           */
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          justifyContent: 'center',
        }}
      >
        {panelIsDrawn(scene) || (scene.kind === 'hero-image' && scene.imageUrl) ? null : (
          <Body scene={scene} frame={frame} frames={frames} accent={accent} u={u} pw={pw} />
        )}
      </div>
      {scene.chip ? <Chip text={scene.chip} frame={frame} frames={frames} u={u} /> : null}
    </AbsoluteFill>
  );
};

/** The generated picture, edge to edge, with the push that keeps it alive. */
const HeroFill: React.FC<{ scene: PanelScene; frame: number; frames: number }> = ({
  scene,
  frame,
  frames,
}) => (
  <AbsoluteFill style={{ overflow: 'hidden' }}>
    <img
      src={scene.imageUrl}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: `scale(${1.02 + 0.05 * (frame / Math.max(1, frames))})`,
        opacity: kf(frame, [[0, 0], [8, 1]]),
      }}
    />
  </AbsoluteFill>
);

const Eyebrow: React.FC<{
  parts: readonly [string, string];
  frame: number;
  u: number;
  onImage?: boolean;
}> = ({ parts, frame, u, onImage = false }) => {
  const [a, b] = parts;
  if (!a && !b) return null;
  const on = kf(frame, [[2, 0], [10, 1]]);
  return (
    <div
      style={{
        position: 'absolute',
        top: u * 7.5,
        left: 0,
        right: 0,
        textAlign: 'center',
        opacity: on,
        fontSize: u * 3.4,
        fontWeight: 700,
        letterSpacing: u * 0.5,
        color: onImage ? '#FFFFFF' : MUTED,
        textShadow: onImage ? `0 ${u * 0.3}px ${u * 1.4}px rgba(0,0,0,0.55)` : undefined,
        textTransform: 'uppercase',
      }}
    >
      {[a, b].filter(Boolean).join('  ·  ')}
    </div>
  );
};

/**
 * The chip opens out of a rule, the way every label in this product does —
 * a 2px line at the final width, growing into a pill over three frames. In
 * the reference it arrives well after the body has finished assembling,
 * which is what makes it read as a verdict on what you just watched rather
 * than as part of the furniture.
 */
const Chip: React.FC<{ text: string; frame: number; frames: number; u: number }> = ({ text, frame, frames, u }) => {
  const at = Math.max(12, Math.round(frames * 0.5));
  const open = kf(frame, [[at, 0], [at + 4, 1]], easeOutExpo);
  const ink = kf(frame, [[at + 3, 0], [at + 9, 1]]);
  if (frame < at) return null;
  return (
    <div
      style={{
        position: 'absolute',
        bottom: u * 4.5,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: INK,
          borderRadius: 999,
          height: u * (0.5 + open * 6.4),
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${u * 3}px`,
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            color: '#FFFFFF',
            opacity: ink,
            fontSize: u * 3,
            fontWeight: 700,
            letterSpacing: u * 0.36,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          {text}
        </span>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------- kinds */

const Body: React.FC<KindProps> = (p) => {
  switch (p.scene.kind) {
    case 'icon-hub':
      return <IconHub {...p} />;
    case 'counter':
      return <Counter {...p} />;
    case 'stat-card':
      return <StatCard {...p} />;
    case 'rank-list':
      return <RankList {...p} />;
    case 'chat-card':
      return <ChatCard {...p} />;
    case 'hero-image':
      return <HeroImage {...p} />;
    case 'toggle-pair':
      return <TogglePair {...p} />;
    case 'list-panel':
    default:
      return <ListPanel {...p} />;
  }
};

type KindProps = {
  scene: PanelScene;
  frame: number;
  frames: number;
  accent: string;
  /** A hundredth of the panel's height, in pixels. */
  u: number;
  /** The panel's width, in pixels. */
  pw: number;
};

/* --------------------------------------------------------------- icon-hub */

/**
 * A hub with the apps it reaches, and a line drawn to each one in turn.
 *
 * The connector is the whole scene. Four icons sitting beside a fifth is a
 * logo wall; a line reaching out to one, then a tick, then the next line, is
 * a claim about what connects to what — and the reference spends three full
 * seconds on exactly that, which is a thirteenth of the video.
 */
const IconHub: React.FC<KindProps> = ({ scene, frame, accent, u, pw }) => {
  const apps = scene.iconSvgs.length ? scene.iconSvgs : scene.icons.map(() => '');
  const n = Math.max(1, apps.length);
  const tile = Math.min(u * 19, (u * 66 - (n - 1) * u * 2.6) / n);
  const gap = u * 2.6;
  const span = n * tile + (n - 1) * gap;
  const hub = u * 30;
  const hubX = pw * 0.12;
  const appX = pw * 0.54;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        style={{
          position: 'absolute',
          left: hubX,
          top: `calc(50% - ${hub / 2}px)`,
          width: hub,
          height: hub,
          borderRadius: hub * 0.26,
          background: `linear-gradient(160deg, ${accent} 0%, ${shade(accent, -0.16)} 100%)`,
          boxShadow: `0 ${u * 1.2}px ${u * 3}px rgba(16,16,24,0.18)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${kf(frame, [[0, 0.82], [9, 1]], easeOutExpo)})`,
        }}
      >
        {/* The hub is the thing everything connects TO, so it says which
            thing. A burst is the same picture in every hub in every video. */}
        <Monogram label={scene.label} u={hub / 11} />
      </div>

      {/* the connectors, one at a time */}
      <svg
        viewBox={`0 0 ${pw} ${u * 64}`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      >
        {apps.map((_, i) => {
          const at = stagger(i, 7, 8);
          const y = u * 32 - span / 2 + i * (tile + gap) + tile / 2;
          const x0 = appX - u * 1.5;
          const x1 = hubX + hub + u * 1.5;
          const d = `M ${x0} ${y} C ${x0 - (x0 - x1) * 0.45} ${y}, ${x1 + (x0 - x1) * 0.35} ${u * 32}, ${x1} ${u * 32}`;
          const len = Math.abs(x0 - x1) * 1.6 + Math.abs(y - u * 32);
          const on = kf(frame, [[at, 0], [at + 8, 1]], easeOutQuint);
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke="#1E2437"
              strokeWidth={u * 0.75}
              strokeLinecap="round"
              strokeDasharray={len}
              strokeDashoffset={len * (1 - on)}
            />
          );
        })}
      </svg>

      {apps.map((svg, i) => {
        const at = stagger(i, 7, 2);
        const y = u * 32 - span / 2 + i * (tile + gap);
        const pop = kf(frame, [[at, 0.72], [at + 9, 1]], easeOutExpo);
        const tickAt = stagger(i, 7, 16);
        const tick = kf(frame, [[tickAt, 0], [tickAt + 6, 1]], easeOutExpo);
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: 'absolute',
                left: appX,
                top: y,
                width: tile,
                height: tile,
                opacity: kf(frame, [[at, 0], [at + 5, 1]]),
                transform: `scale(${pop})`,
                borderRadius: tile * 0.23,
                overflow: 'hidden',
                boxShadow: `0 ${u * 1}px ${u * 2.6}px rgba(16,16,24,0.16)`,
                background: svg
                  ? '#FFFFFF'
                  : `linear-gradient(160deg, ${accent}, ${shade(accent, -0.16)})`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              dangerouslySetInnerHTML={svg ? { __html: fit(svg) } : undefined}
            >
              {/* A lookup that failed leaves an index empty rather than
                  closing the gap, so the tile here is a hole — and a white
                  square on a light panel is an invisible one. */}
              {svg ? undefined : (
                <Monogram label={scene.items[i] ?? scene.icons[i] ?? ''} u={tile / 10} />
              )}
            </div>
            {tick > 0.01 ? (
              <div
                style={{
                  position: 'absolute',
                  left: appX + tile - tile * 0.2,
                  top: y - tile * 0.14,
                  width: tile * 0.42,
                  height: tile * 0.42,
                  borderRadius: '50%',
                  background: GREEN,
                  transform: `scale(${tick})`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#FFFFFF',
                  fontSize: tile * 0.28,
                  fontWeight: 800,
                  boxShadow: `0 ${u * 0.5}px ${u * 1.4}px rgba(16,16,24,0.2)`,
                }}
              >
                ✓
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
};

/** The hub's mark: a radial burst, drawn rather than fetched. */
const Burst: React.FC = () => (
  <svg viewBox="0 0 100 100" style={{ width: '62%', height: '62%' }}>
    {Array.from({ length: 12 }, (_, i) => (
      <rect
        key={i}
        x={47}
        y={11}
        width={6}
        height={31}
        rx={3}
        fill="#FFFFFF"
        transform={`rotate(${i * 30} 50 50)`}
      />
    ))}
    <circle cx={50} cy={50} r={9} fill="#FFFFFF" />
  </svg>
);

/* ----------------------------------------------------------------- counter */

/**
 * A figure running up, with a grid filling behind it.
 *
 * The grid is what makes the number mean something. "1.500 weitere Apps" is
 * an abstraction; thirty-six cells going black while it counts is a quantity
 * you can see, and it costs thirty-six divs.
 */
const Counter: React.FC<KindProps> = ({ scene, frame, u, pw }) => {
  const COLS = 12;
  const ROWS = 3;
  const target = numberOf(scene.figure);
  const t = kf(frame, [[6, 0], [34, 1]], easeOutQuint);
  const shown = target !== null ? formatLike(scene.figure, target * t) : scene.figure;
  const filled = Math.round(COLS * ROWS * t);
  const cell = (pw * 0.72 - (COLS - 1) * u * 1.1) / COLS;

  return (
    <div style={{ width: '100%', textAlign: 'center' }}>
      <div
        style={{
          fontSize: u * 20,
          lineHeight: 1,
          fontWeight: 800,
          color: INK,
          letterSpacing: -u * 0.4,
          fontVariantNumeric: 'tabular-nums',
          opacity: kf(frame, [[2, 0], [9, 1]]),
        }}
      >
        {shown}
      </div>
      {scene.label ? (
        <div
          style={{
            marginTop: u * 2.4,
            fontSize: u * 3.4,
            fontWeight: 700,
            letterSpacing: u * 0.5,
            color: MUTED,
            textTransform: 'uppercase',
            opacity: kf(frame, [[5, 0], [12, 1]]),
          }}
        >
          {scene.label}
        </div>
      ) : null}
      <div
        style={{
          marginTop: u * 6,
          display: 'flex',
          flexWrap: 'wrap',
          gap: u * 1.1,
          width: pw * 0.72,
          marginLeft: 'auto',
          marginRight: 'auto',
          justifyContent: 'center',
        }}
      >
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <div
            key={i}
            style={{
              width: cell,
              height: cell,
              borderRadius: cell * 0.22,
              background: i < filled ? INK : '#FFFFFF',
              border: `1px solid ${i < filled ? INK : LINE}`,
            }}
          />
        ))}
      </div>
    </div>
  );
};

/* --------------------------------------------------------------- stat-card */

/** The dashboard card. Columns count from zero, together, over 20 frames. */
const StatCard: React.FC<KindProps> = ({ scene, frame, u }) => {
  const cols = scene.items.slice(0, 3);
  return (
    <Surface frame={frame} u={u}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: u * 4.4, fontWeight: 700, color: INK }}>{scene.label || 'Insights'}</span>
        <span style={{ fontSize: u * 3.2, color: MUTED }}>{scene.figure}</span>
      </div>
      <div style={{ display: 'flex', marginTop: u * 3.4, gap: u * 2.4 }}>
        {cols.map((item, i) => {
          const value = scene.values[i] ?? '';
          const target = numberOf(value);
          const t = kf(frame, [[10, 0], [30, 1]], easeOutQuint);
          return (
            <div
              key={i}
              style={{
                flex: 1,
                minWidth: 0,
                border: `1px solid ${LINE}`,
                borderRadius: u * 2,
                padding: `${u * 2.2}px ${u * 2.4}px`,
                opacity: kf(frame, [[stagger(i, 4, 6), 0], [stagger(i, 4, 6) + 7, 1]]),
              }}
            >
              <div style={{ fontSize: u * 2.8, color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                {item}
              </div>
              <div
                style={{
                  fontSize: u * 5.4,
                  fontWeight: 700,
                  color: INK,
                  marginTop: u * 1,
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {target !== null ? formatLike(value, target * t) : value || '—'}
              </div>
            </div>
          );
        })}
      </div>
    </Surface>
  );
};

/* --------------------------------------------------------------- rank-list */

/**
 * Rows with bars, and one of them wins.
 *
 * The win is the point and it arrives late — the rows and their figures land
 * first, the viewer reads them, and only then does one fill with the accent
 * and its multiplier run up. Filling it on arrival would be a coloured list.
 */
const RankList: React.FC<KindProps> = ({ scene, frame, frames, accent, u }) => {
  const winAt = Math.max(16, Math.round(frames * 0.45));
  const rows = scene.items.slice(0, 4);
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: u * 2.4 }}>
      {rows.map((item, i) => {
        const at = stagger(i, 5, 3);
        const won = i === scene.winner;
        const win = won ? kf(frame, [[winAt, 0], [winAt + 8, 1]], easeOutExpo) : 0;
        const value = scene.values[i] ?? '';
        const target = numberOf(value);
        const t = kf(frame, [[at + 8, 0], [at + 22, 1]], easeOutQuint);
        return (
          <div
            key={i}
            style={{
              background: win > 0.02 ? mix(CARD, accent, win) : CARD,
              border: `1px solid ${win > 0.02 ? mix(LINE, shade(accent, -0.2), win) : LINE}`,
              borderRadius: u * 2.2,
              padding: `${u * 2.2}px ${u * 3}px`,
              boxShadow: shadow(u),
              opacity: kf(frame, [[at, 0], [at + 7, 1]]),
              transform: `translateY(${(1 - kf(frame, [[at, 0], [at + 9, 1]], easeOutExpo)) * u * 4}px)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: u * 3,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: u * 4,
                  fontWeight: 700,
                  color: win > 0.5 ? '#FFFFFF' : INK,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {item}
              </div>
              <div
                style={{
                  marginTop: u * 1.6,
                  height: u * 0.9,
                  borderRadius: 999,
                  background: win > 0.5 ? 'rgba(255,255,255,0.35)' : '#ECECF1',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${barWidth(i, rows.length) * kf(frame, [[at + 4, 0], [at + 16, 1]], easeOutQuint) * 100}%`,
                    background: win > 0.5 ? '#FFFFFF' : INK,
                    borderRadius: 999,
                  }}
                />
              </div>
            </div>
            {value ? (
              <div
                style={{
                  background: win > 0.5 ? 'rgba(255,255,255,0.22)' : '#F3F3F6',
                  border: `1px solid ${win > 0.5 ? 'rgba(255,255,255,0.3)' : LINE}`,
                  borderRadius: 999,
                  padding: `${u * 0.9}px ${u * 2.2}px`,
                  fontSize: u * 3.4,
                  fontWeight: 700,
                  color: win > 0.5 ? '#FFFFFF' : INK,
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {target !== null ? formatLike(value, target * t) : value}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

/* --------------------------------------------------------------- chat-card */

/** A compose window writing itself, one line per beat, cursor on the last. */
const ChatCard: React.FC<KindProps> = ({ scene, frame, accent, u }) => (
  <Surface frame={frame} u={u}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: u * 1.6 }}>
        <span
          style={{
            width: u * 3.2,
            height: u * 3.2,
            borderRadius: u * 1,
            background: accent,
            display: 'inline-block',
          }}
        />
        <span style={{ fontSize: u * 3.8, fontWeight: 700, color: INK }}>{scene.label || 'Claude'}</span>
      </span>
      <span style={{ fontSize: u * 2.8, color: MUTED }}>{scene.figure}</span>
    </div>
    {scene.items.slice(0, 3).map((line, i) => {
      const at = stagger(i, 11, 8);
      const typed = kf(frame, [[at, 0], [at + 10, 1]], easeOutQuint);
      const chars = Math.round(line.length * typed);
      if (frame < at) return null;
      return (
        <div
          key={i}
          style={{
            marginTop: u * 2.6,
            background: i === 0 ? '#F7F7F9' : 'transparent',
            border: i === 0 ? `1px solid ${LINE}` : 'none',
            borderRadius: u * 2,
            padding: i === 0 ? `${u * 2.2}px ${u * 2.4}px` : 0,
            fontSize: u * 3.6,
            lineHeight: 1.35,
            color: INK,
            display: 'flex',
            alignItems: 'flex-start',
            gap: u * 1.6,
          }}
        >
          {i > 0 ? (
            <span
              style={{
                marginTop: u * 1.1,
                width: u * 1.6,
                height: u * 1.6,
                borderRadius: '50%',
                background: accent,
                flex: 'none',
              }}
            />
          ) : null}
          <span>
            {line.slice(0, chars)}
            {typed < 1 ? <span style={{ color: MUTED }}>|</span> : null}
          </span>
        </div>
      );
    })}
  </Surface>
);

/* -------------------------------------------------------------- list-panel */

/** A list that grows — comments, files, takes — under a count that rises. */
const ListPanel: React.FC<KindProps> = ({ scene, frame, accent, u }) => {
  const target = numberOf(scene.figure);
  const t = kf(frame, [[4, 0], [26, 1]], easeOutQuint);
  return (
    <Surface frame={frame} u={u}>
      {scene.figure || scene.label ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: u * 1.6 }}>
          <span style={{ fontSize: u * 5.6, fontWeight: 800, color: INK, fontVariantNumeric: 'tabular-nums' }}>
            {target !== null ? formatLike(scene.figure, target * t) : scene.figure}
          </span>
          <span style={{ fontSize: u * 3.6, fontWeight: 600, color: MUTED }}>{scene.label}</span>
        </div>
      ) : null}
      {scene.items.slice(0, 4).map((item, i) => {
        const at = stagger(i, 5, 6);
        if (frame < at) return null;
        return (
          <div
            key={i}
            style={{
              marginTop: u * 2.4,
              display: 'flex',
              alignItems: 'center',
              gap: u * 2.2,
              opacity: kf(frame, [[at, 0], [at + 6, 1]]),
              transform: `translateY(${(1 - kf(frame, [[at, 0], [at + 9, 1]], easeOutExpo)) * u * 3}px)`,
            }}
          >
            <span
              style={{
                width: u * 4.4,
                height: u * 4.4,
                borderRadius: '50%',
                background: i % 3 === 0 ? accent : '#D9D9E0',
                flex: 'none',
              }}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: u * 3.6,
                color: INK,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {item}
            </span>
            <span
              style={{
                width: u * 11,
                height: u * 1.1,
                borderRadius: 999,
                background: '#ECECF1',
                flex: 'none',
              }}
            />
          </div>
        );
      })}
    </Surface>
  );
};

/* -------------------------------------------------------------- hero-image */

/** One generated picture, with the slow push that stops it reading as a still. */
const HeroImage: React.FC<KindProps> = ({ scene, frame, frames, u }) => {
  const push = 1 + 0.05 * (frame / Math.max(1, frames));
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {scene.imageUrl ? (
        <img
          src={scene.imageUrl}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            transform: `scale(${push * kf(frame, [[0, 0.97], [12, 1]], easeOutExpo)})`,
            opacity: kf(frame, [[0, 0], [10, 1]]),
          }}
        />
      ) : (
        <div style={{ color: MUTED, fontSize: u * 4.4, fontWeight: 600 }}>{scene.label}</div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------- toggle-pair */

/** Two things and the switch between them, which flips halfway through. */
const TogglePair: React.FC<KindProps> = ({ scene, frame, frames, accent, u }) => {
  const at = Math.max(12, Math.round(frames * 0.45));
  const on = kf(frame, [[at, 0], [at + 7, 1]], easeOutExpo);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: u * 5,
        width: '100%',
      }}
    >
      <Tile svg={scene.iconSvgs[0] ?? ''} accent={accent} frame={frame} at={0} label={scene.items[0] ?? ''} u={u} />
      <div
        style={{
          width: u * 14,
          height: u * 7.4,
          borderRadius: 999,
          background: mix('#D8D8DE', GREEN, on),
          display: 'flex',
          alignItems: 'center',
          padding: u * 0.7,
          flex: 'none',
          boxShadow: `inset 0 ${u * 0.3}px ${u * 0.9}px rgba(16,16,24,0.14)`,
        }}
      >
        <div
          style={{
            width: u * 6,
            height: u * 6,
            borderRadius: '50%',
            background: '#FFFFFF',
            boxShadow: `0 ${u * 0.3}px ${u * 1}px rgba(16,16,24,0.25)`,
            transform: `translateX(${on * u * 6.6}px)`,
          }}
        />
      </div>
      <Tile svg={scene.iconSvgs[1] ?? ''} accent={accent} frame={frame} at={6} label={scene.items[1] ?? ''} u={u} />
    </div>
  );
};

const Tile: React.FC<{
  svg: string;
  accent: string;
  frame: number;
  at: number;
  label: string;
  u: number;
}> = ({ svg, accent, frame, at, label, u }) => (
  <div style={{ textAlign: 'center', flex: 'none' }}>
    <div
      style={{
        width: u * 24,
        height: u * 24,
        borderRadius: u * 6,
        background: svg ? '#FFFFFF' : `linear-gradient(160deg, ${accent}, ${shade(accent, -0.16)})`,
        boxShadow: `0 ${u * 1}px ${u * 2.6}px rgba(16,16,24,0.16)`,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${kf(frame, [[at, 0.8], [at + 9, 1]], easeOutExpo)})`,
        opacity: kf(frame, [[at, 0], [at + 6, 1]]),
      }}
      dangerouslySetInnerHTML={svg ? { __html: fit(svg) } : undefined}
    >
      {svg ? undefined : <Monogram label={label} u={u} />}
    </div>
    {label ? (
      <div
        style={{
          marginTop: u * 2.2,
          fontSize: u * 3.2,
          fontWeight: 700,
          color: MUTED,
          maxWidth: u * 28,
        }}
      >
        {label}
      </div>
    ) : null}
  </div>
);

/**
 * The tile when no icon resolved.
 *
 * It used to be one starburst, the same on every tile — so a `toggle-pair`
 * whose icons did not come back drew the same picture twice with two
 * different labels under it, and a video with four toggle-pairs in it drew
 * that same picture eight times. The exhibit's whole argument is "this thing
 * becomes that thing", and it was showing one thing becoming itself.
 *
 * Initials are not a picture, but they are the label's own initials, so two
 * tiles differ and each one says which side it is. A starburst is kept for
 * the case there is nothing to take initials from.
 */
const Monogram: React.FC<{ label: string; u: number }> = ({ label, u }) => {
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

  if (!initials) return <Burst />;
  return (
    <span
      style={{
        color: '#FFFFFF',
        fontSize: u * (initials.length > 1 ? 8.5 : 11),
        fontWeight: 800,
        letterSpacing: u * -0.2,
        lineHeight: 1,
      }}
    >
      {initials}
    </span>
  );
};

/* ----------------------------------------------------------------- surface */

/** The white card every mock-UI kind is printed on. */
const Surface: React.FC<{ frame: number; u: number; children: React.ReactNode }> = ({
  frame,
  u,
  children,
}) => (
  <div
    style={{
      width: '100%',
      background: CARD,
      border: `1px solid ${LINE}`,
      borderRadius: u * 3,
      boxShadow: shadow(u),
      padding: `${u * 3.4}px ${u * 3.8}px`,
      opacity: kf(frame, [[0, 0], [8, 1]]),
      transform: `translateY(${(1 - kf(frame, [[0, 0], [11, 1]], easeOutExpo)) * u * 2}px)`,
    }}
  >
    {children}
  </div>
);

function shadow(u: number): string {
  return `0 ${u * 0.8}px ${u * 2.6}px rgba(16,16,24,0.07), 0 ${u * 0.15}px ${u * 0.5}px rgba(16,16,24,0.05)`;
}

/* ------------------------------------------------------------------ helpers */

/** An Iconify SVG, forced to fill the tile it was dropped into. */
function fit(svg: string): string {
  return svg
    .replace(/<svg([^>]*)>/, (m, attrs) =>
      `<svg${String(attrs).replace(/\s(width|height|style)="[^"]*"/g, '')} width="100%" height="100%" style="display:block">`,
    );
}

/**
 * The number inside a written figure, in either convention.
 *
 * German writes 1.291 for one thousand two hundred and ninety-one and 10,1
 * for ten point one — exactly inverted from English, and the shared
 * `countUp` helper reads the first of those as 1.291 and counts to one. The
 * panel is the one place in this product that renders a figure in the
 * speaker's own language, so it does its own parsing.
 */
function numberOf(text: string): number | null {
  const m = text.match(/-?[\d.,]+/);
  if (!m) return null;
  const raw = m[0];
  const german = /\.\d{3}(\D|$)/.test(raw) || (raw.includes(',') && !raw.includes('.'));
  const plain = german ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  const value = Number(plain);
  return Number.isFinite(value) ? value : null;
}

/** Put a counted value back in the shape the target was written in. */
function formatLike(target: string, value: number): string {
  const m = target.match(/-?[\d.,]+/);
  if (!m) return target;
  const raw = m[0];
  const german = /\.\d{3}(\D|$)/.test(raw) || (raw.includes(',') && !raw.includes('.'));
  const decimals = german
    ? (raw.split(',')[1] ?? '').length
    : (raw.includes('.') ? raw.split('.')[1].length : 0);
  const fixed = value.toFixed(decimals);
  const [whole, frac] = fixed.split('.');
  /*
   * Group only if the written figure was grouped.
   *
   * German writes 1.500 where English writes 1,500, and the convention is a
   * property of the language rather than of this renderer. Asked to count to
   * a bare "1500" the first version added English commas to a German video.
   * No separator in, no separator out is right in every language.
   */
  const separated = /[.,]\d{3}(\D|$)/.test(raw);
  const grouped = separated ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, german ? '.' : ',') : whole;
  const shown = frac ? `${grouped}${german ? ',' : '.'}${frac}` : grouped;
  return target.replace(raw, shown);
}

/** A deterministic bar length per row — the list is ranked, so it descends. */
function barWidth(i: number, n: number): number {
  return 0.92 - (i / Math.max(1, n)) * 0.42;
}

function shade(hex: string, amount: number): string {
  const [r, g, b] = rgb(hex);
  const f = (c: number) => Math.round(Math.min(255, Math.max(0, c + 255 * amount)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const f = (x: number, y: number) => Math.round(x + (y - x) * Math.min(1, Math.max(0, t)));
  return `rgb(${f(r1, r2)},${f(g1, g2)},${f(b1, b2)})`;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
