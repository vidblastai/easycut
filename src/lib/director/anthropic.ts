import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { env } from '@/lib/config/env';
import { buildDirectorPrompt, SYSTEM_PROMPT, type DirectorBrief } from './prompt';
import { DirectorWireSchema } from './wire';
import { DirectorPlanSchema, type DirectorPlan } from './schema';

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
