import { env } from '@/lib/config/env';
import { wavespeedPriceFor } from '@/lib/director/wavespeed';

/**
 * Every language-model call in the pipeline, routed to Kie.
 *
 * ── Why an adapter and not seven rewrites ───────────────────────────────
 *
 * The director, the retake reader, the scene pass, the panel, the panel art,
 * the motion pass and the SVG illustrator all grew up speaking WaveSpeed's
 * OpenAI-shaped `chat/completions`, each with its own prompt, schema, parser
 * and fallbacks. Moving them to Kie one by one would mean seven translations
 * of the same request and seven places for them to drift.
 *
 * So each of them calls `llmFetch` where it used to call `fetch`, and this
 * module answers in the shape they already read. With a Kie key the request
 * goes to Claude on Kie's Anthropic Messages endpoint — the system message
 * moved to the top level, a JSON schema turned into an instruction, the reply
 * cut back down to its JSON — and comes back as an OpenAI-shaped `Response`.
 * Without one, it is a plain `fetch` to WaveSpeed, exactly as before.
 *
 * ── The model ───────────────────────────────────────────────────────────
 *
 * One: `KIE_CHAT_MODEL`, Opus 5.5 by default, for every pass. The WaveSpeed
 * setup ran the bookkeeping passes on a flash model to save money; on Kie
 * the person asked for Opus everywhere, and a cheaper one is a variable away.
 */

const KIE_MESSAGES_URL = 'https://api.kie.ai/claude/v1/messages';

/** Who answers: Kie when it has a key (unless told otherwise), WaveSpeed otherwise. */
export function chatProvider(): 'kie' | 'wavespeed' | null {
  const kie = Boolean(env.kie.apiKey && env.kie.chatModel);
  const wavespeed = Boolean(env.llm.wavespeedKey);
  const wanted = env.llm.chatProvider;
  if (wanted === 'kie') return kie ? 'kie' : null;
  if (wanted === 'wavespeed') return wavespeed ? 'wavespeed' : null;
  return kie ? 'kie' : wavespeed ? 'wavespeed' : null;
}

export function isChatConfigured(): boolean {
  return chatProvider() !== null;
}

/**
 * The model a pass will actually run on, for its cost line and its log.
 *
 * A pass written for WaveSpeed names a WaveSpeed model; on Kie that name is
 * never sent anywhere, and reporting it would say the video was made by an
 * account it never touched.
 */
export function routedModel(model: string): string {
  return chatProvider() === 'kie' ? env.kie.chatModel : model;
}

/** What a completion cost: Kie says so in credits; otherwise tokens at the model's rate. */
export function completionCostUsd(
  body: { cost_usd?: number; usage?: { prompt_tokens?: number; completion_tokens?: number } },
  model: string,
): number {
  if (typeof body.cost_usd === 'number') return body.cost_usd;
  const pricing = wavespeedPriceFor(model);
  return (
    ((body.usage?.prompt_tokens ?? 0) / 1_000_000) * pricing.inputPerMTok +
    ((body.usage?.completion_tokens ?? 0) / 1_000_000) * pricing.outputPerMTok
  );
}

/** A Kie refusal that means "not now" rather than "no". */
export function isBusy(status: number, message: string): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504 ||
    /try again later|resources are tight|rate limit|overloaded|too many requests/i.test(message);
}

/** Waits between attempts when Kie is busy. */
export const KIE_RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

type OpenAiContent = string | Array<{ type: string; text?: string; image_url?: { url: string } }>;

interface OpenAiRequest {
  model?: string;
  messages: Array<{ role: string; content: OpenAiContent }>;
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: string; json_schema?: { schema?: unknown } };
}

/**
 * `fetch`, for a chat completion.
 *
 * Anything that is not a chat completion, or any call made without a Kie
 * key, goes straight through to `fetch` untouched.
 */
export async function llmFetch(url: string, init: RequestInit): Promise<Response> {
  if (chatProvider() !== 'kie' || !url.endsWith('/chat/completions') || typeof init.body !== 'string') {
    return fetch(url, init);
  }
  const request = JSON.parse(init.body) as OpenAiRequest;
  return completeOnKie(request, init.signal ?? undefined);
}

