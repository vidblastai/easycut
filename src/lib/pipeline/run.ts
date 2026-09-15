import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { env } from '@/lib/config/env';
import { direct, planWindows } from '@/lib/director';
import { buildEdl } from '@/lib/edl/builder';
import { ASPECT_DIMENSIONS, type Aspect, type Edl } from '@/lib/edl/types';
import {
  detectSilence,
  extractAudio,
  extractAudioForAsr,
  makeProxy,
  probe,
} from '@/lib/media/ffmpeg';
import { CostLedger, planDegradation } from '@/lib/pricing/cost';
import { computeReframeTrack, retimeTrack } from '@/lib/reframe';
import { storage } from '@/lib/storage';
import { FORMAT_PRESETS, styleFor } from '@/lib/styles/presets';
import {
  applicableFindings,
  CLEANUP_PRESETS,
  findCleanupTargets,
  summarizeCleanup,
} from '@/lib/timeline/cleanup';
import {
  detectRemovableSilence,
  invertIntervals,
  mergeIntervals,
  SILENCE_PRESETS,
  silenceDensity,
  subtractIntervals,
  type Interval,
} from '@/lib/timeline/silence';
import { layoutSegments, TimeMapper } from '@/lib/timeline/time-mapper';
import { transcribeAudio } from '@/lib/transcribe';
import { resolveAssets } from './assets';
import { STAGE_LABELS, STAGE_WEIGHTS, STAGES, type PipelineContext, type PipelineRequest, type ProgressReporter, type Stage } from './types';

/**
 * The pipeline.
 *
 * Structured as a list of named stages rather than one long function for three
 * reasons: the UI can report exactly where a job is, a crashed job can resume
 * from the last completed stage, and each stage's failure policy is explicit
 * and local.
 *
 * The invariant that matters most: **no stage may fail the job unless the job
 * genuinely cannot produce a video.** Only `ingest` and `render` are fatal.
 * Everything else degrades and records what was lost.
 */

export interface PipelineResult {
  edl: Edl;
  context: PipelineContext;
  costUsd: number;
}

export async function runPipeline(
  request: PipelineRequest,
  report: ProgressReporter = () => {},
): Promise<PipelineResult> {
  const workDir = join(tmpdir(), 'easycut', request.projectId);
  await mkdir(workDir, { recursive: true });

  const context: PipelineContext = {
    request,
    style: styleFor(request.styleId, request.captionPreset),
    ledger: new CostLedger(),
    workDir,
    degraded: [],
    log: [],
  };

  const stages: Array<[Stage, (ctx: PipelineContext) => Promise<void>]> = [
    ['ingest', stageIngest],
    ['transcribe', stageTranscribe],
    ['silence', stageSilence],
    ['cleanup', stageCleanup],
    ['direct', stageDirect],
    ['timeline', stageTimeline],
    ['reframe', stageReframe],
    ['assets', stageAssets],
    ['edl', stageFinaliseEdl],
  ];

  const resumeIndex = request.resumeFrom ? STAGES.indexOf(request.resumeFrom) : 0;
  let completedWeight = 0;

  for (const [stage, handler] of stages) {
    const weight = STAGE_WEIGHTS[stage];

    if (STAGES.indexOf(stage) < resumeIndex) {
      completedWeight += weight;
      continue;
    }

    const startedAt = Date.now();
    await report(stage, completedWeight, STAGE_LABELS[stage]);

    try {
      await handler(context);
      context.log.push({ stage, status: 'ok', ms: Date.now() - startedAt, message: '' });
    } catch (error) {
      const message = (error as Error).message;
      const fatal = stage === 'ingest';
      context.log.push({
        stage,
        status: fatal ? 'failed' : 'degraded',
        ms: Date.now() - startedAt,
        message,
      });
      if (fatal) throw error;
      context.degraded.push(`${stage}: ${message}`);
    }

    completedWeight += weight;
    await report(stage, completedWeight, STAGE_LABELS[stage]);
  }

  if (!context.edl) throw new Error('Pipeline finished without producing an EDL');

  return { edl: context.edl, context, costUsd: context.ledger.totalUsd };
}

