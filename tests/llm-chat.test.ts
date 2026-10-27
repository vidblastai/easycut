import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV = vi.hoisted(() => ({
  llm: {
    wavespeedKey: undefined as string | undefined,
    anthropicKey: undefined as string | undefined,
    chatProvider: 'wavespeed' as 'auto' | 'anthropic' | 'kie' | 'wavespeed',
    chatEffort: 'medium' as const,
    motionModel: 'anthropic/claude-opus-5.5',
  },
  kie: { apiKey: undefined as string | undefined, chatModel: 'claude-opus-5-5', usdPerCredit: 0.005 },
  scenes: { composerProvider: 'auto' as 'auto' | 'anthropic' | 'kie' | 'wavespeed' },
}));
vi.mock('@/lib/config/env', () => ({ env: ENV }));

// The Anthropic SDK, standing in for the network: `stream` resolves to
// whatever `ANTHROPIC.next` holds, and records what it was asked.
const ANTHROPIC = vi.hoisted(() => ({
  next: null as null | { content: Array<{ type: string; text?: string }>; stop_reason: string; usage: Record<string, number> } | Error,
  asked: [] as Array<Record<string, unknown>>,
}));
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    constructor(readonly status: number, message: string) {
      super(message);
    }
  }
  class Anthropic {
    static APIError = APIError;
    messages = {
      stream: (params: Record<string, unknown>) => {
        ANTHROPIC.asked.push(params);
        return {
          finalMessage: async () => {
            if (ANTHROPIC.next instanceof Error) throw ANTHROPIC.next;
            return ANTHROPIC.next;
          },
        };
      },
    };
  }
  return { default: Anthropic, APIError };
});

import Anthropic from '@anthropic-ai/sdk';
import { chatProvider, composerProviders, extractJson, generalProviders, llmFetch, routedModel, toClaude } from '@/lib/llm/chat';

const URL_ = 'https://llm.wavespeed.ai/v1/chat/completions';
const request = {
  model: 'google/gemini-3.6-flash',
  messages: [
    { role: 'system', content: 'You are the director.' },
    { role: 'user', content: 'Cut this.' },
  ],
  max_tokens: 8000,
  temperature: 0.4,
  response_format: { type: 'json_schema', json_schema: { schema: { type: 'object', properties: { cuts: { type: 'array' } } } } },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  ENV.kie.apiKey = undefined;
  ENV.llm.wavespeedKey = undefined;
  ENV.llm.anthropicKey = undefined;
  ENV.llm.chatProvider = 'wavespeed';
  ENV.scenes.composerProvider = 'auto';
  ANTHROPIC.next = null;
  ANTHROPIC.asked = [];
});

describe('who answers', () => {
  it('keeps everything but the scenes on the original setup', () => {
    ENV.llm.wavespeedKey = 'ws';
    ENV.kie.apiKey = 'kie';
    ENV.llm.anthropicKey = 'sk-ant';
    expect(generalProviders()).toEqual(['wavespeed']);
    expect(chatProvider()).toBe('wavespeed');
    expect(routedModel('google/gemini-3.6-flash')).toBe('google/gemini-3.6-flash');
    ENV.llm.chatProvider = 'auto';
    expect(generalProviders()).toEqual(['kie', 'wavespeed']);
  });

  it('writes the scenes with Opus: Anthropic, then Kie, then WaveSpeed', () => {
    ENV.llm.wavespeedKey = 'ws';
    ENV.kie.apiKey = 'kie';
    ENV.llm.anthropicKey = 'sk-ant';
    expect(composerProviders()).toEqual(['anthropic', 'kie', 'wavespeed']);
    expect(routedModel('anthropic/claude-opus-5.5', composerProviders())).toBe('claude-opus-5-5');
    ENV.scenes.composerProvider = 'kie';
    expect(composerProviders()).toEqual(['kie']);
  });
});

describe('the request, as Claude reads it', () => {
  it('moves the system prompt up, turns the schema into a rule, uses Opus 5.5 and sends no temperature', () => {
    const body = toClaude(request, true, 'claude-opus-5-5');
    expect(body.model).toBe('claude-opus-5-5');
    expect(body).not.toHaveProperty('temperature');
    expect(body.system).toMatch(/^You are the director\./);
    expect(body.system).toContain('Reply with ONE JSON object');
    expect(body.system).toContain('"cuts"');
    expect(body.messages).toEqual([{ role: 'user', content: 'Cut this.' }]);
    // Room for adaptive thinking on top of what the pass asked for.
    expect(body.max_tokens).toBe(16000);
  });
});

