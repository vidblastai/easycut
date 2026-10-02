import React from 'react';
import { AbsoluteFill, Img, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { sceneIsDrawn, type AnimatedScene, type Edl } from '../../src/lib/edl/types';
import { FONT_FAMILY } from '../lib/fonts';
import { easeOutCubic, kf, riseIn, stagger, transformOf } from '../lib/motion';
import { ClipFrameFilter, ClipTransitionEffect, clipFilter, clipFrameStyle, clipNeedsFilter, clipPhase, clipTransitionSec, fitTransitions } from '../lib/clip-transition';
import { lookFor } from '../looks';
import { LOOK_META } from '../../src/lib/scenes/looks';
import { styleGuideFor } from '../../src/lib/scenes/style-guides';
import type { Arrange, Look, LookContext } from '../looks/contract';
import { NeonProps } from '../looks/neon';
import { Surface } from '../looks/surface';
import { Illustration } from './Illustration';

/**
 * Faceless animation: the scenes that replace the picture.
 *
 * Every other layer in this renderer decorates the speaker. This one takes the
 * frame away from them. For the seconds a scene is on, there is no footage —
 * there is a made picture with its own background, assembled out of the words
 * being said over it, and the speaker is reduced to the voice explaining it.
 *
 * That is the whole shape of a faceless channel, and it is why this sits above
 * the video and the B-roll rather than beside them: a scene that let the
 * speaker show through the gaps would be an overlay, which is a different
 * thing and one this renderer already has six of.
 *
 * ── Two axes, kept apart ────────────────────────────────────────────────
 *
 * A **kind** is the shape of the explanation, chosen from the transcript:
 *
 *   kinetic-text  the phrase itself, landing word by word
 *   journey       a path across the frame, waypoints lighting up in turn
 *   compare       the frame split down the middle: this against that
 *   orbit         one idea in the centre, its parts arriving around it
 *   stack         layers settling onto each other
 *   big-number    one figure, filling the frame
 *
 * A **look** is the world it is drawn in, chosen from the video's style:
 * `studio`, `neon`, `gallery`, `archive`. See `remotion/looks/`.
 *
 * THIS FILE DRAWS NOTHING. A kind arranges four slots — Title, Figure, Group,
 * Rows — and the look supplies all four. That is the only reason four looks
 * times six kinds is a tractable amount of code instead of twenty-four bespoke
 * layouts, and it is the rule to hold onto when adding either.
 *
 * ── The rule every look obeys ───────────────────────────────────────────
 *
 * Backdrops are static paint moved by `transform`; content arrives by
 * `transform` and `opacity`. No filters, no blend modes, nothing that asks the
 * browser to repaint the whole frame on every tick — a full-frame layer is
 * exactly where that mistake costs the most, and it is what used to make the
 * editor stutter at every cut.
 */

export const Scenes: React.FC<{ edl: Edl }> = ({ edl }) => {
  const { fps } = useVideoConfig();

  return (
    <>
      {edl.scenes.map((scene) => {
        const from = Math.round(scene.outStartSec * fps);
        const durationInFrames = Math.max(1, Math.round((scene.outEndSec - scene.outStartSec) * fps));
        return (
          <Sequence
            key={scene.id}
            from={from}
            durationInFrames={durationInFrames}
            name={`scene · ${scene.look} · ${scene.kind}`}
          >
            <SceneView scene={scene} durationInFrames={durationInFrames} />
          </Sequence>
        );
      })}
    </>
  );
};

const SceneView: React.FC<{ scene: AnimatedScene; durationInFrames: number }> = ({ scene, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const look = lookFor(scene.look);

  const ctx: LookContext = { scene, durationInFrames, fps, width, height, unit: height * 0.001 };

  /*
   * How the scene meets the footage either side of it.
   *
   * The look still decides when the scene says nothing — see `entry` in
   * src/lib/scenes/looks.ts for why most of them cut, and why `archive` fades.
   * A scene that names its own transition overrides that, which is what lets a
   * style give its inserts and its scenes the same signature move.
   */
  const enter = scene.enter ?? (look.entry === 'fade' ? 'fade' : 'cut');
  const exit = scene.exit ?? (look.entry === 'fade' ? 'fade' : 'cut');

  const size = { width, height };
  const { enterFrames, exitFrames } = fitTransitions(
    durationInFrames,
    Math.max(1, Math.round(fps * clipTransitionSec(enter, size))),
    Math.max(1, Math.round(fps * clipTransitionSec(exit, size))),
  );
  const { entering, leaving } = clipPhase(frame, durationInFrames, enterFrames, exitFrames);

  const shared = { width, height, fps, frame, seed: scene.id, cheap: false };
  const enterStyle = clipFrameStyle(enter, { ...shared, progress: entering, leaving: false });
  const exitStyle = clipFrameStyle(exit, { ...shared, progress: leaving, leaving: true });

  // Whichever end is mid-transition owns the smear; only one ever is.
  const moving = entering < 1 ? enterStyle : exitStyle;
  const blurId = `blur-${scene.id}`;

  /*
   * One frame of guard at each end even on a hard cut.
   *
   * A rounding error between the sequence's length and the footage either side
   * of it can otherwise leave a single frame of black, and one black frame in
   * the middle of a cut is more visible than any transition.
   */
  const guard = kf(frame, [[0, 0], [1, 1], [durationInFrames - 1, 1], [durationInFrames, 0]], easeOutCubic);

  return (
    <AbsoluteFill
      style={{
        transform: [enterStyle.transform, exitStyle.transform].filter(Boolean).join(' ') || undefined,
        opacity: Number(enterStyle.opacity ?? 1) * Number(exitStyle.opacity ?? 1) * guard,
        filter: clipFilter(moving, blurId),
        fontFamily: FONT_FAMILY,
      }}
    >
      {clipNeedsFilter(moving) ? <ClipFrameFilter id={blurId} style={moving} /> : null}
      {/*
        ONE background, always.
        A drawn scene brings its own — the illustration's backdrop group runs
        the whole strip and the camera pans across it. Painting the look's
        decorative ground underneath as well put a second, differently-toned
        background behind the first, and the drawing then read as a panel
        floating on someone else's wallpaper. Where the art covers, it IS the
        background; where it cannot quite reach the frame edge, what shows
        through is the flat colour the drawing was told to sit on, so there is
        no seam either way.
      */}
      {sceneIsDrawn(scene) ? (
        <AbsoluteFill style={{ background: styleGuideFor(scene.look).ground }} />
      ) : scene.backdrop !== 'auto' ? (
        // A surface was asked for, so it replaces the look's signature ground
        // rather than sitting over it — see `Surface`.
        <Surface ctx={ctx} />
      ) : (
        <look.Ground ctx={ctx} />
      )}
      <Arrangement ctx={ctx} look={look} />

      {/* And the flavour, if the transition is one. Inside the scene's frame,
          so it cannot bleed onto the footage either side. */}
      {entering < 1 ? (
        <ClipTransitionEffect
          type={enter} progress={entering} leaving={false}
          seed={scene.id} frame={frame} width={width} height={height} cheap={false}
        />
      ) : null}
      {leaving < 1 ? (
        <ClipTransitionEffect
          type={exit} progress={leaving} leaving
          seed={scene.id} frame={frame} width={width} height={height} cheap={false}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------ arrangements */

/**
 * Where the slots go, per kind.
 *
 * The beats are expressed as frames rather than as a fraction of the scene,
 * because a beat has an absolute feel: four frames apart is four frames apart
 * whether the scene runs for two seconds or six. What the duration decides is
 * how long the finished picture gets to sit — and it must get to sit, or the
 * scene reads as a thing that was still arriving when it was cut away from.
 */
const Arrangement: React.FC<{ ctx: LookContext; look: Look }> = ({ ctx, look }) => {
  const { scene } = ctx;
  const items = scene.items.filter((item) => item.trim());
  const icons = scene.iconSvgs;

  const centred: React.CSSProperties = {
    alignItems: 'center',
    justifyContent: 'center',
    padding: `${ctx.unit * 90}px ${ctx.unit * 50}px`,
    gap: ctx.unit * 46,
  };

  /*
   * A drawing outranks the layout.
   *
   * When the illustration pass has drawn this scene, the picture IS the scene
   * and everything else is a label under it — and that is a correction, not a
   * preference. Left to arrange slots, every kind here fills the frame with
   * type, and a video whose animated inserts are all big words set on a
   * gradient is a video of title cards. The words are still there; they are
   * just the size a caption should be.
   */
  if (sceneIsDrawn(scene)) return <Drawn ctx={ctx} look={look} />;

  switch (scene.kind) {
    case 'big-number': {
      const { value, label } = splitFigure(scene.headline, items[0] ?? '');
      return (
        <AbsoluteFill style={centred}>
          <look.Figure ctx={ctx} value={value} label={label} at={2} />
          <Props ctx={ctx} look={look} />
        </AbsoluteFill>
      );
    }

    case 'orbit':
      return (
        <AbsoluteFill style={{ ...centred, flexDirection: 'column' }}>
          {scene.headline ? <look.Title ctx={ctx} text={scene.headline} at={0} /> : null}
          <look.Group ctx={ctx} items={items} icons={icons} arrange="ring" at={6} />
          <Props ctx={ctx} look={look} />
        </AbsoluteFill>
      );

    case 'transform':
      return (
        <AbsoluteFill style={{ ...centred, flexDirection: 'column' }}>
          {scene.headline ? <look.Title ctx={ctx} text={scene.headline} at={0} /> : null}
          <Transform ctx={ctx} />
          <Props ctx={ctx} look={look} />
        </AbsoluteFill>
      );

    case 'compare':
      return (
        <AbsoluteFill style={{ ...centred, flexDirection: 'column' }}>
          {scene.headline ? <look.Title ctx={ctx} text={scene.headline} at={0} /> : null}
          <look.Group ctx={ctx} items={items.slice(0, 2)} icons={icons} arrange="duo" at={7} />
          <Props ctx={ctx} look={look} />
        </AbsoluteFill>
      );

    case 'journey':
      return (
        <AbsoluteFill style={{ ...centred, flexDirection: 'column' }}>
          {scene.headline ? <look.Title ctx={ctx} text={scene.headline} at={0} /> : null}
          <look.Group ctx={ctx} items={items} icons={icons} arrange={journeyArrange(ctx)} at={7} />
          <Props ctx={ctx} look={look} />
        </AbsoluteFill>
      );

    case 'stack':
      return (
        <AbsoluteFill style={{ ...centred, flexDirection: 'column' }}>
          <look.Rows ctx={ctx} items={items} icons={icons} at={2} />
          <Props ctx={ctx} look={look} />
        </AbsoluteFill>
      );

    case 'kinetic-text':
    default:
      return (
        <AbsoluteFill style={{ ...centred, flexDirection: 'column' }}>
          <look.Title ctx={ctx} text={scene.headline} at={2} hero />
          {items.length ? (
            <look.Group ctx={ctx} items={items.slice(0, 3)} icons={icons} arrange="row" at={14} />
          ) : null}
          <Props ctx={ctx} look={look} />
        </AbsoluteFill>
      );
  }
};

/**
 * A scene the model drew.
 *
 * The drawing is the entire scene: it fills the frame, it is its own
 * background, and it carries no words at all.
 *
 * It used to carry a caption. The caption sat perfectly still over a moving
 * picture, which reads as a subtitle that forgot to animate — "make sure
 * there's no text like this that is just static and standing there". Taking it
 * out costs nothing, because the video's real captions are already running and
 * they now have nothing to collide with: `sceneHasText()` reports false for a
 * drawn scene, so they play over it exactly as they play over the footage.
 *
 * The scene's own words are still in the document. The editor shows them and
 * the illustrator is briefed with them; they are simply never rendered.
 */
const Drawn: React.FC<{ ctx: LookContext; look: Look }> = ({ ctx, look }) => {
  const { scene } = ctx;
  const art = scene.art!;

  return (
    <AbsoluteFill>
      {/*
        Edge to edge. A drawing inset in the middle of the frame is a panel,
        and a panel needs something behind it — which is the second background
        this scene is not allowed to have.
      */}
      <Illustration
        art={art}
        at={1}
        width={ctx.width}
        height={ctx.height}
        // The camera paces itself across the WHOLE scene, so it needs the
        // scene's length: a fixed per-frame push would leave a six-second
        // insert twice as close as a three-second one.
        durationInFrames={ctx.durationInFrames}
        seed={scene.id}
      />
      <Props ctx={ctx} look={look} />
    </AbsoluteFill>
  );
};

/**
 * The items under a drawing: words only, no chips.
 *
 * A look's `Group` slot draws each item as an icon in a circle, which is right
 * when the icons ARE the picture and wrong here — under an illustration that
 * already shows the things, an icon chip is a second, worse drawing of the
 * same thing, and where no icon resolved it is a grey dot that reads as a
 * loading state.
 */
/**
 * A path reads across a wide frame and down a tall one.
 *
 * Forcing a row in 9:16 is how three waypoints end up as three unreadable
 * slivers, which is a real failure this catches rather than a refinement.
 */
function journeyArrange(ctx: LookContext): Arrange {
  return ctx.width >= ctx.height ? 'row' : 'column';
}

/** Atmosphere a look may add over the top. Only `neon` has any. */
/**
 * One thing becoming another: two photographs, and an arrow between them.
 *
 * ── Why photographs and not icons ───────────────────────────────────────
 *
 * Every other scene here draws an IDEA — a path, a ring, a figure — and an
 * icon is the right weight for that. This one makes a claim about the world:
 * a seedling turns into a tree, raw footage turns into a cut video. The
 * evidence for a claim like that is a picture of the thing, and two line icons
 * either side of an arrow reads as a diagram of a process rather than as the
 * before and after it is.
 *
 * ── The order is the whole animation ────────────────────────────────────
 *
 * Both panels arriving together is a comparison. One, then the arrow, then the
 * other is a SEQUENCE, and the sequence is what says the left thing caused the
 * right one. So the timing is not decoration: it is the sentence.
 *
 * ── It has to work with no pictures at all ──────────────────────────────
 *
 * The photographs are searched for, and a search can come back empty. A panel
 * with nothing in it falls back to naming its thing in type, which is a worse
 * version of the same scene rather than a broken one — and it is also what the
 * editor shows before the assets have been fetched.
 */
const Transform: React.FC<{ ctx: LookContext }> = ({ ctx }) => {
  const { scene, unit, width, height } = ctx;
  const [before, after] = scene.items;

  /*
   * Sized from the WIDTH, not from `unit`.
   *
   * Every other size in these scenes is written in `unit`, a thousandth of the
   * frame HEIGHT, so a look composes identically at 1080x1920 and 1920x1080.
   * That is exactly wrong here: this is the one scene whose layout is limited
   * by how much room there is ACROSS, and sizing the panels in `unit` made
   * them 576px each in a vertical frame — two of them and an arrow, 1474px
   * wide, in a frame 1080 wide. They ran off both edges.
   *
   * So the row is solved the other way round: take the width it may use, give
   * the arrow and the gaps their share, and the panels get what is left.
   */
  const gap = unit * 22;
  const row = width * 0.84;
  const arrowW = Math.min(unit * 130, row * 0.19);

  /*
   * Portrait in BOTH shapes, which means the aspect is fixed and the size
   * gives way — not the other way round.
   *
   * Clamping the height alone turned the panels landscape in a widescreen
   * frame: there was width to spare and the ceiling bit first, so a 712-wide
   * panel got a 562 height. A photograph of a tree in a letterbox is the wrong
   * crop of the wrong thing. So both limits are measured as a WIDTH, the
   * tighter one wins, and the height follows from it.
   */
  const PORTRAIT = 1.34;
  const byWidth = (row - arrowW - gap * 2) / 2;
  const byHeight = (height * 0.56) / PORTRAIT;
  const panelW = Math.min(byWidth, byHeight);
  const panelH = panelW * PORTRAIT;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap }}>
      <Panel ctx={ctx} label={before} url={scene.photoUrls[0] ?? null} at={2} width={panelW} height={panelH} />
      <Arrow ctx={ctx} at={13} width={arrowW} />
      <Panel ctx={ctx} label={after} url={scene.photoUrls[1] ?? null} at={20} width={panelW} height={panelH} />
    </div>
  );
};

/** One side of the pair. */
const Panel: React.FC<{
  ctx: LookContext;
  label: string | undefined;
  url: string | null;
  at: number;
  width: number;
  height: number;
}> = ({ ctx, label, url, at, width, height }) => {
  const frame = useCurrentFrame();
  const { unit, scene } = ctx;
  /*
   * The look's own palette, because half of these worlds are LIGHT.
   *
   * The first version hardcoded near-white type on a 4%-white plate, which is
   * the right pair in `neon` and invisible in `studio` — white text on a white
   * panel on a white ground. An empty panel is the normal state here, so the
   * one colour that must never be wrong is the one it falls back to.
   */
  const guide = styleGuideFor(scene.look);
  const ink = guide.palette[0]?.hex ?? '#0D0D10';
  const plate = guide.palette[3]?.hex ?? '#E8E8EE';

  /*
   * It arrives at full size, moving — not scaled up from nothing.
   *
   * The same decision as the icon cards, for the same reason: a pop makes a
   * photograph into a sticker, where a thing that is already its own size and
   * is still settling reads as an object that was placed there.
   */
  const entry = riseIn(frame, at, unit * 30, 10);

  return (
    <div
      style={{
        width,
        height,
        borderRadius: unit * 14,
        overflow: 'hidden',
        position: 'relative',
        background: plate,
        boxShadow: `0 ${unit * 18}px ${unit * 44}px rgba(0,0,0,0.45)`,
        opacity: entry.opacity,
        transform: transformOf(entry),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {url ? (
        <Img src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        // No picture is a normal state. The thing still gets named.
        <span
          style={{
            fontFamily: FONT_FAMILY,
            fontSize: unit * 30,
            fontWeight: 700,
            lineHeight: 1.2,
            color: ink,
            textAlign: 'center',
            padding: unit * 24,
            textWrap: 'balance',
          }}
        >
          {label ?? ''}
        </span>
      )}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: unit * 14,
          // A hairline inside the edge, so a photograph that happens to be
          // dark at its border still reads as a panel rather than as a hole.
          boxShadow: `inset 0 0 0 ${Math.max(1, unit * 2)}px ${scene.accent}33`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

/** The direction. Drawn, not typed — an arrow glyph is the wrong weight. */
const Arrow: React.FC<{ ctx: LookContext; at: number; width: number }> = ({ ctx, at, width }) => {
  const frame = useCurrentFrame();
  const { unit, scene } = ctx;

  // Reaching across, rather than fading: the arrow is the verb.
  const reach = kf(frame, [[at, 0], [at + 9, 1]], easeOutCubic);
  const height = width * 0.62;

  return (
    <svg width={width} height={height} viewBox="0 0 100 62" style={{ overflow: 'visible' }} aria-hidden="true">
      <g
        style={{
          opacity: reach,
          transform: `translateX(${(reach - 1) * unit * 26}px)`,
          transformOrigin: 'center',
        }}
      >
        <path
          // A blunt, heavy arrow. A thin one reads as a diagram connector;
          // this is the verb of the sentence and carries the same weight as
          // the two things it joins.
          d="M0 19 H55 V2 L100 31 L55 60 V43 H0 Z"
          fill={scene.accent}
          style={{ filter: `drop-shadow(0 ${unit * 6}px ${unit * 16}px ${scene.accent}55)` }}
        />
      </g>
    </svg>
  );
};

const Props: React.FC<{ ctx: LookContext; look: Look }> = ({ ctx, look }) =>
  look.id === 'neon' ? <NeonProps ctx={ctx} icons={ctx.scene.iconSvgs} /> : null;

/**
 * Pull the figure and its label apart.
 *
 * A big-number scene's headline arrives as one string — "95%", "3x more",
 * "$1.2M a year" — and the look needs the figure on its own so it can count it
 * up with the unit pinned. Whatever is left over becomes the label, unless the
 * scene already supplied one.
 */
export function splitFigure(headline: string, fallbackLabel: string): { value: string; label: string } {
  const match = headline.trim().match(/^([^0-9]*[\d][\d.,]*\s*(?:%|[A-Za-z]{1,2}\b)?)\s*(.*)$/);
  if (!match) return { value: headline.trim(), label: fallbackLabel };
  const [, value, rest] = match;
  return { value: value.trim(), label: (rest.trim() || fallbackLabel).trim() };
}
