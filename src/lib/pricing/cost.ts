import { env } from '@/lib/config/env';
import { priceFor } from '@/lib/director/anthropic';
import type { FormatMode } from '@/lib/styles/presets';

/**
 * The budget guard.
 *
 * The product promise is a hard one — under $1 for a short, under $5 for a
 * long-form — so the ceiling is enforced in code, before anything is spent, not
 * hoped for in a spreadsheet. When a job would exceed its budget, the pipeline
 * does not fail: it *degrades*, dropping the most expensive optional layers in
 * a fixed order until it fits.
 */

export type CostLine =
  | 'transcription'
  | 'director'
  | 'image-generation'
  | 'stock'
  | 'render'
  | 'storage';

export interface CostEstimate {
  lines: Record<CostLine, number>;
  totalUsd: number;
  budgetUsd: number;
  withinBudget: boolean;
  headroomUsd: number;
}

export interface CostInputs {
  mode: FormatMode;
  sourceDurationSec: number;
  outputDurationSec: number;
  width: number;
  height: number;
  fps: number;
  transcriptChars: number;
  directorWindows: number;
  generatedImageCount: number;
  brollClipCount: number;
  /**
   * Which renderer to price. Defaults to whatever is configured, but callers
   * can ask explicitly — the doctor script quotes both, and the budget guard
   * has to be able to reason about the cloud path even on a dev machine where
   * rendering happens to be free.
   */
  renderDriver?: 'local' | 'lambda';
}

/* ------------------------------ unit pricing ------------------------------ */

/** Deepgram Nova-3 pre-recorded, pay-as-you-go. */
const ASR_USD_PER_MINUTE = 0.0043;

/** Flux Schnell at 1 MP / 4 steps. */
const IMAGE_USD_EACH = 0.003;

/**
 * Remotion Lambda at 2 GB memory in us-east-1.
 *
 * Lambda bills GB-seconds: 2 GB × $0.0000166667 per GB-s. Measured throughput
 * for a composition of this complexity is around 4 rendered frames per second
 * per worker, so cost is proportional to total frames and NOT to the worker
 * count — concurrency buys latency, not price. Storage/egress for the output is
 * counted separately below.
 */
const LAMBDA_GB = 2;
const LAMBDA_USD_PER_GB_SECOND = 0.0000166667;
const LAMBDA_FRAMES_PER_SECOND_PER_WORKER = 4;
const LAMBDA_INVOCATION_USD = 0.0000002;

/** Local rendering costs no money — only wall-clock time. */
const LOCAL_RENDER_USD = 0;

/** Cloudflare R2: $0.015/GB-month storage, $0 egress. Amortised over a month. */
const STORAGE_USD_PER_GB_MONTH = 0.015;
/** Rough bitrate of our 1080p H.264 output plus the source we keep. */
const OUTPUT_MBPS = 8;

export function estimateCost(inputs: CostInputs): CostEstimate {
  const budgetUsd = inputs.mode === 'short' ? env.limits.maxCostShortUsd : env.limits.maxCostLongUsd;

  const transcription = (inputs.sourceDurationSec / 60) * ASR_USD_PER_MINUTE;
  const director = estimateDirector(inputs);
  const imageGeneration = inputs.generatedImageCount * IMAGE_USD_EACH;
  const stock = 0; // Pexels and Pixabay are free
  const render = estimateRender(inputs);
  const storage = estimateStorage(inputs);

  const lines: Record<CostLine, number> = {
    transcription,
    director,
    'image-generation': imageGeneration,
    stock,
    render,
    storage,
  };

  const totalUsd = Object.values(lines).reduce((a, b) => a + b, 0);

  return {
    lines,
    totalUsd,
    budgetUsd,
    withinBudget: totalUsd <= budgetUsd,
    headroomUsd: budgetUsd - totalUsd,
  };
}

function estimateDirector(inputs: CostInputs): number {
  if (!env.llm.anthropicKey) return 0;
  const pricing = priceFor(env.llm.model);
  // ~4 characters per token for English prose, plus the brief and the (cached
  // after the first window) system prompt.
  const inputTokens = inputs.transcriptChars / 4 + inputs.directorWindows * 1600;
  const outputTokens = inputs.directorWindows * 3500;
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMTok +
    (outputTokens / 1_000_000) * pricing.outputPerMTok
  );
}

