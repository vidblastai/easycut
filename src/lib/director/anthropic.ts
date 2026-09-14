import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
// The SDK's structured-output helper is built against Zod 4, while the rest of
// the codebase is on the classic (v3) API. Zod ships both from one package, so
// the wire schema below imports the v4 surface explicitly. It is completely
// self-contained — it never touches the v3 schemas — so the two coexist safely.
import { z } from 'zod/v4';
import { env } from '@/lib/config/env';
import { buildDirectorPrompt, SYSTEM_PROMPT, type DirectorBrief } from './prompt';
import { DirectorPlanSchema, type DirectorPlan } from './schema';

/**
 * The wire schema is deliberately separate from `DirectorPlanSchema`.
 *
 * Structured outputs need a schema where every field is required and nothing is
 * optional-with-a-default — the model has to be told exactly what to emit. Our
 * internal schema, by contrast, is full of `.default()` so that a hand-written
 * or repaired plan stays valid. So the model fills in the strict shape, and we
 * run it through the lenient one to get defaults and coercion for free.
 */
const WireHook = z.object({
  startSec: z.number(),
  endSec: z.number(),
  note: z.string(),
});

const DirectorWireSchema = z.object({
  hook: WireHook.nullable(),
  removals: z.array(
    z.object({
      startSec: z.number(),
      endSec: z.number(),
      reason: z.enum(['off-topic', 'rambling', 'repeat', 'weak-ending', 'dead-weight']),
      confidence: z.number(),
      note: z.string(),
    }),
  ),
  emphasis: z.array(z.object({ startSec: z.number(), endSec: z.number() })),
  broll: z.array(
    z.object({
      atSec: z.number(),
      durationSec: z.number(),
      query: z.string(),
      intent: z.string(),
      kind: z.enum(['stock-video', 'stock-photo', 'generated-image']),
    }),
  ),
  graphics: z.array(
    z.object({
      atSec: z.number(),
      durationSec: z.number(),
      type: z.enum(['icon', 'stat', 'list', 'title-card', 'quote', 'arrow', 'image']),
      text: z.string(),
      subtext: z.string(),
      items: z.array(z.string()),
      iconQuery: z.string(),
      imagePrompt: z.string(),
    }),
  ),
  sfx: z.array(
    z.object({
      atSec: z.number(),
      sound: z.enum(['whoosh', 'pop', 'riser', 'impact', 'click', 'swipe', 'ding', 'sub-drop']),
    }),
  ),
  punchIns: z.array(
    z.object({
      atSec: z.number(),
      durationSec: z.number(),
      intensity: z.enum(['subtle', 'medium', 'strong']),
    }),
  ),
  chapters: z.array(z.object({ atSec: z.number(), title: z.string() })),
  titleCard: z.object({ text: z.string(), subtext: z.string() }).nullable(),
  lowerThird: z.object({ text: z.string(), subtext: z.string() }).nullable(),
  musicMood: z.string(),
  deliverable: z.object({
    title: z.string(),
    socialCaption: z.string(),
    hashtags: z.array(z.string()),
  }),
  reasoning: z.string(),
});

/** Published per-MTok pricing, used for the pre-flight budget estimate. */
const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-8': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10 },
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
};

export interface DirectorCallResult {
  plan: DirectorPlan;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export function isAnthropicConfigured(): boolean {
  return Boolean(env.llm.anthropicKey);
}

export function priceFor(model: string) {
  return MODEL_PRICING[model] ?? MODEL_PRICING['claude-opus-5'];
}

export async function runAnthropicDirector(brief: DirectorBrief): Promise<DirectorCallResult> {
  const client = new Anthropic({ apiKey: env.llm.anthropicKey });
  const model = env.llm.model;

  const response = await client.messages.parse({
    model,
    max_tokens: env.llm.maxOutputTokens,
    // The system prompt is byte-identical across every chunk of a long-form
    // video and across every job, so caching it is close to free money: the
    // brief itself is the only part that changes.
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    // This is a latency-sensitive path — the user is watching a progress bar.
    // Medium effort is the sweet spot here; raise LLM_EFFORT for taste-critical work.
    thinking: { type: 'adaptive' },
    output_config: {
      effort: (process.env.LLM_EFFORT as 'low' | 'medium' | 'high' | 'xhigh' | 'max') ?? 'medium',
      format: zodOutputFormat(DirectorWireSchema),
    },
    messages: [{ role: 'user', content: buildDirectorPrompt(brief) }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(
      `Director declined: ${response.stop_details?.category ?? 'unknown'} — ${response.stop_details?.explanation ?? ''}`,
    );
  }
  if (!response.parsed_output) {
    throw new Error('Director returned no parseable plan');
  }

  const pricing = priceFor(model);
  const usage = response.usage;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cachedTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;

  const costUsd =
    (inputTokens / 1_000_000) * pricing.inputPerMTok +
    (cacheWriteTokens / 1_000_000) * pricing.inputPerMTok * 1.25 +
    (cachedTokens / 1_000_000) * pricing.inputPerMTok * 0.1 +
    (outputTokens / 1_000_000) * pricing.outputPerMTok;

  return {
    // Lenient parse fills defaults and drops anything the model over-produced.
    plan: DirectorPlanSchema.parse(response.parsed_output),
    costUsd,
    inputTokens,
    outputTokens,
    cachedTokens,
  };
}

/** Pre-flight estimate so the budget guard can refuse before spending anything. */
export function estimateDirectorCostUsd(transcriptChars: number, chunks: number): number {
  const pricing = priceFor(env.llm.model);
  // ~4 chars per token, plus a ~1200-token system prompt per chunk (cached after
  // the first), plus the brief.
  const inputTokens = transcriptChars / 4 + chunks * 1600;
  const outputTokens = chunks * 3500;
  return (inputTokens / 1_000_000) * pricing.inputPerMTok + (outputTokens / 1_000_000) * pricing.outputPerMTok;
}
