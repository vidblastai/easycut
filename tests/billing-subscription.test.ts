import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Turning Stripe events into what somebody is allowed to do.
 *
 * This is the code path where being wrong costs real money in both directions
 * — a free Studio plan one way, a locked-out paying customer the other — and
 * every case below is one that only shows up in production: events that arrive
 * in the wrong order, a card that failed this morning, a price nobody
 * configured.
 *
 * Against a throwaway database, with hand-built event objects rather than the
 * Stripe SDK: what is under test is our reaction to an event, not Stripe's
 * ability to produce one.
 */
const dir = mkdtempSync(join(tmpdir(), 'easycut-billing-'));
const url = `file:${join(dir, 'billing-test.db')}`;

process.env.DATABASE_URL = url;
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fake';
process.env.STRIPE_PRICE_STARTER = 'price_starter';
process.env.STRIPE_PRICE_CREATOR = 'price_creator';
process.env.STRIPE_PRICE_STUDIO = 'price_studio';

execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
  env: { ...process.env, DATABASE_URL: url },
  stdio: 'ignore',
});

const db = new PrismaClient({ datasources: { db: { url } } });
const { applySubscription, planForStatus } = await import('../src/lib/billing/subscription');
const { planForPrice, priceIdFor, purchasablePlans, billingBlocker, billingEnabled, canBuy } =
  await import('../src/lib/billing/stripe');

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const T0 = new Date('2026-03-01T12:00:00Z');
const later = (mins: number) => new Date(T0.getTime() + mins * 60_000);

/** A subscription, shaped the way the webhook hands one over. */
function subscription(over: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    cancel_at_period_end: false,
    metadata: { userId: 'user_1' },
    items: {
      data: [{ price: { id: 'price_starter' }, current_period_end: Math.floor(later(30 * 24 * 60).getTime() / 1000) }],
    },
    ...over,
  } as never;
}

async function seedUser(over: Record<string, unknown> = {}) {
  await db.user.deleteMany();
  return db.user.create({
    data: { id: 'user_1', email: 'someone@example.com', plan: 'free', ...over },
  });
}

const planOf = async () =>
  (await db.user.findUnique({ where: { id: 'user_1' } }))!;

beforeEach(async () => {
  await seedUser();
});

describe('which plan a price names', () => {
  it('maps each configured price to its plan', () => {
    expect(planForPrice('price_starter')).toBe('starter');
    expect(planForPrice('price_creator')).toBe('creator');
    expect(planForPrice('price_studio')).toBe('studio');
  });

  it('refuses to guess at anything else', () => {
    expect(planForPrice('price_from_last_year')).toBeNull();
    expect(planForPrice(null)).toBeNull();
    expect(planForPrice(undefined)).toBeNull();
    expect(planForPrice('')).toBeNull();
  });

  it('never sells the free tier', () => {
    expect(priceIdFor('free')).toBeUndefined();
    expect(purchasablePlans().some((p) => p.id === 'free')).toBe(false);
  });

  it('says nothing is blocking when everything is set', () => {
    process.env.CLERK_SECRET_KEY = 'sk_clerk_fake';
    expect(billingEnabled()).toBe(true);
    expect(billingBlocker()).toBeNull();
    delete process.env.CLERK_SECRET_KEY;
  });

  /*
   * A subscription has to belong to somebody. Found by running the app with
   * Stripe keys and no Clerk keys: the buttons rendered, the route answered
   * "sign in first", and there was no sign-in page to go to.
   */
  describe('without accounts configured', () => {
    it('will not offer a checkout that cannot complete', () => {
      delete process.env.CLERK_SECRET_KEY;
      expect(canBuy('starter')).toBe(false);
    });

    it('offers one as soon as accounts exist', () => {
      process.env.CLERK_SECRET_KEY = 'sk_clerk_fake';
      expect(canBuy('starter')).toBe(true);
      delete process.env.CLERK_SECRET_KEY;
    });

    it('names the missing half rather than blaming Stripe', () => {
      delete process.env.CLERK_SECRET_KEY;
      expect(billingBlocker()).toMatch(/CLERK_SECRET_KEY/);
    });

    it('never claims a plan is purchasable without a price', () => {
      // The environment is read once at boot, so this cannot be tested by
      // deleting a variable here — but the free tier has no price by
      // construction, which is the same branch.
      process.env.CLERK_SECRET_KEY = 'sk_clerk_fake';
      expect(canBuy('free')).toBe(false);
      expect(canBuy('starter')).toBe(true);
      delete process.env.CLERK_SECRET_KEY;
    });
  });
});

