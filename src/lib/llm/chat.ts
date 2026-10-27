import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/config/env';
import { priceFor } from '@/lib/director/anthropic';
import { wavespeedPriceFor } from '@/lib/director/wavespeed';

/**
 * Every language-model call in the pipeline, routed to Claude.
 *
 * ── Why an adapter and not seven rewrites ───────────────────────────────
 *
 * The director, the retake reader, the scene pass, the panel, the panel art,
 * the motion pass, the SVG illustrator and the HyperFrames composer all grew
 * up speaking WaveSpeed's OpenAI-shaped `chat/completions`, each with its own
 * prompt, schema, parser and fallbacks. Moving them one by one would mean
 * eight translations of the same request and eight places for them to drift.
 *
 * So each of them calls `llmFetch` where it used to call `fetch`, and this
 * module answers in the shape they already read. The request goes to Claude —
 * Anthropic directly, or Kie's copy of the same API — with the system message
 * moved to the top level, a JSON schema turned into an instruction and the
 * reply cut back down to its JSON. Without either key it is a plain `fetch`
 * to WaveSpeed, exactly as before.
 *
 * ── Who answers ─────────────────────────────────────────────────────────
 *
 * Two routes, on purpose:
 *
 *   - The animated scenes (`composerProviders`) are the one thing written by
 *     Claude Opus 5.5: Anthropic, then Kie, then WaveSpeed, whichever have
 *     keys, each tried only if the one before refused. Kie turned away every
 *     request for an hour on the live runs, which is why there is a list.
 *   - Everything else (`generalProviders`) stays on the setup it had before —
 *     WaveSpeed, with the models it always used — unless CHAT_PROVIDER says
 *     otherwise. The editor, the panel and the scene picker are not where
 *     Opus is worth paying for.
 *
 * ── The model ───────────────────────────────────────────────────────────
 *
 * Claude Opus 5.5 everywhere (`KIE_CHAT_MODEL` / `ANTHROPIC_CHAT_MODEL`).
 * Opus 5.5 rejects `temperature`, so it is never sent; how hard it thinks is
 * `CHAT_EFFORT` instead.
 */

const KIE_MESSAGES_URL = 'https://api.kie.ai/claude/v1/messages';
/** Opus 5.5 under its Anthropic name. */
export const ANTHROPIC_CHAT_MODEL = process.env.ANTHROPIC_CHAT_MODEL ?? 'claude-opus-5-5';

export type ChatProvider = 'anthropic' | 'kie' | 'wavespeed';

function available(): Record<ChatProvider, boolean> {
  return {
    anthropic: Boolean(env.llm.anthropicKey),
    kie: Boolean(env.kie.apiKey && env.kie.chatModel),
    wavespeed: Boolean(env.llm.wavespeedKey),
  };
}

function ordered(wanted: string | undefined, auto: readonly ChatProvider[]): ChatProvider[] {
  const keys = available();
  if (wanted && wanted !== 'auto') return keys[wanted as ChatProvider] ? [wanted as ChatProvider] : [];
  return auto.filter((provider) => keys[provider]);
}

/**
 * Who answers the animated scenes: Claude Opus 5.5, from Anthropic first.
 * `SCENE_COMPOSER_PROVIDER` forces one.
 */
export function composerProviders(): ChatProvider[] {
  return ordered(env.scenes.composerProvider, ['anthropic', 'kie', 'wavespeed']);
}

/**
 * Who answers every other pass: the original setup (WaveSpeed) unless
 * `CHAT_PROVIDER` names another. `auto` means Kie, then WaveSpeed.
 */
export function generalProviders(): ChatProvider[] {
  return ordered(env.llm.chatProvider ?? 'wavespeed', ['kie', 'wavespeed']);
}

/** The account tried first for the general passes, or null when none has a key. */
export function chatProvider(): ChatProvider | null {
  return generalProviders()[0] ?? null;
}

export function isChatConfigured(): boolean {
  return chatProvider() !== null;
}

/**
 * The model a pass will run on, for its cost line and its log.
 *
 * A pass written for WaveSpeed names a WaveSpeed model; on Claude that name
 * is never sent anywhere, and reporting it would say the video was made by
 * an account it never touched.
 */