function estimateRender(inputs: CostInputs): number {
  const driver = inputs.renderDriver ?? env.render.driver;
  if (driver !== 'lambda') return LOCAL_RENDER_USD;

  const frames = inputs.outputDurationSec * inputs.fps;
  // Pixel count relative to 1080p — a 4K render is genuinely four times the work.
  const pixelFactor = (inputs.width * inputs.height) / (1920 * 1080);
  const workerSeconds = (frames / LAMBDA_FRAMES_PER_SECOND_PER_WORKER) * pixelFactor;

  const invocations = Math.ceil(frames / env.render.framesPerLambda);

  return workerSeconds * LAMBDA_GB * LAMBDA_USD_PER_GB_SECOND + invocations * LAMBDA_INVOCATION_USD;
}

function estimateStorage(inputs: CostInputs): number {
  const outputGb = (inputs.outputDurationSec * OUTPUT_MBPS) / 8 / 1024;
  // Source files are kept for 30 days so the user can re-cut without re-uploading.
  const sourceGb = (inputs.sourceDurationSec * 12) / 8 / 1024;
  return (outputGb + sourceGb) * STORAGE_USD_PER_GB_MONTH;
}

/* ------------------------------- degradation ------------------------------ */

/**
 * Layers we will sacrifice to stay inside budget, cheapest-to-lose first.
 *
 * The ordering is a product decision, not an arithmetic one: a viewer notices a
 * missing caption instantly and a missing generated illustration never, so
 * captions are the last thing to go and bespoke images are the first.
 */
export const DEGRADATION_ORDER = [
  'generated-images',
  'reframe-precision',
  'broll',
  'render-resolution',
] as const;

export type DegradationStep = (typeof DEGRADATION_ORDER)[number];

export interface DegradationPlan {
  steps: DegradationStep[];
  estimate: CostEstimate;
}

/**
 * Finds the smallest set of sacrifices that brings a job inside budget.
 * Returns an empty step list when nothing needs to be given up.
 */
export function planDegradation(inputs: CostInputs): DegradationPlan {
  let current = { ...inputs };
  let estimate = estimateCost(current);
  const steps: DegradationStep[] = [];

  for (const step of DEGRADATION_ORDER) {
    if (estimate.withinBudget) break;

    switch (step) {
      case 'generated-images':
        current = { ...current, generatedImageCount: 0 };
        break;
      case 'reframe-precision':
        // Reframing is local CPU, so this only matters for render complexity.
        break;
      case 'broll':
        current = { ...current, brollClipCount: 0 };
        break;
      case 'render-resolution':
        // 1080p → 720p is a 2.25× cut in render cost and almost invisible on a phone.
        current = {
          ...current,
          width: Math.round(current.width * (2 / 3)),
          height: Math.round(current.height * (2 / 3)),
        };
        break;
    }

    steps.push(step);
    estimate = estimateCost(current);
  }

  return { steps, estimate };
}

/** Actual spend, accumulated as the job runs, for the per-project cost report. */
export class CostLedger {
  private readonly entries: Array<{ line: CostLine; usd: number; note: string }> = [];

  add(line: CostLine, usd: number, note = ''): void {
    if (!Number.isFinite(usd) || usd <= 0) return;
    this.entries.push({ line, usd, note });
  }

  get totalUsd(): number {
    return this.entries.reduce((sum, e) => sum + e.usd, 0);
  }

  byLine(): Partial<Record<CostLine, number>> {
    const totals: Partial<Record<CostLine, number>> = {};
    for (const entry of this.entries) {
      totals[entry.line] = (totals[entry.line] ?? 0) + entry.usd;
    }
    return totals;
  }

  toJSON() {
    return { totalUsd: Number(this.totalUsd.toFixed(5)), lines: this.byLine(), entries: this.entries };
  }
}

export function formatUsd(value: number): string {
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/**
 * The same number, for somewhere a person is reading rather than auditing.
 *
 * `formatUsd` keeps four decimals under a cent because the whole point of the
 * cost ledger is that fractions of a cent are visible. On a dashboard tile that
 * precision reads as a bug: a brand-new account's total spend rendered as
 * "$0.0000", which looks like something failed rather than like nothing has
 * happened yet.
 */
export function formatUsdCoarse(value: number): string {
  if (value <= 0) return '$0';
  if (value < 0.01) return '<$0.01';
  return `$${value.toFixed(2)}`;
}
