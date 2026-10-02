import { env } from '@/lib/config/env';
import {
  KIE_IMAGE_COST_USD,
  KIE_IMAGE_MODEL,
  KIE_IMAGE_TIMEOUT_MS,
  isKieConfigured,
  kieVideoModel,
  runKieJob,
} from './kie';
import { generateBrollClip, isGeneratedBrollConfigured } from './generated-broll';
import { brollPrompt } from './broll-prompt';
import { estimateImageCostUsd, generateImage, isImageGenConfigured } from './images';
import type { StockClip } from './broll';

/**
 * B-roll that is made rather than found.
 *
 * ── The three sources, and why they are a choice ────────────────────────
 *
 * Stock search finds a literal calculator in 200 milliseconds and costs
 * nothing. For most cues it is simply the better answer, which is why it stays
 * the default and why this is opt-in. What it cannot do is the specific and
 * the abstract — your product, your diagram, the thing no library has filmed —
 * and that is what this exists for.
 *
 * Between the two generated kinds, the trade is not subtle:
 *
 * | source     | per insert | wait per insert | four inserts |
 * |------------|-----------:|----------------:|-------------:|
 * | stock      |      $0.00 |           0.2 s |        $0.00 |
 * | AI picture |      $0.03 |            ~8 s |        $0.12 |
 * | AI video   | $0.11-0.62 |        1-4 min  |  $0.45-2.48 |
 *
 * So a generated STILL is the one that can go in front of everybody: three
 * cents, seconds, and inside the one-dollar short-form budget four times over.
 * A generated CLIP is a deliberate purchase, and the picker says the price.
 *
 * ── A still is not a static insert ──────────────────────────────────────
 *
 * The picture moves. A generated image lands on the timeline as a
 * `stock-photo` clip with a Ken Burns move, which the renderer animates on
 * every frame — a slow push or a drift across the frame for the two and a half
 * seconds it is up. That is done in the composition rather than by baking a
 * clip with ffmpeg first, which would mean a second encode, a second file to
 * store, and a move nobody can change afterwards; as a property of the clip it
 * is editable on the timeline like any other.
 *
 * The move is CHOSEN rather than fixed. Four inserts all pushing in at the
 * same rate is its own kind of still — it reads as a slideshow with a zoom
 * effect — so consecutive stills alternate between a push and a drift, and
 * which drift depends on the clip so the same edit cuts the same way twice.
 */

/**
 * `mixed` is first because it is the default: see `broll-mix.ts` for why one
 * source for a whole video is the wrong shape. The other three stay as
 * overrides — a consistent look, a missing key and a budget are all real
 * reasons to force one.
 */
export type BrollSource = 'mixed' | 'stock' | 'ai-image' | 'ai-video';

export const BROLL_SOURCES: readonly BrollSource[] = ['mixed', 'stock', 'ai-image', 'ai-video'];

export function isBrollSource(value: unknown): value is BrollSource {
  return typeof value === 'string' && (BROLL_SOURCES as readonly string[]).includes(value);
}

/** The moves a generated still is given, in the order they cycle. */
const STILL_MOVES = ['in', 'pan-right', 'out', 'pan-left'] as const;
export type StillMove = (typeof STILL_MOVES)[number];

/**
 * Which move this still gets.
 *
 * By index rather than at random, so the same footage cuts the same way twice
 * — the whole pipeline is deterministic and a generated insert must not be the
 * one thing that is not.
 */
export function moveForStill(index: number): StillMove {
  return STILL_MOVES[index % STILL_MOVES.length];
}

export interface AiClip extends StockClip {
  provider: 'generated';
  costUsd: number;
  prompt: string;
  /** Set for a still, so the builder knows to keep the picture moving. */
  kenBurns?: StillMove;
}

export function isAiBrollConfigured(source: BrollSource): boolean {
  if (source === 'stock') return true;
  // Mixed never needs a key: with none it is every insert searched, which is
  // what `stock` is. Anything it can reach on top of that is a bonus.
  if (source === 'mixed') return true;
  // Both generated sources have a second provider behind them, and for the
  // same reason: this product already asks for a WaveSpeed key, and a
  // deployment that has one should not be told it needs a different account
  // to use a feature its key can already serve.
  if (source === 'ai-image') return isKieConfigured() || isImageGenConfigured();
  return isKieConfigured() || isGeneratedBrollConfigured();
}

/** What the picker quotes and the ledger expects, before anything is made. */
/**
 * What share of a mixed edit gets made rather than found.
 *
 * An assumption, because the wizard quotes before anything has been cut and
 * the real answer depends on cues that do not exist yet. Measured at about a
 * third across the sample transcripts; the ledger charges what was actually
 * spent, so this only has to be close enough not to surprise anybody.
 */
