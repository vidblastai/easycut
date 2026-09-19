import { NextResponse } from 'next/server';
import { ensureUser, isAuthEnabled } from '@/lib/auth';
import { env } from '@/lib/config/env';
import { getPlan } from '@/lib/billing/plans';
import { billingBlocker, priceIdFor, stripe } from '@/lib/billing/stripe';
import { customerFor, readPlanId } from '@/lib/billing/subscription';

export const runtime = 'nodejs';

/**
 * Start a checkout, and answer with somewhere to send the browser.
 *
 * Returns a URL rather than redirecting so the button can show its own failure
 * in place instead of navigating the customer to a blank page. Every refusal
 * below carries a sentence a person can act on — "upgrade doesn't work" with no
 * explanation is the worst possible bug to have on the one page that takes
 * money.
 */
export async function POST(request: Request) {
  const api = stripe();
  const blocker = billingBlocker();
  if (!api || blocker) {
    return NextResponse.json({ error: blocker ?? 'Payments are not switched on yet.' }, { status: 503 });
  }

  // Two different failures that look the same from here. "Sign in" is useless
  // advice on a deployment with no sign-in page, so the operator's problem is
  // reported as the operator's problem.
  if (!isAuthEnabled()) {
    return NextResponse.json(
      { error: 'Accounts are not configured on this deployment, so a subscription has nothing to belong to.' },
      { status: 503 },
    );
  }

  const userId = await ensureUser();
  if (!userId) {
    return NextResponse.json({ error: 'Sign in first, so the plan has an account to land on.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { plan?: unknown };
  const planId = readPlanId(body.plan);
  if (!planId || planId === 'free') {
    return NextResponse.json({ error: 'Pick one of the paid plans.' }, { status: 400 });
  }

  const price = priceIdFor(planId);
  if (!price) {
    return NextResponse.json(
      { error: `${getPlan(planId).name} has no Stripe price configured yet.` },
      { status: 503 },
    );
  }

  const customer = await customerFor(userId);
  if (!customer) {
    return NextResponse.json({ error: 'Could not reach Stripe. Try again in a moment.' }, { status: 502 });
  }

  const session = await api.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price, quantity: 1 }],
    // The id has to be ON THE SUBSCRIPTION, not only on the session: the
    // session is gone by the time `customer.subscription.updated` arrives
    // months later, and that event is how a renewal or a cancellation is heard.
    subscription_data: { metadata: { userId, plan: planId } },
    metadata: { userId, plan: planId },
    allow_promotion_codes: true,
    // `{CHECKOUT_SESSION_ID}` is substituted by Stripe. The landing page uses it
    // to tell "just paid" from "wandered onto this URL".
    success_url: `${env.appUrl}/settings?checkout=done&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.appUrl}/pricing?checkout=cancelled`,
  });

  if (!session.url) {
    return NextResponse.json({ error: 'Stripe did not return a checkout page.' }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
}
