import { describe, expect, it } from 'vitest';
import { estimateGeneratedBrollCostUsd, generatedBrollCostFor } from '@/lib/assets/generated-broll';
import { wavespeedPriceFor } from '@/lib/director/wavespeed';

/**
 * The arithmetic and the clamps around generated media.
 *
 * The network calls are covered by running them against the real API; what is
 * worth a test here is the logic that decides what to ASK for, because getting
 * it wrong shows up as a rejected request or a frozen frame rather than as an
 * exception.
 */

describe('what a generated clip costs', () => {
  it('prices the models it knows from the catalogue', () => {
    expect(generatedBrollCostFor('lightricks/ltx-2-fast/text-to-video')).toBe(0.04);
    expect(generatedBrollCostFor('pruna-ai/p-video-2-pro/text-to-video')).toBe(0.02);
  });

  it('falls back to a price that over- rather than under-states an unknown model', () => {
    // A guess that is too LOW lets a job past the budget guard that should have
    // been refused, which is the expensive direction to be wrong in.
    const unknown = generatedBrollCostFor('someone/a-model-we-have-never-seen/text-to-video');
    expect(unknown).toBeGreaterThanOrEqual(0.04);
  });

  it('multiplies out, so four inserts stay inside the short-form ceiling', () => {
    // The pipeline refuses a short that would cost more than $1.00.
    expect(estimateGeneratedBrollCostUsd(4)).toBeLessThan(1);
    expect(estimateGeneratedBrollCostUsd(4)).toBeCloseTo(0.16, 5);
  });

  it('costs nothing when nothing is generated', () => {
    expect(estimateGeneratedBrollCostUsd(0)).toBe(0);
  });
});

describe('director pricing through the router', () => {
  it('knows the models it defaults to', () => {
    expect(wavespeedPriceFor('google/gemini-3.6-flash')).toEqual({
      inputPerMTok: 0.75,
      outputPerMTok: 3.75,
    });
  });

  it('never returns undefined for a model it has not heard of', () => {
    const p = wavespeedPriceFor('some/new-model');
    expect(p.inputPerMTok).toBeGreaterThan(0);
    expect(p.outputPerMTok).toBeGreaterThan(0);
  });
});