async function completeOnKie(request: OpenAiRequest, signal?: AbortSignal): Promise<Response> {
  const wantsJson = Boolean(request.response_format && request.response_format.type !== 'text');
  const body = toAnthropic(request, wantsJson);

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(KIE_MESSAGES_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.kie.apiKey!}` },
      body: JSON.stringify(body),
      signal,
    });
    const json = (await response.json().catch(() => ({}))) as {
      content?: Array<{ type?: string; text?: string }>;
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
      credits_consumed?: number;
      error?: { message?: string } | string;
      msg?: string;
    };

    if (!response.ok || !json.content) {
      const message =
        (typeof json.error === 'string' ? json.error : json.error?.message) ?? json.msg ?? `${response.status} ${response.statusText}`;
      if (isBusy(response.status, message) && attempt < KIE_RETRY_DELAYS_MS.length) {
        await new Promise((resolve) => setTimeout(resolve, KIE_RETRY_DELAYS_MS[attempt]));
        continue;
      }
      // An error in the shape the callers already read, with a status they
      // treat as a failure — Kie sometimes reports a refusal under a 200.
      return new Response(JSON.stringify({ error: { message: `Kie: ${message}` } }), {
        status: response.ok ? 502 : response.status,
        headers: { 'content-type': 'application/json' },
      });
    }

    const raw = json.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('');
    const content = wantsJson ? extractJson(raw) : raw;
    const costUsd = typeof json.credits_consumed === 'number'
      ? json.credits_consumed * env.kie.usdPerCredit
      : completionCostUsd(
          { usage: { prompt_tokens: json.usage?.input_tokens, completion_tokens: json.usage?.output_tokens } },
          'anthropic/claude-opus-5.5',
        );

    return new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content }, finish_reason: json.stop_reason === 'max_tokens' ? 'length' : 'stop' }],
        usage: { prompt_tokens: json.usage?.input_tokens ?? 0, completion_tokens: json.usage?.output_tokens ?? 0 },
        cost_usd: costUsd,
        model: env.kie.chatModel,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
}

/** The OpenAI-shaped request as Anthropic Messages. Exported for the tests. */
export function toAnthropic(request: OpenAiRequest, wantsJson: boolean) {
  const system = request.messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => b.text ?? '').join('\n')))
    .join('\n\n');

  // Claude has no `response_format`; the schema becomes the last thing the
  // system prompt says, and `extractJson` cleans up whatever wraps the reply.
  const schema = request.response_format?.json_schema?.schema;
  const jsonRule = wantsJson
    ? `\n\nReply with ONE JSON object and nothing else — no prose before or after it, no code fence.${
        schema ? `\nIt must match this JSON schema:\n${JSON.stringify(schema)}` : ''
      }`
    : '';

  return {
    model: env.kie.chatModel,
    // Opus writes long; a ceiling below what the pass asked for would cut a
    // drawing off mid-tag. Never less than asked, never past what Kie takes.
    max_tokens: Math.min(Math.max(request.max_tokens ?? 4096, 1024), 32_000),
    ...(typeof request.temperature === 'number' ? { temperature: Math.min(1, Math.max(0, request.temperature)) } : {}),
    stream: false,
    ...(system || jsonRule ? { system: `${system}${jsonRule}` } : {}),
    messages: request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: typeof m.content === 'string'
          ? m.content
          : m.content.map((block) => {
              if (block.type !== 'image_url' || !block.image_url) return { type: 'text', text: block.text ?? '' };
              const match = block.image_url.url.match(/^data:([^;]+);base64,(.*)$/);
              return match
                ? { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
                : { type: 'image', source: { type: 'url', url: block.image_url.url } };
            }),
      })),
  };
}

/**
 * The JSON object inside a reply.
 *
 * Claude asked for "only JSON" still fences it often enough, and sometimes
 * says a sentence first. Every caller parses with `JSON.parse`, so whatever
 * is outside the outermost braces (or brackets) is cut away here.
 */
export function extractJson(text: string): string {
  const unfenced = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const starts = [unfenced.indexOf('{'), unfenced.indexOf('[')].filter((i) => i >= 0);
  if (!starts.length) return unfenced;
  const start = Math.min(...starts);
  const end = Math.max(unfenced.lastIndexOf('}'), unfenced.lastIndexOf(']'));
  return end > start ? unfenced.slice(start, end + 1) : unfenced;
}