export const MIXED_MADE_SHARE = 0.35;

export function estimateAiBrollUsd(source: BrollSource, inserts: number, secondsEach: number): number {
  if (source === 'stock') return 0;
  if (source === 'mixed') {
    return isImageGenConfigured() || isKieConfigured()
      ? estimateAiBrollUsd('ai-image', Math.round(inserts * MIXED_MADE_SHARE), secondsEach)
      : 0;
  }
  if (source === 'ai-image') {
    return isKieConfigured() ? inserts * KIE_IMAGE_COST_USD : estimateImageCostUsd(inserts);
  }
  if (!isKieConfigured()) return inserts * 0.04; // the WaveSpeed fallback's own rate
  const model = kieVideoModel(env.kie.videoModel);
  return inserts * snapTo(secondsEach, model.durations) * model.usdPerSec;
}

/** How long somebody waits for all of them, given they run at once. */
export function estimateAiBrollSeconds(source: BrollSource, inserts = 1): number {
  if (source === 'stock') return 0;
  if (source === 'mixed') return estimateAiBrollSeconds('ai-image', Math.round(inserts * MIXED_MADE_SHARE));
  const one =
    source === 'ai-image'
      // Measured: Z-Image Turbo about nine seconds, the WaveSpeed image
      // model about eight.
      ? (isKieConfigured() ? 9 : 8)
      : isKieConfigured() ? kieVideoModel(env.kie.videoModel).typicalSec : 110;

  /*
   * Inserts are made concurrently — `Promise.all` over the whole B-roll track —
   * so the wall clock is one clip, not the sum of them. That holds for a short
   * with four. It does not hold for a long-form edit with seventy, where the
   * provider's own concurrency limit starts queueing them, and quoting one
   * clip's time for an hour of work is the same kind of wrong as quoting one
   * clip's price.
   *
   * `BATCH` is the number in flight before queueing begins. Waves past that
   * cost another `one` each, which is the honest shape of the curve even if
   * the exact limit moves.
   */
  const BATCH = 8;
  return Math.round(one * Math.max(1, Math.ceil(inserts / BATCH)));
}

/**
 * How many inserts a video of this shape gets, and how long each runs.
 *
 * Read off the same pacing profile the director is budgeted from, so the tile
 * quotes the video somebody is about to make rather than a typical one. The
 * spread is what makes this matter: a short gets about four inserts and a
 * ten-minute commentary edit gets seventy-five, so a fixed guess is not a
 * rounding error on the price, it is an order of magnitude.
 */
export function brollShapeFor(
  pacing: { brollEverySec: number; brollDurationSec: readonly [number, number] },
  durationSec: number,
): { inserts: number; secondsEach: number } {
  const inserts = pacing.brollEverySec > 0 ? Math.max(1, Math.floor(durationSec / pacing.brollEverySec)) : 0;
  return { inserts, secondsEach: (pacing.brollDurationSec[0] + pacing.brollDurationSec[1]) / 2 };
}

/**
 * One insert, made to order, shaped like a stock clip.
 *
 * Returns null rather than throwing on every failure, because the caller's
 * only sane response is the same in all of them: use the next source. A video
 * with one fewer insert is a video; a thrown error here is no video at all.
 */
export async function makeBrollAsset(
  source: Exclude<BrollSource, 'stock'>,
  subject: string,
  options: {
    orientation: 'portrait' | 'landscape' | 'square';
    durationSec: number;
    /** Position in the video, so the still's move cycles rather than repeats. */
    index: number;
  },
): Promise<AiClip | null> {
  if (source === 'ai-image') return makeStill(subject, options);

  if (isKieConfigured()) return makeClip(subject, options);
  // WaveSpeed is the other account this product already asks for, and it has
  // its own video catalogue — so a deployment with that key and no Kie key
  // still gets AI B-roll rather than an error about a key it never needed.
  const clip = await generateBrollClip(subject, options);
  return clip ? { ...clip } : null;
}

/* ----------------------------------------------------------------- stills */

