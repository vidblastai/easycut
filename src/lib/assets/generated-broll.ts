import { env } from '@/lib/config/env';
import { isWavespeedMediaConfigured, runMediaJob } from './wavespeed-media';
import type { StockClip } from './broll';

/**
 * B-roll that does not exist yet.
 *
 * ── Why this is opt-in and not the default ──────────────────────────────
 *
 * Not cost. Measured against WaveSpeed's own catalogue, a six-second vertical
 * clip from `ltx-2-fast` is $0.04 — four inserts is 16 cents, which sits
 * inside the $1.00 short-form ceiling with room to spare.
 *
 * TIME is the reason. The same clip took 109 seconds to generate, measured end
 * to end. The product's promise is a finished short in about ninety seconds,
 * and clips generate in parallel with each other but not with the wait — so
 * turning this on roughly doubles how long somebody sits watching a progress
 * bar. That is a trade worth offering and not worth imposing.
 *
 * The other reason is aim. B-roll illustrates a noun somebody said. Stock
 * search finds a literal calculator in 200ms; generation produces something
 * plausible in two minutes. For most cues the stock clip is simply the better
 * answer, and this exists for the cues where it isn't — the specific, the
 * abstract, the thing no stock library has.
 *
 * So: stock first, always. This fills what stock could not, when asked.
 */

/** What a generated clip costs, from WaveSpeed's catalogue. */
const MODEL_COST_USD: Record<string, number> = {
  'lightricks/ltx-2-fast/text-to-video': 0.04,
  'lightricks/ltx-2-pro/text-to-video': 0.06,
  'bytedance/seedance-v1-pro-fast/text-to-video': 0.06,
  'x-ai/grok-imagine-video/text-to-video': 0.05,
  'pruna-ai/p-video-2-pro/text-to-video': 0.02,
};

const FALLBACK_COST_USD = 0.06;

/**
 * Measured at 109s for six seconds of vertical video. Four minutes is the
 * give-up point, not the expectation — a clip that takes longer than that has
 * gone wrong, and the edit is better off without it than waiting on it.
 */
const TIMEOUT_MS = 240_000;

/**
 * Generators do not take an arbitrary length — they take one of a fixed set,
 * and a request for five seconds is rejected outright rather than rounded.
 * (Measured: ltx-2-fast answers "duration must be one of [6, 8, 10, …]".)
 *
 * So snap UP to the next rung. Snapping down would hand the timeline a clip
 * shorter than the insert it has to cover, and a B-roll insert that runs out
 * early is a frozen frame in the middle of somebody's finished video — much
 * worse than a second of unused tail, which simply gets trimmed.
 */
const DURATION_LADDER = [6, 8, 10, 12, 14, 16, 18, 20];

function snapDuration(seconds: number): number {
  const wanted = Math.ceil(seconds);
  return DURATION_LADDER.find((rung) => rung >= wanted) ?? DURATION_LADDER.at(-1)!;
}

export function isGeneratedBrollConfigured(): boolean {
  return isWavespeedMediaConfigured();
}

export function generatedBrollCostFor(model = env.genvideo.model): number {
  return MODEL_COST_USD[model] ?? FALLBACK_COST_USD;
}

export function estimateGeneratedBrollCostUsd(count: number): number {
  return count * generatedBrollCostFor();
}

/**
 * The look is ours, the subject is the director's.
 *
 * Without a house style every clip arrives in whatever aesthetic the model
 * felt like, and four inserts in one video then look like four different
 * videos. The negative clause matters as much: generated footage loves adding
 * captions and logos, and a burnt-in caption underneath our caption track is
 * the one artefact nobody can edit away afterwards.
 */
function stylePrompt(subject: string): string {
  return (
    `${subject}. Cinematic live-action B-roll, shallow depth of field, natural motion, ` +
    `soft directional light, muted contemporary colour grade, no on-screen text, ` +
    `no captions, no subtitles, no logos, no watermark, no people speaking to camera.`
  );
}

export interface GeneratedClip extends StockClip {
  provider: 'generated';
  costUsd: number;
  prompt: string;
}

/**
 * One generated insert, shaped like a stock clip so the timeline builder does
 * not need to know where it came from.
 */
export async function generateBrollClip(
  subject: string,
  options: { orientation: 'portrait' | 'landscape' | 'square'; durationSec: number },
): Promise<GeneratedClip | null> {
  if (!isGeneratedBrollConfigured()) return null;

  const aspect =
    options.orientation === 'portrait' ? '9:16' : options.orientation === 'square' ? '1:1' : '16:9';

  const duration = snapDuration(options.durationSec);

  try {
    const { urls } = await runMediaJob({
      model: env.genvideo.model,
      input: { prompt: stylePrompt(subject), aspect_ratio: aspect, duration },
      timeoutMs: TIMEOUT_MS,
      pollMs: 4000,
    });

    const [width, height] =
      aspect === '9:16' ? [768, 1344] : aspect === '1:1' ? [1024, 1024] : [1344, 768];

    return {
      id: `generated-${Buffer.from(subject).toString('base64url').slice(0, 16)}`,
      provider: 'generated',
      url: urls[0],
      previewUrl: urls[0],
      width,
      height,
      durationSec: duration,
      kind: 'stock-video',
      // Generated, so nobody is owed a credit — but the editor shows where
      // every insert came from, and "generated" is the honest answer.
      attribution: 'Generated',
      // Generated to order, so it matches the cue by construction. The score
      // exists so this can sit in the same ranking as stock without a special
      // case; it is deliberately below a strong stock match.
      score: 0.8,
      costUsd: generatedBrollCostFor(),
      prompt: subject,
    };
  } catch (error) {
    // Never fatal. A missing insert is a video with less B-roll; a thrown error
    // here would be no video at all.
    console.warn(`[easycut] generated B-roll failed for "${subject}": ${(error as Error).message}`);
    return null;
  }
}
