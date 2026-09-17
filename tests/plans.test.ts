import { describe, expect, it } from 'vitest';
import {
  COGS_PER_JOB_USD,
  COGS_PER_SOURCE_MINUTE_USD,
  PAID_PLANS,
  PLANS,
  canReEdit,
  getPlan,
  planEconomics,
  renderExpiresAt,
  sourceExpiresAt,
  videosFor,
} from '@/lib/billing/plans';

describe('the unit costs behind the plans', () => {
  it('still reproduce the two figures the cost model publishes', () => {
    // If these drift, every margin below is fiction. The two anchors are the
    // ones docs/COST_MODEL.md quotes and tests/cost.test.ts guards.
    const short = COGS_PER_JOB_USD + 1 * COGS_PER_SOURCE_MINUTE_USD;
    const long = COGS_PER_JOB_USD + 10 * COGS_PER_SOURCE_MINUTE_USD;
    expect(short).toBeCloseTo(0.1234, 3);
    expect(long).toBeCloseTo(0.7354, 3);
  });
});

describe('plan economics', () => {
  it('every paid plan clears 70 % gross margin fully used', () => {
    for (const plan of PAID_PLANS) {
      const e = planEconomics(plan);
      expect(e.grossMargin, `${plan.name} margin ${(e.grossMargin * 100).toFixed(1)}%`)
        .toBeGreaterThan(0.7);
    }
  });

  it('and none of them is quietly printing money either', () => {
    // A margin above ~90 % on an AI product means the allowance is too mean to
    // be worth buying — that is a pricing bug, not a win.
    for (const plan of PAID_PLANS) {
      expect(planEconomics(plan).grossMargin, plan.name).toBeLessThan(0.9);
    }
  });

  it('gets cheaper per minute as you go up', () => {
    // If a bigger plan is not better value per minute, nobody upgrades.
    const rates = PAID_PLANS.map((p) => planEconomics(p).pricePerMinuteUsd);
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i], PAID_PLANS[i].name).toBeLessThan(rates[i - 1]);
    }
  });

  it('prices the allowance far above what the pipeline costs', () => {
    // The customer-facing sanity check: a minute of footage sells for orders of
    // magnitude more than it costs, which is what pays for everything else.
    for (const plan of PAID_PLANS) {
      const e = planEconomics(plan);
      const costPerMinute = e.pipelineUsd / plan.footageMinutes;
      expect(e.pricePerMinuteUsd / costPerMinute, plan.name).toBeGreaterThan(3);
    }
  });

  it('counts storage against the plans that keep things longest', () => {
    // Studio keeps renders indefinitely and sources for 90 days, so its storage
    // line has to be the biggest — if it is not, the model is not modelling.
    const [starter, creator, studio] = PAID_PLANS.map(planEconomics);
    expect(starter.storageUsd).toBeLessThan(creator.storageUsd);
    expect(creator.storageUsd).toBeLessThan(studio.storageUsd);
  });

  it('the free tier costs us less than a cup of coffee per signup', () => {
    const e = planEconomics(PLANS.free);
    expect(e.totalCostUsd).toBeLessThan(1);
  });
});

describe('what a plan promises', () => {
  it('Starter is the three videos it says it is', () => {
    const { shorts, long } = videosFor(PLANS.starter);
    expect(long).toBe(3);
    expect(shorts).toBe(12);
  });

  it('each tier is a real step up, not a rounding error', () => {
    for (let i = 1; i < PAID_PLANS.length; i++) {
      expect(PAID_PLANS[i].footageMinutes).toBeGreaterThan(PAID_PLANS[i - 1].footageMinutes * 2);
    }
  });

  it('a single upload can never swallow a whole month', () => {
    for (const plan of Object.values(PLANS)) {
      expect(plan.maxMinutesPerUpload, plan.name).toBeLessThanOrEqual(plan.footageMinutes);
    }
  });
});

describe('retention', () => {
  it('keeps the finished video longer than the footage it came from', () => {
    // The source is ~20× the size and only useful for re-cutting; the video is
    // the thing people come back for.
    for (const plan of Object.values(PLANS)) {
      if (plan.renderRetentionDays === null) continue;
      expect(plan.renderRetentionDays, plan.name).toBeGreaterThan(plan.sourceRetentionDays);
    }
  });

  it('gets more generous as the plan gets bigger', () => {
    for (let i = 1; i < PAID_PLANS.length; i++) {
      expect(PAID_PLANS[i].sourceRetentionDays).toBeGreaterThan(PAID_PLANS[i - 1].sourceRetentionDays);
    }
    expect(PLANS.studio.renderRetentionDays).toBeNull();
  });

  it('dates the deletion from the upload, not from now', () => {
    const uploaded = new Date('2026-01-01T00:00:00Z');
    expect(sourceExpiresAt(PLANS.starter, uploaded).toISOString()).toBe('2026-01-08T00:00:00.000Z');
    expect(renderExpiresAt(PLANS.starter, uploaded)?.toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });

  it('never expires a Studio render', () => {
    expect(renderExpiresAt(PLANS.studio, new Date())).toBeNull();
  });

  it('closes the editor when the footage is gone, not the video', () => {
    const uploaded = new Date('2026-01-01T00:00:00Z');
    expect(canReEdit(PLANS.starter, uploaded, new Date('2026-01-05T00:00:00Z'))).toBe(true);
    expect(canReEdit(PLANS.starter, uploaded, new Date('2026-01-09T00:00:00Z'))).toBe(false);
    // Studio gets three months of it.
    expect(canReEdit(PLANS.studio, uploaded, new Date('2026-03-01T00:00:00Z'))).toBe(true);
  });
});

describe('getPlan', () => {
  it('treats an unknown or missing plan as free rather than throwing', () => {
    // A null column on a row written before plans existed must not 500 the app.
    expect(getPlan(null).id).toBe('free');
    expect(getPlan(undefined).id).toBe('free');
    expect(getPlan('enterprise-platinum').id).toBe('free');
  });

  it('and never accidentally grants a paid plan', () => {
    expect(getPlan('').priceUsd).toBe(0);
    expect(getPlan('STARTER').priceUsd).toBe(0);
  });
});