describe('the reply, as the callers read it', () => {
  it('cuts a fenced or chatty reply down to its JSON', () => {
    expect(extractJson('Here you go:\n```json\n{"cuts": [1]}\n```')).toBe('{"cuts": [1]}');
    expect(extractJson('[{"a":1}] hope that helps')).toBe('[{"a":1}]');
  });

  it('answers in the OpenAI shape, priced in Kie credits', async () => {
    ENV.kie.apiKey = 'kie';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: 'text', text: '```json\n{"cuts":[]}\n```' }], credits_consumed: 30, stop_reason: 'end_turn' })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const response = await llmFetch(URL_, { method: 'POST', body: JSON.stringify(request) }, ['kie']);
    const body = await response.json();
    expect(response.ok).toBe(true);
    expect(JSON.parse(body.choices[0].message.content)).toEqual({ cuts: [] });
    expect(body.cost_usd).toBeCloseTo(0.15);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://api.kie.ai/claude/v1/messages');
  });

  it('reports a refusal as a failure, even one Kie sent under a 200', async () => {
    ENV.kie.apiKey = 'kie';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 402, msg: 'Credits insufficient' }))));
    const response = await llmFetch(URL_, { method: 'POST', body: JSON.stringify(request) }, ['kie']);
    expect(response.ok).toBe(false);
    expect((await response.json()).error.message).toBe('kie: Credits insufficient');
  });

  it('waits out a busy Kie instead of giving up', async () => {
    vi.useFakeTimers();
    ENV.kie.apiKey = 'kie';
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return calls === 1
        ? new Response(JSON.stringify({ msg: 'Resources are tight, please try again later.' }))
        : new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], credits_consumed: 1 }));
    }));
    const pending = llmFetch(URL_, { method: 'POST', body: JSON.stringify({ ...request, response_format: undefined }) }, ['kie']);
    await vi.advanceTimersByTimeAsync(5_000);
    const body = await (await pending).json();
    expect(body.choices[0].message.content).toBe('ok');
    expect(calls).toBe(2);
  });

  it('leaves WaveSpeed calls alone on the original setup, whatever other keys exist', async () => {
    ENV.llm.wavespeedKey = 'ws';
    ENV.kie.apiKey = 'kie';
    ENV.llm.anthropicKey = 'sk-ant';
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await llmFetch(URL_, { method: 'POST', body: JSON.stringify(request) });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(URL_);
  });
});

describe('straight from Anthropic', () => {
  it('streams Opus 5.5 with adaptive thinking, and prices it at $4 / $20', async () => {
    ENV.llm.anthropicKey = 'sk-ant';
    ANTHROPIC.next = {
      content: [{ type: 'thinking' }, { type: 'text', text: '```json\n{"cuts":[1]}\n```' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1_000_000, output_tokens: 100_000 },
    };
    const response = await llmFetch(URL_, { method: 'POST', body: JSON.stringify(request) }, composerProviders());
    const body = await response.json();
    expect(JSON.parse(body.choices[0].message.content)).toEqual({ cuts: [1] });
    expect(body.cost_usd).toBeCloseTo(6);
    expect(ANTHROPIC.asked[0]).toMatchObject({ model: 'claude-opus-5-5', thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } });
    expect(ANTHROPIC.asked[0]).not.toHaveProperty('temperature');
  });

  it('moves on to Kie when Anthropic refuses, and names both when both do', async () => {
    ENV.llm.anthropicKey = 'sk-ant';
    ENV.kie.apiKey = 'kie';
    ANTHROPIC.next = new (Anthropic as unknown as { APIError: new (s: number, m: string) => Error }).APIError(529, 'Overloaded');
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'from kie' }], credits_consumed: 2 })),
    ));
    const ok = await (await llmFetch(URL_, { method: 'POST', body: JSON.stringify({ ...request, response_format: undefined }) }, composerProviders())).json();
    expect(ok.choices[0].message.content).toBe('from kie');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 402, msg: 'Credits insufficient' }))));
    const failed = await llmFetch(URL_, { method: 'POST', body: JSON.stringify(request) }, composerProviders());
    expect(failed.ok).toBe(false);
    expect((await failed.json()).error.message).toBe('anthropic: Overloaded · kie: Credits insufficient');
  });
});
