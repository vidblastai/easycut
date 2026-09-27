import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { AnimatedScene, Edl } from '../../src/lib/edl/types';
import { FONT_FAMILY } from '../lib/fonts';
import { easeOutCubic, kf } from '../lib/motion';
import { lookFor } from '../looks';
import type { Arrange, Look, LookContext } from '../looks/contract';
import { NeonProps } from '../looks/neon';

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
   * How the scene meets the footage either side of it — the look decides; see
   * `entry` in src/lib/scenes/looks.ts for why most of them cut. One frame of
   * guard at each end either way, so a rounding error cannot leave a single
   * frame of black between the scene and the footage.
   */
  const fadeFrames = look.entry === 'fade' ? Math.round(fps * 0.4) : 1;
  const opacity = kf(
    frame,
    [
      [0, 0],
      [fadeFrames, 1],
      [durationInFrames - fadeFrames, 1],
      [durationInFrames, 0],
    ],
    easeOutCubic,
  );

  return (
    <AbsoluteFill style={{ opacity, fontFamily: FONT_FAMILY }}>
      <look.Ground ctx={ctx} />
      <Arrangement ctx={ctx} look={look} />
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