async function makeStill(
  subject: string,
  options: { orientation: 'portrait' | 'landscape' | 'square'; durationSec: number; index: number },
): Promise<AiClip | null> {
  const aspect =
    options.orientation === 'portrait' ? '9:16' : options.orientation === 'square' ? '1:1' : '16:9';

  /*
   * The image generator this product already has, when there is no Kie key.
   *
   * It is the same arrangement `ai-video` has had all along — Kie first, the
   * WaveSpeed account second — and the reason is the same: a deployment whose
   * key can already make the picture should not be shown a locked tile asking
   * it to open an account somewhere else.
   *
   * `styled: false` matters. That helper's default suffix describes an
   * editorial illustration on a near-black ground, which is right for the
   * graphics it normally draws and wrong for every B-roll insert, which has
   * to pass as footage. `brollPrompt` already writes the photographic one.
   */
  if (!isKieConfigured()) {
    const made = await generateImage(brollPrompt(subject, 'still'), aspect, { styled: false });
    if (!made) return null;
    const [width, height] =
      aspect === '9:16' ? [1024, 1792] : aspect === '1:1' ? [1024, 1024] : [1792, 1024];
    return {
      id: `ai-still-${slug(subject)}`,
      provider: 'generated',
      url: made.url,
      previewUrl: made.url,
      width,
      height,
      durationSec: options.durationSec,
      kind: 'stock-photo',
      attribution: 'Generated',
      score: 0.8,
      costUsd: made.costUsd,
      prompt: subject,
      kenBurns: moveForStill(options.index),
    };
  }

  try {
    const { urls } = await runKieJob({
      model: KIE_IMAGE_MODEL,
      input: {
        prompt: brollPrompt(subject, 'still'),
        aspect_ratio: aspect,
      },
      timeoutMs: KIE_IMAGE_TIMEOUT_MS,
      pollMs: 1500,
    });

    const [width, height] =
      aspect === '9:16' ? [1024, 1792] : aspect === '1:1' ? [1024, 1024] : [1792, 1024];

    return {
      id: `ai-still-${slug(subject)}`,
      provider: 'generated',
      url: urls[0],
      previewUrl: urls[0],
      width,
      height,
      // A still has no length of its own: it lasts exactly as long as the
      // insert, which is why it can never be the clip that runs out early.
      durationSec: options.durationSec,
      kind: 'stock-photo',
      attribution: 'Generated',
      // Made for this cue, so it matches by construction — but deliberately
      // below a strong stock match, so this can sit in the same ranking
      // without a special case.
      score: 0.8,
      costUsd: KIE_IMAGE_COST_USD,
      prompt: subject,
      kenBurns: moveForStill(options.index),
    };
  } catch (error) {
    console.warn(`[easycut] AI still failed for "${subject}": ${(error as Error).message}`);
    return null;
  }
}

/* ------------------------------------------------------------------ clips */

async function makeClip(
  subject: string,
  options: { orientation: 'portrait' | 'landscape' | 'square'; durationSec: number },
): Promise<AiClip | null> {
  const model = kieVideoModel(env.kie.videoModel);
  const aspect =
    options.orientation === 'portrait' ? '9:16' : options.orientation === 'square' ? '1:1' : '16:9';

  /*
   * Snapped UP to a length the model will accept.
   *
   * These models take one of a fixed set and reject anything else outright
   * rather than rounding. Snapping DOWN would hand the timeline a clip shorter
   * than the insert it has to cover, and an insert that runs out early is a
   * frozen frame in the middle of a finished video — much worse than a second
   * of unused tail, which simply gets trimmed.
   */
  const duration = snapTo(options.durationSec, model.durations);

  try {
    const { urls } = await runKieJob({
      model: model.id,
      input: {
        prompt: brollPrompt(subject, 'clip'),
        aspect_ratio: aspect,
        resolution: model.resolution,
        // The Seedance 1.x models want a STRING here and the 2.x ones a
        // number, and each rejects the other's shape. Sent as a string with
        // the 2.x id switched, rather than as whatever the caller had.
        duration: model.id.startsWith('bytedance/v1-') ? String(duration) : duration,
      },
      timeoutMs: Math.max(120_000, model.typicalSec * 3_000),
      pollMs: 5000,
    });

    const [width, height] =
      aspect === '9:16' ? [720, 1280] : aspect === '1:1' ? [1024, 1024] : [1280, 720];

    return {
      id: `ai-clip-${slug(subject)}`,
      provider: 'generated',
      url: urls[0],
      previewUrl: urls[0],
      width,
      height,
      durationSec: duration,
      kind: 'stock-video',
      attribution: 'Generated',
      score: 0.8,
      costUsd: duration * model.usdPerSec,
      prompt: subject,
    };
  } catch (error) {
    console.warn(`[easycut] AI clip failed for "${subject}": ${(error as Error).message}`);
    return null;
  }
}

/* ---------------------------------------------------------------- helpers */

function snapTo(seconds: number, ladder: readonly number[]): number {
  const wanted = Math.ceil(seconds);
  return ladder.find((rung) => rung >= wanted) ?? ladder[ladder.length - 1];
}

function slug(subject: string): string {
  return Buffer.from(subject).toString('base64url').slice(0, 16);
}

/* ------------------------------------------------------------ the offers */

/**
 * The three choices, priced, for the picker.
 *
 * Built on the server because only the server knows which keys are set, and
 * computed from the same catalogue the pipeline bills against rather than from
 * a sentence somebody wrote once — a price on a tile that does not match the
 * price on the invoice is worse than no price at all.
 *
 * `inserts` and `secondsEach` are the shape of a typical video of this mode,
 * not a promise: the director decides how many inserts a video gets. It is an
 * estimate and the tile reads as one.
 */
