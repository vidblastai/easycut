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

/**
 * Unwrap a ```json fence, if the model added one.
 *
 * It is asked for JSON and given a strict schema, and it still occasionally
 * returns the object inside a markdown code fence. `JSON.parse` then throws on
 * the first backtick, the whole pass reports an error, and the video silently
 * gets no scenes — one run in five, for a formatting habit.
 */
function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/** Long enough for the eye to read it, short enough not to lose the speaker. */
const MIN_SCENE_SEC = 2.4;
const MAX_SCENE_SEC = 6.5;

export const PlannedSceneSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  kind: z.enum(SCENE_KINDS),
  backdrop: z.enum(SCENE_BACKDROPS).default('auto'),
  headline: z.string().default(''),
  items: z.array(z.string()).default([]),
  iconQueries: z.array(z.string()).default([]),
  /** Why this passage, in one line. Shown in the editor and useful to read. */
  reason: z.string().default(''),
});
export type PlannedScene = z.infer<typeof PlannedSceneSchema>;

const SYSTEM = `You pick the moments in a talking-head video that should become a full-screen animated scene, and you say what that scene contains.

A scene REPLACES the speaker. For as long as it is on, the viewer sees a drawn picture and hears a voice. You are looking for the passages where the words describe something the eye could hold better than the ear can, and where losing the speaker for a few seconds costs nothing.

**The scene is a PICTURE, not a slide of text.** An illustrator draws the thing being described afterwards, from your choice; you are writing the caption that goes under the drawing, not the drawing itself. So prefer passages with something in them you could DRAW — an object, a place, a process, a contrast you can see. A sentence whose only content is an abstract claim can still be a scene, but it is the weakest kind, and a video whose scenes are all of them is a video of title cards.

**Work in two steps, in this order.** First read the whole transcript and list, in "considered", every passage that has one of the six shapes below — one short line each, naming the passage and the shape. Then choose the best ones, up to the budget, and write those into "scenes". Do the listing first and do it honestly: the way this task goes wrong is deciding "nothing here" before looking, and a transcript almost always has more shapes in it than the budget allows.

A passage qualifies only if it has a SHAPE. There are seven, and they are your seven scene kinds:

- kinetic-text — one short declarative line that IS the point. A claim, a rule, a punchline. The words are the picture.
- journey — an ordered sequence. Steps, stages, a path from one state to another, something happening over time.
- compare — exactly two things set against each other. Before and after, us and them, the wrong way and the right way.
- orbit — one idea with its parts. "Everything you need in one place", a thing made of several named components.
- stack — things building on each other, where the order is cumulative rather than chronological. Layers, foundations, "on top of that".
- big-number — a single figure that carries the whole sentence.
- transform — one PHYSICAL thing turning into another physical thing. A seedling becomes a tree, raw footage becomes a finished cut, a green banana ripens. Drawn as two photographs with an arrow between them, so both sides must be things a camera could point at. Never use it for an abstraction becoming another abstraction ("doubt becomes confidence") — there is nothing to photograph and the scene ends up illustrating a mood.

A passage with none of these shapes does not get a scene — a scene over someone simply talking is a wasted one.

**But "considered" and "scenes" must agree.** If you listed anything in "considered", then "scenes" must contain at least one of them: having found a shape and then drawn nothing is the single most common way to get this wrong, and it is always wrong. Both lists are empty only when the footage genuinely has no shape in it at all — pure narrative, pure anecdote, someone thinking out loud.

The difference between compare and transform is direction. Compare sets two things against each other and leaves them side by side; transform says the first one BECAME the second. If the sentence has a "becomes", "turns into" or "from X to Y" in it, and both sides are things rather than ideas, it is a transform.

Note how low the bar for kinetic-text is, deliberately: one short line that IS the point — a claim, a rule, the sentence the video exists to deliver — qualifies on its own. A list of named parts said in one breath ("the captions, the B-roll, the effects") is an orbit. A figure said with any weight at all is a big-number. These are common; treat them as the normal case, not as exceptions.

Rules that matter as much as the choice:

1. **Use the speaker's own words, and few of them.** headline and items are lifted from what is actually said, trimmed — not paraphrased, not improved, not summarised into marketing language. If the animation says something the voice does not, the video sounds like two people.
1b. **Keep the words short.** headline is at most SIX words, and four is better; items are one or two words each. These are labels on a picture, and anything longer stops being a label and starts being a paragraph on screen. Where the drawing will say it on its own, leave headline empty — a scene with no words at all is a good scene, not an incomplete one, and at least one scene in a video should be that.
2. **Fit the window to the sentence.** startSec and endSec must cover the passage that describes the scene and stop when it does. Never run past the end of the thought.
3. **Never cover a hook.** The opening seconds are the speaker earning attention. Leave them alone.
4. **Never two scenes back to back.** Leave at least four seconds of speaker between them, or the video stops being a talking-head video.
5. **items must match the kind.** journey and stack: the steps in order. compare: exactly two. orbit: the parts, three to five. big-number: one item, the label under the figure. kinetic-text: empty. transform: exactly two, the thing BEFORE and the thing AFTER, in that order — and each one is a plain noun phrase that would work typed into a stock photo search ("banana seedling", "banana tree"), not a clause.
6. **iconQueries** are one concrete noun each, parallel to items — "rocket", "shield", "clock", "credit card". Leave an entry empty if nothing concrete fits; a wrong icon is worse than none. These are the fallback for when the illustrator cannot draw the scene, so name the most literal object in the sentence.
7. **backdrop** is the SURFACE the scene is printed on, not its colour. Light or dark comes from the look, which is already chosen — \`paper\` is cream in a light look and charcoal in a dark one — so pick the material and nothing else:
   - auto (default) — the look's own ground. Right whenever nothing below is clearly better.
   - paper — stock with a visible tooth. Something hand-made, considered, explained slowly.
   - paper-grid — the same stock ruled into squares. A worked example: a plan, a measurement, a recipe, maths.
   - grid — a clean technical grid with no paper under it. Engineering, product, data.
   - dots — light and friendly.
   - rays — energy, a reveal, a launch.
   - gradient — calm.
   - solid — when the content is busy and needs the room.`;

