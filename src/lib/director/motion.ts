import { env } from '@/lib/config/env';
import { languageBrief } from './prompt';
import { GRAPHIC_ANIMATIONS, MOVING_GRAPHICS } from '@/lib/edl/types';
import type { Transcript } from '@/lib/transcribe/types';
import { DirectorGraphicSchema, type DirectorGraphic, type DirectorPlan } from './schema';
import { wavespeedPriceFor } from './wavespeed';

/**
 * The motion-graphics pass.
 *
 * ── Why this is its own call, on its own model ──────────────────────────
 *
 * Most of what the director does is bookkeeping against a transcript: find the
 * rambling, mark the emphasised words, write a stock query for a noun. A flash
 * model does that well and cheaply, and it runs on every upload.
 *
 * Deciding that "we went from twelve to sixty-three in a quarter" wants two
 * bars growing rather than a stat card — and what the labels should be, and
 * that the second bar has to finish on the word "sixty-three" — is a different
 * kind of judgement. It is design, it is the part of the output people
 * actually notice, and it is where a stronger model earns its rate. So it is a
 * second, small call: a transcript and a short brief in, a handful of cues
 * out, on whatever `MOTION_MODEL` names.
 *
 * It is allowed to return nothing. Most footage does not contain a number
 * worth animating, and a counter over every figure is a dashboard, not an edit.
 *
 * If it fails, the plan keeps the graphics the main director already chose.
 * A motion graphic is a garnish; nothing downstream depends on one existing.
 */

const API_BASE = 'https://llm.wavespeed.ai/v1';

/** What the pass is allowed to return — the six that are a movement. */
const MOTION_TYPES = MOVING_GRAPHICS.concat('badge');

const SYSTEM = `You design motion graphics for short video edits. You are given a transcript with timestamps and you return the two or three moments — at most — that genuinely deserve an animated graphic, and what that graphic should be.

You are not decorating. A motion graphic earns its place only when the speaker says something the eye can hold onto better than the ear can: a figure they are proud of, a before-and-after they actually compare, a short list they enumerate, a proportion. Everything else gets nothing, and returning an empty list is the right answer more often than not.

Timing is the craft. \`atSec\` is where the movement STARTS, which is where the speaker starts saying the thing — a counter that lands after the sentence has moved on reads as lag, not as emphasis.`;

function briefFor(transcript: Transcript, plan: DirectorPlan, durationSec: number): string {
  const lines = transcript.words
    .map((w) => `${w.startSec.toFixed(1)} ${w.text}`)
    .join(' ');
  const taken = plan.graphics
    .map((g) => `${g.atSec.toFixed(1)}s ${g.type}`)
    .join(', ') || 'none';

  return `Video length: ${durationSec.toFixed(1)}s.${languageBrief(transcript.language)}
Graphics the edit already has (do not put one on top of these): ${taken}

Types you may use:
- counter — a figure running up to its value. text = the target with its unit ("40K", "3x", "$1.2M"); subtext = two or three words naming what it counts.
- progress-ring — a ring filling to a percentage, for something genuinely said as a proportion. text = the percentage.
- bar-chart — two to four bars growing, for a comparison the speaker actually makes. items = "Label value" pairs, biggest last, e.g. ["Before 12", "After 63"].
- checklist — ticks landing one at a time, for steps or requirements they enumerate. items = the lines; text = an optional heading.
- underline — a stroke drawn under the one phrase on screen that matters. text = the phrase.
- badge — a pill that snaps in. Two or three words at most: "FREE", "NEW IN V3".

animation is optional: "fade" keeps out of the movement's way (the usual right answer), "bounce" or "spin-in" for something that should feel alive, "pulse" to bring the eye back a beat later, "wipe" for a reveal.

Return {"graphics": [...]} and nothing else. Two or three at most for a video this length, never two in the same sentence, and [] if the footage does not contain a moment that wants one.

Transcript (seconds then word):
${lines}`;
}

const jsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['graphics'],
  properties: {
    graphics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['atSec', 'durationSec', 'type', 'text', 'subtext', 'items', 'animation'],
        properties: {
          atSec: { type: 'number' },
          durationSec: { type: 'number' },
          type: { type: 'string', enum: MOTION_TYPES },
          text: { type: 'string' },
          subtext: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
          animation: { type: 'string', enum: GRAPHIC_ANIMATIONS },
        },
      },
    },
  },
} as const;

export interface MotionPassResult {
  graphics: DirectorGraphic[];
  costUsd: number;
  model: string;
  /** Set when the pass could not run or failed; the edit continues without it. */
  error?: string;
}

export function isMotionPassConfigured(): boolean {
  return Boolean(env.llm.wavespeedKey && env.llm.motionModel);
}

export async function designMotionGraphics(
  transcript: Transcript,
  plan: DirectorPlan,
  durationSec: number,
): Promise<MotionPassResult> {
  const model = env.llm.motionModel;
  if (!isMotionPassConfigured()) {
    return { graphics: [], costUsd: 0, model, error: 'no motion model configured' };
  }

  try {
    const response = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.llm.wavespeedKey!}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: briefFor(transcript, plan, durationSec) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'motion_graphics', strict: true, schema: jsonSchema },
        },
        max_tokens: 2000,
        // Same reasoning as the main director: somebody re-running the same
        // footage should get the same edit back.
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(body.error?.message ?? `${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = body.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) throw new Error('empty response');

    const raw = JSON.parse(text) as { graphics?: unknown[] };
    const graphics = (raw.graphics ?? [])
      .map((g) => DirectorGraphicSchema.safeParse(g))
      .filter((r): r is { success: true; data: DirectorGraphic } => r.success)
      .map((r) => r.data)
      .filter((g) => g.atSec >= 0 && g.atSec < durationSec);

    const pricing = wavespeedPriceFor(model);
    const costUsd =
      ((body.usage?.prompt_tokens ?? 0) / 1_000_000) * pricing.inputPerMTok +
      ((body.usage?.completion_tokens ?? 0) / 1_000_000) * pricing.outputPerMTok;

    return { graphics, costUsd, model };
  } catch (error) {
    return {
      graphics: [],
      costUsd: 0,
      model,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Fold the pass's cues into the plan.
 *
 * The main director's graphics stay; a motion cue is dropped if it lands on
 * one of them, because two graphics on screen at once is the thing the whole
 * plan is written to avoid.
 */
export function withMotionGraphics(plan: DirectorPlan, motion: DirectorGraphic[]): DirectorPlan {
  if (!motion.length) return plan;
  const clear = (cue: DirectorGraphic) =>
    !plan.graphics.some(
      (g) => cue.atSec < g.atSec + g.durationSec + 0.3 && cue.atSec + cue.durationSec > g.atSec - 0.3,
    );
  const merged = [...plan.graphics, ...motion.filter(clear)].sort((a, b) => a.atSec - b.atSec);
  return { ...plan, graphics: merged };
}
