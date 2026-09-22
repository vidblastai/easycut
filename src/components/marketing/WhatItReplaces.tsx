import { PAID_PLANS, SOURCE_MINUTES_PER_LONG, videosFor } from '@/lib/billing/plans';

/**
 * What this is instead of, with the arithmetic shown.
 *
 * The comparison is against the two things people actually do — edit it
 * themselves, or pay somebody — rather than against named competitors. Partly
 * because that is the real decision, and partly because a table of claims
 * about somebody else's product is a table that goes out of date silently and
 * that we cannot check.
 *
 * Every figure on our own row comes from `plans.ts`, so the page cannot
 * advertise a price or an allowance the software does not enforce.
 */

const STARTER = PAID_PLANS[0];

export function WhatItReplaces() {
  const { long } = videosFor(STARTER);
  const perVideo = STARTER.priceUsd / Math.max(1, long);

  const rows = [
    {
      who: 'Editing it yourself',
      time: '4–8 hours a video',
      cost: 'Your evening',
      detail:
        'Cutting the pauses, timing the captions, hunting for B-roll, exporting it three ' +
        'times for three platforms.',
      ours: false,
    },
    {
      who: 'Hiring an editor',
      time: '1–3 days a video',
      cost: 'Per video, every video',
      detail:
        'Better than doing it yourself, and a round of notes each time. Turnaround is ' +
        'somebody else’s calendar.',
      ours: false,
    },
    {
      who: 'EasyCut',
      time: 'Minutes',
      cost: `$${STARTER.priceUsd} a month`,
      detail:
        `About ${long} long-form videos on ${STARTER.name} — roughly ` +
        `$${perVideo.toFixed(2)} each — and changing your mind is free, because a re-edit ` +
        're-renders only what changed.',
      ours: true,
    },
  ];

  return (
    <section className="relative z-10 border-t border-line bg-[#0B0B0E] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="max-w-2xl text-3xl font-extrabold tracking-[-0.03em] sm:text-[40px]">
          The edit is the reason you post less than you meant to.
        </h2>
        <p className="mt-4 max-w-xl text-muted">
          Not the filming. Filming takes ten minutes. Here is what the other part costs.
        </p>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {rows.map((row) => (
            <div
              key={row.who}
              className={
                row.ours
                  ? 'rounded-2xl border border-violet bg-violet-dim p-6'
                  : 'card p-6 opacity-90'
              }
            >
              <h3 className="text-lg font-bold tracking-[-0.02em]">{row.who}</h3>

              <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-line-soft py-4">
                <div>
                  <dt className="eyebrow">Turnaround</dt>
                  <dd className="mt-1 text-[15px] font-bold">{row.time}</dd>
                </div>
                <div>
                  <dt className="eyebrow">Cost</dt>
                  <dd className="mt-1 text-[15px] font-bold">{row.cost}</dd>
                </div>
              </dl>

              <p className="mt-4 text-sm leading-relaxed text-muted">{row.detail}</p>
            </div>
          ))}
        </div>

        <p className="mt-6 max-w-2xl text-[13px] leading-relaxed text-faint">
          The video counts assume about {SOURCE_MINUTES_PER_LONG} minutes of footage per
          long-form video, which is deliberately cautious — film tighter and you get more than
          the page promises. Turnaround for the first two is what people report, not something
          we measured.
        </p>
      </div>
    </section>
  );
}
