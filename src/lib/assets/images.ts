import { env } from '@/lib/config/env';
import { isWavespeedMediaConfigured, runMediaJob } from './wavespeed-media';

/**
 * Bespoke illustration, for the rare cue where no stock clip and no icon can
 * show the thing. Flux Schnell is the right model here: four denoising steps,
 * about two seconds, roughly $0.003 an image. Anything slower or pricier breaks
 * both the speed and the cost budget for the sake of a 2.5-second insert.
 *
 * The director is instructed to use this at most once or twice per video, and
 * the pipeline enforces that independently — a prompt-level limit is a
 * suggestion, a code-level limit is a budget.
 */

export interface GeneratedImage {
  url: string;
  provider: 'replicate' | 'fal' | 'wavespeed';
  costUsd: number;
  prompt: string;
}

/** Flux Schnell, 1 megapixel, 4 steps. */
const REPLICATE_COST_USD = 0.003;
const FAL_COST_USD = 0.003;
/** WaveSpeed's own catalogue price for the default model, per image. */
const WAVESPEED_COST_USD = 0.008;
/** Measured at about six seconds; this is the give-up point, not the expectation. */
const WAVESPEED_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 700;
const MAX_POLLS = 60;

export function isImageGenConfigured(): boolean {
  if (!env.features.generatedImages) return false;
  return Boolean(
    env.imagegen.replicateToken || env.imagegen.falKey || isWavespeedMediaConfigured(),
  );
}

export function estimateImageCostUsd(count: number): number {
  if (env.imagegen.replicateToken) return count * REPLICATE_COST_USD;
  if (env.imagegen.falKey) return count * FAL_COST_USD;
  return count * WAVESPEED_COST_USD;
}

export async function generateImage(prompt: string, aspect: '9:16' | '16:9' | '1:1'): Promise<GeneratedImage | null> {
  // The director writes a subject; we own the look, so the style suffix is ours.
  const styled = `${prompt}. Clean modern editorial illustration, bold simple shapes, high contrast, deep near-black background, single violet accent, centred subject, generous negative space, no text, no watermark.`;

  const preferReplicate = env.imagegen.provider === 'replicate' || (env.imagegen.provider === 'auto' && env.imagegen.replicateToken);

  if (preferReplicate && env.imagegen.replicateToken) {
    const result = await generateWithReplicate(styled, aspect).catch(() => null);
    if (result) return result;
  }
  if (env.imagegen.falKey) {
    const result = await generateWithFal(styled, aspect).catch(() => null);
    if (result) return result;
  }
  // Last, and reached by most deployments, because it is the key people
  // already have for the director. A failure here returns null like the
  // others: a missing illustration means the cue falls back to stock or an
  // icon, never that the video fails.
  if (isWavespeedMediaConfigured()) {
    return generateWithWavespeed(styled, aspect).catch(() => null);
  }
  return null;
}

/** Sizes that match the frame the insert will sit in, at about one megapixel. */
const WAVESPEED_SIZE: Record<string, string> = {
  '9:16': '768*1344',
  '16:9': '1344*768',
  '1:1': '1024*1024',
};

async function generateWithWavespeed(
  prompt: string,
  aspect: '9:16' | '16:9' | '1:1',
): Promise<GeneratedImage | null> {
  const { urls } = await runMediaJob({
    model: env.imagegen.wavespeedModel,
    input: {
      prompt,
      size: WAVESPEED_SIZE[aspect] ?? WAVESPEED_SIZE['1:1'],
      output_format: 'jpeg',
    },
    timeoutMs: WAVESPEED_TIMEOUT_MS,
    // These land in seconds, so poll faster than the video path does.
    pollMs: 900,
  });
  return { url: urls[0], provider: 'wavespeed', costUsd: WAVESPEED_COST_USD, prompt };
}

async function generateWithReplicate(prompt: string, aspect: string): Promise<GeneratedImage | null> {
  const response = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.imagegen.replicateToken}`,
      'Content-Type': 'application/json',
      // Ask Replicate to hold the connection open — usually removes the polling
      // round-trips entirely for a model this fast.
      Prefer: 'wait=55',
    },
    body: JSON.stringify({
      model: env.imagegen.replicateModel,
      input: {
        prompt,
        aspect_ratio: aspect,
        num_outputs: 1,
        output_format: 'webp',
        output_quality: 90,
        go_fast: true,
      },
    }),
  });

  if (!response.ok) throw new Error(`Replicate ${response.status}: ${(await response.text()).slice(0, 200)}`);
  let prediction = (await response.json()) as any;

  for (let i = 0; i < MAX_POLLS && ['starting', 'processing'].includes(prediction.status); i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const polled = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${env.imagegen.replicateToken}` },
    });
    prediction = await polled.json();
  }

  const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (typeof url !== 'string') return null;

  return { url, provider: 'replicate', costUsd: REPLICATE_COST_USD, prompt };
}

async function generateWithFal(prompt: string, aspect: string): Promise<GeneratedImage | null> {
  const imageSize =
    aspect === '9:16' ? 'portrait_16_9' : aspect === '1:1' ? 'square_hd' : 'landscape_16_9';

  const response = await fetch(`https://fal.run/${env.imagegen.falModel}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${env.imagegen.falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: imageSize,
      num_images: 1,
      num_inference_steps: 4,
      enable_safety_checker: true,
    }),
  });

  if (!response.ok) throw new Error(`fal ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const json = (await response.json()) as any;
  const url = json?.images?.[0]?.url;
  if (typeof url !== 'string') return null;

  return { url, provider: 'fal', costUsd: FAL_COST_USD, prompt };
}
