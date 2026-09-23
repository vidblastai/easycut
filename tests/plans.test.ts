import { describe, expect, it } from 'vitest';
import {
  COGS_PER_JOB_USD,
  COGS_PER_SOURCE_MINUTE_USD,
  PAID_PLANS,
  PLANS,
  annualMonthly,
  annualTotal,
  canReEdit,
  getPlan,
  planEconomics,
  renderExpiresAt,
  SOURCE_MINUTES_PER_SHORT,
  priceFor,
  sourceExpiresAt,
  usd,
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
    expect(shorts).toBe(6);
  });

  it('under-promises rather than over-promises', () => {
    // Being handed more than the page said is a good surprise; the reverse is
    // a refund. So the advertised count must be the pessimistic one.
    expect(SOURCE_MINUTES_PER_SHORT).toBeGreaterThanOrEqual(10);
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

/**
 * A plan is a set of promises. These check the software can keep each one.
 *
 * Written after finding two it could not: the pricing page advertised 4K
 * exports that no code path produced, and "first in the queue" on a queue with
 * no notion of priority. Both had been true-looking for weeks, because nothing
 * connected the claim on the page to the behaviour underneath.
 */
describe('every plan feature is one the software actually enforces', () => {
  it('never advertises a resolution the renderer cannot produce', async () => {
    const { ASPECT_DIMENSIONS } = await import('@/lib/edl/types');
    const { RENDER_QUALITIES, QUALITY_SCALE, QUALITY_SHORT_SIDE } = await import('@/lib/render/quality');

    /*
     * The compositions are laid out at a 1080 base and `renderMedia`'s `scale`
     * multiplies the output, so the resolutions that can actually come out are
     * exactly the base short side times each quality's scale. A plan may only
     * claim one of those.
     *
     * This test caught the original 4K lie — the page said 4K when nothing
     * scaled anything — so it is deliberately still phrased as "can the
     * renderer reach this number", not "is this number in a list".
     */
    const shortSide = Math.min(...Object.values(ASPECT_DIMENSIONS).map((d) => Math.min(d.width, d.height)));
    const reachable = RENDER_QUALITIES.map((q) => shortSide * QUALITY_SCALE[q]);

    for (const plan of [PLANS.free, ...PAID_PLANS]) {
      expect(reachable, `${plan.name} claims ${plan.maxRenderHeight}p`).toContain(plan.maxRenderHeight);
    }

    // And the quality table agrees with the compositions it multiplies.
    for (const quality of RENDER_QUALITIES) {
      expect(shortSide * QUALITY_SCALE[quality]).toBe(QUALITY_SHORT_SIDE[quality]);
    }
  });

  it('gives 4K only to the plans whose page says so', async () => {
    const { allowsQuality } = await import('@/lib/render/quality');
    const { entitlementsOf } = await import('@/lib/billing/entitlements');
    for (const plan of [PLANS.free, ...PAID_PLANS]) {
      const claimed = plan.maxRenderHeight >= 2160;
      // The entitlement the render route reads has to match the plan table the
      // pricing card is printed from, or somebody pays for a button that 403s.
      expect(allowsQuality(entitlementsOf(plan.id).maxHeight, '4k')).toBe(claimed);
    }
    expect(PLANS.free.maxRenderHeight).toBe(1080);
    expect(PLANS.starter.maxRenderHeight).toBe(1080);
    expect(PLANS.creator.maxRenderHeight).toBe(2160);
    expect(PLANS.studio.maxRenderHeight).toBe(2160);
  });

  it('turns a priority plan into a queue priority, and an ordinary one into none', async () => {
    const { entitlementsOf } = await import('@/lib/billing/entitlements');
    for (const plan of [PLANS.free, ...PAID_PLANS]) {
      expect(entitlementsOf(plan.id).priority > 0).toBe(plan.priorityQueue);
      expect(entitlementsOf(plan.id).watermark).toBe(plan.watermark);
    }
  });

  it('watermarks the free tier and nothing that was paid for', () => {
    expect(PLANS.free.watermark).toBe(true);
    for (const plan of PAID_PLANS) expect(plan.watermark).toBe(false);
  });

  it('gives every paid plan something the one below it does not have', () => {
    // A ladder where a rung adds nothing is a rung nobody climbs to.
    for (let i = 1; i < PAID_PLANS.length; i++) {
      const below = PAID_PLANS[i - 1];
      const above = PAID_PLANS[i];
      expect(above.priceUsd).toBeGreaterThan(below.priceUsd);
      expect(above.footageMinutes).toBeGreaterThan(below.footageMinutes);
      expect(above.maxMinutesPerUpload).toBeGreaterThan(below.maxMinutesPerUpload);
      expect(above.sourceRetentionDays).toBeGreaterThan(below.sourceRetentionDays);
      expect(above.concurrentJobs).toBeGreaterThan(below.concurrentJobs);
    }
  });
});

describe('paying by the year', () => {
  it('takes a fifth off, to the cent', () => {
    for (const plan of PAID_PLANS) {
      expect(annualMonthly(plan)).toBeCloseTo(plan.priceUsd * 0.8, 2);
      // Rounded to a real price, not a fraction of a cent.
      expect(Math.round(annualMonthly(plan) * 100)).toBe(annualMonthly(plan) * 100);
    }
  });

  it('charges exactly twelve of the monthly figure it printed', () => {
    // The two numbers sit on the same card. A total derived from the LIST
    // price instead of the rounded monthly one is out by a couple of cents on
    // Creator, and somebody does that multiplication.
    for (const plan of PAID_PLANS) {
      expect(annualTotal(plan)).toBeCloseTo(annualMonthly(plan) * 12, 2);
    }
  });

  it('is cheaper over a year than paying monthly, on every plan', () => {
    for (const plan of PAID_PLANS) {
      expect(annualTotal(plan)).toBeLessThan(plan.priceUsd * 12);
    }
  });

  it('shows the monthly figure for the interval on screen', () => {
    const creator = getPlan('creator');
    expect(priceFor(creator, 'monthly')).toBe(creator.priceUsd);
    expect(priceFor(creator, 'annual')).toBe(annualMonthly(creator));
  });

  it('formats money without trailing zeros, and groups thousands', () => {
    expect(usd(24)).toBe('$24');
    expect(usd(59.99)).toBe('$59.99');
    expect(usd(1824)).toBe('$1,824');
    expect(usd(719.88)).toBe('$719.88');
  });
});