/* -------------------------------------------------------------- 1. ingest */

async function stageIngest(ctx: PipelineContext): Promise<void> {
  const driver = storage();
  const sourcePath = join(ctx.workDir, 'source' + extensionOf(ctx.request.sourceKey));

  // Pull the source local once. Everything after this is filesystem work.
  const { writeFile } = await import('node:fs/promises');
  const { localPathFor } = await import('@/lib/storage');
  const local = localPathFor(ctx.request.sourceKey);
  if (local) {
    ctx.sourcePath = local;
  } else {
    await writeFile(sourcePath, await driver.get(ctx.request.sourceKey));
    ctx.sourcePath = sourcePath;
  }

  ctx.media = await probe(ctx.sourcePath);

  if (!ctx.media.hasAudio) {
    throw new Error('This file has no audio track. EasyCut edits talking-head footage — it needs a voice to work from.');
  }

  const limit =
    ctx.request.mode === 'short' ? env.limits.maxShortDurationSec : env.limits.maxLongDurationSec;
  if (ctx.media.durationSec > limit * 1.5) {
    throw new Error(
      `That's ${Math.round(ctx.media.durationSec / 60)} minutes of footage; the ${ctx.request.mode}-form limit is ${Math.round(limit / 60)}.`,
    );
  }

  // The proxy, the ASR audio and the mix audio are independent of each other.
  const proxyPath = join(ctx.workDir, 'proxy.mp4');
  const asrAudioPath = join(ctx.workDir, 'asr.wav');
  const mixAudioPath = join(ctx.workDir, 'mix.wav');

  await Promise.all([
    makeProxy(ctx.sourcePath, proxyPath).then(() => { ctx.proxyPath = proxyPath; }),
    extractAudioForAsr(ctx.sourcePath, asrAudioPath).then(() => { ctx.asrAudioPath = asrAudioPath; }),
    extractAudio(ctx.sourcePath, mixAudioPath).then(() => { ctx.mixAudioPath = mixAudioPath; }),
  ]);
}

/* ---------------------------------------------------------- 2. transcribe */

async function stageTranscribe(ctx: PipelineContext): Promise<void> {
  if (!ctx.asrAudioPath || !ctx.media) throw new Error('No audio to transcribe');

  const result = await transcribeAudio(ctx.asrAudioPath, ctx.media.durationSec, {
    diarize: false, // talking head: one speaker, and diarisation costs latency
  });

  ctx.transcript = result.transcript;
  ctx.ledger.add('transcription', result.costUsd, result.transcript.provider);

  if (result.transcript.degraded || !result.transcript.words.length) {
    ctx.degraded.push('captions (no transcription provider configured)');
  }
}

/* ------------------------------------------------------------- 3. silence */

async function stageSilence(ctx: PipelineContext): Promise<void> {
  if (!ctx.asrAudioPath) throw new Error('No audio');

  ctx.acousticSilence = await detectSilence(ctx.asrAudioPath).catch(() => []);

  if (!ctx.transcript?.words.length) {
    // No transcript: fall back to the acoustic signal alone, conservatively.
    // Everything quiet for more than a second goes; nothing else is touched.
    ctx.silenceRemovals = (ctx.acousticSilence ?? [])
      .filter((s) => s.endSec - s.startSec > 1.1)
      .map((s) => ({ startSec: s.startSec + 0.25, endSec: s.endSec - 0.25 }))
      .filter((s) => s.endSec > s.startSec);
    return;
  }

  const preset =
    ctx.request.inputMode === 'roughcut'
      ? SILENCE_PRESETS.micro
      : SILENCE_PRESETS[ctx.style.silencePreset];

  ctx.silenceRemovals = detectRemovableSilence(ctx.transcript, ctx.acousticSilence ?? [], preset);
}