/** The director's own brief, exported so a test can hold it to the schema. */
export const SCENE_SYSTEM_PROMPT = SYSTEM;

function briefFor(transcript: Transcript, plan: DirectorPlan, sourceSec: number, budget: number): string {
  // Sentences, not words: the model is choosing a PASSAGE, and giving it a
  // word list invites timestamps that start mid-clause.
  const lines = transcript.sentences?.length
    ? transcript.sentences.map((s) => `[${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)}] ${s.text}`).join('\n')
    : transcript.words.map((w) => `${w.startSec.toFixed(1)} ${w.text}`).join(' ');

  const covered = plan.broll.map((b) => `${b.atSec.toFixed(1)}s`).join(', ') || 'none';

  return `Transcript covers ${sourceSec.toFixed(1)}s of footage. At most ${budget} scene${budget === 1 ? '' : 's'}.
Moments already covered by B-roll (do not put a scene on these): ${covered}

If you listed more candidates than the budget allows, fill the budget — returning one scene when you are allowed two, having found three, is leaving the video worse than it could be. Spread them out; they cannot sit next to each other.

Return {"considered": [...], "scenes": [...]} as raw JSON, with no code fence and nothing else. Fill in "reason" with one short line naming the shape you saw in that passage — it is shown to the person editing.

Transcript:
${lines}`;
}

const jsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['considered', 'scenes'],
  properties: {
    /*
     * Written BEFORE `scenes`, and that ordering is the point.
     *
     * Asked only for a list of scenes, the model would sometimes answer `[]`
     * on a transcript that plainly contained one — three identical runs on the
     * same eighteen seconds returned 0, 1, 1. It was deciding "nothing here"
     * without going through the footage. Making it enumerate what it can see
     * first, in a field the schema forces it to fill in first, turns a
     * judgement call into a two-step task: find the shapes, then pick.
     */
    considered: { type: 'array', items: { type: 'string' } },
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
  // Floor of two, because one is the same as none for a short video: an
  // eighteen-second clip with three candidates in it was being allowed a
  // single scene, which made the layer feel like it had not run. The spacing
  // rules below (four seconds of speaker between scenes, 2.4s to 6.5s each)
  // already stop a video turning into an animation reel, so the budget can
  // afford to be generous and let the guards do the limiting.
  return Math.max(2, Math.min(6, Math.round(durationSec / 25)));
}

export interface ScenePassResult {
  scenes: PlannedScene[];
  /** What it spotted before choosing. Kept for the log: scenes empty while
   *  this is not is the failure mode worth seeing rather than guessing at. */
  considered: string[];
  costUsd: number;
  model: string;
  error?: string;
}

export function isScenePassConfigured(): boolean {
  return Boolean(env.llm.wavespeedKey && env.llm.motionModel);
}

/**
 * @param sourceDurationSec  Length of the FOOTAGE, because every timestamp the
 *   model sees and returns is a source timestamp.
 * @param finishedDurationSec  Length of the finished video, used only to decide
 *   how many scenes it can carry.
 *
 * ── Why those are two arguments and not one ─────────────────────────────
 *
 * They were one, and it was a silent bug that hid the whole feature. The
 * pipeline naturally has the POST-CUT length to hand — it is what the director
 * is briefed with — but the transcript is the raw footage, so a scene chosen at
 * 40s in a 60s recording that cuts down to 38s was clamped to "ends at 38s",
 * came out shorter than the minimum, and was dropped. Every scene in the back
 * half of a video disappeared, which on a product whose entire job is removing
 * silence meant most of them. Nothing errored; there were simply never any
 * scenes.
 */
