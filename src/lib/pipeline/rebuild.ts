import { buildEdl } from '@/lib/edl/builder';
import { ASPECT_DIMENSIONS, type Aspect, type Edl } from '@/lib/edl/types';
import type { DirectorPlan } from '@/lib/director/schema';
import type { MediaInfo } from '@/lib/media/ffmpeg';
import { resolveAssets } from './assets';
import { CostLedger } from '@/lib/pricing/cost';
import { FORMAT_PRESETS, styleFor, type FormatMode } from '@/lib/styles/presets';
import { invertIntervals, mergeIntervals, subtractIntervals, type Interval } from '@/lib/timeline/silence';
import { layoutSegments } from '@/lib/timeline/time-mapper';
import type { Transcript } from '@/lib/transcribe/types';

/**
 * Rebuilds an EDL from cached analysis.
 *
 * Transcription and the director are the only stages that cost money. Because
 * their outputs are stored on the project, everything that *feels* like a
 * re-edit — a different style, a shorter cut, a different aspect exported by
 * hand — is really just this function plus a render. No ASR call, no LLM call,
 * no re-upload.
 *
 * That is why the editor can offer free, unlimited tweaks.
 *
 * Note what `aspect` is and is not. The default path never sets it: the format
 * is chosen from the shape of the footage (see src/lib/styles/detect.ts) and
 * the output keeps that shape, because EasyCut edits the video you filmed
 * rather than converting it into the other format. This override exists for
 * the "Export 1:1" button in the editor — somebody asking, in as many words,
 * for a reframed copy — and for nothing else.
 */

export interface RebuildInput {
  projectId: string;
  transcript: Transcript;
  plan: DirectorPlan;
  media: MediaInfo;
  /** Mechanical removals found on the original run (silence + cleanup). */
  mechanicalCuts: Interval[];
  sourceUrl: string;
  sourceKey: string;
  reframe: Edl['reframe'];

  styleId: string;
  /** The caption look, when the user chose one. Null takes the edit style's. */
  captionPreset?: string | null;
  mode: FormatMode;
  /** Override the format's default aspect, e.g. exporting 1:1 from a short. */
  aspect?: Aspect;
  /** Hard ceiling on output length, defaults to the format's own. */
  maxDurationSec?: number;
  /** Segment ids the user deleted by hand in the editor. */
  removedSegmentIds?: string[];
  degraded?: string[];
}

export async function rebuildEdl(input: RebuildInput): Promise<Edl> {
  const style = styleFor(input.styleId, input.captionPreset);
  const aspect = input.aspect ?? FORMAT_PRESETS[input.mode].aspect;
  const ceiling = input.maxDurationSec ?? FORMAT_PRESETS[input.mode].maxDurationSec;

  const directorCuts: Interval[] = input.plan.removals
    .filter((r) => r.confidence >= 0.6)
    .map((r) => ({ startSec: r.startSec, endSec: r.endSec }));

  const removals = mergeIntervals([...input.mechanicalCuts, ...directorCuts]);
  let keeps = invertIntervals(removals, input.media.durationSec).filter(
    (k) => k.endSec - k.startSec >= 0.12,
  );

  /* ---------------------------- hook relocation ---------------------------- */

  const hook = input.plan.hook;
  let ranges: Array<{ sourceStartSec: number; sourceEndSec: number; reason: 'keep' | 'hook'; text: string }>;

  if (hook && hook.endSec > hook.startSec && input.mode === 'short') {
    const span = { startSec: hook.startSec, endSec: hook.endSec };
    const body = subtractIntervals(keeps, [span]).filter((k) => k.endSec - k.startSec >= 0.3);
    const hookKeeps = intersect(keeps, [span]);
    ranges = [
      ...hookKeeps.map((k) => ({ sourceStartSec: k.startSec, sourceEndSec: k.endSec, reason: 'hook' as const, text: '' })),
      ...body.map((k) => ({ sourceStartSec: k.startSec, sourceEndSec: k.endSec, reason: 'keep' as const, text: '' })),
    ];
  } else {
    ranges = keeps.map((k) => ({ sourceStartSec: k.startSec, sourceEndSec: k.endSec, reason: 'keep' as const, text: '' }));
  }

  /* ------------------------------ length cap ------------------------------- */

  let accumulated = 0;
  const capped: typeof ranges = [];
  for (const range of ranges) {
    const length = range.sourceEndSec - range.sourceStartSec;
    if (accumulated + length <= ceiling) {
      capped.push(range);
      accumulated += length;
      continue;
    }
    const remaining = ceiling - accumulated;
    if (remaining > 1.2) capped.push({ ...range, sourceEndSec: range.sourceStartSec + remaining });
    break;
  }

  let segments = layoutSegments(capped);

  // Apply the user's manual deletions, then re-lay-out so output time stays
  // contiguous — a gap in the timeline would render as black.
  if (input.removedSegmentIds?.length) {
    const removed = new Set(input.removedSegmentIds);
    segments = layoutSegments(
      segments
        .filter((s) => !removed.has(s.id))
        .map((s) => ({
          sourceStartSec: s.sourceStartSec,
          sourceEndSec: s.sourceEndSec,
          speed: s.speed,
          reason: s.reason,
          text: s.text,
        })),
    );
  }

  if (!segments.length) throw new Error('Nothing left after the cuts — try removing fewer clips.');

  for (const segment of segments) {
    segment.text = input.transcript.words
      .filter((w) => w.startSec >= segment.sourceStartSec && w.endSec <= segment.sourceEndSec)
      .map((w) => w.text)
      .join(' ');
  }

  const dimensions = ASPECT_DIMENSIONS[aspect];

  const built = buildEdl({
    projectId: input.projectId,
    style,
    mode: input.mode,
    aspect,
    fps: Math.min(30, Math.round(input.media.fps) || 30),
    transcript: input.transcript,
    plan: input.plan,
    segments,
    source: {
      assetId: input.sourceKey,
      url: input.sourceUrl,
      width: input.media.width,
      height: input.media.height,
      fps: input.media.fps,
      durationSec: input.media.durationSec,
      hasAudio: input.media.hasAudio,
    },
    // A reframe track computed for one aspect is wrong for another; drop it
    // rather than crop to the wrong window.
    reframe: matchesAspect(input.reframe, input.media, dimensions) ? input.reframe : null,
    degraded: input.degraded ?? [],
  });

  const resolved = await resolveAssets(built, {
    mode: input.mode,
    musicMood: input.plan.musicMood || style.musicMood,
    ledger: new CostLedger(), // rebuilds spend nothing worth tracking
  });

  return resolved.edl;
}

function matchesAspect(
  reframe: Edl['reframe'],
  media: MediaInfo,
  dimensions: { width: number; height: number },
): boolean {
  if (!reframe || !reframe.keyframes.length) return false;
  const sourceAspect = media.width / media.height;
  const targetAspect = dimensions.width / dimensions.height;
  const expectedWidth = targetAspect >= sourceAspect ? 1 : targetAspect / sourceAspect;
  return Math.abs(reframe.keyframes[0].w - expectedWidth) < 0.02;
}

function intersect(base: Interval[], mask: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const b of base) {
    for (const m of mask) {
      const lo = Math.max(b.startSec, m.startSec);
      const hi = Math.min(b.endSec, m.endSec);
      if (hi > lo) out.push({ startSec: lo, endSec: hi });
    }
  }
  return mergeIntervals(out);
}
