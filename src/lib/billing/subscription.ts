import type Stripe from 'stripe';
import { db } from '@/lib/db';
import { PLAN_IDS, type PlanId } from './plans';
import { planForPrice, stripe } from './stripe';

/**
 * Turning a Stripe subscription into a row in our database.
 *
 * One function does the writing — `applySubscription` — and every webhook goes
 * through it, so there is exactly one place that decides what plan somebody is
 * on. The three things it has to get right are all failure modes that only show
 * up in production:
 *
 *   1. **Events arrive out of order.** Stripe delivers at least once and makes
 *      no ordering promise, so an upgrade and the `updated` event that follows
 *      it can land the wrong way round. Every write carries the event's own
 *      Stripe timestamp and an older one is dropped, which is the difference
 *      between "they upgraded" and "they upgraded and then mysteriously did
 *      not".
 *
 *   2. **`past_due` is not `canceled`.** A card that failed this morning is a
 *      customer whose payment will probably retry successfully this week.
 *      Cutting their account off at the first decline loses the customer AND
 *      the money. They keep the plan; Stripe keeps dunning; if it finally
 *      cancels, the cancel event takes the plan away.
 *
 *   3. **An unknown price means leave it alone.** A legacy price, or one
 *      created in the dashboard and never added to the environment, must not
 *      silently downgrade somebody to free. It is logged and ignored.
 */

/** What a Stripe status means for access, given the plan that was bought. */
export function planForStatus(status: Stripe.Subscription.Status, bought: PlanId): PlanId {
  switch (status) {
    case 'active':
    case 'trialing':
    // Still theirs: Stripe is retrying the card, and losing their videos on
    // the day a card expires is how a recoverable failure becomes a churn.
    case 'past_due':
      return bought;
    default:
      // canceled, unpaid, incomplete, incomplete_expired, paused
      return 'free';
  }
}

/** The subscription's first price id, which is the one that names the plan. */
function priceOf(sub: Stripe.Subscription): string | null {
  return sub.items?.data?.[0]?.price?.id ?? null;
}

/**
 * Stripe puts the period end on the subscription ITEM in recent API versions
 * and on the subscription itself in older ones. Read both so the renewal date
 * does not quietly become null after an API version bump.
 */
function periodEnd(sub: Stripe.Subscription): Date | null {
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  const raw = item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof raw === 'number' ? new Date(raw * 1000) : null;
}

export interface Applied {
  userId: string;
  plan: PlanId;
  /** False when the event was older than what the row already had. */
  written: boolean;
}

/**
 * Write a subscription's current state onto the account it belongs to.
 *
 * `eventAt` is the Stripe event's own `created` time, NOT the moment we
 * received it — see (1) above.
 */
export async function applySubscription(sub: Stripe.Subscription, eventAt: Date): Promise<Applied | null> {
  const user = await findUser(sub);
  if (!user) {
    console.warn('[billing] subscription for an account we do not have', sub.id);
    return null;
  }

  const bought = planForPrice(priceOf(sub));
  if (!bought) {
    console.warn('[billing] unrecognised price on subscription — leaving the plan alone', sub.id, priceOf(sub));
    return null;
  }

  // An event we have already been overtaken by. Reported, not thrown: Stripe
  // retries anything that is not a 2xx, and this one is correctly handled.
  if (user.planUpdatedAt && user.planUpdatedAt > eventAt) {
    return { userId: user.id, plan: user.plan as PlanId, written: false };
  }

  const plan = planForStatus(sub.status, bought);

  await db.user.update({
    where: { id: user.id },
    data: {
      plan,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      planStatus: sub.status,
      planRenewsAt: periodEnd(sub),
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      planUpdatedAt: eventAt,
    },
  });

  return { userId: user.id, plan, written: true };
}

/**
 * Whose subscription this is.
 *
 * Checkout writes our user id into the subscription's metadata, which is the
 * reliable link: the customer id is only on our row once a webhook has told us
 * about it, and the very first `checkout.session.completed` is exactly the
 * event where it has not yet. Falls back to the customer id for every
 * subsequent event and for subscriptions created in the Stripe dashboard.
 */
async function findUser(sub: Stripe.Subscription) {
  const fromMeta = sub.metadata?.userId;
  if (fromMeta) {
    const row = await db.user.findUnique({ where: { id: fromMeta } });
    if (row) return row;
  }
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customerId) return null;
  return db.user.findUnique({ where: { stripeCustomerId: customerId } });
}

/**
 * The Stripe customer for this account, made on first need.
 *
 * Created lazily rather than at sign-up: most people who make an account never
 * reach checkout, and a Stripe customer per curious visitor is clutter in the
 * dashboard that somebody eventually has to reconcile.
 */
export async function customerFor(userId: string): Promise<string | null> {
  const api = stripe();
  if (!api) return null;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true, email: true, name: true },
  });
  if (!user) return null;
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await api.customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId },
  });

  await db.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

/** A plan id from an untrusted string, or null. */
export function readPlanId(value: unknown): PlanId | null {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value)
    ? (value as PlanId)
    : null;
}
