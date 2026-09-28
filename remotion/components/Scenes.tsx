import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { sceneIsDrawn, type AnimatedScene, type Edl } from '../../src/lib/edl/types';
import { FONT_FAMILY } from '../lib/fonts';
import { easeOutCubic, kf, riseIn, stagger, transformOf } from '../lib/motion';
import { ClipTransitionEffect, MotionBlurFilter, clipFilter, clipFrameStyle, clipPhase, clipTransitionSec, fitTransitions } from '../lib/clip-transition';
import { lookFor } from '../looks';
import { LOOK_META } from '../../src/lib/scenes/looks';
import { styleGuideFor } from '../../src/lib/scenes/style-guides';
import type { Arrange, Look, LookContext } from '../looks/contract';
import { NeonProps } from '../looks/neon';
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
      {moving.blur.x > 0 || moving.blur.y > 0 ? <MotionBlurFilter id={blurId} blur={moving.blur} /> : null}
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