/* ------------------------------------------------------------- 4. cleanup */

async function stageCleanup(ctx: PipelineContext): Promise<void> {
  if (!ctx.transcript?.words.length) {
    ctx.cleanupFindings = [];
    ctx.cleanupRemovals = [];
    return;
  }

  const options = CLEANUP_PRESETS[ctx.request.inputMode];
  ctx.cleanupFindings = findCleanupTargets(ctx.transcript, options);
  ctx.cleanupRemovals = applicableFindings(ctx.cleanupFindings, options);

  const summary = summarizeCleanup(ctx.cleanupFindings, options);
  ctx.log.push({
    stage: 'cleanup',
    status: 'ok',
    ms: 0,
    message: `Removed ${summary.totalSeconds}s: ${summary.fillers.count} fillers, ${summary.stammers.count} stammers, ${summary.falseStarts.count} false starts, ${summary.retakes.count} retakes`,
  });
}

/* -------------------------------------------------------------- 5. direct */

async function stageDirect(ctx: PipelineContext): Promise<void> {
  if (!ctx.transcript || !ctx.media) throw new Error('Nothing to direct');

  // What the video will be after the mechanical cuts — the director needs the
  // real target length, not the raw footage length.
  const mechanicalRemoval = totalLength([...(ctx.silenceRemovals ?? []), ...(ctx.cleanupRemovals ?? [])]);
  const targetDurationSec = Math.max(1, ctx.media.durationSec - mechanicalRemoval);

  const result = await direct({
    transcript: ctx.transcript,
    style: ctx.style,
    mode: ctx.request.mode,
    inputMode: ctx.request.inputMode,
    targetDurationSec,
    userNote: ctx.request.userNote,
  });

  ctx.plan = result.plan;
  ctx.ledger.add('director', result.costUsd, result.provider);

  if (result.provider === 'heuristic') {
    ctx.degraded.push(
      result.error
        ? `AI director unavailable (${result.error}) — used the rule-based editor`
        : 'AI director not configured — used the rule-based editor',
    );
  }
}

/* ------------------------------------------------------------ 6. timeline */

