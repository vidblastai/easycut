import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { env } from '@/lib/config/env';
import { stripe } from '@/lib/billing/stripe';
import { applySubscription } from '@/lib/billing/subscription';
import { reportError } from '@/lib/errors/report';

export const runtime = 'nodejs';
// The signature is computed over the EXACT bytes Stripe sent. Anything that
// parses and re-serialises the body — a JSON body parser, a proxy that
// pretty-prints — breaks verification, so this route reads raw text and is
// excluded from the middleware in src/middleware.ts.
export const dynamic = 'force-dynamic';

/**
 * Stripe telling us what happened.
 *
 * This is the only thing that moves an account between plans, so it is the one
 * route where being wrong is expensive in both directions: fail open and
 * somebody gets Studio for nothing, fail closed and a paying customer is
 * locked out of the videos they paid for.
 *
 * Three rules it follows, in order of how much trouble each one saves:
 *
 *   1. **Verify the signature before reading anything.** The body is an
 *      unauthenticated POST from the internet; without verification, "give me
 *      the Studio plan" is a curl command anybody can write.
 *
 *   2. **Answer 200 for anything handled, including the ignorable.** Stripe
 *      retries non-2xx responses with backoff for three days. An event type we
 *      do not care about must not look like a failure, or the queue behind it
 *      backs up and the events we DO care about arrive late.
 *
 *   3. **Answer 500 when our own write failed.** That retry is the safety net
 *      that makes the whole thing eventually consistent.
 */

/** The events that change what somebody is allowed to do. */
const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

export async function POST(request: Request) {
  const api = stripe();
  if (!api || !env.stripe.webhookSecret) {
    return NextResponse.json({ error: 'Billing is not configured.' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'Unsigned.' }, { status: 400 });

  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = await api.webhooks.constructEventAsync(raw, signature, env.stripe.webhookSecret);
  } catch (error) {
    // 400, not 500: a bad signature is not something a retry will fix, and
    // telling Stripe to keep trying would only mask it.
    console.warn('[billing] rejected an unverifiable webhook:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Bad signature.' }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) return NextResponse.json({ ignored: event.type });

  // Stripe's own clock for this event — what keeps two events that crossed in
  // flight from writing each other's state. See src/lib/billing/subscription.ts.
  const at = new Date(event.created * 1000);

  try {
    const subscription = await subscriptionOf(api, event);
    if (!subscription) return NextResponse.json({ ignored: event.type, reason: 'no subscription' });

    const applied = await applySubscription(subscription, at);
    if (!applied) return NextResponse.json({ ignored: event.type, reason: 'unmatched' });

    console.log(`[billing] ${event.type}: ${applied.userId} → ${applied.plan}${applied.written ? '' : ' (stale, ignored)'}`);
    return NextResponse.json({ ok: true, plan: applied.plan });
  } catch (error) {
    /*
     * Worth waking up for. Stripe has taken the money by the time this event
     * arrives, so a failure here is a customer who has paid and not been
     * upgraded — and Stripe's own retries will replay it, which the
     * fingerprint folds into one alert rather than six.
     */
    await reportError(error, { where: 'billing.webhook', event: event.type, eventId: event.id });
    return NextResponse.json({ error: 'Could not apply.' }, { status: 500 });
  }
}

/**
 * The subscription an event is about.
 *
 * A checkout session carries only an id for it, and a one-off payment carries
 * none at all, so the session is expanded rather than assumed. The
 * `customer.subscription.*` events already hold the whole object.
 */
async function subscriptionOf(api: Stripe, event: Stripe.Event): Promise<Stripe.Subscription | null> {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const id = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!id) return null;
    const sub = await api.subscriptions.retrieve(id);
    // Checkout knows who this is; the subscription may not yet, if it was made
    // before `subscription_data.metadata` reached Stripe.
    if (!sub.metadata?.userId && session.metadata?.userId) {
      sub.metadata = { ...sub.metadata, userId: session.metadata.userId };
    }
    return sub;
  }
  return event.data.object as Stripe.Subscription;
}
