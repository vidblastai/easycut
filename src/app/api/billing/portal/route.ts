import { NextResponse } from 'next/server';
import { ensureUser } from '@/lib/auth';
import { env } from '@/lib/config/env';
import { stripe } from '@/lib/billing/stripe';
import { customerFor } from '@/lib/billing/subscription';

export const runtime = 'nodejs';

/**
 * Send somebody to Stripe to change or cancel their own subscription.
 *
 * Deliberately not rebuilt in-app. Changing a card, seeing invoices, applying
 * tax and cancelling are all things Stripe's portal already does correctly in
 * every jurisdiction, and every one of them is a place where a home-made
 * version is worse and occasionally illegal.
 */
export async function POST() {
  const api = stripe();
  if (!api) return NextResponse.json({ error: 'Payments are not switched on yet.' }, { status: 503 });

  const userId = await ensureUser();
  if (!userId) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const customer = await customerFor(userId);
  if (!customer) return NextResponse.json({ error: 'No billing account yet.' }, { status: 400 });

  try {
    const session = await api.billingPortal.sessions.create({
      customer,
      return_url: `${env.appUrl}/settings`,
    });
    return NextResponse.json({ url: session.url });
  } catch (error) {
    // The commonest cause by far, and one the logs alone will not tell you:
    // the portal has to be configured once in the Stripe dashboard before it
    // will open for anybody.
    const message = error instanceof Error ? error.message : 'Stripe refused to open the billing portal.';
    console.error('[billing] portal', message);
    return NextResponse.json(
      { error: /configuration/i.test(message) ? 'The Stripe customer portal has not been set up yet — do it once at dashboard.stripe.com/settings/billing/portal.' : message },
      { status: 502 },
    );
  }
}
