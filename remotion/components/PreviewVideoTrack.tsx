import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { AbsoluteFill, Internals, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Edl } from '../../src/lib/edl/types';
import { brollCoverage, layoutPlan, lerpRegion, regionStyle } from '../../src/lib/styles/layouts';
import { cameraFrame, punchScaleAt, sampleTrack } from '../lib/reframe';
import { ramp } from '../lib/timing';
import { planPreviewFrame } from '../../src/lib/timeline/preview-plan';

/**
 * The speaker's footage in the EDITOR: two elements, leapfrogging the cuts.
 *
 * ── The problem, precisely ──────────────────────────────────────────────
 *
 * The renderer gives every segment its own `<Sequence>` and its own video
 * element. That is right for a render and wrong for a browser: Remotion's
 * `use-media-playback` calls `bufferUntilFirstFrame` whenever a media element
 * seeks, which stops the Player's clock until that element produces a frame.
 * A cut mounts an element, the element seeks, the world stops. Once per cut,
 * by design.
 *
 * Playing everything through ONE element, seeking it by hand, removed that —
 * but not the seek itself. An in-memory seek is fast, not free: the decoder
 * still has to find the keyframe before the target and decode forward to it,
 * and the picture holds the old frame while it does. On a cut every second or
 * two, that is exactly the stutter you can see.
 *
 * ── What this does instead ──────────────────────────────────────────────
 *
 * Two elements, and the next cut is already prepared before it arrives. One
 * plays the current segment. The other sits paused at the FIRST FRAME of the
 * next one, decoded and ready. At the cut they swap: the standby is already
 * showing the right frame, so it only has to start playing, and the one that
 * just finished becomes the standby and goes off to prepare the cut after
 * that. The seek never happens while anybody is watching.
 *
 * This is what a native editor does with its decoders, and it is the only way
 * to make a cut cost nothing in a browser. Both elements are mounted for the
 * whole session, so nothing is ever created mid-playback, and Remotion is
 * never told about any of it — the clock cannot stop for a seek it does not
 * know happened.
 *
 * The renderer is untouched: it still uses `VideoTrack`, one sequence per
 * segment, and the exported file is unchanged.
 */

/** A gap this big means the edit jumped — a scrub, not playback. */
const RESYNC_THRESHOLD_SEC = 0.3;
/**
 * Not zero, and that is the whole trick.
 *
 * A `<video>` at `opacity: 0` is a layer a browser is free to stop compositing,
 * and one it is no longer compositing is one whose decoded frame it may throw
 * away — so the standby we carefully parked on the next cut's first frame has
 * to produce that frame again at the cut, which is the stall we are here to
 * remove. A hair above zero keeps the layer alive and the frame decoded, and is
 * invisible under an opaque element covering exactly the same box.
 */
