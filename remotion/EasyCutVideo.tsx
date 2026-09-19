import React from 'react';
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion';
import { sfxDurationSec } from '../src/lib/assets/sfx';
import { layoutPlan } from '../src/lib/styles/layouts';
import { FONT_FAMILY } from './lib/fonts';
import type { Edl } from '../src/lib/edl/types';
import { BrollLayer } from './components/BrollLayer';
import { Captions } from './components/Captions';
import { Graphics } from './components/Graphics';
import { Overlays } from './components/Overlays';
import { Transitions } from './components/Transitions';
import { Watermark } from './components/Watermark';
import { VideoTrack } from './components/VideoTrack';

export interface EasyCutVideoProps {
  edl: Edl;
  /**
   * When true, the composition plays audio itself (music, SFX and the source's
   * own track). The cloud render leaves this off and muxes ffmpeg's mix instead;
   * the browser preview turns it on so the user can hear roughly what they'll get.
   */
  previewAudio?: boolean;
  /**
   * Somewhere to send a media failure instead of throwing.
   *
   * Supplied only by the browser preview. A render must NOT have it: a source
   * the renderer cannot decode has to fail the job loudly, because the
   * alternative is shipping a video with a silent black hole where a clip was.
   * In the preview the opposite is true — one unreachable B-roll URL should not
   * take down the whole picture while somebody is editing.
   */
  onMediaError?: (message: string) => void;
}

/**
 * The finished video, as a component.
 *
 * Layer order is the whole design, and it is deliberate:
 *
 *   1. speaker            — the thing the viewer came for
 *   2. B-roll             — covers the speaker when it plays
 *                           (on a reaction cut these two swap: the picture
 *                           takes the frame and the speaker rides on top of
 *                           it, shrunk into the corner)
 *   3. graphics           — sit on top of both
 *   4. captions           — must never be covered, so they go above graphics
 *   5. transitions        — flash across everything at a cut
 *   6. overlays           — the video's own chrome, above all of it
 *   7. watermark          — the free tier's mark, above even that, because a
 *                           watermark something else can cover is not one
 */
export const EasyCutVideo: React.FC<EasyCutVideoProps> = ({ edl, previewAudio = false, onMediaError }) => {
  const { fps } = useVideoConfig();

  const plan = layoutPlan(edl.format.layout, edl.format);

  /*
   * A reaction cut inverts the two bottom layers.
   *
   * Everywhere else the speaker is the base and B-roll covers them. Here the
   * picture is the base and the speaker sits on it in a corner box — which is
   * the whole point of the format, and is achieved by ordering rather than by
   * a second copy of the video: `VideoTrack` shrinks itself to the inset over
   * exactly the frames the insert is up, so one decode serves both states.
   */
  const speakerOnTop = plan.speakerWithBroll !== null;
  const speaker = <VideoTrack edl={edl} onMediaError={onMediaError} />;
  const broll = <BrollLayer edl={edl} onMediaError={onMediaError} />;

  return (
    <AbsoluteFill style={{ backgroundColor: '#0D0D10', fontFamily: FONT_FAMILY }}>
      {speakerOnTop ? broll : speaker}
      {speakerOnTop ? speaker : broll}
      <Graphics edl={edl} />
      <Captions edl={edl} positionY={plan.captionY} />
      <Transitions edl={edl} />
      <Overlays edl={edl} />
      {edl.watermark ? <Watermark /> : null}

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
