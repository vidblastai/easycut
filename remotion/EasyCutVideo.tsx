import React from 'react';
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion';
import { sfxDurationSec } from '../src/lib/assets/sfx';
import { FONT_FAMILY } from './lib/fonts';
import type { Edl } from '../src/lib/edl/types';
import { BrollLayer } from './components/BrollLayer';
import { Captions } from './components/Captions';
import { Graphics } from './components/Graphics';
import { Overlays } from './components/Overlays';
import { Transitions } from './components/Transitions';
import { VideoTrack } from './components/VideoTrack';

export interface EasyCutVideoProps {
  edl: Edl;
  /**
   * When true, the composition plays audio itself (music, SFX and the source's
   * own track). The cloud render leaves this off and muxes ffmpeg's mix instead;
   * the browser preview turns it on so the user can hear roughly what they'll get.
   */
  previewAudio?: boolean;
}

/**
 * The finished video, as a component.
 *
 * Layer order is the whole design, and it is deliberate:
 *
 *   1. speaker            — the thing the viewer came for
 *   2. B-roll             — covers the speaker when it plays
 *   3. graphics           — sit on top of both
 *   4. captions           — must never be covered, so they go above graphics
 *   5. transitions        — flash across everything at a cut
 *   6. overlays           — the video's own chrome, above all of it
 */
export const EasyCutVideo: React.FC<EasyCutVideoProps> = ({ edl, previewAudio = false }) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: '#0D0D10', fontFamily: FONT_FAMILY }}>
      <VideoTrack edl={edl} />
      <BrollLayer edl={edl} />
      <Graphics edl={edl} />
      <Captions edl={edl} />
      <Transitions edl={edl} />
      <Overlays edl={edl} />

      {previewAudio ? <PreviewAudio edl={edl} fps={fps} /> : null}
    </AbsoluteFill>
  );
};

/**
 * Browser-side approximation of the final mix.
 *
 * It cannot reproduce the sidechain ducking (there is no compressor in a
 * `<Audio>` tag), so the music sits at a fixed, already-ducked level. That is
 * close enough to judge an edit by, and the exported file gets the real mix.
 */
const PreviewAudio: React.FC<{ edl: Edl; fps: number }> = ({ edl, fps }) => (
  <>
    {edl.segments.map((segment) => (
      <Sequence
        key={`audio-${segment.id}`}
        from={Math.round(segment.outStartSec * fps)}
        durationInFrames={Math.max(1, Math.round((segment.outEndSec - segment.outStartSec) * fps))}
        layout="none"
      >
        <Audio
          src={edl.source.url}
          trimBefore={Math.round(segment.sourceStartSec * fps)}
          trimAfter={Math.ceil(segment.sourceEndSec * fps)}
          playbackRate={segment.speed}
        />
      </Sequence>
    ))}

    {edl.music ? (
      <Audio
        src={edl.music.url}
        loop
        // Pre-ducked: the preview has no compressor, so bias toward the voice.
        volume={Math.pow(10, (edl.music.gainDb + edl.music.duckDb * 0.65) / 20)}
      />
    ) : null}

    {/* Each cue is bounded by how long it actually sounds for.
        A Sequence with no `durationInFrames` runs to the end of the video, so
        every sound effect kept its audio element mounted from the moment it
        played until the credits — and the browser caps how many media elements
        can exist at once. Four cues plus the music plus the voice was enough to
        hit it, and the Player refused to mount anything further with "tried to
        simultaneously mount 6 <Html5Audio /> tags": the preview lost its sound
        entirely, on an edit with four whooshes in it. */}
    {edl.sfx.map((cue) =>
      cue.url ? (
        <Sequence
          key={`sfx-${cue.id}`}
          from={Math.round(cue.atSec * fps)}
          durationInFrames={Math.max(1, Math.ceil(sfxDurationSec(cue.sound) * fps))}
          layout="none"
        >
          <Audio src={cue.url} volume={Math.pow(10, cue.gainDb / 20)} />
        </Sequence>
      ) : null,
    )}
  </>
);
