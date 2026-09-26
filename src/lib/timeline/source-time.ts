import type { Edl } from '@/lib/edl/types';

/**
 * Where a moment of the EDIT lives in the source file.
 *
 * The editor plays the whole edit through ONE video element, so something has
 * to answer "the video is at 6.2 seconds of the output — where is that in the
 * file?" on every frame. That is this: find the segment the moment falls in,
 * and walk into it at the segment's own speed.
 *
 * Outside the edit — before the first segment or past the last — it clamps to
 * the nearest one rather than returning nothing. A preview parked at 0 on an
 * edit whose first segment starts at 4.0s should show that frame, not black.
 */
export function sourceTimeAt(
  segments: Edl['segments'],
  outSec: number,
): { segment: Edl['segments'][number] | null; sourceSec: number } {
  if (!segments.length) return { segment: null, sourceSec: outSec };

  const inside = segments.find((s) => outSec >= s.outStartSec && outSec < s.outEndSec);
  const segment = inside ?? (outSec < segments[0].outStartSec ? segments[0] : segments[segments.length - 1]);

  const into = Math.max(0, outSec - segment.outStartSec) * (segment.speed || 1);
  const sourceSec = Math.min(
    segment.sourceEndSec,
    segment.sourceStartSec + into,
  );
  return { segment, sourceSec };
}
