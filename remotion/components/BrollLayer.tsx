import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { BrollClip, Edl } from '../../src/lib/edl/types';
import { ramp } from '../lib/timing';
import { BrollOverlay } from './BrollOverlay';
import { ClipFrameFilter, ClipTransitionEffect, clipFilter, clipFrameStyle, clipNeedsFilter, clipPhase, clipTransitionSec, fitTransitions } from '../lib/clip-transition';
import { layoutPlan, regionStyle } from '../../src/lib/styles/layouts';

/**
 * B-roll inserts.
 *
 * Two rules encoded here that separate a good insert from a bad one:
 *
 *  - It **covers** the frame rather than sitting in a box. A picture-in-picture
 *    inset reads as a screen recording, not an edit.
 *  - Stills always move. A static photo held for two seconds looks like the
 *    video froze, so every image gets a slow Ken Burns push.
 */
export const BrollLayer: React.FC<{ edl: Edl; onMediaError?: (message: string) => void; cheap?: boolean }> = ({
  edl,
  onMediaError,
  cheap = false,
}) => {
  const { fps } = useVideoConfig();

  // On a `full` layout B-roll COVERS the frame — an insert in a box reads as a
  // screen recording rather than an edit. On a split or side layout it has its
  // own half, which is on screen throughout, so the half gets a backing panel:
  // a moment of black where one clip ends and the next begins would read as a
  // dropout rather than a cut.
  const plan = layoutPlan(edl.format.layout, edl.format);
  const region = plan.broll;

  const inserts = edl.broll.map((clip) => {
    if (!clip.url) return null;
    const from = Math.round(clip.outStartSec * fps);
    const durationInFrames = Math.max(1, Math.round((clip.outEndSec - clip.outStartSec) * fps));

    return (
      <Sequence key={clip.id} from={from} durationInFrames={durationInFrames} premountFor={Math.round(fps * 2)}>
        <BrollInsert
          clip={clip}
          durationInFrames={durationInFrames}
          onMediaError={onMediaError}
          cheap={cheap}
        />
      </Sequence>
    );
  });

  if (!region) return <>{inserts}</>;

  return (
    <AbsoluteFill
      style={{
        ...regionStyle(region),
        overflow: 'hidden',
        /*
         * A backing panel only where the slot is PERMANENT.
         *
         * On a split screen the half is on screen throughout, so a moment of
         * black between two clips reads as a dropout and the panel covers it.
         * A headline layout has a region for its inserts but the speaker is
         * what lives in that frame the rest of the time — painting a panel
         * there would black the speaker out whenever no insert was playing.
         */
        backgroundColor: plan.alwaysOn ? '#0D0D10' : 'transparent',
        borderRadius: plan.frameRadius ? `${plan.frameRadius}%` : undefined,
      }}
    >
      {inserts}
    </AbsoluteFill>
  );
};