async function stageTimeline(ctx: PipelineContext): Promise<void> {
  if (!ctx.media) throw new Error('No media info');
  const duration = ctx.media.durationSec;

  // Three independent removal sets, merged: mechanical silence, mechanical
  // cleanup, and the director's content judgement.
  const directorRemovals: Interval[] = (ctx.plan?.removals ?? [])
    .filter((r) => r.confidence >= 0.6)
    .map((r) => ({ startSec: r.startSec, endSec: r.endSec }));

  const removals = mergeIntervals([
    ...(ctx.silenceRemovals ?? []),
    ...(ctx.cleanupRemovals ?? []),
    ...directorRemovals,
  ]);

  let keeps = invertIntervals(removals, duration);

  // A surviving fragment shorter than this is a stutter, not a shot.
  keeps = keeps.filter((k) => k.endSec - k.startSec >= 0.12);

  /* ------------------------- hook relocation ------------------------- */

  const hook = ctx.plan?.hook ?? null;
  let ranges: Array<{ sourceStartSec: number; sourceEndSec: number; reason: 'keep' | 'hook'; text: string }> = [];

  if (hook && hook.endSec > hook.startSec && ctx.request.mode === 'short') {
    // The hook plays first, then the rest of the video minus the hook's own
    // span — so the line isn't heard twice.
    const hookRange = { startSec: hook.startSec, endSec: hook.endSec };
    const body = subtractIntervals(keeps, [hookRange]).filter((k) => k.endSec - k.startSec >= 0.3);
    const hookKeeps = intersect(keeps, [hookRange]);

    ranges = [
      ...hookKeeps.map((k) => ({ sourceStartSec: k.startSec, sourceEndSec: k.endSec, reason: 'hook' as const, text: '' })),
      ...body.map((k) => ({ sourceStartSec: k.startSec, sourceEndSec: k.endSec, reason: 'keep' as const, text: '' })),
    ];
  } else {
    ranges = keeps.map((k) => ({ sourceStartSec: k.startSec, sourceEndSec: k.endSec, reason: 'keep' as const, text: '' }));
  }

  /* --------------------- short-form length ceiling --------------------- */

  const ceiling = FORMAT_PRESETS[ctx.request.mode].maxDurationSec;
  let accumulated = 0;
  const trimmed: typeof ranges = [];
  for (const range of ranges) {
    const length = range.sourceEndSec - range.sourceStartSec;
    if (accumulated + length <= ceiling) {
      trimmed.push(range);
      accumulated += length;
      continue;
    }
    // Take the part that fits, but only if there's enough of it to be a shot.
    const remaining = ceiling - accumulated;
    if (remaining > 1.2) {
      trimmed.push({ ...range, sourceEndSec: range.sourceStartSec + remaining });
      accumulated = ceiling;
    }
    break;
  }

  const segments = layoutSegments(trimmed);
  if (!segments.length) {
    throw new Error('Nothing survived the edit — the footage may be silent throughout.');
  }

  // Attach the transcript text to each segment so the editor can show it.
  if (ctx.transcript) {
    for (const segment of segments) {
      segment.text = ctx.transcript.words
        .filter((w) => w.startSec >= segment.sourceStartSec && w.endSec <= segment.sourceEndSec)
        .map((w) => w.text)
        .join(' ');
    }
  }

  ctx.edl = {
    version: '1.0',
    projectId: ctx.request.projectId,
    styleId: ctx.style.id,
    format: { aspect: '16:9', width: 1920, height: 1080, fps: 30, durationSec: 0 },
    source: {
      assetId: ctx.request.sourceKey,
      url: storage().publicUrl(ctx.request.sourceKey),
      width: ctx.media.width,
      height: ctx.media.height,
      fps: ctx.media.fps,
      durationSec: ctx.media.durationSec,
      hasAudio: ctx.media.hasAudio,
    },
    segments,
    captions: [],
    captionStyle: ctx.style.captionStyle,
    broll: [],
    graphics: [],
    overlays: [],
    transitions: [],
    punchIns: [],
    reframe: null,
    sfx: [],
    music: null,
    audio: { targetLufs: -14, denoise: true, highPassHz: 80, compress: true },
    deliverable: { title: '', socialCaption: '', hashtags: [], thumbnailAtSec: 0, chapters: [] },
    degraded: [],
  };
}

/* ------------------------------------------------------------- 7. reframe */

async function stageReframe(ctx: PipelineContext): Promise<void> {
  if (!ctx.edl || !ctx.media) return;

  const aspect: Aspect = FORMAT_PRESETS[ctx.request.mode].aspect;
  const dimensions = ASPECT_DIMENSIONS[aspect];
  const sourceAspect = ctx.media.width / ctx.media.height;
  const targetAspect = dimensions.width / dimensions.height;

  // Only worth doing when the shape actually changes.
  if (!env.features.reframe || Math.abs(sourceAspect - targetAspect) < 0.05) {
    ctx.edl.reframe = null;
    return;
  }

  const track = await computeReframeTrack(ctx.proxyPath ?? ctx.sourcePath!, {
    sourceWidth: ctx.media.width,
    sourceHeight: ctx.media.height,
    targetAspect,
    durationSec: ctx.media.durationSec,
    headroom: 0.06,
  });

  // The tracker works in source time; the renderer reads output time. Re-time
  // the track through the same mapper every other cue goes through.
  ctx.edl.reframe = retimeTrack(track, new TimeMapper(ctx.edl.segments));

  if (track.method === 'center') {
    ctx.degraded.push('subject tracking (fell back to a centre crop)');
  }
}

/* -------------------------------------------------------------- 8. assets */

