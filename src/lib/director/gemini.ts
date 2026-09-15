import { env } from '@/lib/config/env';
import { buildDirectorPrompt, SYSTEM_PROMPT, type DirectorBrief } from './prompt';
import { DirectorPlanSchema, type DirectorPlan } from './schema';
import { directorJsonSchema } from './wire';
import type { DirectorCallResult } from './anthropic';

/**
 * The director, on Gemini.
 *
 * Here because "why pay for a director at all" is a fair question with a real
 * answer on both sides, and the honest way to settle it is to let someone run
 * the same footage through both rather than take a recommendation. The plan
 * shape, the prompt and the validation are identical — only the call differs —
 * so the comparison is about the model and nothing else.
 *
 * Raw fetch rather than @google/genai: this is one POST with a JSON body, the
 * SDK would be a dependency for a single call, and the free tier's whole appeal
 * is not adding weight to the project.
 *
 * What the free tier actually costs you: on Gemini's free tier Google may use
 * prompts and responses to improve its products. Your transcript is your
 * unpublished script, so that is a real decision, not a footnote — it is why
 * this is opt-in and why the doctor prints it.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Published per-MTok pricing for the paid tier. Free-tier calls cost nothing in
 * dollars, which is what `costUsd: 0` below means — not that the request was
 * free of consequence.
 *
 * These move. `npm run doctor` prints the model the key can actually reach; if
 * a price here is stale the budget guard is conservative in the right
 * direction, because every one of these is far below the Anthropic tier the
 * ceilings were set against.
 */
const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  'gemini-3-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  'gemini-3-pro': { inputPerMTok: 2, outputPerMTok: 12 },
  'gemini-2.5-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  'gemini-2.5-flash-lite': { inputPerMTok: 0.1, outputPerMTok: 0.4 },
};

export function isGeminiConfigured(): boolean {
  return Boolean(env.llm.geminiKey);
}

export function geminiPriceFor(model: string) {
  return MODEL_PRICING[model] ?? MODEL_PRICING['gemini-3-flash'];
}

/** Whether this key is on the free tier — decided by Google, not by us. */
export function isGeminiFreeTier(): boolean {
  return env.llm.geminiPaid !== true;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  error?: { message?: string; status?: string };
}

export async function runGeminiDirector(brief: DirectorBrief): Promise<DirectorCallResult> {
  const model = env.llm.geminiModel;
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Header rather than ?key= — a query string ends up in proxy logs and
      // shell history, and this one is a credential.
      'x-goog-api-key': env.llm.geminiKey!,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildDirectorPrompt(brief) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: directorJsonSchema(),
        maxOutputTokens: env.llm.maxOutputTokens,
        // The director places cues against timestamps. Sampling variance buys
        // nothing here and costs reproducibility, which matters when a user
        // re-runs the same footage and expects the same edit.
        temperature: 0.4,
      },
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as GeminiResponse;
    const detail = body.error?.message ?? `${response.status} ${response.statusText}`;
    // 429 on the free tier is the common one and deserves to say so, because
    // "the director failed" sends people looking for a bug.
    if (response.status === 429) {
      throw new Error(`Gemini rate limit reached (free tier is a few requests a minute): ${detail}`);
    }
    throw new Error(`Gemini director failed: ${detail}`);
  }

  const body = (await response.json()) as GeminiResponse;
  const candidate = body.candidates?.[0];

  if (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) {
    throw new Error(`Gemini declined: ${candidate.finishReason}`);
  }

  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text.trim()) throw new Error('Gemini returned no plan');

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Gemini returned a plan that was not valid JSON');
  }

  const usage = body.usageMetadata ?? {};
  const inputTokens = usage.promptTokenCount ?? 0;
  const outputTokens = usage.candidatesTokenCount ?? 0;
  const cachedTokens = usage.cachedContentTokenCount ?? 0;

  const pricing = geminiPriceFor(model);
  const costUsd = isGeminiFreeTier()
    ? 0
    : (inputTokens / 1_000_000) * pricing.inputPerMTok +
      (outputTokens / 1_000_000) * pricing.outputPerMTok;

  return {
    // Same lenient parse as the Anthropic path: whatever the model produced,
    // the pipeline downstream only ever sees a validated DirectorPlan.
    plan: DirectorPlanSchema.parse(raw) as DirectorPlan,
    costUsd,
    inputTokens,
    outputTokens,
    cachedTokens,
  };
}

/** Pre-flight estimate so the budget guard can refuse before spending anything. */
export function estimateGeminiCostUsd(transcriptChars: number, chunks: number): number {
  if (isGeminiFreeTier()) return 0;
  const pricing = geminiPriceFor(env.llm.geminiModel);
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
 * rather than asserts. A wrong id in .env otherwise shows up as a director that
 * silently falls back to the rule-based editor.
 */
export async function listGeminiModels(): Promise<string[]> {
  if (!isGeminiConfigured()) return [];
  const response = await fetch(`${API_BASE}/models`, {
    headers: { 'x-goog-api-key': env.llm.geminiKey! },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const body = (await response.json()) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };
  return (body.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter(Boolean);
}
