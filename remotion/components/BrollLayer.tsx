import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { BrollClip, Edl } from '../../src/lib/edl/types';
import { lifecycleOpacity, ramp } from '../lib/timing';

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
export const BrollLayer: React.FC<{ edl: Edl; onMediaError?: (message: string) => void }> = ({ edl, onMediaError }) => {
  const { fps } = useVideoConfig();

  return (
    <>
      {edl.broll.map((clip) => {
        if (!clip.url) return null;
        const from = Math.round(clip.outStartSec * fps);
        const durationInFrames = Math.max(1, Math.round((clip.outEndSec - clip.outStartSec) * fps));

        return (
          <Sequence key={clip.id} from={from} durationInFrames={durationInFrames} premountFor={Math.round(fps)}>
            <BrollInsert clip={clip} durationInFrames={durationInFrames} onMediaError={onMediaError} />
          </Sequence>
        );
      })}
    </>
  );
};

const BrollInsert: React.FC<{ clip: BrollClip; durationInFrames: number; onMediaError?: (message: string) => void }> = ({ clip, durationInFrames, onMediaError }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Short cross-fades at both ends; a hard cut to stock is jarring against a
  // continuous voice track.
  const opacity = lifecycleOpacity(frame, durationInFrames, Math.round(fps * 0.12)) * clip.opacity;

  const progress = ramp(frame, 0, durationInFrames);
  const { scale, translateX, translateY } = kenBurns(clip.kenBurns, progress);

  const isVideo = clip.kind === 'stock-video';

  return (
    <AbsoluteFill style={{ opacity, overflow: 'hidden', backgroundColor: '#000' }}>
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
