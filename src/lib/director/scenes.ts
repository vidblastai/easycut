import { env } from '@/lib/config/env';
import { SCENE_BACKDROPS, SCENE_KINDS } from '@/lib/edl/types';
import type { Transcript } from '@/lib/transcribe/types';
import { z } from 'zod';
import type { DirectorPlan } from './schema';
import { wavespeedPriceFor } from './wavespeed';

/**
 * Choosing which seconds of a video become a drawn scene, and what is in them.
 *
 * ── Why this is the hardest call in the pipeline ────────────────────────
 *
 * A scene takes the speaker off the screen. Put one in the wrong place and the
 * viewer loses the person mid-thought for four seconds and comes back not
 * knowing what happened — which is worse than no animation at all. Put one on
 * a sentence that has a shape, and it is the best thing in the video.
 *
 * So the model is not asked "where would an animation look nice". It is asked
 * a question with a right answer: which sentences here have a SHAPE — a
 * sequence, a contrast, a whole with parts, a figure — and what is that shape?
 * The six scene kinds are those shapes. If a passage has none of them it gets
 * nothing, and the prompt says so more than once, because the failure mode of
 * every model on a task like this is to fill the quota.
 *
 * The scene's words are the speaker's own, not a paraphrase. A faceless video
 * where the animation says something slightly different from the voice reads
 * as two people talking over each other.
 */

const API_BASE = 'https://llm.wavespeed.ai/v1';

/** Long enough for the eye to read it, short enough not to lose the speaker. */
const MIN_SCENE_SEC = 2.4;
const MAX_SCENE_SEC = 6.5;

export const PlannedSceneSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  kind: z.enum(SCENE_KINDS),
  backdrop: z.enum(SCENE_BACKDROPS).default('gradient'),
  headline: z.string().default(''),
  items: z.array(z.string()).default([]),
  iconQueries: z.array(z.string()).default([]),
  /** Why this passage, in one line. Shown in the editor and useful to read. */
  reason: z.string().default(''),
});
export type PlannedScene = z.infer<typeof PlannedSceneSchema>;

const SYSTEM = `You pick the moments in a talking-head video that should become a full-screen animated scene, and you say what that scene contains.

A scene REPLACES the speaker. For as long as it is on, the viewer sees a drawn picture and hears a voice. That is a real cost: if you cover a moment that needed a face, the video gets worse. You are looking for the opposite — the passages where the words describe something the eye could hold better than the ear can, and where losing the speaker for a few seconds costs nothing.

A passage qualifies only if it has a SHAPE. There are six, and they are your six scene kinds:

- kinetic-text — one short declarative line that IS the point. A claim, a rule, a punchline. The words are the picture.
- journey — an ordered sequence. Steps, stages, a path from one state to another, something happening over time.
- compare — exactly two things set against each other. Before and after, us and them, the wrong way and the right way.
- orbit — one idea with its parts. "Everything you need in one place", a thing made of several named components.
- stack — things building on each other, where the order is cumulative rather than chronological. Layers, foundations, "on top of that".
- big-number — a single figure that carries the whole sentence.

If a passage does not have one of these shapes, it does not get a scene. Most of a video does not. Returning fewer scenes than you are allowed is a correct answer and is usually the right one; returning a scene for a passage that is just the speaker talking is the failure this task is most prone to.

Rules that matter as much as the choice:

1. **Use the speaker's own words.** headline and items come from what is actually said, trimmed — not paraphrased, not improved, not summarised into marketing language. If the animation says something the voice does not, the video sounds like two people.
2. **Fit the window to the sentence.** startSec and endSec must cover the passage that describes the scene and stop when it does. Never run past the end of the thought.
3. **Never cover a hook.** The opening seconds are the speaker earning attention. Leave them alone.
4. **Never two scenes back to back.** Leave at least four seconds of speaker between them, or the video stops being a talking-head video.
5. **items must match the kind.** journey and stack: the steps in order. compare: exactly two. orbit: the parts, three to five. big-number: one item, the label under the figure. kinetic-text: empty.
6. **iconQueries** are one concrete noun each, parallel to items — "rocket", "shield", "clock", "credit card". Leave an entry empty if nothing concrete fits; a wrong icon is worse than none.
7. **backdrop** sets the mood: gradient (default, calm), grid (technical, product), dots (light, friendly), rays (energy, a reveal), solid (when the content is busy and needs room).`;

