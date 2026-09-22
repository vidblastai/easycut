'use client';

import { useState } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import {
  BILLING_INTERVALS,
  ANNUAL_DISCOUNT,
  PAID_PLANS,
  annualTotal,
  priceFor,
  usd,
  videosFor,
  type BillingInterval,
  type Plan,
  type PlanId,
} from '@/lib/billing/plans';
import { IconCheck } from '@/components/shell/Icons';
import { PlanButton } from '@/components/marketing/PlanButton';

/**
 * The three cards, and the switch between paying by the month and by the year.
 *
 * The interval is client state because it is a way of LOOKING at one price
 * list, not a different page: flipping it must not cost a round trip or lose
 * the reader's place on a long homepage.
 *
 * What it can charge is a server fact, so it arrives as a prop. The prices on
 * the cards are read off `plans.ts` and are true whether or not Stripe is set
 * up; the button is the part that has to know better, and it says so rather
 * than opening a checkout at the wrong interval.
 */

/** Which intervals this deployment can actually take money at, per plan. */
export type Buyable = Record<string, { monthly: boolean; annual: boolean }>;

export function PricingPlans({
  buyable,
  currentPlan,
  className,
}: {
  buyable: Buyable;
  currentPlan?: string | null;
  className?: string;
}) {
  const [interval, setInterval] = useState<BillingInterval>('monthly');

  return (
    <div className={className}>
      <div className="flex justify-center">
        <div
          role="tablist"
          aria-label="Billing period"
          className="inline-flex gap-0.5 rounded-full border border-line bg-charcoal p-1"
        >
          {BILLING_INTERVALS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={interval === option}
              onClick={() => setInterval(option)}
              className={clsx(
                'inline-flex items-center gap-2 rounded-full px-[18px] py-[10px] text-[13.5px] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet',
                interval === option ? 'bg-chalk text-ink' : 'text-muted hover:text-chalk',
              )}
            >
              {option === 'annual' ? 'Annual' : 'Monthly'}
              {option === 'annual' ? (
                <span
                  className={clsx(
                    'rounded-full px-1.5 py-0.5 text-[10.5px] font-bold tracking-wide',
                    interval === 'annual' ? 'bg-violet text-ink' : 'bg-violet-dim text-violet',
                  )}
                >
                  Save {ANNUAL_DISCOUNT * 100}%
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-7 grid gap-4 lg:grid-cols-3">
        {PAID_PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            interval={interval}
            featured={plan.id === 'creator'}
            current={currentPlan === plan.id}
            buyable={buyable[plan.id]?.[interval] ?? false}
            // Told apart from "no Stripe at all", because they need different
            // sentences: one is a beta, the other is a missing annual price.
            monthlyOnly={
              interval === 'annual' &&
              !(buyable[plan.id]?.annual ?? false) &&
              (buyable[plan.id]?.monthly ?? false)
            }
          />
        ))}
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  interval,
  featured,
  current,
  buyable,
  monthlyOnly,
}: {
  plan: Plan;
  interval: BillingInterval;
  featured: boolean;
  current?: boolean;
  buyable: boolean;
  monthlyOnly: boolean;
}) {
  const { shorts, long } = videosFor(plan);
  const hours = plan.footageMinutes / 60;
  const annual = interval === 'annual';

  return (
    <div
      className={clsx(
        'flex h-full flex-col rounded-2xl border p-6 text-left',
        current
          ? 'border-ok bg-charcoal'
          : featured
            ? 'border-violet bg-violet-dim'
            : 'border-line bg-charcoal',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[17px] font-bold">{plan.name}</h3>
        {current ? (
          <span className="rounded-full bg-ok px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider text-ink">
            Your plan
          </span>
        ) : featured ? (
          <span className="rounded-full bg-violet px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider text-ink">
            Most popular
          </span>
        ) : null}
      </div>

      {/* The big figure is per month either way, because that is the number the
          three plans are being compared on. What is actually charged goes on
          the line below, where it cannot be mistaken for the monthly one. */}
      <p className="mt-3 flex items-baseline gap-1.5">
        <span className="text-[34px] font-extrabold leading-none tracking-[-.04em]">
          {usd(priceFor(plan, interval))}
        </span>
        <span className="text-[13.5px] text-muted">/ month</span>
        {annual ? (
          <span className="text-[13.5px] text-faint line-through">{usd(plan.priceUsd)}</span>
        ) : null}
      </p>
      {/* Reserved whether or not it says anything, so flipping the toggle does
          not shuffle three cards' buttons up and down. */}
      <p className={clsx('mt-1.5 min-h-[18px] text-[12.5px]', annual ? 'text-violet' : 'text-faint')}>
        {annual ? `${usd(annualTotal(plan))} billed once a year` : 'Billed monthly. Cancel any time.'}
      </p>

      <p className="mt-2 text-[13.5px] text-muted">{plan.bestFor}</p>

      {/* The allowance, in both units — the one we meter and the one they count. */}
      <div className="mt-5 rounded-xl border border-line/70 bg-ink/40 px-4 py-3.5">
        <p className="text-[15px] font-bold">
          {hours % 1 === 0 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${plan.footageMinutes} minutes`} of
          footage a month
        </p>
        <p className="mt-1 text-[12.5px] leading-snug text-muted">
          About {long} long-form video{long === 1 ? '' : 's'}, or {shorts} shorts
        </p>
      </div>

      <ul className="mt-5 flex-1 space-y-2.5">
        <Feature>
          Footage kept <strong className="font-semibold text-chalk">{plan.sourceRetentionDays} days</strong> —
          re-cut it as often as you like until then
        </Feature>
        <Feature>
          Finished videos kept{' '}
          <strong className="font-semibold text-chalk">
            {plan.renderRetentionDays === null ? 'for as long as you subscribe' : `${plan.renderRetentionDays} days`}
          </strong>
        </Feature>
        <Feature>Up to {plan.maxMinutesPerUpload} minutes in a single upload</Feature>
        <Feature>
          {plan.maxRenderHeight === 2160 ? '4K' : '1080p'} export, in the shape you shot in —
          vertical or widescreen
        </Feature>
        <Feature>
          {plan.concurrentJobs === 1 ? 'One video at a time' : `${plan.concurrentJobs} videos at once`}
          {plan.priorityQueue ? ', and first in the queue' : ''}
        </Feature>
        {plan.watermark ? null : <Feature>No watermark</Feature>}
      </ul>

      {current ? (
        <Link href="/settings" className="btn-ghost mt-6 w-full justify-center">
          Manage your plan
        </Link>
      ) : (
        <>
          <PlanButton
            plan={plan.id as PlanId}
            interval={interval}
            label={buyable ? `Get ${plan.name}` : `Start with ${plan.name}`}
            featured={featured}
            buyable={buyable}
            className="mt-6"
          />
          {monthlyOnly ? (
            <p className="mt-2 text-[12px] leading-snug text-warn">
              Paying by the year is not switched on yet — this plan can be bought monthly today.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-[13.5px] leading-snug text-muted">
      <IconCheck className="mt-0.5 h-3.5 w-3.5 flex-none text-violet" />
      <span>{children}</span>
    </li>
  );
}