export async function designScenes(
  transcript: Transcript,
  plan: DirectorPlan,
  sourceDurationSec: number,
  finishedDurationSec: number = sourceDurationSec,
): Promise<ScenePassResult> {
  /*
   * Ask twice if the first answer is nothing.
   *
   * On identical input this returns a scene most of the time and an empty list
   * the rest — not because the transcript is borderline, but because "is there
   * anything here" is a judgement the model sometimes short-circuits. Measured
   * on eighteen seconds of footage with three clear candidates in it, single
   * runs came back 0, 1, 1. A second ask costs about a cent and turns a coin
   * flip into a near-certainty, and an empty answer twice over is worth
   * believing.
   */
  const first = await askForScenes(transcript, plan, sourceDurationSec, finishedDurationSec);
  if (first.scenes.length) return first;

  // Including after an error: a malformed answer is the most worth retrying,
  // and returning the first failure meant a stray code fence cost the video
  // its scenes outright.
  const second = await askForScenes(transcript, plan, sourceDurationSec, finishedDurationSec);
  return {
    ...second,
    // Both attempts were paid for either way.
    costUsd: first.costUsd + second.costUsd,
    considered: second.considered.length ? second.considered : first.considered,
    error: second.scenes.length ? undefined : (second.error ?? first.error),
  };
}

async function askForScenes(
  transcript: Transcript,
  plan: DirectorPlan,
  sourceDurationSec: number,
  finishedDurationSec: number,
): Promise<ScenePassResult> {
  const model = env.llm.motionModel;
  if (!isScenePassConfigured()) {
    return { scenes: [], considered: [], costUsd: 0, model, error: 'no scene model configured' };
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
          { role: 'user', content: briefFor(transcript, plan, sourceDurationSec, sceneBudget(finishedDurationSec)) },
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
    const text = stripFence(body.choices?.[0]?.message?.content ?? '');
    if (!text.trim()) throw new Error('empty response');

    const raw = JSON.parse(text) as { scenes?: unknown[]; considered?: unknown[] };
    const scenes = sanitiseScenes(
      (raw.scenes ?? [])
        .map((s) => PlannedSceneSchema.safeParse(s))
        .filter((r): r is { success: true; data: PlannedScene } => r.success)
        .map((r) => r.data),
      sourceDurationSec,
    );

    const pricing = wavespeedPriceFor(model);
    const costUsd =
      ((body.usage?.prompt_tokens ?? 0) / 1_000_000) * pricing.inputPerMTok +
      ((body.usage?.completion_tokens ?? 0) / 1_000_000) * pricing.outputPerMTok;

    const considered = (raw.considered ?? []).filter((c): c is string => typeof c === 'string');
    return { scenes, considered, costUsd, model };
  } catch (error) {
    return {
      scenes: [],
      considered: [],
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
/** Keep the first n words, dropping any punctuation left dangling at the cut. */
export function trimToWords(n: number): (text: string) => string {
  return (text) => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length <= n) return text.trim();
    return words.slice(0, n).join(' ').replace(/[,;:\-–—]$/, '');
  };
}

export function sanitiseScenes(scenes: PlannedScene[], sourceDurationSec: number): PlannedScene[] {
  const HOOK_SEC = 2.5;
  const GAP_SEC = 4;

  const ordered = [...scenes].sort((a, b) => a.startSec - b.startSec);
  const kept: PlannedScene[] = [];

  for (const scene of ordered) {
    const start = Math.max(HOOK_SEC, scene.startSec);
    // Source seconds on both sides. Passing a post-cut length here silently
    // deletes every scene in the back half of the video.
    const end = Math.min(sourceDurationSec, scene.endSec);
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
      // Two panels and an arrow. One side is not a transformation, and three
      // is a journey — which is a different scene that already exists.
      : clipped.kind === 'transform' ? items.length === 2
      : clipped.kind === 'big-number' ? /\d/.test(clipped.headline)
      : clipped.kind === 'kinetic-text' ? clipped.headline.trim().length > 0
      : items.length >= 2;

    const trimmed = usable
      ? { ...clipped, items: items.map(trimToWords(3)) }
      : { ...clipped, kind: 'kinetic-text' as const, items: [], iconQueries: [] };

    // The word budget, enforced rather than asked for.
    //
    // The prompt says six words; a model that has just read a transcript
    // returns the whole sentence often enough that the difference shows up as
    // an insert with a paragraph set across it. Truncating here is blunt, but
    // a label cut short still reads as a label, and a paragraph never does.
    kept.push({ ...trimmed, headline: trimToWords(6)(trimmed.headline) });
  }

  return kept;
}
