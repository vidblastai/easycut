import Link from 'next/link';
import { clsx } from 'clsx';
import { db } from '@/lib/db';
import { currentUserId, isAuthEnabled } from '@/lib/auth';
import { formatMinutes, usageFor } from '@/lib/billing/usage';
import { PAID_PLANS, PLANS } from '@/lib/billing/plans';
import { billingBlocker, billingEnabled } from '@/lib/billing/stripe';
import { ManageButton } from './ManageButton';

/**
 * What you are on, what is left of it, and what happens next.
 *
 * Kept in one panel at the top of Settings rather than spread between a
 * sidebar meter and a pricing page, because the three questions people
 * actually have — "what am I paying?", "how much have I used?", "when does it
 * renew or stop?" — are one question in practice and answering two of them is
 * worse than answering none.
 *
 * The panel renders in all four states a deployment can be in: no accounts at
 * all (self-hosted), signed in with no payments configured (a free beta),
 * signed in on the free tier, and subscribed. Each says something true rather
 * than hiding.
 */

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export async function BillingPanel({ justPaid = false }: { justPaid?: boolean }) {
  /*
   * No accounts: there is no plan to be on, so there is no panel.
   *
   * With one exception, and it is the case this panel most needs to cover.
   * Stripe configured and accounts not is a deployment where every upgrade
   * button is inert, and the person who can fix it is the one reading this
   * page — so say it here rather than leaving a silent gap where the plan
   * should be. A clone with neither configured gets nothing, because nothing
   * is wrong with it.
   */
  if (!isAuthEnabled()) {
    const why = billingBlocker();
    return billingEnabled() && why ? <OperatorNote>{why}</OperatorNote> : null;
  }

  const userId = await currentUserId();
  if (!userId) return null;

  const [usage, row] = await Promise.all([
    usageFor(userId).catch(() => null),
    db.user
      .findUnique({
        where: { id: userId },
        select: { plan: true, planStatus: true, planRenewsAt: true, cancelAtPeriodEnd: true, stripeCustomerId: true },
      })
      .catch(() => null),
  ]);
  if (!usage) return null;

  const plan = usage.plan;
  const used = Math.min(1, plan.footageMinutes ? usage.minutesUsed / plan.footageMinutes : 0);
  const paying = plan.id !== 'free';
  const blocker = billingBlocker();

  return (
    <section className="mt-7 rounded-[14px] border border-line bg-charcoal p-5">
      {justPaid ? (
        <p className="mb-4 rounded-xl border border-ok/40 bg-ok/10 px-3.5 py-2.5 text-[13px] font-semibold text-chalk">
          You&rsquo;re on {plan.name}. The allowance below is live now — go and make something.
        </p>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">Your plan</p>
          <h2 className="mt-1 text-[22px] font-extrabold tracking-[-.03em]">
            {plan.name}
            {paying ? (
              <span className="ml-2 align-middle text-[13.5px] font-semibold text-muted">
                ${plan.priceUsd % 1 === 0 ? plan.priceUsd : plan.priceUsd.toFixed(2)} / month
              </span>
            ) : null}
          </h2>
          <p className="mt-1 text-[13px] text-muted">{renewal(row, plan.id !== 'free')}</p>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          {billingEnabled() && row?.stripeCustomerId ? <ManageButton /> : null}
          <Link href="/pricing" className={clsx(paying ? 'btn-ghost' : 'btn-primary')}>
            {paying ? 'Change plan' : 'See the plans'}
          </Link>
        </div>
      </div>

      {/* The meter. Same numbers the upload refusal quotes, so nobody is
          surprised by a refusal they could have seen coming. */}
      <div className="mt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
          <span className="font-semibold">
            {formatMinutes(usage.minutesUsed)} of {formatMinutes(plan.footageMinutes)} used
          </span>
          <span className="text-muted">
            {usage.minutesRemaining <= 0
              ? 'Nothing left this month'
              : `${formatMinutes(usage.minutesRemaining)} left`}{' '}
            · resets {DATE.format(usage.periodEnd)}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink">
          <div
            className={clsx('h-full rounded-full', used >= 1 ? 'bg-warn' : 'bg-violet')}
            style={{ width: `${Math.max(2, used * 100).toFixed(1)}%` }}
          />
        </div>
      </div>

      {/* What the operator needs to know, on the page where they would look. */}
      {blocker ? <OperatorNote className="mt-4">{blocker}</OperatorNote> : null}

      {!paying && !blocker ? (
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
          On the free tier your videos carry a watermark and your footage is deleted after{' '}
          {PLANS.free.sourceRetentionDays} days.{' '}
          <Link href="/pricing" className="font-semibold text-violet hover:underline">
            {PAID_PLANS[0].name} is ${PAID_PLANS[0].priceUsd} a month.
          </Link>
        </p>
      ) : null}
    </section>
  );
}

/**
 * What the person running this deployment needs to know, where they would look.
 *
 * Addressed to the operator rather than the customer — it names environment
 * variables — which is correct: Settings is a page about this installation,
 * and "the upgrade button does nothing" is the least debuggable bug a product
 * can have from the outside.
 */
function OperatorNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={clsx(
        'rounded-xl border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-chalk/90',
        className ?? 'mt-7',
      )}
    >
      <b className="font-bold">Payments are not live yet.</b> {children} Until then everyone stays on
      whatever plan their account says, and you can set one by hand. The plans themselves —
      allowances, retention, limits — are enforced either way.
    </p>
  );
}

/** One sentence about what happens at the end of the month. */
function renewal(
  row: { planStatus: string | null; planRenewsAt: Date | null; cancelAtPeriodEnd: boolean } | null,
  paying: boolean,
): string {
  if (!paying) return 'The free tier — no card, no renewal.';
  if (!row?.planRenewsAt) return 'Active.';
  const when = DATE.format(row.planRenewsAt);
  if (row.cancelAtPeriodEnd) return `Ends ${when}. You keep everything until then.`;
  if (row.planStatus === 'past_due') {
    return `We could not take payment. Stripe will try again — update your card to be safe. Renews ${when}.`;
  }
  if (row.planStatus === 'trialing') return `Free trial until ${when}.`;
  return `Renews ${when}.`;
}
