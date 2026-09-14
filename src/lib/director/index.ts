import { env } from '@/lib/config/env';
import type { FormatMode, StylePreset } from '@/lib/styles/presets';
import type { Transcript } from '@/lib/transcribe/types';
import { estimateDirectorCostUsd, isAnthropicConfigured, runAnthropicDirector } from './anthropic';
import { runHeuristicDirector } from './heuristic';
import type { DirectorBrief } from './prompt';
import { mergePlans, type DirectorPlan } from './schema';

export * from './schema';
export type { DirectorBrief } from './prompt';

/**
 * Long-form videos are analysed in overlapping windows rather than one giant
 * call. Three reasons, in order of importance:
 *
 *  1. **Latency.** Windows run concurrently, so a 10-minute video is analysed in
 *     about the time one window takes, not ten.
 *  2. **Attention.** A model asked to place 40 cues across 10 minutes in one
 *     response reliably front-loads them and forgets the last third.
 *  3. **Cost.** The cached system prompt is shared, and each window's output is
 *     small enough to stay well inside sensible token limits.
 */
const WINDOW_SEC = 180;
const WINDOW_OVERLAP_SEC = 12;

export interface DirectorRequest {
  transcript: Transcript;
  style: StylePreset;
  mode: FormatMode;
  inputMode: 'raw' | 'roughcut';
  targetDurationSec: number;
  userNote?: string;
}

export interface DirectorResult {
  plan: DirectorPlan;
  costUsd: number;
  provider: 'anthropic' | 'heuristic';
  /** Populated when the LLM failed and we fell back. */
  error?: string;
}

export function planWindows(durationSec: number): Array<{ startSec: number; endSec: number }> {
  if (durationSec <= WINDOW_SEC) return [{ startSec: 0, endSec: durationSec }];

  const windows: Array<{ startSec: number; endSec: number }> = [];
  let cursor = 0;
  while (cursor < durationSec) {
    const end = Math.min(durationSec, cursor + WINDOW_SEC);
    windows.push({ startSec: cursor, endSec: end });
    if (end >= durationSec) break;
    cursor = end - WINDOW_OVERLAP_SEC;
  }
  return windows;
}

export async function direct(request: DirectorRequest): Promise<DirectorResult> {
  const { transcript } = request;

  // No transcript means no content to reason about — silence-only edit.
  if (!transcript.words.length) {
    return {
      plan: runHeuristicDirector(briefFor(request, 0, transcript.durationSec)),
      costUsd: 0,
      provider: 'heuristic',
      error: 'No transcript available',
    };
  }

  if (env.llm.provider === 'stub' || !isAnthropicConfigured()) {
    return { plan: heuristicAcrossWindows(request), costUsd: 0, provider: 'heuristic' };
  }

  const windows = planWindows(transcript.durationSec);

  try {
    const results = await Promise.all(
      windows.map((w) => runAnthropicDirector(briefFor(request, w.startSec, w.endSec))),
    );
    const plan = dedupeOverlaps(mergePlans(results.map((r) => r.plan)));
    return {
      plan,
      costUsd: results.reduce((sum, r) => sum + r.costUsd, 0),
      provider: 'anthropic',
    };
  } catch (error) {
    // A failed director must never fail the job — the user still gets a video.
    return {
      plan: heuristicAcrossWindows(request),
      costUsd: 0,
      provider: 'heuristic',
      error: (error as Error).message,
    };
  }
}

export function estimateCostUsd(request: DirectorRequest): number {
  if (!isAnthropicConfigured()) return 0;
  const windows = planWindows(request.transcript.durationSec);
  return estimateDirectorCostUsd(request.transcript.text.length, windows.length);
}

function briefFor(request: DirectorRequest, startSec: number, endSec: number): DirectorBrief {
  return {
    transcript: request.transcript,
    style: request.style,
    mode: request.mode,
    inputMode: request.inputMode,
    windowStartSec: startSec,
    windowEndSec: endSec,
    totalDurationSec: request.transcript.durationSec,
    targetDurationSec: request.targetDurationSec,
    userNote: request.userNote,
  };
}

function heuristicAcrossWindows(request: DirectorRequest): DirectorPlan {
  const windows = planWindows(request.transcript.durationSec);
  return dedupeOverlaps(
    mergePlans(windows.map((w) => runHeuristicDirector(briefFor(request, w.startSec, w.endSec)))),
  );
}

/**
 * Windows overlap so that a cue near a boundary isn't missed, which means the
 * same beat can be planned twice. Collapse anything landing within a second of
 * an existing cue of the same kind.
 */
function dedupeOverlaps(plan: DirectorPlan): DirectorPlan {
  const near = <T extends { atSec: number }>(list: T[], toleranceSec: number): T[] => {
    const kept: T[] = [];
    for (const item of [...list].sort((a, b) => a.atSec - b.atSec)) {
      if (kept.some((k) => Math.abs(k.atSec - item.atSec) < toleranceSec)) continue;
      kept.push(item);
    }
    return kept;
  };

  return {
    ...plan,
    broll: near(plan.broll, 1.5),
    graphics: near(plan.graphics, 1.5),
    sfx: near(plan.sfx, 0.4),
    punchIns: near(plan.punchIns, 2),
    chapters: near(plan.chapters, 20),
  };
}
