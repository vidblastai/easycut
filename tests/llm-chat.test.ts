import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV = vi.hoisted(() => ({
  llm: { wavespeedKey: undefined as string | undefined, chatProvider: 'auto' as 'auto' | 'kie' | 'wavespeed', motionModel: 'anthropic/claude-opus-5.5' },
  kie: { apiKey: undefined as string | undefined, chatModel: 'claude-opus-5-5', usdPerCredit: 0.005 },
}));
vi.mock('@/lib/config/env', () => ({ env: ENV }));

import { chatProvider, extractJson, llmFetch, routedModel, toAnthropic } from '@/lib/llm/chat';

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
  ENV.llm.chatProvider = 'auto';
});

describe('who answers', () => {
  it('is Kie whenever it has a key, WaveSpeed only without one', () => {
    ENV.llm.wavespeedKey = 'ws';
    expect(chatProvider()).toBe('wavespeed');
    expect(routedModel('google/gemini-3.6-flash')).toBe('google/gemini-3.6-flash');
    ENV.kie.apiKey = 'kie';
    expect(chatProvider()).toBe('kie');
    expect(routedModel('google/gemini-3.6-flash')).toBe('claude-opus-5-5');
  });
});

describe('the request, as Claude reads it', () => {
  it('moves the system prompt up, turns the schema into a rule, and uses Opus 5.5', () => {
    const body = toAnthropic(request, true);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.system).toMatch(/^You are the director\./);
    expect(body.system).toContain('Reply with ONE JSON object');
    expect(body.system).toContain('"cuts"');
    expect(body.messages).toEqual([{ role: 'user', content: 'Cut this.' }]);
    expect(body.max_tokens).toBe(8000);
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
    const response = await llmFetch(URL_, { method: 'POST', body: JSON.stringify(request) });
    const body = await response.json();
    expect(response.ok).toBe(true);
    expect(JSON.parse(body.choices[0].message.content)).toEqual({ cuts: [] });
    expect(body.cost_usd).toBeCloseTo(0.15);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://api.kie.ai/claude/v1/messages');
  });

  it('reports a refusal as a failure, even one Kie sent under a 200', async () => {
    ENV.kie.apiKey = 'kie';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 402, msg: 'Credits insufficient' }))));
    const response = await llmFetch(URL_, { method: 'POST', body: JSON.stringify(request) });
    expect(response.ok).toBe(false);
    expect((await response.json()).error.message).toBe('Kie: Credits insufficient');
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
    const pending = llmFetch(URL_, { method: 'POST', body: JSON.stringify({ ...request, response_format: undefined }) });
    await vi.advanceTimersByTimeAsync(5_000);
    const body = await (await pending).json();
    expect(body.choices[0].message.content).toBe('ok');
    expect(calls).toBe(2);
  });

  it('leaves WaveSpeed calls alone when there is no Kie key', async () => {
    ENV.llm.wavespeedKey = 'ws';
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await llmFetch(URL_, { method: 'POST', body: JSON.stringify(request) });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(URL_);
  });
});
