import React from 'react';
import { AbsoluteFill, Img, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { PHOTO_GRID_MAX, PHOTO_ROW_MAX, sceneIsDrawn, type AnimatedScene, type Edl } from '../../src/lib/edl/types';
import { FONT_FAMILY } from '../lib/fonts';
import { easeOutCubic, kf, riseIn, riseProgress, stagger, transformOf } from '../lib/motion';
import { seeded } from '../lib/timing';
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
 *   transform     this thing became that one: two photographs and an arrow
 *   photo-row     two or three photographs rising out of the floor in turn
 *   photo-point   one photograph and one line of type beside it
 *   photo-grid    four to six photographs, in reading order
 *   photo-hero    one photograph, blurred behind itself and sharp in front
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

    /*
     * No title. The two photographs and the arrow ARE the sentence.
     *
     * Every other kind here takes a headline because its picture is a diagram
     * that needs saying what it is of. This one is already a claim — that
     * thing turned into this thing — and a line of type over it only repeats
     * the pictures in words. It also costs the panels the room they most
     * need: the photographs are the evidence, so they get the height.
     */
    case 'transform':
      return (
        <AbsoluteFill style={{ ...centred, flexDirection: 'column' }}>
          <Transform ctx={ctx} />
          <Props ctx={ctx} look={look} />
        </AbsoluteFill>
      );

    case 'photo-row':
      return (
        <AbsoluteFill style={{ ...centred, flexDirection: 'column' }}>
          {scene.headline ? <look.Title ctx={ctx} text={scene.headline} at={0} /> : null}
          <PhotoRow ctx={ctx} />
          <Props ctx={ctx} look={look} />
        </AbsoluteFill>
      );

    // No separate title: the headline IS one half of this layout, so it is
    // laid out beside the picture rather than stacked above the pair.
    case 'photo-point':
      return (
        <AbsoluteFill style={centred}>
          <PhotoPoint ctx={ctx} look={look} />
          <Props ctx={ctx} look={look} />
        </AbsoluteFill>
      );

    /*
     * No headline, like `transform`. The picture is the whole scene, and a
     * line of type over a photograph needs a plate behind it to stay legible
     * — at which point it is a different layout, and that layout is
     * `photo-point`.
     */
    case 'photo-hero':
      return (
        <AbsoluteFill>
          <PhotoHero ctx={ctx} />
          <Props ctx={ctx} look={look} />
        </AbsoluteFill>
      );

    case 'photo-grid':
      return (
        <AbsoluteFill style={{ ...centred, flexDirection: 'column' }}>
          {scene.headline ? <look.Title ctx={ctx} text={scene.headline} at={0} /> : null}
          <PhotoGrid ctx={ctx} />
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
  // 0.72 rather than 0.56 because nothing is set above the row any more.
  const byHeight = (height * 0.72) / PORTRAIT;
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

/**
 * One side of the pair.
 *
 * The rectangle itself is the shared `Plate`; this only supplies the
 * entrance, which is a short lift rather than the floor the other photo
 * scenes climb out of — two panels and an arrow is a SENTENCE with a verb in
 * the middle, and a pair of plates leaping up out of the ground either side
 * of it fights the reading order the arrow is there to set.
 */
const Panel: React.FC<{
  ctx: LookContext;
  label: string | undefined;
  url: string | null;
  at: number;
  width: number;
  height: number;
}> = ({ ctx, label, url, at, width, height }) => {
  const frame = useCurrentFrame();
  /*
   * It arrives at full size, moving — not scaled up from nothing.
   *
   * The same decision as the icon cards, for the same reason: a pop makes a
   * photograph into a sticker, where a thing that is already its own size and
   * is still settling reads as an object that was placed there.
   */
  const entry = riseIn(frame, at, ctx.unit * 30, 10);

  return (
    <div style={{ opacity: entry.opacity, transform: transformOf(entry) }}>
      <Plate ctx={ctx} label={label} url={url} width={width} height={height} />
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

/* ------------------------------ photo scenes ----------------------------- */

/**
 * Three kinds that put PHOTOGRAPHS on the frame, and the floor they rise from.
 *
 * ── Why this file draws them, when it draws nothing else ────────────────
 *
 * The rule above is that a kind arranges slots and a look fills them, and it
 * is what keeps four looks times ten kinds affordable. A photograph has no
 * slot: there is nothing for a look to style about a rectangle with a picture
 * in it, and giving each look its own `Photo` would be four copies of the same
 * component differing only in a border radius. So the plate is drawn here,
 * once, and it takes its colours from the look's style guide — which is the
 * same answer `transform` already arrived at, for the same reason.
 *
 * The HEADLINE still goes through `look.Title`. That is type, and type is
 * exactly what a look has an opinion about.
 *
 * ── The entrance is the icon card's, not a fade ─────────────────────────
 *
 * "Images coming up from under the screen" is a floor, not an animation
 * curve: each plate gets its own clip box reaching below where it lands, sits
 * underneath it at full size, and climbs out. No fade, no scale — a plate
 * that scales is a sticker, and fade-plus-slide is a web animation. The
 * numbers (19 frames, quadratic out) are the ones measured off the reference
 * clip for the icon cards; it is the same move at a different size.
 *
 * They arrive ONE AT A TIME, seven frames apart. That is slower than the
 * four-frame stagger the looks use for chips, deliberately: a chip is one
 * item in a set and the set is the point, where each of these is a thing you
 * are meant to look at before the next one lands.
 */

/** Room around a plate for its shadow, so the clip box does not slice it. */
const PLATE_PAD = 0.1;

/** Measured on the reference clip, for the icon cards. Same move. */
const RISE_FRAMES = 19;

/** Long enough that you watch them land one by one rather than as a wave. */
const RISE_STAGGER = 7;

/**
 * One plate, climbing out of its own floor.
 *
 * The clip box is bigger than the plate on every side — `PLATE_PAD` of the
 * plate's height all round for the shadow, and one whole plate-height plus
 * that padding below, which is the floor. Travel is the distance that puts
 * the plate's TOP on the clip's bottom edge, so at frame zero it is not
 * dimmed or small, it is behind something.
 */
const Rising: React.FC<{
  at: number;
  width: number;
  height: number;
  children: React.ReactNode;
}> = ({ at, width, height, children }) => {
  const frame = useCurrentFrame();
  const pad = height * PLATE_PAD;
  const travel = height + pad;
  const climbed = riseProgress(frame - at, RISE_FRAMES);

  return (
    <div style={{ width, height, position: 'relative' }}>
      <div
        style={{
          position: 'absolute',
          left: -pad,
          top: -pad,
          width: width + pad * 2,
          height: height + pad * 2,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: pad,
            top: pad,
            width,
            height,
            transform: `translate3d(0, ${travel * (1 - climbed)}px, 0)`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

/**
 * A picture and the word for it.
 *
 * The caption sits UNDER the plate when there is a picture, and INSIDE it
 * when there is not — which is one word on screen either way rather than the
 * same noun twice. An empty plate is a normal state here and not a failure:
 * the photographs are searched for, a search can come back empty, and the
 * editor shows the scene before anything has been fetched at all.
 */
const PhotoPlate: React.FC<{
  ctx: LookContext;
  label: string | undefined;
  url: string | null;
  at: number;
  width: number;
  height: number;
  caption?: boolean;
}> = ({ ctx, label, url, at, width, height, caption = true }) => {
  const { unit } = ctx;
  const showCaption = caption && Boolean(url && label);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: unit * 14 }}>
      <Rising at={at} width={width} height={height}>
        <Plate ctx={ctx} label={url ? undefined : label} url={url} width={width} height={height} />
      </Rising>
      {showCaption ? <PlateCaption ctx={ctx} text={label!} at={at + RISE_FRAMES - 4} width={width} /> : null}
    </div>
  );
};

/** The rectangle itself: a picture, or the thing's name where there is none. */
const Plate: React.FC<{
  ctx: LookContext;
  label: string | undefined;
  url: string | null;
  width: number;
  height: number;
}> = ({ ctx, label, url, width, height }) => {
  const { unit, scene } = ctx;
  const guide = styleGuideFor(scene.look);
  const ink = guide.palette[0]?.hex ?? '#0D0D10';
  const plate = guide.palette[3]?.hex ?? '#E8E8EE';
  const radius = Math.min(unit * 16, height * 0.07);

  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        overflow: 'hidden',
        position: 'relative',
        background: plate,
        boxShadow: `0 ${unit * 16}px ${unit * 40}px rgba(0,0,0,0.42)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {url ? (
        <Img src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span
          style={{
            fontFamily: FONT_FAMILY,
            fontSize: Math.min(unit * 30, width * 0.14),
            fontWeight: 700,
            lineHeight: 1.2,
            color: ink,
            textAlign: 'center',
            padding: unit * 20,
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
          borderRadius: radius,
          // A hairline inside the edge, so a photograph that happens to be
          // dark at its border still reads as a panel rather than as a hole.
          boxShadow: `inset 0 0 0 ${Math.max(1, unit * 2)}px ${scene.accent}33`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};

/** The word under a picture. Arrives as the plate settles, not with it. */
const PlateCaption: React.FC<{ ctx: LookContext; text: string; at: number; width: number }> = ({
  ctx, text, at, width,
}) => {
  const frame = useCurrentFrame();
  const { unit, scene } = ctx;
  const guide = styleGuideFor(scene.look);
  const entry = riseIn(frame, at, unit * 12, 8);

  return (
    <span
      style={{
        fontFamily: FONT_FAMILY,
        fontSize: Math.min(unit * 26, width * 0.15),
        fontWeight: 600,
        letterSpacing: '-0.01em',
        color: guide.palette[0]?.hex ?? '#0D0D10',
        maxWidth: width,
        textAlign: 'center',
        textWrap: 'balance',
        opacity: entry.opacity,
        transform: transformOf(entry),
      }}
    >
      {text}
    </span>
  );
};

/**
 * Two or three pictures across the frame, rising one after the other.
 *
 * Sized from the WIDTH, like `transform` and for the same reason: `unit` is a
 * thousandth of the frame HEIGHT, and this is a layout limited by room
 * ACROSS. The ratio is fixed and the SIZE gives way, so the plates stay the
 * same shape in a tall frame and a wide one — clamping the height alone is
 * what turned the transform panels landscape in widescreen.
 */
const PhotoRow: React.FC<{ ctx: LookContext }> = ({ ctx }) => {
  const { scene, unit, width, height } = ctx;
  const items = scene.items.filter((item) => item.trim()).slice(0, PHOTO_ROW_MAX);
  const count = Math.max(2, items.length);

  const PORTRAIT = 1.3;
  /*
   * The gap is a fraction of the PLATE, not of `unit`.
   *
   * `unit` is a thousandth of the frame HEIGHT, so a gap written in it is 65px
   * between three 280px plates in a vertical frame and 37px between three
   * 573px plates in a widescreen one — a quarter of a plate in one shape and a
   * fifteenth in the other. Solving for the plate first is what makes the row
   * read the same in both.
   */
  const GAP_OF_PLATE = 0.07;
  // A tall frame is the one with nothing to spare across, so it keeps less
  // margin: three portrait plates in 1080 are small enough already.
  const row = width * (width > height ? 0.9 : 0.96);
  const byWidth = row / (count + GAP_OF_PLATE * (count - 1));
  // Headroom for the headline when there is one, and for the captions always.
  const byHeight = (height * (scene.headline.trim() ? 0.52 : 0.62)) / PORTRAIT;
  const plateW = Math.min(byWidth, byHeight);
  const plateH = plateW * PORTRAIT;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: plateW * GAP_OF_PLATE }}>
      {Array.from({ length: count }, (_, i) => (
        <PhotoPlate
          key={i}
          ctx={ctx}
          label={items[i]}
          url={scene.photoUrls[i] ?? null}
          at={4 + i * RISE_STAGGER}
          width={plateW}
          height={plateH}
        />
      ))}
    </div>
  );
};

/**
 * One picture and one line of type.
 *
 * Side by side where the frame is wide, stacked where it is tall — and that
 * reads off the FRAME rather than off the format, because the question is how
 * much room there is across, not which platform this is for. A 40%-wide text
 * column in a vertical frame sets three words to a line, which is not a
 * sentence any more.
 *
 * Which side the picture takes alternates per scene, seeded off the scene's
 * id so it is the same on every render. Two of these in one video with the
 * picture on the same side both times reads as a template; mirrored, it reads
 * as an edit.
 */
const PhotoPoint: React.FC<{ ctx: LookContext; look: Look }> = ({ ctx, look }) => {
  const { scene, unit, width, height } = ctx;
  const wide = width > height;
  const url = scene.photoUrls[0] ?? null;
  const label = scene.items.find((item) => item.trim());
  const pictureFirst = seeded(scene.id, 0) < 0.5;

  const picture = wide
    ? { w: width * 0.42, h: width * 0.42 * 1.16 }
    : { w: width * 0.88, h: width * 0.88 * 0.74 };
  const plateH = Math.min(picture.h, height * (wide ? 0.74 : 0.46));
  const plateW = plateH * (picture.w / picture.h);

  /*
   * A column, not a block that shrinks to its longest word.
   *
   * Sized rather than auto, because the pair is centred as a unit: left to
   * its content, a three-word headline collapses to a third of the room it
   * was given and the whole composition slides toward the picture, which
   * then reads as a picture with a note stuck to it.
   */
  const words = (
    <div
      style={{
        width: wide ? width * 0.34 : width * 0.86,
        textAlign: wide ? 'left' : 'center',
        flexShrink: 0,
      }}
    >
      <look.Title ctx={ctx} text={scene.headline} at={0} />
    </div>
  );
  const plate = (
    <PhotoPlate
      ctx={ctx}
      label={label}
      url={url}
      at={8}
      width={plateW}
      height={plateH}
      // The headline already says it. A word under the picture as well would
      // be the scene saying the same thing twice in two type sizes.
      caption={false}
    />
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: wide ? 'row' : 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: unit * (wide ? 54 : 38),
      }}
    >
      {wide && pictureFirst ? plate : words}
      {wide && pictureFirst ? words : plate}
    </div>
  );
};

/**
 * Four to six pictures, filling the frame in reading order.
 *
 * Square cells, because a grid is the one layout where the cell shape has to
 * work in both aspects at once — portrait cells in a wide frame leave two
 * bands of ground above and below, landscape ones in a tall frame leave them
 * at the sides. The columns are what change with the frame instead.
 */
const PhotoGrid: React.FC<{ ctx: LookContext }> = ({ ctx }) => {
  const { scene, unit, width, height } = ctx;
  const items = scene.items.filter((item) => item.trim()).slice(0, PHOTO_GRID_MAX);
  const count = Math.max(4, items.length);
  const columns = width > height ? 3 : 2;
  const rows = Math.ceil(count / columns);

  // Proportional to the cell, for the reason `PhotoRow` spells out.
  const GAP_OF_CELL = 0.07;
  const byWidth = (width * 0.92) / (columns + GAP_OF_CELL * (columns - 1));
  const byHeight =
    (height * (scene.headline.trim() ? 0.58 : 0.7)) / (rows + GAP_OF_CELL * (rows - 1));
  const cell = Math.min(byWidth, byHeight);
  const gap = cell * GAP_OF_CELL;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, ${cell}px)`,
        gap,
        justifyContent: 'center',
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <PhotoPlate
          key={i}
          ctx={ctx}
          label={items[i]}
          url={scene.photoUrls[i] ?? null}
          // Reading order, and a shorter stagger than the row: six plates
          // seven frames apart would still be arriving three seconds in.
          at={4 + i * 5}
          width={cell}
          height={cell}
          // The cell is square and small; a word under each of six of them is
          // a paragraph laid out as a grid.
          caption={false}
        />
      ))}
    </div>
  );
};

/**
 * One photograph, shown twice: blurred and filling the frame, sharp in front.
 *
 * The oldest trick in the edit and still the best one for a single picture,
 * because the alternatives are both worse. A photograph letterboxed on a flat
 * colour has two dead bands; one cropped to fill the frame throws away
 * whatever was at its sides, which for a stock photo is usually half the
 * subject. Blurring the same picture up to full bleed gives the frame an edge
 * to edge ground that is guaranteed to agree with the card in front of it,
 * because it IS the card in front of it.
 *
 * ── The blur is a filter, which the house rule normally forbids ─────────
 *
 * "No `filter` on anything full-frame" exists because a full-frame effect
 * repainted every frame is what made the editor stutter. Two things buy this
 * one its exemption, and they are the same two that bought `bloom` its
 * `backdrop-filter` on a B-roll insert: it is on screen for a few seconds
 * rather than for the video, and the blurred layer never changes, so it is
 * rasterised once. The slow push lives on a parent, so the transform moves a
 * cached surface instead of re-running the blur — which is why these are two
 * nested elements and not one with both properties on it.
 *
 * ── The scrim comes from the look ───────────────────────────────────────
 *
 * Without one, a bright photograph behind a bright card leaves the card with
 * no edge; with a hardcoded dark one, every scene in a light look suddenly
 * has a black background. So it is the look's own ground at a little under
 * half opacity: the blurred picture still reads through it, and the frame
 * stays the tone the rest of the video is.
 */
const PhotoHero: React.FC<{ ctx: LookContext }> = ({ ctx }) => {
  const frame = useCurrentFrame();
  const { scene, unit, width, height } = ctx;
  const url = scene.photoUrls[0] ?? null;
  const label = scene.items.find((item) => item.trim());
  const guide = styleGuideFor(scene.look);

  /*
   * The card is the frame's own shape, inset.
   *
   * A fixed ratio would letterbox in one aspect or the other, and this is the
   * one layout with no reason to pick a shape of its own: the picture behind
   * it is the frame, so the picture in front reads as the same frame held
   * closer. 0.78 across, which is where the blurred border is wide enough to
   * be a deliberate margin rather than a misalignment.
   */
  const cardW = width * (width > height ? 0.78 : 0.86);
  const cardH = cardW * (height / width);

  // Never stops moving: a slow push on the ground, counter to the card's own
  // settle, so the two planes separate. 4% over a six-second scene.
  const push = 1.14 + kf(frame, [[0, 0], [180, 0.04]]);

  /*
   * The picture lands sharp and then recedes behind itself.
   *
   * Opening on the blur already finished is a background; opening sharp and
   * letting it go soft as the card climbs out of it says the two layers are
   * one picture, which is the whole idea. Fourteen frames, ending just as the
   * card finishes rising.
   *
   * It costs those fourteen frames of real full-frame filtering — the layer
   * cannot be cached while its radius is changing — and nothing after them,
   * which is the same bargain a transition effect makes at a cut.
   */
  const settle = kf(frame, [[0, 0], [14, 1]], easeOutCubic);

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      {url ? (
        <AbsoluteFill style={{ overflow: 'hidden' }}>
          {/* Outer: the move, which also scales the blurred result past the
              frame's edges — a blur pulls a layer's own corners inward and
              draws a soft border round them otherwise. Inner: the blur.
              Keeping them apart is what lets the browser cache the expensive
              half while the cheap half animates. */}
          <AbsoluteFill style={{ transform: `scale(${push})`, willChange: 'transform' }}>
            <AbsoluteFill style={{ filter: `blur(${unit * 26 * settle}px)` }}>
              <Img src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </AbsoluteFill>
          </AbsoluteFill>
          <AbsoluteFill style={{ background: guide.ground, opacity: 0.42 }} />
        </AbsoluteFill>
      ) : null}

      <Rising at={4} width={cardW} height={cardH}>
        <Plate ctx={ctx} label={label} url={url} width={cardW} height={cardH} />
      </Rising>
    </AbsoluteFill>
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
