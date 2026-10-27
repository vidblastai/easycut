import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/config/env', () => ({
  env: { llm: { wavespeedKey: 'test-key', motionModel: 'anthropic/claude-opus-5.5' } },
}));

import {
  auditComposition,
  isFatal,
  parseComposition,
  REVIEW_OK,
  reviewScene,
  reviewTimes,
  serialiseComposition,
  systemPrompt,
  type CompositionRequest,
} from '@/lib/director/hyperframe';

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

afterEach(() => vi.unstubAllGlobals());

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
