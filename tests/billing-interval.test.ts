import { describe, expect, it } from 'vitest';

/**
 * Two Stripe Prices, one plan.
 *
 * Monthly and annual are separate Prices on the same Product, and the webhook
 * that arrives months later carries a price id, not a plan. If `planForPrice`
 * only knows the monthly ids, every annual subscriber's first renewal event
 * looks like "unknown price" — and the two bugs that follow are the expensive
 * kind: an account silently dropped to free, or a card that said "annual"
 * opening a checkout that bills monthly.
 *
 * The environment is set before the module under test is imported, because
 * `src/lib/config/env.ts` reads process.env once at module load.
 */
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.CLERK_SECRET_KEY = 'sk_test_clerk';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_clerk';
process.env.STRIPE_PRICE_STARTER = 'price_starter_m';
process.env.STRIPE_PRICE_CREATOR = 'price_creator_m';
process.env.STRIPE_PRICE_STUDIO = 'price_studio_m';
process.env.STRIPE_PRICE_CREATOR_ANNUAL = 'price_creator_y';

const { annualAvailable, canBuy, planForPrice, priceIdFor } = await import('@/lib/billing/stripe');

describe('monthly and annual prices', () => {
  it('hands back the price for the interval asked for', () => {
    expect(priceIdFor('creator')).toBe('price_creator_m');
    expect(priceIdFor('creator', 'monthly')).toBe('price_creator_m');
    expect(priceIdFor('creator', 'annual')).toBe('price_creator_y');
  });

  it('does not fall back to the other interval', () => {
    // Starter has no annual price here. Returning the monthly one would charge
    // somebody every month on a card that said they were buying a year.
    expect(priceIdFor('starter', 'annual')).toBeUndefined();
  });

  it('maps either interval back to the same plan', () => {
    expect(planForPrice('price_creator_m')).toBe('creator');
    expect(planForPrice('price_creator_y')).toBe('creator');
  });

  it('leaves an unrecognised price alone rather than guessing', () => {
    expect(planForPrice('price_from_some_other_account')).toBeNull();
    expect(planForPrice(null)).toBeNull();
  });

  it('only offers to sell an interval it has a price for', () => {
    expect(canBuy('creator', 'annual')).toBe(true);
    expect(canBuy('starter', 'annual')).toBe(false);
    expect(canBuy('starter', 'monthly')).toBe(true);
  });

  it('does not claim annual is available while one plan is missing it', () => {
    // Starter and Studio have no annual price in this environment, so the
    // toggle has to tell the truth on those cards.
    expect(annualAvailable()).toBe(false);
  });
});
