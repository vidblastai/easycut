import type { Edl } from './types';

/**
 * Putting the cuts on the beat.
 *
 * The music bed already knows its own tempo — every track in the library
 * carries a `bpm`, the asset stage copies it onto the document, and until now
 * absolutely nothing read it. This is the thing it was for.
 *
 * ── What gets moved, and what must not ──────────────────────────────────
 *
 * Only the layers that sit ON TOP of the speech: a B-roll insert arriving, a
 * graphic appearing. Those are free to land a frame or two either side of where
 * the director put them, because what they illustrate is a whole sentence.
 *
 * Nothing that is tied to a syllable moves. An icon card rises on the word it
 * names and a caption is the word; nudging either onto a grid would break the
 * one relationship that makes them work. Neither does the cut itself — the
 * speech segments are the edit, and moving those is a different and much more
 * dangerous idea.
 *
 * ── Why the nudge is small ──────────────────────────────────────────────
 *
 * Because the point is to remove a wrongness, not to impose a rhythm. An insert
 * 80ms off the beat reads as slightly loose; the same insert dragged 300ms to
 * reach a beat reads as late, and it has stopped covering the phrase it was
 * chosen for. So a cue only moves if the beat is already nearly under it, and
 * roughly half of them will be — the rest stay exactly where the director put
 * them, which is the right answer for those.
 */

/** Tempos outside this are either a mis-tagged track or not a tempo at all. */
const BPM_RANGE = [50, 200] as const;

/**
 * The furthest a cue is allowed to travel to reach a beat.
 *
 * Two caps, and the tighter one wins. A quarter of a beat keeps the nudge
 * musically small at any tempo; 0.15s keeps it imperceptible as a timing change
 * at slow ones, where a quarter beat is nearly a third of a second.
 */
export const MAX_NUDGE_SEC = 0.15;

export interface BeatGrid {
  /** Seconds per beat. */
  beatSec: number;
  /** Video time of the first beat. */
  firstSec: number;
}

/**
 * The grid a track lays over the video, or null when there is no usable tempo.
 *
 * `startAtSec` is where the bed was trimmed from, and the bed is laid at video
 * time zero — so a track entered part-way through arrives already part-way
 * through a bar, and the grid is offset by exactly that much. Assuming the
 * first beat sits at video zero is the obvious mistake, and it puts every
 * "aligned" cue a fraction of a beat out, which is worse than not aligning.
 */
export function beatGrid(music: Edl['music']): BeatGrid | null {
  if (!music?.bpm) return null;
  if (music.bpm < BPM_RANGE[0] || music.bpm > BPM_RANGE[1]) return null;

  const beatSec = 60 / music.bpm;
  const phase = ((music.startAtSec % beatSec) + beatSec) % beatSec;
  return { beatSec, firstSec: phase === 0 ? 0 : beatSec - phase };
}

/** The beat nearest a moment, which may be before it. */
export function nearestBeat(atSec: number, grid: BeatGrid): number {
  const beats = Math.round((atSec - grid.firstSec) / grid.beatSec);
  return grid.firstSec + Math.max(0, beats) * grid.beatSec;
}

/**
 * Where a cue should go: the nearest beat, or exactly where it was.
 *
 * Returns the original when the beat is further away than the cue is allowed to
 * travel, which is the common case and is not a failure.
 */
export function alignedTo(atSec: number, grid: BeatGrid, maxNudgeSec = MAX_NUDGE_SEC): number {
  const limit = Math.min(maxNudgeSec, grid.beatSec / 4);
  const beat = nearestBeat(atSec, grid);
  return Math.abs(beat - atSec) <= limit ? beat : atSec;
}

/**
 * Nudges what can move onto the beat, and leaves the rest alone.
 *
 * An insert keeps its LENGTH — the whole clip slides, rather than its start
 * moving and its end staying put, because stretching a clip to reach a beat
 * changes how long the viewer looks at it and that is a different decision.
 *
 * A move is abandoned if it would collide with the neighbour or run off the
 * end. The non-overlap rules that placed these are not re-run here, so the only
 * safe nudge is one that cannot break them.
 */
export function alignToBeat(edl: Edl, maxNudgeSec = MAX_NUDGE_SEC): Edl {
  const grid = beatGrid(edl.music);
  if (!grid) return edl;

  const broll = [...edl.broll].sort((a, b) => a.outStartSec - b.outStartSec);
  const moved = broll.map((clip, i) => {
    const start = alignedTo(clip.outStartSec, grid, maxNudgeSec);
    if (start === clip.outStartSec) return clip;

    const length = clip.outEndSec - clip.outStartSec;
    const end = start + length;
    // Against the ORIGINAL neighbours, not the nudged ones: two clips that both
    // move toward the same beat would each see the other as still out of the
    // way and end up overlapping.
    const previousEnd = i > 0 ? broll[i - 1].outEndSec : 0;
    const nextStart = i + 1 < broll.length ? broll[i + 1].outStartSec : Infinity;
    if (start < previousEnd || end > nextStart || end > edl.format.durationSec) return clip;

    return { ...clip, outStartSec: start, outEndSec: end };
  });

  const graphics = edl.graphics.map((graphic) => {
    // A title card is pinned to frame zero on purpose; a beat would unpin it.
    if (graphic.type === 'title-card') return graphic;
    const start = alignedTo(graphic.outStartSec, grid, maxNudgeSec);
    if (start === graphic.outStartSec) return graphic;

    const end = start + (graphic.outEndSec - graphic.outStartSec);
    if (end > edl.format.durationSec) return graphic;
    return { ...graphic, outStartSec: start, outEndSec: end };
  });

  return { ...edl, broll: moved, graphics };
}
