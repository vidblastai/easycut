import type { PanelScene } from './types';
import type { TimeMapper } from '@/lib/timeline/time-mapper';

/**
 * The panel, moved from footage time onto the finished timeline.
 *
 * The pass that writes it reads the transcript, so it answers in SOURCE
 * seconds — and by the time the video is cut, the silence pass and the
 * director between them have removed anywhere from a tenth to a third of
 * those seconds. An exhibit left at its source timestamp drifts further out
 * of step with the voice the longer the video runs, which is the one thing
 * this layer cannot survive: the whole format is a picture of the sentence
 * being spoken underneath it.
 *
 * Two things have to hold afterwards, and neither follows from mapping the
 * timestamps alone:
 *
 *  - **No gaps.** A gap is not a pause here, it is the top 42% of the frame
 *    going blank. A scene whose speech was cut entirely maps to nothing and
 *    has to be dropped, and its neighbours close over the hole.
 *  - **Nothing left over at the end.** The last exhibit runs to the end of
 *    the video however short its own passage turned out.
 */
export function placePanel(
  scenes: PanelScene[],
  mapper: TimeMapper,
  durationSec: number,
  minSec = 0.8,
): PanelScene[] {
  const mapped: PanelScene[] = [];

  for (const scene of scenes) {
    const start = mapper.toOutputClamped(scene.outStartSec);
    const end = mapper.toOutputClamped(scene.outEndSec);
    // A passage cut out of the video entirely collapses to a point.
    if (end - start < 0.15) continue;
    mapped.push({ ...scene, outStartSec: start, outEndSec: end });
  }

  mapped.sort((a, b) => a.outStartSec - b.outStartSec);

  const out: PanelScene[] = [];
  for (const scene of mapped) {
    const start = out.length ? out[out.length - 1].outEndSec : 0;
    const end = Math.min(durationSec, Math.max(scene.outEndSec, start + minSec));
    if (end <= start + 0.1) continue;
    out.push({ ...scene, outStartSec: round(start), outEndSec: round(end) });
  }

  if (out.length) out[out.length - 1].outEndSec = round(durationSec);
  return out;
}

function round(sec: number): number {
  return Math.round(sec * 100) / 100;
}
