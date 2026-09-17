import Link from 'next/link';
import { clsx } from 'clsx';
import { PAID_PLANS, PLANS, videosFor, type Plan } from '@/lib/billing/plans';
import { IconCheck } from '@/components/shell/Icons';

export const metadata = {
  title: 'Pricing — EasyCut',
  description: 'Three plans, measured in minutes of footage rather than vague credits.',
};

/**
 * The pricing page.
 *
 * Every number on it comes from `src/lib/billing/plans.ts` — the same file the
 * API meters against and the sweeper deletes by. A page that hard-codes "3
 * videos" is a page that will one day disagree with the software, and the
 * customer will believe the page.
 *
 * The one piece of translation this page does is the honest one: we meter
 * MINUTES because that is what costs money, and we show VIDEOS because that is
 * what people count. Both are stated, so nobody discovers the unit at the point
 * of being refused.
 */
export default function PricingPage() {
  return (
    <main className="min-h-screen bg-ink px-5 py-12 sm:px-8">
      <div className="mx-auto max-w-[72rem]">
        <Link href="/" className="text-[13px] font-semibold text-violet hover:underline">
          ← EasyCut
        </Link>

        <header className="mt-6 max-w-[54ch]">
          <h1 className="text-[36px] font-extrabold leading-[1.1] tracking-[-.038em]">
            Pay for footage, not for features.
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            Every plan does the whole edit — cuts, captions, B-roll, graphics, sound effects, music,
            punch-ins. What changes is how much footage you can put through it each month, and how
            long we hold on to it.
          </p>
        </header>

        <div className="mt-9 grid gap-4 lg:grid-cols-3">
          {PAID_PLANS.map((plan) => (
            <PlanCard key={plan.id} plan={plan} featured={plan.id === 'creator'} />
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

        <Explainer />
      </div>
    </main>
  );
}

function PlanCard({ plan, featured }: { plan: Plan; featured: boolean }) {
  const { shorts, long } = videosFor(plan);
  const hours = plan.footageMinutes / 60;

  return (
    <div
      className={clsx(
        'flex h-full flex-col rounded-2xl border p-6',
        featured ? 'border-violet bg-violet-dim' : 'border-line bg-charcoal',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-bold">{plan.name}</h2>
        {featured ? (
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
        <Feature>
          Up to {plan.maxMinutesPerUpload} minutes in a single upload
        </Feature>
        <Feature>
          {plan.maxRenderHeight === 2160 ? '4K export' : '1080p export'}, every aspect ratio
        </Feature>
        <Feature>
          {plan.concurrentJobs === 1 ? 'One video at a time' : `${plan.concurrentJobs} videos at once`}
          {plan.priorityQueue ? ', and first in the queue' : ''}
        </Feature>
        {plan.watermark ? null : <Feature>No watermark</Feature>}
      </ul>

      <Link
        href="/new"
        className={clsx('mt-6 w-full justify-center', featured ? 'btn-primary' : 'btn-ghost')}
      >
        Start with {plan.name}
      </Link>
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
 * metered in minutes — after being refused — feels tricked; somebody who read
 * it here feels informed, and it is the same fact either way.
 */
function Explainer() {
  return (
    <section className="mt-12 grid gap-8 border-t border-line pt-9 sm:grid-cols-2">
      <div>
        <h3 className="text-[15px] font-bold">Why minutes, and not videos?</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Almost everything a video costs us scales with how much footage went in, not with how many
          clips came out. A plan sold as &ldquo;three videos&rdquo; would have to either refuse your
          hour-long podcast or lose money on it — so the meter is minutes, and the number of videos
          is simply what that buys. Twenty minutes of raw footage is a typical long-form edit; five
          is a typical short.
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
