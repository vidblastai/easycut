import { describe, expect, it } from 'vitest';
import { estimateCost, planDegradation, CostLedger } from '@/lib/pricing/cost';

/**
 * The product promise is a hard number: under $1 for a short, under $5 for a
 * long-form video. These tests are that promise, written down.
 */

const SHORT = {
  mode: 'short' as const,
  sourceDurationSec: 90,
  outputDurationSec: 55,
  width: 1080,
  height: 1920,
  fps: 30,
  transcriptChars: 1500,
  directorWindows: 1,
  generatedImageCount: 1,
  brollClipCount: 7,
  // Price the cloud path explicitly: local rendering is free, so it would
  // trivially pass these ceilings and prove nothing.
  renderDriver: 'lambda' as const,
};

const LONG = {
  mode: 'long' as const,
  sourceDurationSec: 780,
  outputDurationSec: 600,
  width: 1920,
  height: 1080,
  fps: 30,
  transcriptChars: 16000,
  directorWindows: 5,
  generatedImageCount: 2,
  brollClipCount: 18,
  renderDriver: 'lambda' as const,
};

describe('cost ceilings', () => {
  it('keeps a 60-second short under $1', () => {
    const estimate = estimateCost(SHORT);
    expect(estimate.budgetUsd).toBe(1);
    expect(estimate.totalUsd).toBeLessThan(1);
    expect(estimate.withinBudget).toBe(true);
  });

  it('keeps a 10-minute long-form video under $5', () => {
    const estimate = estimateCost(LONG);
    expect(estimate.budgetUsd).toBe(5);
    expect(estimate.totalUsd).toBeLessThan(5);
    expect(estimate.withinBudget).toBe(true);
  });

  it('leaves real headroom rather than squeaking under the line', () => {
    // A 2× margin is what lets a provider price rise or an unusually long
    // transcript land without breaking the promise.
    expect(estimateCost(SHORT).headroomUsd).toBeGreaterThan(0.5);
    expect(estimateCost(LONG).headroomUsd).toBeGreaterThan(2.5);
  });

  it('charges nothing for rendering on the local driver', () => {
    expect(estimateCost({ ...SHORT, renderDriver: 'local' }).lines.render).toBe(0);
  });

  it('scales render cost with pixel count', () => {
    const hd = estimateCost({ ...LONG, width: 1920, height: 1080 });
    const uhd = estimateCost({ ...LONG, width: 3840, height: 2160 });
    expect(uhd.lines.render).toBeGreaterThan(hd.lines.render);
  });
});

describe('degradation', () => {
  it('does nothing when the job already fits', () => {
    expect(planDegradation(SHORT).steps).toEqual([]);
  });

  it('sacrifices generated images before anything a viewer would notice', () => {
    // An absurd job that cannot possibly fit.
    const plan = planDegradation({
      ...LONG,
      outputDurationSec: 36_000,
      width: 3840,
      height: 2160,
      generatedImageCount: 400,
    });
    expect(plan.steps[0]).toBe('generated-images');
    // Captions are never on the list at all.
    expect(plan.steps).not.toContain('captions');
  });
});

describe('CostLedger', () => {
  it('totals spend per line and ignores junk entries', () => {
    const ledger = new CostLedger();
    ledger.add('transcription', 0.0043, 'deepgram');
    ledger.add('director', 0.11, 'claude-opus-5');
    ledger.add('image-generation', 0.003);
    ledger.add('render', 0);          // free local render
    ledger.add('storage', NaN);       // never poisons the total

    expect(ledger.totalUsd).toBeCloseTo(0.1173, 5);
    expect(ledger.byLine().director).toBeCloseTo(0.11, 5);
    expect(ledger.byLine().render).toBeUndefined();
  });
});