export function routedModel(model: string, providers: ChatProvider[] = generalProviders()): string {
  const first = providers[0] ?? null;
  if (first === 'anthropic') return ANTHROPIC_CHAT_MODEL;
  if (first === 'kie') return env.kie.chatModel;
  return model;
}

/** What a completion cost: as reported when it was, otherwise tokens at the model's rate. */
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

/** A refusal that means "not now" rather than "no". */
export function isBusy(status: number, message: string): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504 || status === 529 ||
    /try again later|resources are tight|rate limit|overloaded|too many requests/i.test(message);
}

/** Waits between attempts when Kie is busy. */
export const KIE_RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

type OpenAiContent = string | Array<{ type: string; text?: string; image_url?: { url: string } }>;

export interface OpenAiRequest {
  model?: string;
  messages: Array<{ role: string; content: OpenAiContent }>;
  max_tokens?: number;
  temperature?: number;
  response_format?: { type: string; json_schema?: { schema?: unknown } };
}

/**
 * `fetch`, for a chat completion.
 *
 * Anything that is not a chat completion goes straight to `fetch`. A chat
 * completion goes to each configured account in turn until one answers; the
 * error from the last one names every account that refused.
 */
export async function llmFetch(
  url: string,
  init: RequestInit,
  providers: ChatProvider[] = generalProviders(),
): Promise<Response> {
  if (!url.endsWith('/chat/completions') || typeof init.body !== 'string') return fetch(url, init);
  if (!providers.length || (providers.length === 1 && providers[0] === 'wavespeed')) return fetch(url, init);

  const request = JSON.parse(init.body) as OpenAiRequest;
  const failures: string[] = [];
  let last: Response | null = null;
  for (const provider of providers) {
    const response = provider === 'anthropic'
      ? await completeOnAnthropic(request, init.signal ?? undefined)
      : provider === 'kie'
        ? await completeOnKie(request, init.signal ?? undefined)
        : await fetch(url, init);
    if (response.ok) return response;
    last = response;
    const body = (await response.clone().json().catch(() => ({}))) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message ?? `${response.status}`;
    failures.push(`${provider}: ${message.replace(/^(Kie|Anthropic): /, '')}`);
  }
  return new Response(JSON.stringify({ error: { message: failures.join(' · ') } }), {
    status: last?.status && last.status >= 400 ? last.status : 502,
    headers: { 'content-type': 'application/json' },
  });
}

/* ---------------------------------------------------------------- anthropic */

let anthropicClient: Anthropic | null = null;
function anthropic(): Anthropic {
  anthropicClient ??= new Anthropic({ apiKey: env.llm.anthropicKey });
  return anthropicClient;
}

/**
 * Claude Opus 5.5 from Anthropic, streamed.
 *
 * Streamed because the drawing passes ask for tens of thousands of tokens and
 * a single non-streamed response that long runs into HTTP timeouts; the SDK
 * assembles the final message. Thinking is adaptive (Opus 5.5 cannot turn it
 * off) and only the text blocks are the answer.
 */
async function completeOnAnthropic(request: OpenAiRequest, signal?: AbortSignal): Promise<Response> {
  const wantsJson = Boolean(request.response_format && request.response_format.type !== 'text');
  const body = toClaude(request, wantsJson, ANTHROPIC_CHAT_MODEL);
  try {
    const stream = anthropic().messages.stream(
      {
        model: body.model,
        max_tokens: body.max_tokens,
        ...(body.system ? { system: body.system } : {}),
        messages: body.messages as Anthropic.MessageParam[],
        thinking: { type: 'adaptive' },
        output_config: { effort: env.llm.chatEffort },
      },
      { signal },
    );
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') {
      return errorResponse(`Anthropic: declined (${message.stop_details?.category ?? 'unknown'})`, 400);
    }
    const raw = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
    const pricing = priceFor(ANTHROPIC_CHAT_MODEL);
    const usage = message.usage;
    const costUsd =
      ((usage.input_tokens ?? 0) / 1_000_000) * pricing.inputPerMTok +
      ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * pricing.inputPerMTok * 1.25 +
      ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * pricing.inputPerMTok * 0.1 +
      ((usage.output_tokens ?? 0) / 1_000_000) * pricing.outputPerMTok;
    return okResponse(wantsJson ? extractJson(raw) : raw, message.stop_reason === 'max_tokens', usage.input_tokens, usage.output_tokens, costUsd, ANTHROPIC_CHAT_MODEL);
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      return errorResponse(`Anthropic: ${error.message}`, typeof error.status === 'number' ? error.status : 502);
    }
    return errorResponse(`Anthropic: ${error instanceof Error ? error.message : String(error)}`, 502);
  }
}

