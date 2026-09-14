import type { Segment } from '@/lib/edl/types';

/**
 * Once footage has been cut, source time and output time diverge. Every
 * downstream layer (captions, B-roll cues, SFX, punch-ins) is authored against
 * one clock and consumed on the other, so this mapping is the most
 * safety-critical arithmetic in the product: get it wrong and captions drift.
 *
 * The mapper is built from the final segment list and answers both directions.
 */
export class TimeMapper {
  private readonly segments: Segment[];

  constructor(segments: Segment[]) {
    // Sorted by output time so we can binary-search either clock.
    this.segments = [...segments].sort((a, b) => a.outStartSec - b.outStartSec);
  }

  get outputDuration(): number {
    const last = this.segments[this.segments.length - 1];
    return last ? last.outEndSec : 0;
  }

  /**
   * SOURCE → OUTPUT.
   *
   * Returns null when the timestamp fell inside a removed region. Callers decide
   * what that means: a caption word that was cut simply disappears, but a B-roll
   * cue anchored to a cut line needs to be re-anchored.
   */
  toOutput(sourceSec: number): number | null {
    for (const seg of this.segments) {
      if (sourceSec >= seg.sourceStartSec && sourceSec <= seg.sourceEndSec) {
        const offset = (sourceSec - seg.sourceStartSec) / seg.speed;
        return seg.outStartSec + offset;
      }
    }
    return null;
  }

  /**
   * SOURCE → OUTPUT, never null.
   *
   * Snaps a cut-away timestamp to the nearest surviving frame. Use this for
   * anything that must still be placed (a B-roll insert whose anchor line was
   * trimmed should land at the next surviving word, not vanish).
   */
  toOutputClamped(sourceSec: number): number {
    const exact = this.toOutput(sourceSec);
    if (exact !== null) return exact;
    if (!this.segments.length) return 0;

    if (sourceSec < this.segments[0].sourceStartSec) return 0;

    let best = this.outputDuration;
    let bestDistance = Infinity;
    for (const seg of this.segments) {
      // Distance to whichever edge of this segment is closer.
      const dStart = Math.abs(sourceSec - seg.sourceStartSec);
      const dEnd = Math.abs(sourceSec - seg.sourceEndSec);
      if (dStart < bestDistance) {
        bestDistance = dStart;
        best = seg.outStartSec;
      }
      if (dEnd < bestDistance) {
        bestDistance = dEnd;
        best = seg.outEndSec;
      }
    }
    return best;
  }

  /** OUTPUT → SOURCE. Always defined inside the output duration. */
  toSource(outSec: number): number {
    for (const seg of this.segments) {
      if (outSec >= seg.outStartSec && outSec <= seg.outEndSec) {
        return seg.sourceStartSec + (outSec - seg.outStartSec) * seg.speed;
      }
    }
    const last = this.segments[this.segments.length - 1];
    return last ? last.sourceEndSec : 0;
  }

  /** The segment playing at an output timestamp, if any. */
  segmentAt(outSec: number): Segment | null {
    return this.segments.find((s) => outSec >= s.outStartSec && outSec < s.outEndSec) ?? null;
  }

  /**
   * Maps a source interval onto output time, splitting it wherever a cut
   * interrupts it. A single sentence spanning a removed "umm" comes back as two
   * output intervals — which is exactly what a caption renderer needs.
   */
  mapInterval(sourceStart: number, sourceEnd: number): Array<{ startSec: number; endSec: number }> {
    const out: Array<{ startSec: number; endSec: number }> = [];
    for (const seg of this.segments) {
      const lo = Math.max(sourceStart, seg.sourceStartSec);
      const hi = Math.min(sourceEnd, seg.sourceEndSec);
      if (hi <= lo) continue;
      out.push({
        startSec: seg.outStartSec + (lo - seg.sourceStartSec) / seg.speed,
        endSec: seg.outStartSec + (hi - seg.sourceStartSec) / seg.speed,
      });
    }
    // Deliberately NOT merged, even though segments are laid out contiguously
    // and the pieces will therefore touch. The piece count is the signal — a
    // caller that gets two intervals back knows a cut fell inside its span and
    // can decide to break the element there rather than draw across the splice.
    return out;
  }

  /**
   * Output timestamps where a visible cut happens — i.e. the seam between two
   * segments that were NOT adjacent in the source. These are the only places a
   * transition or whoosh makes sense; a seam between contiguous source frames
   * is invisible and decorating it looks amateurish.
   */
  cutPoints(minGapSec = 0.04): number[] {
    const points: number[] = [];
    for (let i = 1; i < this.segments.length; i++) {
      const prev = this.segments[i - 1];
      const cur = this.segments[i];
      const sourceGap = cur.sourceStartSec - prev.sourceEndSec;
      // A negative gap means a reorder (the hook moved), which is always visible.
      if (sourceGap < 0 || sourceGap > minGapSec) {
        points.push(cur.outStartSec);
      }
    }
    return points;
  }
}


/**
 * Turns "keep these source ranges, in this order" into a laid-out segment list
 * with output timestamps. This is the one place output time is assigned.
 */
export function layoutSegments(
  ranges: Array<{
    sourceStartSec: number;
    sourceEndSec: number;
    speed?: number;
    reason?: Segment['reason'];
    text?: string;
  }>,
): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  ranges.forEach((r, i) => {
    const speed = r.speed ?? 1;
    const sourceLength = Math.max(0, r.sourceEndSec - r.sourceStartSec);
    const outLength = sourceLength / speed;
    if (outLength <= 0) return;

    segments.push({
      id: `seg-${i}`,
      sourceStartSec: r.sourceStartSec,
      sourceEndSec: r.sourceEndSec,
      outStartSec: cursor,
      outEndSec: cursor + outLength,
      speed,
      reason: r.reason ?? 'keep',
      text: r.text ?? '',
    });
    cursor += outLength;
  });

  return segments;
}
