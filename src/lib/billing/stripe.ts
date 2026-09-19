import Stripe from 'stripe';
import { env } from '@/lib/config/env';
import { isAuthEnabled } from '@/lib/auth';
import { PAID_PLANS, type PlanId } from './plans';

/**
 * Taking the money.
 *
 * Everything a subscription *does* — the allowance, the retention clocks, the
 * concurrency, the watermark — is enforced in `plans.ts` and `usage.ts` and
 * works with no Stripe account at all. This file is only the part that changes
 * `user.plan` from `free` to something else and takes payment for it.
 *
 * ── Why it degrades instead of throwing ──────────────────────────────────
 *
 * Same rule as every other provider in this codebase: with no keys the app
 * still runs, and the thing that needs a key says so plainly rather than
 * 500-ing. `billingEnabled()` is false, the upgrade buttons become a line of
 * text explaining that payment is not switched on yet, and everybody stays on
 * whatever plan their row says. That is also exactly the shape of a free beta:
 * set nobody's plan from Stripe, set it by hand, and the rest of the product
 * behaves identically.
 *
 * ── Why the price ids are environment, not code ──────────────────────────
 *
 * A price id is specific to one Stripe account and one mode. Hard-coding them
 * would mean test ids in the repo and a code change to go live. So the plan
 * definitions stay pure and the mapping lives next to the secret key.
 */

let client: Stripe | null = null;

export function billingEnabled(): boolean {
  return Boolean(env.stripe.secretKey);
}

/** The Stripe client, or null when billing is not configured. */
export function stripe(): Stripe | null {
  if (!billingEnabled()) return null;
  if (!client) {
    client = new Stripe(env.stripe.secretKey as string, {
      // Pinned deliberately. Stripe changes response shapes between versions,
      // and a library upgrade silently moving the account's API version is how
      // a webhook handler starts reading a field that is no longer there.
      apiVersion: '2025-08-27.basil',
      appInfo: { name: 'EasyCut', url: env.appUrl },
      // A checkout request that hangs should fail the button, not the page.
      timeout: 20_000,
      maxNetworkRetries: 2,
    });
  }
  return client;
}

/** The Stripe price for a plan, or undefined when that plan has no price set. */
export function priceIdFor(plan: PlanId): string | undefined {
  return env.stripe.prices[plan as keyof typeof env.stripe.prices];
}

/**
 * The plan a Stripe price belongs to.
 *
 * The webhook arrives carrying a price, not a plan, so this is the inverse of
 * `priceIdFor` and the reason both live in one file. An unrecognised price —
 * a legacy one, or a plan that has since been renamed — returns null, and the
 * caller leaves the account alone rather than guessing it down to `free`.
 */
export function planForPrice(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  for (const plan of PAID_PLANS) {
    if (priceIdFor(plan.id) === priceId) return plan.id;
  }
  return null;
}

/**
 * Whether a customer could get all the way through checkout on this
 * deployment, for one particular plan.
 *
 * Three things have to be true and the third is easy to forget: a subscription
 * has to belong to somebody, so a deployment with no accounts configured
 * cannot sell one. Without this check the button opens, the route answers
 * "sign in first", and there is no sign-in page to send them to.
 */
export function canBuy(planId: PlanId): boolean {
  return billingEnabled() && isAuthEnabled() && Boolean(priceIdFor(planId));
}

/** Plans that can actually be bought right now: priced, and with a price id. */
export function purchasablePlans() {
  return PAID_PLANS.filter((p) => Boolean(priceIdFor(p.id)));
}

/**
 * What is stopping a customer paying, in one line, or null when nothing is.
 *
 * Surfaced in Settings rather than only in logs: "the upgrade button does
 * nothing" is the single least debuggable failure a product can have, and the
 * person who can fix it is the one looking at that page.
 */
export function billingBlocker(): string | null {
  if (!env.stripe.secretKey) return 'STRIPE_SECRET_KEY is not set, so nothing can be charged yet.';
  if (!isAuthEnabled()) {
    return 'Stripe is configured but accounts are not (CLERK_SECRET_KEY), and a subscription has to belong to somebody. Nobody can subscribe until sign-in works.';
  }
  if (!env.stripe.webhookSecret) {
    return 'STRIPE_WEBHOOK_SECRET is not set. Checkout would work, but nothing would upgrade the account afterwards.';
  }
  const missing = PAID_PLANS.filter((p) => !priceIdFor(p.id)).map((p) => p.name);
  if (missing.length === PAID_PLANS.length) return 'No Stripe prices are configured, so no plan can be bought.';
  if (missing.length) return `No Stripe price for ${missing.join(' or ')}, so ${missing.length === 1 ? 'that plan' : 'those plans'} cannot be bought.`;
  return null;
}