/* ---------------------------------------------------------------------- kie */

async function completeOnKie(request: OpenAiRequest, signal?: AbortSignal): Promise<Response> {
  const wantsJson = Boolean(request.response_format && request.response_format.type !== 'text');
  const body = { ...toClaude(request, wantsJson, env.kie.chatModel), stream: false };

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(KIE_MESSAGES_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.kie.apiKey!}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      return errorResponse(`Kie: ${error instanceof Error ? error.message : String(error)}`, 502);
    }
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
      // Kie sometimes reports a refusal under a 200; it is still a refusal.
      return errorResponse(`Kie: ${message}`, response.ok ? 502 : response.status);
    }

    const raw = json.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('');
    const costUsd = typeof json.credits_consumed === 'number'
      ? json.credits_consumed * env.kie.usdPerCredit
      : completionCostUsd(
          { usage: { prompt_tokens: json.usage?.input_tokens, completion_tokens: json.usage?.output_tokens } },
          'anthropic/claude-opus-5.5',
        );
    return okResponse(wantsJson ? extractJson(raw) : raw, json.stop_reason === 'max_tokens', json.usage?.input_tokens, json.usage?.output_tokens, costUsd, env.kie.chatModel);
  }
}

/* ------------------------------------------------------------------ shapes */

function okResponse(content: string, truncated: boolean, input = 0, output = 0, costUsd: number, model: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content }, finish_reason: truncated ? 'length' : 'stop' }],
      usage: { prompt_tokens: input, completion_tokens: output },
      cost_usd: costUsd,
      model,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status: status >= 400 ? status : 502,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The OpenAI-shaped request as Claude's Messages API reads it.
 *
 * No `temperature`: Opus 5.5 rejects it outright. Exported for the tests.
 */
export function toClaude(request: OpenAiRequest, wantsJson: boolean, model: string) {
  const system = request.messages
    .filter((m) => m.role === 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : m.content.map((b) => b.text ?? '').join('\n')))
    .join('\n\n');

  // Claude has no `response_format` here; the schema becomes the last thing
  // the system prompt says, and `extractJson` cleans up whatever wraps it.
  const schema = request.response_format?.json_schema?.schema;
  const jsonRule = wantsJson
    ? `\n\nReply with ONE JSON object and nothing else — no prose before or after it, no code fence.${
        schema ? `\nIt must match this JSON schema:\n${JSON.stringify(schema)}` : ''
      }`
    : '';

  return {
    model,
    // Opus writes long, and thinking counts against this too; a ceiling below
    // what the pass asked for would cut a drawing off mid-tag.
    max_tokens: Math.min(Math.max(request.max_tokens ?? 8000, 8000) + 8000, 64_000),
    ...(system || jsonRule ? { system: `${system}${jsonRule}` } : {}),
    messages: request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: typeof m.content === 'string'
          ? m.content
          : m.content.map((block) => {
              if (block.type !== 'image_url' || !block.image_url) return { type: 'text' as const, text: block.text ?? '' };
              const match = block.image_url.url.match(/^data:([^;]+);base64,(.*)$/);
              return match
                ? { type: 'image' as const, source: { type: 'base64' as const, media_type: match[1], data: match[2] } }
                : { type: 'image' as const, source: { type: 'url' as const, url: block.image_url.url } };
            }),
      })),
  };
}

/**
 * The JSON inside a reply.
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
