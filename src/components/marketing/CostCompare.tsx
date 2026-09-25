/**
 * What a run actually costs us, and therefore what the ceilings mean.
 *
 * Measured against the real provider bills rather than estimated, which is
 * the only reason it is worth printing: a made-up number here would be a
 * claim about the product's economics that nobody can check.
 *
 * The ceilings are enforced in `src/lib/pipeline` — a job that would overrun
 * drops its most expensive optional layers rather than overspending — so the
 * headroom figures are a property of the code, not a hope.
 */

const FIGURES = [
  ['60-second short', '$0.12', 'Against a $1.00 ceiling. 8.1× headroom.'],
  ['10-minute long form', '$0.74', 'Against a $5.00 ceiling. 6.8× headroom.'],
  ['Every edit after that', 'Free', 'Restyle, re-cut, re-crop and re-export replay cached analysis.'],
] as const;

export function CostCompare() {
  return (
    <section className="relative z-10 border-t border-line py-24">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="max-w-2xl text-3xl font-extrabold tracking-[-0.03em] sm:text-[40px]">
          A fraction of what an editor costs.
        </h2>
        <p className="mt-4 max-w-[58ch] text-muted">
          Measured, not estimated. The ceilings are enforced in code — a job that would overrun
          drops its most expensive optional layers rather than overspending.
        </p>

        {/* One-pixel gaps over a line-coloured ground: the rules between the
            figures are the gaps themselves, so there is no border to double
            up at the edges. */}
        <dl className="mt-7 grid gap-px overflow-hidden rounded-xl border border-line bg-line-soft sm:grid-cols-3">
          {FIGURES.map(([label, value, note]) => (
            <div key={label} className="bg-charcoal px-5 py-[22px]">
              <dt className="text-[11px] font-bold uppercase tracking-[0.07em] text-faint">{label}</dt>
              <dd className="mt-2 text-[28px] font-extrabold tracking-[-0.035em] tabular-nums text-violet">
                {value}
              </dd>
              <dd className="mt-1.5 text-[12.5px] leading-[1.5] text-muted">{note}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
