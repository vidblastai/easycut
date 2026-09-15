import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Which director runs, and what it is allowed to cost.
 *
 * Worth testing rather than eyeballing: the selection is the one place where a
 * wrong answer is invisible. A job that quietly falls back to the rule-based
 * editor still produces a video, so nothing fails — it just comes out worse,
 * and the only symptom is a user saying "the AI doesn't seem that smart".
 */

const ENV = {
  provider: 'auto' as 'auto' | 'anthropic' | 'gemini' | 'stub',
  anthropicKey: undefined as string | undefined,
  model: 'claude-opus-5',
  geminiKey: undefined as string | undefined,
  geminiModel: 'gemini-3-flash',
  geminiPaid: false,
  maxOutputTokens: 8000,
};

vi.mock('@/lib/config/env', () => ({
  env: {
    get llm() {
      return ENV;
    },
  },
}));

function configure(patch: Partial<typeof ENV>) {
  Object.assign(ENV, {
    provider: 'auto',
    anthropicKey: undefined,
    geminiKey: undefined,
    geminiPaid: false,
  }, patch);
}

afterEach(() => configure({}));

describe('provider selection', () => {
  it('falls back to the rule-based director with no keys at all', async () => {
    const { selectedProvider } = await import('../src/lib/director');
    configure({});
    expect(selectedProvider()).toBe('heuristic');
  });

  it('prefers Anthropic on auto when both keys are present', async () => {
    // A paid key is a deliberate act; a free one is often left over from
    // something else. Explicit LLM_PROVIDER always overrides this.
    const { selectedProvider } = await import('../src/lib/director');
    configure({ anthropicKey: 'sk-ant-x', geminiKey: 'AIza-x' });
    expect(selectedProvider()).toBe('anthropic');
  });

  it('uses Gemini on auto when it is the only key', async () => {
    const { selectedProvider } = await import('../src/lib/director');
    configure({ geminiKey: 'AIza-x' });
    expect(selectedProvider()).toBe('gemini');
  });

  it('honours an explicit provider over what keys happen to be set', async () => {
    const { selectedProvider } = await import('../src/lib/director');
    configure({ provider: 'gemini', anthropicKey: 'sk-ant-x', geminiKey: 'AIza-x' });
    expect(selectedProvider()).toBe('gemini');
    configure({ provider: 'anthropic', anthropicKey: 'sk-ant-x', geminiKey: 'AIza-x' });
    expect(selectedProvider()).toBe('anthropic');
  });

  it('falls back rather than failing when the named provider has no key', async () => {
    const { selectedProvider } = await import('../src/lib/director');
    configure({ provider: 'gemini', anthropicKey: 'sk-ant-x' });
    expect(selectedProvider()).toBe('heuristic');
  });

  it('stub means stub, whatever is configured', async () => {
    const { selectedProvider } = await import('../src/lib/director');
    configure({ provider: 'stub', anthropicKey: 'sk-ant-x', geminiKey: 'AIza-x' });
    expect(selectedProvider()).toBe('heuristic');
  });
});

describe('cost', () => {
  it('reports zero on the Gemini free tier', async () => {
    const { estimateGeminiCostUsd } = await import('../src/lib/director/gemini');
    configure({ geminiKey: 'AIza-x', geminiPaid: false });
    expect(estimateGeminiCostUsd(20_000, 4)).toBe(0);
  });

  it('charges once a billing account is linked', async () => {
    const { estimateGeminiCostUsd } = await import('../src/lib/director/gemini');
    configure({ geminiKey: 'AIza-x', geminiPaid: true });
    expect(estimateGeminiCostUsd(20_000, 4)).toBeGreaterThan(0);
  });

  it('prices an unknown Gemini model rather than returning zero', async () => {
    // Silently free is the dangerous failure: the budget guard would wave
    // through a job it should have degraded.
    const { geminiPriceFor } = await import('../src/lib/director/gemini');
    expect(geminiPriceFor('gemini-99-something').inputPerMTok).toBeGreaterThan(0);
  });

  it('still costs meaningfully less than the Anthropic tier', async () => {
    const { estimateGeminiCostUsd } = await import('../src/lib/director/gemini');
    const { estimateDirectorCostUsd } = await import('../src/lib/director/anthropic');
    configure({ geminiKey: 'AIza-x', geminiPaid: true, anthropicKey: 'sk-ant-x' });
    expect(estimateGeminiCostUsd(20_000, 4)).toBeLessThan(estimateDirectorCostUsd(20_000, 4));
  });
});

describe('the wire schema both providers share', () => {
  it('emits JSON Schema Gemini will accept', async () => {
    const { directorJsonSchema } = await import('../src/lib/director/wire');
    const schema = directorJsonSchema();
    // Gemini rejects the dialect marker outright.
    expect(schema.$schema).toBeUndefined();
    expect(schema.type).toBe('object');
    const props = schema.properties as Record<string, unknown>;
    // The fields the pipeline actually consumes downstream.
    for (const field of ['hook', 'removals', 'broll', 'graphics', 'sfx', 'punchIns', 'deliverable']) {
      expect(props[field], field).toBeDefined();
    }
  });

  it('marks every field required, so neither model can omit one', async () => {
    const { directorJsonSchema } = await import('../src/lib/director/wire');
    const schema = directorJsonSchema();
    const required = schema.required as string[];
    const props = Object.keys(schema.properties as Record<string, unknown>);
    expect(required.sort()).toEqual(props.sort());
  });
});
