import type { Edl, SceneLook } from '@/lib/edl/types';
import type { WordCue } from '@/lib/director/hyperframe';

/**
 * Shared by the MCP service and the worker job that renders what it saved —
 * kept apart from both so the worker does not load the web app's auth.
 */

/** The words spoken over a span of the finished video, in the span's own time. */
export function wordsBetween(edl: Edl, startSec: number, endSec: number): WordCue[] {
  return edl.captions
    .flatMap((cue) => cue.words)
    .filter((word) => word.startSec >= startSec - 0.05 && word.startSec < endSec)
    .map((word) => ({ text: word.text.replace(/[^\p{L}\p{N}'-]/gu, ''), atSec: Math.max(0, word.startSec - startSec) }));
}

export interface ClientScene {
  html: string;
  look: SceneLook;
  concept: string;
  submittedAt: string;
}

