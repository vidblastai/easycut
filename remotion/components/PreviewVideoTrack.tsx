import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { AbsoluteFill, Internals, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Edl } from '../../src/lib/edl/types';
import { brollCoverage, layoutPlan, lerpRegion, regionStyle } from '../../src/lib/styles/layouts';
import { cameraFrame, punchScaleAt, sampleTrack } from '../lib/reframe';
import { ramp } from '../lib/timing';
import { sourceTimeAt } from '../../src/lib/timeline/source-time';

/**
 * The speaker's footage in the EDITOR, as one video element for the whole edit.
 *
 * ── Why this exists, and why it is not `VideoTrack` ─────────────────────
 *
 * In the renderer each segment is its own `<Sequence>` with its own video, and
 * that is correct: a render draws one frame at a time and does not care how
 * many elements there are. In the browser it is the reason the preview froze
 * at every cut, and Remotion's own source says so plainly: when a media
 * element seeks, `bufferUntilFirstFrame` puts the PLAYER into a buffering
 * state — it stops the clock and everything on it until that element produces
 * a frame. A new segment going live is a new element, and a new element seeks.
 * So every cut is a deliberate, unavoidable stall, once per cut, forever.
 *
 * The fix is to take the footage out of Remotion's media system. All the
 * segments come from ONE file, so one element can play all of them: it is
 * mounted for the whole composition, and at a cut it moves its own
 * `currentTime`. Remotion never learns about that seek, so the clock never
 * stops; and because the file is already in memory (see `usePreloadedVideo`)
 * the seek is a memory offset, which lands in a frame or two.
 *
 * Everything else about the preview — captions, B-roll, graphics, overlays —
 * stays exactly as it is. This replaces one layer, in the browser only.
 */

/** A gap this big means the edit jumped: a cut, or somebody scrubbing. */
const SEEK_THRESHOLD_SEC = 0.25;
/** Below this, leave the element alone and let it play at its own rate. */
const NUDGE_THRESHOLD_SEC = 0.08;

/** The same easing the renderer's video track uses, so the two agree. */
function ease(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export const PreviewVideoTrack: React.FC<{
  edl: Edl;
  /** The preview carries the voice; the render mixes it separately. */
  withAudio?: boolean;
  onMediaError?: (message: string) => void;
}> = ({ edl, withAudio = false, onMediaError }) => {
  const frame = useCurrentFrame();
  const { fps, width: frameWidth, height: frameHeight } = useVideoConfig();
  /* The Player's own transport state, so this element starts and stops with
     everything else rather than guessing from the frame advancing. */
  const isPlaying = Internals.Timeline.usePlaying();

  const ref = useRef<HTMLVideoElement>(null);
  const outSec = frame / fps;

  const plan = layoutPlan(edl.format.layout, edl.format);
  const coverage = plan.speakerWithBroll ? brollCoverage(edl.broll, outSec) : 0;
  const region = plan.speakerWithBroll
    ? lerpRegion(plan.speaker, plan.speakerWithBroll, ease(coverage))
    : plan.speaker;
  const inset = coverage > 0.001;

  const shaped =
    plan.speakerShape === 'circle'
      ? { borderRadius: '50%', boxShadow: '0 1.2% 3% rgba(0,0,0,.55)' }
      : plan.frameRadius
        ? { borderRadius: `${plan.frameRadius}%` }
        : null;

  const viewport = {
    width: Math.max(2, Math.round(frameWidth * region.w)),
    height: Math.max(2, Math.round(frameHeight * region.h)),
  };
  const crop = sampleTrack(edl.reframe, outSec);
  const punch = punchScaleAt(edl.punchIns, outSec, (from, to) => ramp(frame, from * fps, to * fps));
  const camera = cameraFrame(edl, crop, punch, viewport);

  /* Where in the source file this moment of the edit lives. */
  const { segment, sourceSec } = sourceTimeAt(edl.segments, outSec);

  /*
   * Kept in step by hand, every frame.
   *
   * A layout effect rather than an effect: this runs before the browser
   * paints, so the picture and the captions over it belong to the same moment
   * rather than being a frame apart at every cut.
   */
  useLayoutEffect(() => {
    const video = ref.current;
    if (!video || !segment) return;

    const rate = Math.max(0.0625, segment.speed);
    if (video.playbackRate !== rate) video.playbackRate = rate;

    const drift = video.currentTime - sourceSec;
    if (Math.abs(drift) > SEEK_THRESHOLD_SEC) {
      // A cut, or a scrub. One assignment; no request, because the file is
      // already in memory.
      video.currentTime = sourceSec;
    } else if (!isPlaying && Math.abs(drift) > NUDGE_THRESHOLD_SEC) {
      // Paused and slightly off — land it exactly, so a still frame is the
      // frame the timeline says it is.
      video.currentTime = sourceSec;
    }

    if (isPlaying && video.paused) {
      void video.play().catch(() => {
        /* Autoplay refusals are the browser's business, not an edit's. */
      });
    } else if (!isPlaying && !video.paused) {
      video.pause();
    }
  });

  /* Muted elements are allowed to play without a gesture; an unmuted one is
     not, so the voice arrives on the first press of play rather than never. */
  useEffect(() => {
    const video = ref.current;
    if (video) video.muted = !withAudio;
  }, [withAudio]);

  return (
    <AbsoluteFill
      style={{
        ...regionStyle(region),
        backgroundColor: '#000',
        overflow: 'hidden',
        ...shaped,
        ...(inset
          ? {
              borderRadius: `${(coverage * 2.2).toFixed(2)}%`,
              boxShadow: `0 ${(coverage * 18).toFixed(1)}px ${(coverage * 42).toFixed(1)}px rgba(0,0,0,${(coverage * 0.55).toFixed(3)})`,
              outline: `${(coverage * 3).toFixed(2)}px solid rgba(255,255,255,${(coverage * 0.14).toFixed(3)})`,
              outlineOffset: '-1px',
            }
          : null),
      }}
    >
      <video
        ref={ref}
        src={edl.source.url}
        preload="auto"
        playsInline
        muted={!withAudio}
        onError={onMediaError ? () => onMediaError('This browser could not play the preview copy.') : undefined}
        style={{
          position: 'absolute',
          width: camera.width,
          height: camera.height,
          left: camera.left,
          top: camera.top,
          objectFit: 'fill',
        }}
      />
    </AbsoluteFill>
  );
};