export function brollSourceOffers(inserts: number, secondsEach: number): Array<{
  source: BrollSource;
  label: string;
  body: string;
  costUsd: number;
  waitSec: number;
  available: boolean;
  missing?: string;
}> {
  return brollSourceRates().map((rate) => ({
    source: rate.source,
    label: rate.label,
    body: rate.body,
    costUsd: priceBrollRate(rate, inserts, secondsEach),
    waitSec: estimateAiBrollSeconds(rate.source, inserts),
    available: rate.available,
    missing: rate.missing,
  }));
}

/** What a source charges, without deciding yet how big the video is. */
export interface BrollSourceRate {
  source: BrollSource;
  label: string;
  body: string;
  available: boolean;
  missing?: string;
  /** Charged once per insert, whatever its length. */
  usdPerInsert: number;
  /** Charged per second of insert, after snapping to `durations`. */
  usdPerSecond: number;
  /** The lengths the provider actually bills in: a 4.2s clip costs a 5s one. */
  durations: readonly number[];
  /** Wall clock for one insert. */
  oneSec: number;
}

/**
 * The rates, separated from the size of the video.
 *
 * The wizard has to price the video somebody is ABOUT to make, and that
 * depends on their file's length and the style they picked — both of which
 * live in the browser, while the keys and the billing catalogue live on the
 * server and must stay there. So the server sends what things cost and the
 * client multiplies by how many.
 *
 * It replaced a single hardcoded `brollSourceOffers(4, 2.5)`: four inserts of
 * two and a half seconds, the shape of a typical short, quoted at the same
 * price for a ten-minute edit that gets twenty times as many.
 */
export function brollSourceRates(): BrollSourceRate[] {
  const videoLabel = isKieConfigured() ? kieVideoModel(env.kie.videoModel).label : 'a video model';
  const model = isKieConfigured() ? kieVideoModel(env.kie.videoModel) : null;

  return [
    {
      source: 'mixed',
      label: 'Mixed',
      body: 'Each cue goes where it will look best: the library for anything a camera has filmed, a made picture for the rest.',
      available: true,
      usdPerInsert: (isKieConfigured() || isImageGenConfigured())
        ? estimateAiBrollUsd('ai-image', 1, 1) * MIXED_MADE_SHARE
        : 0,
      usdPerSecond: 0, durations: [1], oneSec: 0,
    },
    {
      source: 'stock',
      label: 'Stock footage',
      body: 'Searched from Pexels and Pixabay. Right for most cues, and it costs nothing.',
      available: true,
      usdPerInsert: 0, usdPerSecond: 0, durations: [1], oneSec: 0,
    },
    {
      source: 'ai-image',
      label: 'AI pictures',
      body: `A still made for each cue by ${isKieConfigured() ? 'Z-Image Turbo' : 'an image model'}, pushed and panned across the frame so it moves like footage.`,
      available: isKieConfigured() || isImageGenConfigured(),
      missing: 'Needs a Kie API key (KIE_API_KEY) or a WaveSpeed key.',
      // A picture is priced per picture; its length on screen costs nothing.
      usdPerInsert: isKieConfigured() ? KIE_IMAGE_COST_USD : estimateImageCostUsd(1),
      usdPerSecond: 0,
      durations: [1],
      oneSec: isKieConfigured() ? 9 : 8,
    },
    {
      source: 'ai-video',
      label: 'AI video',
      body: `Real generated footage from ${videoLabel}. The best picture, and by far the slowest.`,
      available: isKieConfigured() || isGeneratedBrollConfigured(),
      missing: 'Needs a Kie API key (KIE_API_KEY) or a WaveSpeed key.',
      usdPerInsert: 0,
      usdPerSecond: model?.usdPerSec ?? 0.008,
      durations: model?.durations ?? [5, 10],
      oneSec: model?.typicalSec ?? 110,
    },
  ];
}

/** Applies a rate to a video of a given shape. Safe to run in the browser. */
export function priceBrollRate(rate: BrollSourceRate, inserts: number, secondsEach: number): number {
  if (!inserts) return 0;
  const billed = rate.usdPerSecond ? snapTo(secondsEach, rate.durations) : 0;
  return inserts * (rate.usdPerInsert + billed * rate.usdPerSecond);
}

/** The wall clock for a whole batch, given the rate's one-insert time. */
export function waitForBrollRate(rate: BrollSourceRate, inserts: number): number {
  if (!rate.oneSec || !inserts) return 0;
  const BATCH = 8;
  return Math.round(rate.oneSec * Math.max(1, Math.ceil(inserts / BATCH)));
}

