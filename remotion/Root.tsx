import React from 'react';
import { Composition } from 'remotion';
import { EasyCutVideo } from './EasyCutVideo';
import { SAMPLE_EDL } from './sample-edl';
import type { Edl } from '../src/lib/edl/types';

/**
 * One composition, fully driven by input props.
 *
 * `calculateMetadata` reads the dimensions, fps and duration straight off the
 * EDL, which is why a single composition can render a 9:16 short and a 16:9
 * ten-minute piece without registering a second one — and why the Studio can
 * open any real project's EDL for debugging.
 */
export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="EasyCutVideo"
      component={EasyCutVideo as unknown as React.FC<Record<string, unknown>>}
      // Placeholders; calculateMetadata overrides all of these from the EDL.
      durationInFrames={300}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ edl: SAMPLE_EDL as unknown as Edl, previewAudio: false } as Record<string, unknown>}
      calculateMetadata={({ props }) => {
        const edl = (props as { edl: Edl }).edl;
        const fps = edl.format.fps || 30;
        return {
          width: edl.format.width,
          height: edl.format.height,
          fps,
          durationInFrames: Math.max(1, Math.round(edl.format.durationSec * fps)),
        };
      }}
    />
  </>
);