async function stageAssets(ctx: PipelineContext): Promise<void> {
  if (!ctx.edl || !ctx.plan || !ctx.transcript || !ctx.media) return;

  // Build the full EDL first — asset resolution needs the final cue placement,
  // which only exists after the director's plan is mapped onto output time.
  const aspect: Aspect = FORMAT_PRESETS[ctx.request.mode].aspect;

  const built = buildEdl({
    projectId: ctx.request.projectId,
    style: ctx.style,
    mode: ctx.request.mode,
    aspect,
    fps: Math.min(30, Math.round(ctx.media.fps) || 30),
    transcript: ctx.transcript,
    plan: ctx.plan,
    segments: ctx.edl.segments,
    source: ctx.edl.source,
    reframe: ctx.edl.reframe,
    degraded: ctx.degraded,
  });

  const resolved = await resolveAssets(built, {
    mode: ctx.request.mode,
    musicMood: ctx.plan.musicMood || ctx.style.musicMood,
    ledger: ctx.ledger,
  });

  ctx.edl = resolved.edl;
  ctx.degraded.push(...resolved.degraded);
}

/* ----------------------------------------------------------------- 9. edl */

async function stageFinaliseEdl(ctx: PipelineContext): Promise<void> {
  if (!ctx.edl || !ctx.media) return;

  // Budget check with the real shape of the finished edit, before render spend.
  const degradation = planDegradation({
    mode: ctx.request.mode,
    sourceDurationSec: ctx.media.durationSec,
    outputDurationSec: ctx.edl.format.durationSec,
    width: ctx.edl.format.width,
    height: ctx.edl.format.height,
    fps: ctx.edl.format.fps,
    transcriptChars: ctx.transcript?.text.length ?? 0,
    directorWindows: planWindows(ctx.media.durationSec).length,
    generatedImageCount: ctx.edl.graphics.filter((g) => g.type === 'image' && g.assetUrl).length,
    brollClipCount: ctx.edl.broll.length,
  });

  for (const step of degradation.steps) {
    switch (step) {
      case 'generated-images':
        ctx.edl.graphics = ctx.edl.graphics.filter((g) => g.type !== 'image');
        break;
      case 'broll':
        ctx.edl.broll = [];
        break;
      case 'render-resolution': {
        // Two-thirds scale keeps the aspect exact and halves the render bill.
        ctx.edl.format = {
          ...ctx.edl.format,
          width: even(Math.round(ctx.edl.format.width * (2 / 3))),
          height: even(Math.round(ctx.edl.format.height * (2 / 3))),
        };
        break;
      }
      default:
        break;
    }
    ctx.degraded.push(`budget: dropped ${step} to stay under $${degradation.estimate.budgetUsd}`);
  }

  ctx.edl.degraded = dedupe(ctx.degraded);
  ctx.ledger.add('render', degradation.estimate.lines.render, env.render.driver);
  ctx.ledger.add('storage', degradation.estimate.lines.storage, env.storage.driver);
}

/* -------------------------------------------------------------- helpers */

function totalLength(intervals: Interval[]): number {
  return mergeIntervals(intervals).reduce((sum, i) => sum + (i.endSec - i.startSec), 0);
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

function extensionOf(key: string): string {
  const match = key.match(/\.[a-z0-9]{2,5}$/i);
  return match ? match[0] : '.mp4';
}

function even(value: number): number {
  // H.264 requires even dimensions.
  return value % 2 === 0 ? value : value + 1;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** Auto-detects whether footage looks raw or already cut, for the upload hint. */
export async function suggestInputMode(audioPath: string, transcript: Parameters<typeof silenceDensity>[0]): Promise<'raw' | 'roughcut'> {
  const acoustic = await detectSilence(audioPath).catch(() => []);
  return silenceDensity(transcript, acoustic) > 0.12 ? 'raw' : 'roughcut';
}

export async function cleanupWorkDir(projectId: string): Promise<void> {
  await rm(join(tmpdir(), 'easycut', projectId), { recursive: true, force: true }).catch(() => {});
}
