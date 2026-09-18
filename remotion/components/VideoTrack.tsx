import React from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Edl } from '../../src/lib/edl/types';
import { cameraFrame, punchScaleAt, sampleTrack } from '../lib/reframe';
import { ramp } from '../lib/timing';
import { brollCoverage, layoutPlan, lerpRegion, regionStyle } from '../../src/lib/styles/layouts';

/**
 * The speaker.
 *
 * Each surviving segment is its own `<Sequence>` pointing at a slice of the
 * single source file. Remotion seeks rather than re-encodes, so a 40-cut edit
 * costs no more to render than an uncut one.
 *
 * Audio is muted here on purpose — the finished audio is built separately by
 * ffmpeg (concat, loudness, ducking, effects) and muxed in at the end. Letting
 * the browser mix audio would be slower and would lose the sidechain ducking.
 */
export const VideoTrack: React.FC<{ edl: Edl; onMediaError?: (message: string) => void }> = ({ edl, onMediaError }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const outSec = frame / fps;

  // The speaker gets a box rather than the frame: on a split screen it is the
  // upper half, and the crop has to be computed against THAT shape or the
  // picture is letterboxed inside its own half.
  const plan = layoutPlan(edl.format.layout, edl.format);

  /*
   * On a reaction cut the box MOVES.
   *
   * Full frame while there is nothing else to look at; the corner the moment a
   * picture comes up; back again when it goes. `brollCoverage` is ramped at
   * both ends, so this is a slide rather than a jump — and because the crop is
   * recomputed from the box every frame, the face stays framed the whole way
   * down instead of being squashed into the corner and re-centred afterwards.
   */
  const coverage = plan.speakerWithBroll ? brollCoverage(edl.broll, outSec) : 0;
  const region = plan.speakerWithBroll
    ? lerpRegion(plan.speaker, plan.speakerWithBroll, ease(coverage))
    : plan.speaker;
  const inset = coverage > 0.001;

  const viewport = {
    width: Math.max(2, Math.round(edl.format.width * region.w)),
    height: Math.max(2, Math.round(edl.format.height * region.h)),
  };

  const crop = sampleTrack(edl.reframe, outSec);
  const punch = punchScaleAt(edl.punchIns, outSec, (from, to) =>
    ramp(frame, from * fps, to * fps),
  );
  const camera = cameraFrame(edl, crop, punch, viewport);

  return (
    <AbsoluteFill
      style={{
        ...regionStyle(region),
        backgroundColor: '#000',
        overflow: 'hidden',
        /*
         * The inset needs to read as a thing sitting ON the picture, not as a
         * hole cut in it. A corner radius and a lifted edge do that; without
         * them a square of face in the corner looks like a rendering fault.
         * Both scale with the coverage so they arrive with the box.
         */
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
      {edl.segments.map((segment) => {
        const from = Math.round(segment.outStartSec * fps);
        const durationInFrames = Math.max(1, Math.round((segment.outEndSec - segment.outStartSec) * fps));

        return (
          <Sequence
            key={segment.id}
            from={from}
            durationInFrames={durationInFrames}
            // Warms the decoder before the cut, so the first frame of each
            // segment isn't a flash of black on a fast edit. Premounting is a
            // property of the default absolute-fill layout, so no `layout` here.
            premountFor={Math.round(fps * 0.5)}
          >
            <AbsoluteFill style={{ overflow: 'hidden' }}>
              <OffthreadVideo
                // Present only in the preview. Absent in a render, where a
                // source the renderer cannot decode must fail the job rather
                // than leave a black hole in the delivered video.
                onError={onMediaError ? (e) => onMediaError(e.message) : undefined}
                src={edl.source.url}
                // Trims are expressed in COMPOSITION frames, not source frames —
                // a 60 fps source in a 30 fps composition would otherwise play
                // the wrong half of every clip.
                trimBefore={Math.round(segment.sourceStartSec * fps)}
                trimAfter={Math.ceil(segment.sourceEndSec * fps)}
                playbackRate={segment.speed}
                muted
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
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

/**
 * Ease in and out of the corner.
 *
 * Linear movement between two sizes looks mechanical — the box appears to be
 * dragged. A smoothstep starts and finishes slowly and covers the middle fast,
 * which is what a cut feels like.
 */
function ease(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}
