import Link from 'next/link';
import { PricingExplainer, PricingSection } from '@/components/marketing/PricingSection';
import { SiteFooter } from '@/components/marketing/SiteFooter';

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
    <>
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
              Every plan does the whole edit — cuts, captions, B-roll, graphics, sound effects,
              music, punch-ins. What changes is how much footage you can put through it each month,
              and how long we hold on to it.
            </p>
          </header>

          <PricingSection heading={false} className="mt-9" />

          <div className="mt-12 border-t border-line pt-9">
            <PricingExplainer />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