const BrollInsert: React.FC<{
  clip: BrollClip;
  durationInFrames: number;
  onMediaError?: (message: string) => void;
  cheap?: boolean;
}> = ({ clip, durationInFrames, onMediaError, cheap = false }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  /*
   * How it arrives and how it leaves, from the document.
   *
   * This used to be a fixed 0.12s cross-fade at both ends — which is not
   * nothing, but it is the same nothing on every insert in every video, and an
   * insert that fades up in four frames still reads as a picture that appeared
   * rather than a cut that was made. The style now names a vocabulary and the
   * builder cycles it, so consecutive inserts travel in from different edges.
   */
  const size = { width, height };
  // Shrunk to fit: a short insert cannot afford a full pair of slides, and
  // arriving and immediately leaving reads as a wobble.
  const { enterFrames, exitFrames } = fitTransitions(
    durationInFrames,
    Math.round(fps * clipTransitionSec(clip.enter, size)),
    Math.round(fps * clipTransitionSec(clip.exit, size)),
  );
  const { entering, leaving } = clipPhase(frame, durationInFrames, enterFrames, exitFrames);

  // The end being animated right now. Both curves are applied, so a clip too
  // short to finish arriving before it has to leave degrades instead of
  // jumping: the two opacities multiply and the two transforms compose.
  const shared = { width, height, fps, frame, seed: clip.id, cheap };
  const enterStyle = clipFrameStyle(clip.enter, { ...shared, progress: entering, leaving: false });
  const exitStyle = clipFrameStyle(clip.exit, { ...shared, progress: leaving, leaving: true });

  // One blur at a time: only one end of the clip is ever moving, so whichever
  // is mid-transition owns the smear. Adding them would double the sigma on a
  // clip short enough for the two to overlap.
  const moving = entering < 1 ? enterStyle : exitStyle;
  const blurId = `blur-${clip.id}`;

  const effect = entering < 1 ? { type: clip.enter, progress: entering, leaving: false } : null;
  const outgoing = leaving < 1 ? { type: clip.exit, progress: leaving, leaving: true } : null;

  const progress = ramp(frame, 0, durationInFrames);
  const { scale, translateX, translateY } = kenBurns(clip.kenBurns, progress);

  const isVideo = clip.kind === 'stock-video';

  return (
    <AbsoluteFill
      style={{
        // Composed rather than picked: `transform: a b` is one declaration,
        // and writing `${a} ${b}` where one of them is undefined discards the
        // whole thing — which is how an insert ends up not transitioning at
        // all in exactly the cases where both ends are animating.
        transform: [enterStyle.transform, exitStyle.transform].filter(Boolean).join(' ') || undefined,
        opacity: Number(enterStyle.opacity ?? 1) * Number(exitStyle.opacity ?? 1) * clip.opacity,
        filter: clipFilter(moving, blurId),
        /*
         * No `overflow: hidden` while the smear is on.
         *
         * A blur needs to paint OUTSIDE the element it came from — that is
         * what a smear is — and clipping it to the clip's own box cuts the
         * trailing edge off square, which reads as a hard band rather than as
         * motion. Restored the moment the clip settles, where it is what stops
         * a Ken Burns push spilling past the frame.
         *
         * The SMEAR specifically, not any filter. A glitch is also a filter
         * and wants the opposite: it only ever pulls pixels inward, so opening
         * the box would let a Ken Burns push spill out and then be torn, which
         * puts shards of the insert on the footage either side of it.
         */
        overflow: moving.blur.x > 0 || moving.blur.y > 0 ? 'visible' : 'hidden',
        backgroundColor: '#000',
      }}
    >
      {clipNeedsFilter(moving) ? <ClipFrameFilter id={blurId} style={moving} /> : null}
      <AbsoluteFill
        style={{
          transform: `scale(${scale * clip.scale}) translate(${translateX}%, ${translateY}%)`,
          transformOrigin: 'center center',
        }}
      >
        {isVideo ? (
          <OffthreadVideo
            onError={onMediaError ? (e) => onMediaError(e.message) : undefined}
            src={clip.url}
            trimBefore={Math.round(clip.clipStartSec * fps)}
            muted={clip.audioGainDb <= -55}
            volume={clip.audioGainDb <= -55 ? 0 : Math.pow(10, clip.audioGainDb / 20)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <Img src={clip.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </AbsoluteFill>

      {/* The treatment the insert is wearing.

          Above the picture and BELOW the transition effect, which is the only
          order that works: a glitch tears the shot, and a shot with grain on
          it should tear with its grain. Painting the grain after the tear puts
          a clean, undamaged layer on top of the damage.

          Inside the clip's frame either way, so it stops where the insert
          stops — grain over the B-roll and not over the speaker is an edit,
          grain over both is a filter. */}
      {clip.overlay !== 'none' ? (
        <BrollOverlay type={clip.overlay} seed={clip.id} progress={progress} accent={clip.accent} cheap={cheap} />
      ) : null}

      {/* Over the picture, inside the clip's own frame — a glitch that spilled
          past the insert would tear the speaker either side of it too. */}
      {effect ? (
        <ClipTransitionEffect {...effect} seed={clip.id} frame={frame} width={width} height={height} cheap={cheap} />
      ) : null}
      {outgoing ? (
        <ClipTransitionEffect {...outgoing} seed={clip.id} frame={frame} width={width} height={height} cheap={cheap} />
      ) : null}
    </AbsoluteFill>
  );
};

/** Slow, deliberate moves — anything faster reads as a mistake. */
function kenBurns(kind: BrollClip['kenBurns'], progress: number) {
  switch (kind) {
    case 'in':
      return { scale: 1.04 + progress * 0.09, translateX: 0, translateY: 0 };
    case 'out':
      return { scale: 1.13 - progress * 0.09, translateX: 0, translateY: 0 };
    case 'pan-left':
      return { scale: 1.12, translateX: 2.5 - progress * 5, translateY: 0 };
    case 'pan-right':
      return { scale: 1.12, translateX: -2.5 + progress * 5, translateY: 0 };
    default:
      // Even "none" gets a hair of movement: a perfectly static insert against
      // a moving talking head looks like a freeze frame.
      return { scale: 1.02 + progress * 0.015, translateX: 0, translateY: 0 };
  }
}
