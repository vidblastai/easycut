import Link from 'next/link';
import { clsx } from 'clsx';
import { PAID_PLANS, PLANS, videosFor, type Plan } from '@/lib/billing/plans';
import { IconCheck } from '@/components/shell/Icons';
import { PlanButton } from '@/components/marketing/PlanButton';
import { canBuy } from '@/lib/billing/stripe';

/**
 * The plans, as a section rather than a page.
 *
 * It lives here because it belongs in two places: on the homepage, where
 * somebody deciding whether this is for them needs to see the price without
 * hunting for it, and on /pricing, where somebody who has already decided goes
 * to compare. One component, so the two can never drift into quoting different
 * numbers at the same person.
 *
 * Every figure comes from `src/lib/billing/plans.ts` — the file the API meters
 * against and the sweeper deletes by — so a price change is one edit and the
 * page cannot end up promising something the software will not do.
 */

export function PricingSection({
  heading = true,
  className,
  currentPlan,
}: {
  /** The homepage supplies its own section heading; /pricing uses this one. */
  heading?: boolean;
  className?: string;
  /** The signed-in visitor's plan, so their own card says so. */
  currentPlan?: string | null;
}) {
  return (
    <div className={className}>
      {heading ? (
        <div className="mx-auto max-w-[54ch] text-center">
          <h2 className="text-3xl font-extrabold tracking-[-.035em] sm:text-[38px]">
            Pay for footage, not for features.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">
            Every plan does the whole edit — cuts, captions, B-roll, graphics, sound effects, music,
            punch-ins. What changes is how much footage you can put through it each month, and how
            long we hold on to it.
          </p>
        </div>
      ) : null}

      <div className={clsx('grid gap-4 lg:grid-cols-3', heading && 'mt-10')}>
        {PAID_PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            featured={plan.id === 'creator'}
            current={currentPlan === plan.id}
          />
        ))}
      </div>

      {/* The free tier is a way in, not a fourth column competing with three. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-line bg-charcoal px-5 py-4">
        <p className="text-[14px] font-semibold">
          Or try it first — {PLANS.free.footageMinutes} minutes, free.
        </p>
        <p className="min-w-0 flex-1 text-[13px] text-muted">
          One video on your own footage, watermarked, so you can see what it does before you decide.
        </p>
        <Link href="/new" className="btn-ghost flex-none">
          Start free
        </Link>
      </div>
    </div>
  );
}

function PlanCard({ plan, featured, current }: { plan: Plan; featured: boolean; current?: boolean }) {
  const { shorts, long } = videosFor(plan);
  const hours = plan.footageMinutes / 60;

  /*
   * Whether this card can actually take money — a Stripe key, a price for THIS
   * plan, and accounts to attach the subscription to. When any of the three is
   * missing the card keeps its call to action and sends people to start a
   * video instead, which is the right thing during a free beta.
   */
  const buyable = canBuy(plan.id);

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

      <p className="mt-3 flex items-baseline gap-1.5">
        <span className="text-[34px] font-extrabold leading-none tracking-[-.04em]">
          ${plan.priceUsd % 1 === 0 ? plan.priceUsd : plan.priceUsd.toFixed(2)}
        </span>
        <span className="text-[13.5px] text-muted">/ month</span>
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
          {plan.maxRenderHeight === 2160 ? '4K' : '1080p'} export, and every aspect ratio from one
          edit — vertical, square and widescreen
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
        <PlanButton
          plan={plan.id}
          label={buyable ? `Get ${plan.name}` : `Start with ${plan.name}`}
          featured={featured}
          buyable={buyable}
          className="mt-6"
        />
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

/**
 * The two questions the pricing table provokes, answered before they are asked.
 *
 * Both are about the unit. Somebody who works out for themselves that a plan is
 * metered in minutes — after being refused — feels tricked; somebody who read it
 * here feels informed, and it is the same fact either way.
 */
export function PricingExplainer() {
  return (
    <section className="grid gap-8 sm:grid-cols-2">
      <div>
        <h3 className="text-[15px] font-bold">Why minutes, and not videos?</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Almost everything a video costs us scales with how much footage went in, not with how many
          clips came out. A plan sold as &ldquo;three videos&rdquo; would have to either refuse your
          hour-long podcast or lose money on it — so the meter is minutes, and the number of videos
          is what that buys. The counts are deliberately cautious: ten minutes of footage per short,
          twenty per long-form. Film tighter than that and you get more.
        </p>
      </div>
      <div>
        <h3 className="text-[15px] font-bold">Why is my footage deleted before my video?</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Your original file is roughly twenty times the size of the finished video, and once the
          edit exists the only thing it is needed for is re-cutting. So we hold it for the window
          your plan buys — long enough to change your mind — and keep the finished video far longer.
          After the footage goes you can still watch and download what you made; you just cannot
          re-render it.{' '}
          <Link href="/privacy" className="font-semibold text-violet hover:underline">
            The full schedule is in the privacy policy.
          </Link>
        </p>
      </div>
    </section>
  );
}