const STANDBY_OPACITY = '0.001';

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
  /* The Player's own transport state, so these elements start and stop with
     everything else rather than guessing from the frame advancing. */
  const isPlaying = Internals.Timeline.usePlaying();

  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  /** Which element is on screen: the other one is preparing the next cut. */
  const liveIsA = useRef(true);
  /** The segment the live element is playing, so a change means a cut. */
  const liveSegment = useRef<string | null>(null);
  /** The segment the standby has been prepared for, to prepare it only once. */
  const readySegment = useRef<string | null>(null);

  const outSec = frame / fps;

  /* ---- geometry, identical to the renderer's video track ---- */
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

  /*
   * Every frame: swap, seek or prepare — whichever this moment calls for.
   *
   * The decision itself lives in `planPreviewFrame`, which is a pure function
   * with tests of its own: getting it wrong puts the seek back at the cut,
   * which is the stutter this whole arrangement exists to remove, and that is
   * not something to leave untested inside an effect.
   *
   * A layout effect rather than an effect, so the picture and the captions
   * over it belong to the same moment rather than being a frame apart.
   */
  useLayoutEffect(() => {
    const a = aRef.current;
    const b = bRef.current;
    if (!a || !b) return;

    let live = liveIsA.current ? a : b;
    let standby = liveIsA.current ? b : a;

    const plan = planPreviewFrame({
      segments: edl.segments,
      outSec,
      liveSegmentId: liveSegment.current,
      readySegmentId: readySegment.current,
      liveTime: live.currentTime,
      playing: isPlaying,
      resyncSec: RESYNC_THRESHOLD_SEC,
    });
    if (!plan.segmentId) return;

    if (plan.swap) {
      // The standby has been sitting on this segment's first frame, decoded.
      // Swapping is two style changes and a play() — no seek, nothing to wait
      // for, which is the entire point of keeping a pair.
      liveIsA.current = !liveIsA.current;
      const wasLive = live;
      live = standby;
      standby = wasLive;

      live.style.opacity = '1';
      live.style.zIndex = '1';
      standby.style.opacity = STANDBY_OPACITY;
      standby.style.zIndex = '0';
      standby.pause();
      standby.muted = true;
      live.muted = !withAudio;
    }

    if (plan.changed) {
      liveSegment.current = plan.segmentId;
      readySegment.current = null;
    }

    if (live.playbackRate !== plan.speed) live.playbackRate = plan.speed;
    if (plan.seekTo !== null) live.currentTime = plan.seekTo;

    if (isPlaying && live.paused) {
      void live.play().catch(() => {
        /* Autoplay refusals are the browser's business, not an edit's. */
      });
    } else if (!isPlaying && !live.paused) {
      live.pause();
    }

    if (plan.prepare) {
      readySegment.current = plan.prepare.id;
      standby.pause();
      standby.muted = true;
      // Decoding this frame now is the work that used to happen AT the cut.
      standby.currentTime = plan.prepare.at;
      standby.playbackRate = plan.prepare.speed;
    }
  });

  useEffect(() => {
    const live = liveIsA.current ? aRef.current : bRef.current;
    if (live) live.muted = !withAudio;
  }, [withAudio]);

  /*
   * The camera as a transform, not as a box.
   *
   * `cameraFrame` gives a rectangle, and writing it to `width`/`height`/`left`/
   * `top` is a layout pass and a rescale of the video's destination rect on
   * every frame a punch-in or a reframe is moving — which is most frames, and
   * a punch-in usually begins ON a cut. The same rectangle expressed as a
   * translate and a scale from the top-left corner is identical to the pixel
   * and never leaves the compositor.
   */
  const videoStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: viewport.width,
    height: viewport.height,
    objectFit: 'fill',
    transformOrigin: '0 0',
    transform: `translate3d(${camera.left}px, ${camera.top}px, 0) scale(${camera.width / viewport.width}, ${camera.height / viewport.height})`,
    // Both elements keep their own compositor layer for the whole session, so
    // the swap at a cut is a layer flip rather than a rasterisation.
    backfaceVisibility: 'hidden',
    willChange: 'transform, opacity',
  };

  return (
    <AbsoluteFill
      style={{
        ...regionStyle(region),
        backgroundColor: '#000',
        overflow: 'hidden',
        /*
         * Keep the pair's z-indexes inside this box.
         *
         * The two elements use `zIndex` 0 and 1 to say which of THEM is in
         * front. Without a stacking context of its own, that 1 is measured
         * against the whole composition — so the video sorts above the caption
         * layer and the captions vanish behind the picture. (It only started
         * mattering when the camera became a transform, which promotes the
         * element to its own layer; the bug was always there waiting.)
         */
        isolation: 'isolate',
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
      {/* The pair. Both mounted for the whole session: an element created
          mid-playback is the thing this exists to avoid. */}
      <video
        ref={aRef}
        src={edl.source.url}
        preload="auto"
        playsInline
        onError={onMediaError ? () => onMediaError('This browser could not play the preview copy.') : undefined}
        style={{ ...videoStyle, opacity: 1, zIndex: 1 }}
      />
      <video
        ref={bRef}
        src={edl.source.url}
        preload="auto"
        playsInline
        muted
        style={{ ...videoStyle, opacity: Number(STANDBY_OPACITY), zIndex: 0 }}
      />
    </AbsoluteFill>
  );
};