function briefFor(transcript: Transcript, plan: DirectorPlan, durationSec: number, budget: number): string {
  // Sentences, not words: the model is choosing a PASSAGE, and giving it a
  // word list invites timestamps that start mid-clause.
  const lines = transcript.sentences?.length
    ? transcript.sentences.map((s) => `[${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)}] ${s.text}`).join('\n')
    : transcript.words.map((w) => `${w.startSec.toFixed(1)} ${w.text}`).join(' ');

  const covered = plan.broll.map((b) => `${b.atSec.toFixed(1)}s`).join(', ') || 'none';

  return `Video length: ${durationSec.toFixed(1)}s. At most ${budget} scene${budget === 1 ? '' : 's'} — fewer is usually right.
Moments already covered by B-roll (do not put a scene on these): ${covered}

Return {"scenes": [...]} and nothing else. [] is a valid and common answer. Fill in "reason" with one short line on what shape you saw in that passage — it is shown to the person editing.

Transcript:
${lines}`;
}

const jsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scenes'],
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['startSec', 'endSec', 'kind', 'backdrop', 'headline', 'items', 'iconQueries', 'reason'],
        properties: {
          startSec: { type: 'number' },
          endSec: { type: 'number' },
          kind: { type: 'string', enum: SCENE_KINDS },
          backdrop: { type: 'string', enum: SCENE_BACKDROPS },
          headline: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
          iconQueries: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

/**
 * How many scenes a video of this length may have.
 *
 * A ceiling, not a target — the prompt says so twice, and the pass regularly
 * returns fewer. Roughly one per half minute: dense enough that a minute-long
 * explainer with two real shapes in it can have both, sparse enough that the
 * result is still a talking-head video with animation in it rather than an
 * animation with a voice over it.
 */
export function sceneBudget(durationSec: number): number {
  return Math.max(1, Math.min(6, Math.round(durationSec / 30)));
}

export interface ScenePassResult {
  scenes: PlannedScene[];
  costUsd: number;
  model: string;
  error?: string;
}

export function isScenePassConfigured(): boolean {
  return Boolean(env.llm.wavespeedKey && env.llm.motionModel);
}

export async function designScenes(
  transcript: Transcript,
  plan: DirectorPlan,
  durationSec: number,
): Promise<ScenePassResult> {
  const model = env.llm.motionModel;
  if (!isScenePassConfigured()) {
    return { scenes: [], costUsd: 0, model, error: 'no scene model configured' };
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
          { role: 'user', content: briefFor(transcript, plan, durationSec, sceneBudget(durationSec)) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'scenes', strict: true, schema: jsonSchema },
        },
        max_tokens: 3000,
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

    const raw = JSON.parse(text) as { scenes?: unknown[] };
    const scenes = sanitiseScenes(
      (raw.scenes ?? [])
        .map((s) => PlannedSceneSchema.safeParse(s))
        .filter((r): r is { success: true; data: PlannedScene } => r.success)
        .map((r) => r.data),
      durationSec,
    );

    const pricing = wavespeedPriceFor(model);
    const costUsd =
      ((body.usage?.prompt_tokens ?? 0) / 1_000_000) * pricing.inputPerMTok +
      ((body.usage?.completion_tokens ?? 0) / 1_000_000) * pricing.outputPerMTok;

    return { scenes, costUsd, model };
  } catch (error) {
    return {
      scenes: [],
      costUsd: 0,
      model,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The rules the prompt asks for, enforced rather than hoped for.
 *
 * Everything here is a rule a model breaks occasionally and a viewer notices
 * every time: a scene that outlives its sentence, two of them back to back, or
 * one over the opening seconds where the speaker is still earning attention.
 * Checking is cheap; a video that drops the presenter for eleven seconds is not.
 */
export function sanitiseScenes(scenes: PlannedScene[], durationSec: number): PlannedScene[] {
  const HOOK_SEC = 2.5;
  const GAP_SEC = 4;

  const ordered = [...scenes].sort((a, b) => a.startSec - b.startSec);
  const kept: PlannedScene[] = [];

  for (const scene of ordered) {
    const start = Math.max(HOOK_SEC, scene.startSec);
    const end = Math.min(durationSec, scene.endSec);
    const length = end - start;
    if (length < MIN_SCENE_SEC) continue;

    const clipped = { ...scene, startSec: start, endSec: Math.min(end, start + MAX_SCENE_SEC) };

    const previous = kept[kept.length - 1];
    if (previous && clipped.startSec - previous.endSec < GAP_SEC) continue;

    // A kind whose items do not fit it cannot be drawn as that kind. Rather
    // than render a compare with one side, fall back to the shape that always
    // works: the words themselves.
    const items = clipped.items.filter((i) => i.trim().length);
    const usable =
      clipped.kind === 'compare' ? items.length === 2
      : clipped.kind === 'big-number' ? /\d/.test(clipped.headline)
      : clipped.kind === 'kinetic-text' ? clipped.headline.trim().length > 0
      : items.length >= 2;

    kept.push(
      usable
        ? { ...clipped, items }
        : { ...clipped, kind: 'kinetic-text', items: [], iconQueries: [] },
    );
  }

  return kept;
}