describe('what a subscription status means for access', () => {
  it('gives the plan to anybody Stripe considers current', () => {
    expect(planForStatus('active', 'creator')).toBe('creator');
    expect(planForStatus('trialing', 'creator')).toBe('creator');
  });

  it('does NOT cut off a card that failed this morning', () => {
    // Stripe duns a past_due subscription for days and usually collects.
    // Taking the account away on the first decline loses the customer and the
    // money — the cancellation event is what takes the plan away.
    expect(planForStatus('past_due', 'studio')).toBe('studio');
  });

  it('drops to free once it is actually over', () => {
    expect(planForStatus('canceled', 'studio')).toBe('free');
    expect(planForStatus('unpaid', 'studio')).toBe('free');
    expect(planForStatus('incomplete_expired', 'starter')).toBe('free');
  });
});

describe('applying one to an account', () => {
  it('upgrades, and records enough to describe the subscription', async () => {
    const applied = await applySubscription(subscription(), T0);
    expect(applied).toMatchObject({ userId: 'user_1', plan: 'starter', written: true });

    const row = await planOf();
    expect(row.plan).toBe('starter');
    expect(row.stripeSubscriptionId).toBe('sub_1');
    expect(row.stripeCustomerId).toBe('cus_1');
    expect(row.planStatus).toBe('active');
    expect(row.cancelAtPeriodEnd).toBe(false);
    expect(row.planRenewsAt).toBeInstanceOf(Date);
  });

  it('finds the account by customer id once the first event has linked it', async () => {
    await seedUser({ stripeCustomerId: 'cus_1' });
    // No metadata at all — a subscription created in the Stripe dashboard.
    const applied = await applySubscription(subscription({ metadata: {} }), T0);
    expect(applied?.plan).toBe('starter');
  });

  it('leaves an account it cannot identify alone', async () => {
    const applied = await applySubscription(
      subscription({ metadata: {}, customer: 'cus_nobody' }),
      T0,
    );
    expect(applied).toBeNull();
    expect((await planOf()).plan).toBe('free');
  });

  it('leaves the plan alone when the price is not one of ours', async () => {
    // A legacy price, or one created in the dashboard. Downgrading to free
    // here would take a paying customer's account away over a config gap.
    await seedUser({ plan: 'creator' });
    const applied = await applySubscription(
      subscription({ items: { data: [{ price: { id: 'price_mystery' } }] } }),
      T0,
    );
    expect(applied).toBeNull();
    expect((await planOf()).plan).toBe('creator');
  });

  it('ignores an event older than the state it already has', async () => {
    // Stripe delivers at least once and in no particular order. Without this,
    // an upgrade followed by its own `updated` event can land backwards.
    await applySubscription(subscription({ items: { data: [{ price: { id: 'price_studio' } }] } }), later(10));
    expect((await planOf()).plan).toBe('studio');

    const stale = await applySubscription(subscription(), T0);
    expect(stale).toMatchObject({ written: false });
    expect((await planOf()).plan).toBe('studio');
  });

  it('applies an event newer than the state it has', async () => {
    await applySubscription(subscription(), T0);
    await applySubscription(
      subscription({ items: { data: [{ price: { id: 'price_studio' } }] } }),
      later(10),
    );
    expect((await planOf()).plan).toBe('studio');
  });

  it('keeps the plan through a failed payment, and says so', async () => {
    await applySubscription(subscription(), T0);
    await applySubscription(subscription({ status: 'past_due' }), later(5));
    const row = await planOf();
    expect(row.plan).toBe('starter');
    expect(row.planStatus).toBe('past_due');
  });

  it('takes it away when the subscription actually ends', async () => {
    await applySubscription(subscription(), T0);
    await applySubscription(subscription({ status: 'canceled' }), later(5));
    expect((await planOf()).plan).toBe('free');
  });

  it('flags a cancellation that has not taken effect yet without removing access', async () => {
    await applySubscription(subscription({ cancel_at_period_end: true }), T0);
    const row = await planOf();
    // They paid for this month. They keep this month.
    expect(row.plan).toBe('starter');
    expect(row.cancelAtPeriodEnd).toBe(true);
  });

  it('reads the period end from the subscription itself when the item has none', async () => {
    const end = Math.floor(later(60 * 24 * 30).getTime() / 1000);
    await applySubscription(
      subscription({ items: { data: [{ price: { id: 'price_starter' } }] }, current_period_end: end }),
      T0,
    );
    expect((await planOf()).planRenewsAt?.getTime()).toBe(end * 1000);
  });
});
