import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV = vi.hoisted(() => ({
  llm: {
    wavespeedKey: 'test-key' as string | undefined,
    anthropicKey: undefined as string | undefined,
    motionModel: 'anthropic/claude-opus-5.5',
    chatProvider: 'auto' as 'auto' | 'anthropic' | 'kie' | 'wavespeed',
    chatEffort: 'medium' as const,
  },
  kie: { apiKey: undefined as string | undefined, chatModel: 'claude-opus-5-5', usdPerCredit: 0.005 },
  scenes: { composerProvider: 'auto' as 'auto' | 'kie' | 'wavespeed' },
}));
vi.mock('@/lib/config/env', () => ({ env: ENV }));

import {
  auditComposition,
  composerProvider,
  isFatal,
  parseComposition,
  REVIEW_OK,
  reviewScene,
  reviewTimes,
  serialiseComposition,
  systemPrompt,
  type CompositionRequest,
} from '@/lib/director/hyperframe';
import { isBusy } from '@/lib/llm/chat';

const fixture = readFileSync('tests/fixtures/hyperframes/neurons.txt', 'utf8');
const parts = parseComposition(fixture)!;
const request: CompositionRequest = {
  line: 'Your brain has eighty six billion neurons.',
  words: [{ text: 'brain', atSec: 0.3 }],
  headline: '',
  items: [],
  kind: 'kinetic-text',
  look: 'science',
  width: 1080,
  height: 1920,
  durationSec: 5.5,
};
const sheet = { dataUri: 'data:image/jpeg;base64,AAAA', times: reviewTimes(5.5) };

function replyWith(text: string) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  ENV.kie.apiKey = undefined;
  ENV.scenes.composerProvider = 'auto';
  ENV.llm.chatProvider = 'auto';
});

describe('the concept line', () => {
  it('is read off the reply and survives a round trip', () => {
    expect(parts.concept).toMatch(/dives into a brain/);
    expect(parseComposition(serialiseComposition(parts))).toEqual(parts);
  });

  it('is asked for, and its absence weakens a scene without killing it', () => {
    expect(systemPrompt(1080, 1920, 4)).toContain('<!-- concept:');
    const problems = auditComposition({ ...parts, concept: '' });
    expect(problems).toHaveLength(1);
    expect(isFatal(problems[0])).toBe(false);
  });
});

describe('what the repo taught the prompt', () => {
  it('asks for transformation between beats, not cuts', () => {
    const prompt = systemPrompt(1080, 1920, 4);
    expect(prompt).toContain('Transform, never cut');
    expect(prompt).toContain('back.out(1.4)');
    expect(prompt).toContain('half the speed');
  });
});

describe('the look-and-fix round', () => {
  it('shows the model its own scene and the frames', async () => {
    const fetchMock = replyWith(REVIEW_OK);
    const result = await reviewScene(request, parts, sheet);
    expect(result.approved).toBe(true);
    expect(result.parts).toBeNull();
    expect(result.costUsd).toBeGreaterThan(0);

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    const last = body.messages.at(-1);
    expect(body.messages.at(-2)).toMatchObject({ role: 'assistant' });
    expect(body.messages.at(-2).content).toContain('<!-- concept:');
    expect(last.content[1]).toEqual({ type: 'image_url', image_url: { url: sheet.dataUri } });
    expect(last.content[0].text).toContain('1.1s');
  });

  it('returns a revision when the model fixes something', async () => {
    replyWith(fixture.replaceAll('#FF5D73', '#FF6B80'));
    const result = await reviewScene(request, parts, sheet);
    expect(result.approved).toBe(false);
    expect(result.parts?.markup).toContain('#FF6B80');
  });

  it('never throws, so a failed review costs only the review', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500, statusText: 'boom' })));
    const result = await reviewScene(request, parts, sheet);
    expect(result).toMatchObject({ parts: null, approved: false });
    expect(result.error).toBeTruthy();
  });

  it('looks at the scene early, mid-move, late and settled', () => {
    expect(reviewTimes(4)).toEqual([0.8, 1.8, 2.8, 3.72]);
  });
});

describe('when one account refuses', () => {
  it('falls through to the other, and names both when both refuse', async () => {
    ENV.kie.apiKey = 'kie-key';
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('kie.ai')
        ? new Response(JSON.stringify({ msg: 'Unauthorized' }), { status: 401 })
        : new Response(JSON.stringify({ choices: [{ message: { content: REVIEW_OK } }] })),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect((await reviewScene(request, parts, sheet)).approved).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ msg: 'nope' }), { status: 402 })));
    const failed = await reviewScene(request, parts, sheet);
    expect(failed.error).toMatch(/^kie: .* · wavespeed: /);
  });
});

describe('when Kie is busy', () => {
  it('tells "not now" from "no"', () => {
    expect(isBusy(200, 'Resources are tight, please try again later.')).toBe(true);
    expect(isBusy(429, '')).toBe(true);
    expect(isBusy(401, 'Unauthorized')).toBe(false);
    expect(isBusy(402, 'Insufficient balance')).toBe(false);
  });

  it('waits and asks again instead of giving up', async () => {
    vi.useFakeTimers();
    ENV.kie.apiKey = 'kie-key';
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return calls === 1
        ? new Response(JSON.stringify({ msg: 'Resources are tight, please try again later.' }), { status: 200 })
        : new Response(JSON.stringify({ content: [{ type: 'text', text: REVIEW_OK }], credits_consumed: 4 }));
    }));
    const pending = reviewScene(request, parts, sheet);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;
    vi.useRealTimers();
    expect(result.approved).toBe(true);
    expect(calls).toBe(2);
  });
});

describe('through Kie', () => {
  it('is preferred when its key is set, unless WaveSpeed is asked for', () => {
    expect(composerProvider()).toBe('wavespeed');
    ENV.kie.apiKey = 'kie-key';
    expect(composerProvider()).toBe('kie');
    ENV.llm.chatProvider = 'wavespeed';
    expect(composerProvider()).toBe('wavespeed');
  });

  it('speaks the Anthropic Messages shape, frames included, and bills by credits', async () => {
    ENV.kie.apiKey = 'kie-key';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: 'text', text: REVIEW_OK }], credits_consumed: 20 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await reviewScene(request, parts, sheet);
    expect(result.approved).toBe(true);
    expect(result.costUsd).toBeCloseTo(0.1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }];
    expect(url).toBe('https://api.kie.ai/claude/v1/messages');
    expect(init.headers.authorization).toBe('Bearer kie-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.system).toContain('You make one shot');
    expect(body.messages.some((m: { role: string }) => m.role === 'system')).toBe(false);
    expect(body.messages.at(-1).content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
    });
  });
});
