import Link from 'next/link';
import { PAID_PLANS, PLANS } from '@/lib/billing/plans';
import { PricingPlans, type Buyable } from '@/components/marketing/PricingPlans';
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
        <div className="mx-auto max-w-[46ch] text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-charcoal px-3.5 py-1.5 text-[12px] font-semibold text-muted">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-violet" />
            Pricing
          </span>
          <h2 className="mt-4 text-balance text-3xl font-extrabold leading-[1.05] tracking-[-.04em] sm:text-[42px]">
            Three plans. Each one is cheaper than one edit.
          </h2>
          <p className="mx-auto mt-4 max-w-[54ch] text-[15px] leading-relaxed text-muted">
            Every plan does the whole edit — cuts, captions, B-roll, graphics, sound effects, music,
            punch-ins. What changes is how much footage you can put through it each month, and how
            long we hold on to it.
          </p>
        </div>
      ) : null}

      <PricingPlans buyable={buyableByPlan()} currentPlan={currentPlan} className={heading ? 'mt-8' : undefined} />

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

/**
 * Which plans can actually take money, and at which interval.
 *
 * Read on the server because it depends on the Stripe keys, and passed down as
 * plain data: the toggle is a client component and must not import anything
 * that reaches for a secret.
 */
function buyableByPlan(): Buyable {
  return Object.fromEntries(
    PAID_PLANS.map((plan) => [
      plan.id,
      { monthly: canBuy(plan.id, 'monthly'), annual: canBuy(plan.id, 'annual') },
    ]),
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
