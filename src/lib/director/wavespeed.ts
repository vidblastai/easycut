import { env } from '@/lib/config/env';
import { buildDirectorPrompt, SYSTEM_PROMPT, type DirectorBrief } from './prompt';
import { directorJsonSchema } from './wire';
import { DirectorPlanSchema, type DirectorPlan } from './schema';
import type { DirectorCallResult } from './anthropic';

/**
 * The director, through WaveSpeed.
 *
 * ── Why route instead of calling Google directly ────────────────────────
 *
 * One key reaches ~113 models from every major vendor, AND the same account
 * serves the image and video generation used for generated B-roll. The
 * alternative was a Gemini key, plus a key for whoever generates video, plus
 * two billing relationships — for a product where both jobs are the same
 * sentence: "make something that illustrates what they just said".
 *
 * It costs nothing in quality for a CLOSED model. Google is the only place
 * Gemini's weights exist, so a router can only forward the request; there is
 * no cheaper copy to be fobbed off with. That is NOT true of open-weight
 * models (Llama, Qwen, DeepSeek), which anyone can host at any quantisation —
 * so the default here is deliberately a closed model.
 *
 * What a router can genuinely cost you is plumbing, and one piece of plumbing
 * matters enormously here: the director does not chat, it must return a plan
 * that validates against a schema. `google/gemini-3.6-flash` was measured
 * honouring `strict: true` through this endpoint before it was made the
 * default; `gemini-2.5-flash` is left available but is not the default.
 *
 * OpenAI-compatible, so this is one POST. No SDK for a single call.
 */

const API_BASE = 'https://llm.wavespeed.ai/v1';

/**
 * Per-MTok pricing, read off WaveSpeed's own catalogue at the time of writing.
 *
 * These move. `npm run doctor` asks the catalogue rather than trusting this
 * table; it exists only so the pre-flight budget guard has a number before any
 * request is made. Every entry is far below the Anthropic tier the spend
 * ceilings were set against, so a stale price here is conservative in the
 * right direction.
 */
const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  'google/gemini-3.6-flash': { inputPerMTok: 0.75, outputPerMTok: 3.75 },
  'google/gemini-3.5-flash': { inputPerMTok: 1.5, outputPerMTok: 9 },
  'google/gemini-3.5-flash-lite': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  'google/gemini-3-flash-preview': { inputPerMTok: 0.5, outputPerMTok: 3 },
  'google/gemini-2.5-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  'google/gemini-2.5-pro': { inputPerMTok: 1.25, outputPerMTok: 10 },
};

const FALLBACK_PRICING = { inputPerMTok: 1, outputPerMTok: 5 };

export function isWavespeedConfigured(): boolean {
  return Boolean(env.llm.wavespeedKey);
}

export function wavespeedPriceFor(model: string) {
  return MODEL_PRICING[model] ?? FALLBACK_PRICING;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string; type?: string };
}

export async function runWavespeedDirector(brief: DirectorBrief): Promise<DirectorCallResult> {
  const model = env.llm.wavespeedModel;

  const response = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.llm.wavespeedKey!}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildDirectorPrompt(brief) },
      ],
      /*
       * `strict: true` is the whole reason this is usable. Without schema
       * enforcement the model returns prose around the JSON often enough to
       * matter, and a director that fails to parse silently becomes the
       * rule-based one — the exact failure that looks like "the AI is not
       * working" while every log says success.
       */
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'director_plan', strict: true, schema: directorJsonSchema() },
      },
      max_tokens: env.llm.maxOutputTokens,
      // The director places cues against timestamps. Sampling variance buys
      // nothing and costs reproducibility, which matters when somebody re-runs
      // the same footage and expects the same edit.
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ChatResponse;
    const detail = body.error?.message ?? `${response.status} ${response.statusText}`;
    if (response.status === 429) {
      throw new Error(`WaveSpeed rate limit reached: ${detail}`);
    }
    if (response.status === 402) {
      throw new Error(`WaveSpeed account is out of credit: ${detail}`);
    }
    throw new Error(`WaveSpeed director failed: ${detail}`);
  }

  const body = (await response.json()) as ChatResponse;
  const choice = body.choices?.[0];

  // `length` means the plan was cut off mid-JSON. Saying so beats "invalid
  // JSON", which sends somebody looking for a bug in the parser.
  if (choice?.finish_reason === 'length') {
    throw new Error(
      `WaveSpeed director ran out of output tokens (LLM_MAX_OUTPUT_TOKENS=${env.llm.maxOutputTokens})`,
    );
  }

  const text = choice?.message?.content ?? '';
  if (!text.trim()) throw new Error('WaveSpeed returned no plan');

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('WaveSpeed returned a plan that was not valid JSON');
  }

  const usage = body.usage ?? {};
  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;

  const pricing = wavespeedPriceFor(model);
  const costUsd =
    (inputTokens / 1_000_000) * pricing.inputPerMTok +
    (outputTokens / 1_000_000) * pricing.outputPerMTok;

  return {
    // Same lenient parse as the other providers: whatever came back, the
    // pipeline downstream only ever sees a validated DirectorPlan.
    plan: DirectorPlanSchema.parse(raw) as DirectorPlan,
    costUsd,
    inputTokens,
    outputTokens,
    cachedTokens,
  };
}

/** Pre-flight estimate, so the budget guard can refuse before spending. */
export function estimateWavespeedCostUsd(transcriptChars: number, chunks: number): number {
  const pricing = wavespeedPriceFor(env.llm.wavespeedModel);
  const inputTokens = transcriptChars / 4 + chunks * 1600;
  const outputTokens = chunks * 3500;
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMTok +
    (outputTokens / 1_000_000) * pricing.outputPerMTok
  );
}

/**
 * What this key can actually reach.
 *
 * Model ids move faster than any table in a repo, so `npm run doctor` asks
 * rather than asserts. A wrong id in .env otherwise shows up as a director
 * that silently falls back to the rule-based editor.
 */
export async function listWavespeedModels(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/models`, {
    headers: env.llm.wavespeedKey ? { authorization: `Bearer ${env.llm.wavespeedKey}` } : undefined,
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const body = (await response.json()) as { data?: Array<{ id?: string }> };
  return (body.data ?? []).map((m) => m.id ?? '').filter(Boolean).sort();
}
