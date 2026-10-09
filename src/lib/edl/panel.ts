import { renderableKinds } from './panel-kinds';
import type { PanelScene } from './types';

/** The part of an output segment's identity this module reads. */
interface Segment {
  sourceStartSec: number;
  sourceEndSec: number;
  outStartSec: number;
  outEndSec: number;
}

/** A placement shorter than this is a sliver nobody can read. */
const SLIVER_SEC = 0.15;

/**
 * The panel, moved from footage time onto the finished timeline.
 *
 * The pass that writes it reads the transcript, so it answers in SOURCE
 * seconds — and by the time the video is cut, the silence pass and the
 * director between them have removed anywhere from a tenth to a third of
 * those seconds AND, when the director finds a hook, MOVED some of them. An
 * exhibit left at its source timestamp drifts out of step with the voice
 * underneath it, which is the one thing this layer cannot survive: the whole
 * format is a picture of the sentence being spoken.
 *
 * ── Why the segments and not a time mapper ─────────────────────────────────
 *
 * This used to map each scene's two timestamps through a `TimeMapper` and
 * then re-butt the results, which assumed output time rises with source
 * time. It does not. The director hoists the best line to the front as a
 * hook, so on a real 40s upload the output began with source 36.2–39.6 and
 * the rest followed from 0.75. Mapping the endpoints of a scene that spans
 * that seam gave a span 17 seconds long, and the re-butting loop — which
 * only ever moved its cursor forward — then dropped the fifteen exhibits
 * inside it. Twenty exhibits became five, one of them a static panel held
 * for 17 seconds, which is the "nothing is happening up there" the layout
 * exists to prevent.
 *
 * So each scene is intersected with each segment instead. A source span that
 * the edit shows twice gets two placements; one it shows in the middle of the
 * video gets its exhibit there. Nothing depends on the order the director
 * chose.
 *
 * Two things have to hold afterwards, and neither follows from the mapping:
 *
 *  - **No gaps.** A gap is not a pause here, it is the top 42% of the frame
 *    going blank. Each exhibit therefore runs until the next one begins, and
 *    the first and last reach the ends of the video.
 *  - **Nothing too brief to read.** A placement under `minSec` is absorbed by
 *    its neighbour rather than dropped, so the time is always accounted for.
 */
export function placePanel(
  scenes: readonly PanelScene[],
  segments: readonly Segment[],
  durationSec: number,
  minSec = 0.8,
): PanelScene[] {
  const placed: PanelScene[] = [];

  for (const scene of scenes) {
    for (const segment of segments) {
      const from = Math.max(scene.outStartSec, segment.sourceStartSec);
      const to = Math.min(scene.outEndSec, segment.sourceEndSec);
      if (to - from < SLIVER_SEC) continue;

      // Segments can be retimed (a speed ramp), so the offset is scaled by
      // the segment's own ratio rather than added straight on.
      const sourceSpan = segment.sourceEndSec - segment.sourceStartSec;
      const outSpan = segment.outEndSec - segment.outStartSec;
      const scale = sourceSpan > 0.001 ? outSpan / sourceSpan : 1;

      placed.push({
        ...scene,
        // Unique per placement: the renderer keys its sequences by this, and
        // a reordered edit can show one source span more than once.
        id: `${scene.id}@${segment.outStartSec.toFixed(2)}`,
        outStartSec: segment.outStartSec + (from - segment.sourceStartSec) * scale,
        outEndSec: segment.outStartSec + (to - segment.sourceStartSec) * scale,
      });
    }
  }

  placed.sort((a, b) => a.outStartSec - b.outStartSec);
  if (!placed.length) return [];

  // Each exhibit holds until the next one arrives, and the pair at the ends
  // reach the ends of the video. Extending the EARLIER one, rather than
  // pulling the later one back, is what stops a long placement from
  // swallowing the exhibits inside it.
  for (let i = 0; i < placed.length - 1; i++) {
    placed[i].outEndSec = placed[i + 1].outStartSec;
  }
  placed[0].outStartSec = 0;
  placed[placed.length - 1].outEndSec = durationSec;

  const out: PanelScene[] = [];
  for (const scene of placed) {
    const previous = out[out.length - 1];
    if (previous && scene.outEndSec - scene.outStartSec < minSec) {
      // Too brief to read: its time goes to the exhibit already on screen.
      previous.outEndSec = scene.outEndSec;
      continue;
    }
    out.push({ ...scene, outStartSec: round(scene.outStartSec), outEndSec: round(scene.outEndSec) });
  }

  // The head has no predecessor to absorb it, so it borrows from its successor.
  if (out.length > 1 && out[0].outEndSec - out[0].outStartSec < minSec) {
    out[1].outStartSec = 0;
    out.shift();
  }

  /*
   * No exhibit twice running — decided HERE, last, in output order.
   *
   * The writing pass already rotates a repeated kind, but it works through
   * the transcript, which is source order. The director hoists a hook, so
   * two scenes that were nowhere near each other in the footage end up
   * adjacent in the cut: on a real upload two `toggle-pair`s landed back to
   * back that way, which is the slideshow-of-one-card the rule exists to
   * stop. Output order is the only order a viewer ever sees.
   *
   * After the absorb pass rather than before it, because absorbing a brief
   * placement closes a gap between two scenes that were not neighbours a
   * moment ago — which is its own way of putting two of a kind together.
   */
  for (let i = 1; i < out.length; i++) {
    const previous = out[i - 1].kind;
    if (out[i].kind !== previous) continue;
    const other = renderableKinds(out[i]).find((k) => k !== previous);
    if (other) out[i] = { ...out[i], kind: other };
  }

  return out;
}

function round(sec: number): number {
  return Math.round(sec * 100) / 100;
}
