import type { Edl } from '@/lib/edl/types';
import { sourceTimeAt } from './source-time';

/**
 * What the editor's pair of video elements should do on this frame.
 *
 * The editor plays the edit through two elements that leapfrog the cuts: one
 * on screen, one already parked on the first frame of the next segment. This
 * decides, for a single frame, whether they swap, whether anything has to
 * seek, and what the standby should be getting ready for.
 *
 * It is a pure function because the alternative is untestable: the real thing
 * runs inside a layout effect against two media elements, and the failure mode
 * — a seek at the wrong moment — is exactly the stutter the pair exists to
 * remove. See PreviewVideoTrack.
 */

export interface PreviewPlanInput {
  segments: Edl['segments'];
  /** Where the edit is now, in output seconds. */
  outSec: number;
  /** The segment the visible element is currently playing. */
  liveSegmentId: string | null;
  /** The segment the standby has been parked on, if any. */
  readySegmentId: string | null;
  /** The visible element's own clock. */
  liveTime: number;
  playing: boolean;
  /** A gap this big means the edit jumped rather than played. */
  resyncSec?: number;
}

export interface PreviewPlan {
  segmentId: string | null;
  /** The source time the visible element should be showing. */
  sourceSec: number;
  speed: number;
  /** The edit has moved to a different segment since the last frame. */
  changed: boolean;
  /** Show the standby instead: it is already parked on this segment. */
  swap: boolean;
  /** Move the visible element's clock here. Null means leave it alone. */
  seekTo: number | null;
  /** Park the standby on this segment, ready for the next cut. */
  prepare: { id: string; at: number; speed: number } | null;
}

export function planPreviewFrame(input: PreviewPlanInput): PreviewPlan {
  const {
    segments,
    outSec,
    liveSegmentId,
    readySegmentId,
    liveTime,
    playing,
    resyncSec = 0.3,
  } = input;

  const { segment, sourceSec } = sourceTimeAt(segments, outSec);
  if (!segment) {
    return {
      segmentId: null, sourceSec, speed: 1, changed: false, swap: false,
      seekTo: null, prepare: null,
    };
  }

  const speed = Math.max(0.0625, segment.speed || 1);
  const changed = liveSegmentId !== segment.id;
  // The standby is only useful if it was parked on the segment we have just
  // arrived at. Anything else — a scrub, a first frame, a jump the preparation
  // did not see coming — means the visible element has to seek instead.
  const swap = changed && readySegmentId === segment.id;

  let seekTo: number | null = null;
  if (changed && !swap) {
    seekTo = sourceSec;
  } else if (!changed) {
    const drift = Math.abs(liveTime - sourceSec);
    // While playing, leave small drift alone: the element is the clock, and
    // correcting it every frame would be a seek every frame.
    if (drift > resyncSec) seekTo = sourceSec;
    // Paused, land exactly on the frame the timeline claims to show.
    else if (!playing && drift > 0.04) seekTo = sourceSec;
  }

  const index = segments.indexOf(segment);
  const next = segments[index + 1];
  // After a swap the standby is whatever just finished, so its old parking is
  // meaningless: prepare again for the cut ahead.
  const parked = swap ? null : readySegmentId;

  /*
   * Prepare the moment we know what is next — not shortly before the cut.
   *
   * Parking the standby means seeking it, and a seek is the one thing in here
   * that costs real time: the decoder has to find a keyframe and decode
   * forward to the target while the other element is mid-playback. That cost
   * does not disappear, so the only question is WHEN the viewer pays it.
   *
   * It used to be paid a second or so before each cut, which is the worst
   * possible moment: the picture is steady, the eye is settled, and the hitch
   * arrives out of nowhere with nothing to explain it. So it read as the edit
   * stopping just before every new clip — which is exactly what it was.
   *
   * Now it is paid at the cut itself, in the same frame as the swap. The
   * picture is changing completely at that instant anyway, so the one frame
   * the decoder takes is hidden under the change the viewer is already looking
   * at. Preparing this early also gives the standby the WHOLE segment to get
   * ready in rather than 1.2 seconds, so it is more reliably decoded by the
   * time the cut arrives, not less.
   *
   * Not on a frame that is already seeking, though. `changed && !swap` is a
   * scrub or a jump, where the visible element needs the decoder for the frame
   * the user is dragging to; asking it to park the standby in the same breath
   * is two seeks for one frame, and the drag is what has to stay responsive.
   * The frame after it settles prepares instead.
   */
  const prepare =
    next && parked !== next.id && (swap || !changed)
      ? { id: next.id, at: next.sourceStartSec, speed: Math.max(0.0625, next.speed || 1) }
      : null;

  return { segmentId: segment.id, sourceSec, speed, changed, swap, seekTo, prepare };
}
