import React from 'react';
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion';
import { sfxDurationSec } from '../src/lib/assets/sfx';
import { layoutPlan } from '../src/lib/styles/layouts';
import { FONT_FAMILY } from './lib/fonts';
import type { Edl } from '../src/lib/edl/types';
import { BrollLayer } from './components/BrollLayer';
import { Captions } from './components/Captions';
import { Graphics } from './components/Graphics';
import { Annotations } from './components/Annotations';
import { IconCards } from './components/IconCards';
import { Overlays } from './components/Overlays';
import { Scenes } from './components/Scenes';
import { Transitions } from './components/Transitions';
import { Headline } from './components/Headline';
import { Watermark } from './components/Watermark';
import { VideoTrack } from './components/VideoTrack';
import { PreviewVideoTrack } from './components/PreviewVideoTrack';

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
  /**
   * Draw the cheap version of the expensive effects.
   *
   * Set only by the browser preview. A gradient caption's outline is eight
   * `drop-shadow` passes per word, which a render pays once per frame at its
   * own pace and a browser pays thirty times a second while somebody is
   * dragging a clip. Four passes at preview size look the same; keeping time
   * does not.
   */
  lowDetail?: boolean;
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
 *   3. headline           — the band a bulletin layout reserves at the top
 *   4. graphics           — sit on top of both
 *   5. captions           — must never be covered, so they go above graphics
 *   6. transitions        — flash across everything at a cut
 *   7. overlays           — the video's own chrome, above all of it
 *   8. watermark          — the free tier's mark, above even that, because a
 *                           watermark something else can cover is not one
 */
export const EasyCutVideo: React.FC<EasyCutVideoProps> = ({ edl, previewAudio = false, onMediaError, lowDetail = false }) => {
  const { fps } = useVideoConfig();

  const plan = layoutPlan(edl.format.layout, edl.format);

  /*
   * A reaction cut and a commentary bubble invert the two bottom layers.
   *
   * Everywhere else the speaker is the base and B-roll covers them. Here the
   * picture is the base and the speaker sits on it in a corner box — which is
   * the whole point of the format, and is achieved by ordering rather than by
   * a second copy of the video: `VideoTrack` shrinks itself to the inset over
   * exactly the frames the insert is up, so one decode serves both states.
   */
  const speakerOnTop = plan.stack === 'over';
  /*
   * Two ways to show the same footage, and the difference is the cut.
   *
   * The renderer wants a sequence per segment: it draws one frame at a time
   * and does not care how many elements there are. A browser does. Each
   * sequence is its own video element, a new element seeks, and Remotion stops
   * the Player's clock until a seeking element produces a frame — a stall at
   * every cut, by design. So the editor plays one element for the whole edit
   * and moves its own `currentTime` at the cuts. See PreviewVideoTrack.
   */
  const speaker = lowDetail ? (
    <PreviewVideoTrack edl={edl} withAudio={previewAudio} onMediaError={onMediaError} />
  ) : (
    <VideoTrack edl={edl} onMediaError={onMediaError} />
  );
  const broll = <BrollLayer edl={edl} onMediaError={onMediaError} cheap={lowDetail} />;

  return (
    <AbsoluteFill style={{ backgroundColor: '#0D0D10', fontFamily: FONT_FAMILY }}>
      {speakerOnTop ? broll : speaker}
      {speakerOnTop ? speaker : broll}
      {/* Above the footage and the B-roll, because a scene REPLACES the
          picture rather than sitting on it — that is what separates a faceless
          animation from the six overlay graphics below. Still under the
          captions: the words stay on screen over a scene, which is most of why
          a faceless edit is watchable with the sound off. */}
      <Scenes edl={edl} />
      {plan.headline ? <Headline edl={edl} /> : null}
      <Graphics edl={edl} />
      {/* Under the captions, deliberately. A card rises from a floor below
          where it lands, so for a few frames it passes through the caption
          band — and the words have to stay on top of it, not the other way
          round. */}
      {/* Above the picture and below the captions: an annotation stands on
          the live frame beside the speaker, so it has to clear the words the
          same way the icon cards do. */}
      <Annotations edl={edl} />
      <IconCards edl={edl} />
      <Captions edl={edl} positionY={plan.captionY} lowDetail={lowDetail} />
      <Transitions edl={edl} cheap={lowDetail} />
      <Overlays edl={edl} cheap={lowDetail} />
      {edl.watermark ? <Watermark cheap={lowDetail} /> : null}

      {previewAudio ? <PreviewAudio edl={edl} fps={fps} withVoice={!lowDetail} /> : null}
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
/**
 * Nothing in the preview mix may stop the picture.
 *
 * Remotion pauses the whole Player while any media element is buffering —
 * sensible for a render, wrong for an editor, and expensive here in
 * particular: the director puts a whoosh ON the cut, so the element that
 * mounts and seeks at the worst possible moment is a sound effect. Measured on
 * a real edit, that was a 27–34ms freeze at every cut and once, where two
 * effects and a transition landed together, 667ms.
 *
 * `pauseWhenBuffering={false}` says: if a sound is not ready, let it be late
 * or let it be missed. This is the preview; the export mixes the audio with
 * ffmpeg and cannot drop anything.
 */
const PREVIEW_AUDIO = { pauseWhenBuffering: false } as const;

const PreviewAudio: React.FC<{ edl: Edl; fps: number; withVoice?: boolean }> = ({
  edl,
  fps,
  withVoice = true,
}) => (
  <>
    {/* The voice, one element per segment — unless the single preview video
        element is already carrying it, in which case a second copy would be
        both an echo and another thing to seek at every cut. */}
    {(withVoice ? edl.segments : []).map((segment) => (
      <Sequence
        key={`audio-${segment.id}`}
        from={Math.round(segment.outStartSec * fps)}
        durationInFrames={Math.max(1, Math.round((segment.outEndSec - segment.outStartSec) * fps))}
        layout="none"
      >
        <Audio
          {...PREVIEW_AUDIO}
          src={edl.source.url}
          trimBefore={Math.round(segment.sourceStartSec * fps)}
          trimAfter={Math.ceil(segment.sourceEndSec * fps)}
          playbackRate={segment.speed}
        />
      </Sequence>
    ))}

    {edl.music ? (
      <Audio
        {...PREVIEW_AUDIO}
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
          // Mounted a second early so the file is loaded and seeked before the
          // cut it sits on, rather than at it.
          premountFor={Math.round(fps)}
        >
          <Audio {...PREVIEW_AUDIO} src={cue.url} volume={Math.pow(10, cue.gainDb / 20)} />
        </Sequence>
      ) : null,
    )}
  </>
);
