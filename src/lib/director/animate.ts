import { env } from '@/lib/config/env';
import type { SceneLook } from '@/lib/edl/types';
import { guideAsPrompt, styleGuideFor } from '@/lib/scenes/style-guides';

/**
 * Turning a drawn beat into footage, with Seedance.
 *
 * ── The shape, and why it is this shape ─────────────────────────────────
 *
 * Five models went through the same frame of our neon look. Every one of them
 * animated the picture well and every one of them destroyed the rendered type
 * within two seconds. That settles the architecture rather than leaving it a
 * preference:
 *
 *   1. Opus draws the beat as SVG, as it already does.
 *   2. That beat is rendered to a PNG **with no words on it**.
 *   3. Seedance animates the PNG.
 *   4. Remotion draws the caption over the result, crisply, in the video's
 *      own typeface.
 *
 * The model never sees a letter, so it never has the chance to melt one.
 *
 * ── The prompt is the whole job ─────────────────────────────────────────
 *
 * An image-to-video model is handed a picture that already contains the
 * subject, the palette and the composition. Describing those again is wasted,
 * and worse than wasted: restating the subject invites it to draw a second
 * one, which is exactly what happened in testing — Seedance produced a second
 * figure beside ours when the prompt described the figure.
 *
 * So the prompt says four things and nothing else:
 *
 *   MOTION   one or two physical changes, written by the model that drew it
 *   CAMERA   one move, named
 *   STYLE    the guide's own words, so the world cannot drift
 *   NEVER    the specific failures these models have, not generic negatives
 */

const API_BASE = 'https://api.wavespeed.ai/api/v3';

/**
 * Seedance 2.0 Fast, at 720p.
 *
 * 2.5 is visibly better and costs $1.80 per five seconds against $1.00, which
 * on a four-scene video is the difference between $4 and $7.20 for a gap that
 * barely shows on a three-second insert. `SCENE_VIDEO_MODEL` overrides it.
 */
const DEFAULT_MODEL = 'bytedance/seedance-2.0-fast/image-to-video';

/**
 * The failures these models actually have, named.
 *
 * Generic negatives ("low quality, blurry") do nothing on a model that was
 * handed a clean plate. Every line here is something that happened in testing
 * and cost a clip.
 */
const NEVER = [
  'no text, no letters, no numbers, no captions, no watermark, no logo',
  'do not add any new object, character or figure that is not already in the image',
  'do not duplicate or mirror anything in the image',
  'do not change the colours, the palette or the background',
  'no photorealism, no 3D render, no live action, no film grain',
  'no morphing, no melting, no warping of the shapes',
  'no cuts, no scene change — one continuous shot',
];

export interface AnimateRequest {
  /** The beat's plate, as a data URI or a URL. No words on it. */
  plate: string;
  /**
   * What physically happens, in one or two clauses.
   *
   * Written by Opus when it drew the beat — see `data-motion` in
   * `assets/illustration.ts`. It knows which piece is a clock hand and which
   * is a background, which no generic prompt can.
   */
  motion: string;
  look: SceneLook;
  /** Seconds. Seedance bills per five-second block, so this rounds up. */
  seconds: number;
}

export interface AnimateResult {
  url: string | null;
  costUsd: number;
  error?: string;
}

export function isAnimatorConfigured(): boolean {
  return Boolean(env.llm.wavespeedKey);
}

/**
 * What Seedance is told.
 *
 * Exported and pure so it can be read and tested without spending anything —
 * this prompt is the whole quality of the feature, and it should be arguable
 * over in a diff rather than only observable in a bill.
 */
export function motionPrompt(request: AnimateRequest): string {
  const guide = styleGuideFor(request.look);

  return [
    // The motion first: an image-to-video model weights the opening of the
    // prompt most heavily, and the one thing it cannot read off the plate is
    // what is supposed to change.
    `Animate this image. ${request.motion.trim().replace(/\.?$/, '.')}`,
    `Camera: ${guide.camera}`,
    `Keep the existing artwork exactly as drawn — same shapes, same lines, same colours. ${guide.rendering}`,
    `How things move in this world: ${guide.motion}`,
    NEVER.join(', ') + '.',
  ].join('\n');
}

/**
 * How many seconds to buy.
 *
 * Seedance bills per five-second block and its floor is four, so a 2.4-second
 * scene and a 5-second scene cost the same. Buying the block and trimming in
 * the renderer is both cheaper and better — the last half second of a
 * generated clip is where the drift shows.
 */
export function billableSeconds(seconds: number): number {
  return Math.max(5, Math.ceil(seconds / 5) * 5);
}

/** $0.20 a second at 720p: the 480p base doubled. Not the catalogue's number. */
const USD_PER_SECOND_720P = 0.2;

export function animationCost(seconds: number): number {
  return billableSeconds(seconds) * USD_PER_SECOND_720P;
}

export async function animatePlate(request: AnimateRequest): Promise<AnimateResult> {
  const key = env.llm.wavespeedKey;
  const model = env.genvideo.sceneModel || DEFAULT_MODEL;
  if (!key) return { url: null, costUsd: 0, error: 'WAVESPEED_API_KEY is not set' };

  const seconds = billableSeconds(request.seconds);

  try {
    const submit = await fetch(`${API_BASE}/${model}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        prompt: motionPrompt(request),
        image: request.plate,
        duration: seconds,
        resolution: '720p',
        generate_audio: false,
      }),
    });

    const submitted = (await submit.json().catch(() => ({}))) as { data?: { id?: string }; message?: string };
    if (!submit.ok || !submitted.data?.id) {
      throw new Error(submitted.message ?? `${submit.status} ${submit.statusText}`);
    }

    const id = submitted.data.id;
    // Measured at about two minutes for five seconds at 720p; the ceiling is
    // generous because the alternative is paying for a job and abandoning it.
    const deadline = Date.now() + 6 * 60_000;

    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const poll = await fetch(`${API_BASE}/predictions/${id}/result`, { headers: { authorization: `Bearer ${key}` } });
      const body = (await poll.json().catch(() => ({}))) as {
        data?: { status?: string; outputs?: string[]; error?: string };
      };

      if (body.data?.status === 'completed') {
        const url = body.data.outputs?.[0] ?? null;
        return url
          ? { url, costUsd: animationCost(seconds) }
          : { url: null, costUsd: animationCost(seconds), error: 'completed with no output' };
      }
      if (body.data?.status === 'failed') {
        // Paid for either way, so it is reported either way.
        return { url: null, costUsd: animationCost(seconds), error: body.data.error ?? 'generation failed' };
      }
      if (Date.now() > deadline) return { url: null, costUsd: animationCost(seconds), error: 'timed out' };
    }
  } catch (error) {
    return { url: null, costUsd: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
