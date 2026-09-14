import React from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Edl } from '../../src/lib/edl/types';
import { cameraFrame, punchScaleAt, sampleTrack } from '../lib/reframe';
import { ramp } from '../lib/timing';

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
export const VideoTrack: React.FC<{ edl: Edl }> = ({ edl }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const outSec = frame / fps;

  const crop = sampleTrack(edl.reframe, outSec);
  const punch = punchScaleAt(edl.punchIns, outSec, (from, to) =>
    ramp(frame, from * fps, to * fps),
  );
  const camera = cameraFrame(edl, crop, punch);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
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
