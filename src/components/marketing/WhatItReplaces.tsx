import Link from 'next/link';
import { PAID_PLANS, PLANS, SOURCE_MINUTES_PER_LONG, videosFor } from '@/lib/billing/plans';

/**
 * What this is instead of, as a table you can scan a row at a time.
 *
 * Three columns because there are three real options — do it yourself, pay
 * somebody, or this — and deliberately NOT a comparison against named
 * competitors: that is a table of claims about someone else's product that
 * goes stale silently and that we cannot check.
 *
 * Our column is generated from `plans.ts`, so the page cannot quote a price or
 * an allowance the software does not enforce. The other two columns are
 * labelled as what people report, because that is what they are.
 */

const STARTER = PAID_PLANS[0];

export function WhatItReplaces() {
  const { long } = videosFor(STARTER);
  const perVideo = STARTER.priceUsd / Math.max(1, long);

  const ROWS: Array<{ label: string; diy: string; hired: string; ours: string }> = [
    {
      label: 'Cost per month',
      diy: '$0 — and your evenings',
      hired: 'Per video, every video',
      ours: `From $${STARTER.priceUsd}`,
    },
    {
      label: 'Your time per video',
      diy: 'Hours on the timeline',
      hired: 'Briefs and revision notes',
      ours: 'One upload',
    },
    {
      label: 'Turnaround',
      diy: 'Whenever you get to it',
      hired: 'Somebody else’s calendar',
      ours: 'Minutes',
    },
    {
      label: 'Changing your mind',
      diy: 'Re-export everything',
      hired: 'Another round of notes',
      ours: 'Re-renders only what changed',
    },
    {
      label: 'Every aspect ratio',
      diy: 'One export per platform',
      hired: 'Usually charged as extra',
      ours: 'From the same edit',
    },
  ];

  return (
    <section className="relative z-10 border-t border-line bg-[#0B0B0E] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="max-w-3xl text-3xl font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
          The edit is the reason you post less than you meant to.
        </h2>
        <p className="mt-4 max-w-xl text-muted">
          Not the filming — filming takes ten minutes. Here is what the other part costs.
        </p>

        {/* A table, not three cards: the whole point is reading across a row.
            It scrolls sideways in its own box on a narrow screen rather than
            making the page do it. */}
        <div className="mt-10 -mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[46rem] border-collapse text-left">
            <thead>
              <tr>
                <th className="w-[22%] py-3 pr-4" />
                <th className="eyebrow w-[26%] py-3 pr-4 font-semibold">Edit it yourself</th>
                <th className="eyebrow w-[26%] py-3 pr-4 font-semibold">Hire an editor</th>
                <th className="w-[26%] rounded-t-2xl border border-b-0 border-violet bg-violet-dim px-5 py-3">
                  <span className="eyebrow font-bold text-violet">EasyCut</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr key={row.label} className="border-t border-line-soft">
                  <th scope="row" className="py-4 pr-4 align-top text-[13px] font-semibold text-faint">
                    {row.label}
                  </th>
                  <td className="py-4 pr-4 align-top text-[14.5px] text-muted">{row.diy}</td>
                  <td className="py-4 pr-4 align-top text-[14.5px] text-muted">{row.hired}</td>
                  <td
                    className={`border-x border-violet bg-violet-dim px-5 py-4 align-top text-[14.5px] font-semibold text-chalk ${
                      i === ROWS.length - 1 ? 'rounded-b-2xl border-b' : ''
                    }`}
                  >
                    {row.ours}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href="/new" className="btn-primary">
            Try it free
          </Link>
          <p className="text-[13px] text-muted">
            {PLANS.free.footageMinutes} minutes on your own footage, no card.
          </p>
        </div>

        <p className="mt-6 max-w-2xl text-[13px] leading-relaxed text-faint">
          About {long} long-form videos a month on {STARTER.name} — roughly ${perVideo.toFixed(2)}{' '}
          each — assuming {SOURCE_MINUTES_PER_LONG} minutes of footage per video, which is
          deliberately cautious. The first two columns describe what people report, not something
          we measured.
        </p>
      </div>
    </section>
  );
}
