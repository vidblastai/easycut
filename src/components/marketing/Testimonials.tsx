import { TESTIMONIALS } from '@/content/testimonials';

/**
 * Testimonials, or nothing at all.
 *
 * Renders only when `src/content/testimonials.ts` has real entries in it. An
 * empty grid with three grey boxes saying "coming soon" is worse than no
 * section — it advertises that nobody has said anything yet — and a
 * placeholder quote is worse than both.
 */
export function Testimonials() {
  if (!TESTIMONIALS.length) return null;

  return (
    <section className="relative z-10 border-t border-line bg-[#0B0B0E] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="max-w-2xl text-3xl font-extrabold tracking-[-0.03em] sm:text-[40px]">
          People who stopped editing.
        </h2>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <figure key={`${t.name}-${t.quote.slice(0, 24)}`} className="card flex h-full flex-col p-6">
              <blockquote className="flex-1 text-[15px] leading-relaxed text-chalk/90">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-5 flex items-center gap-3 border-t border-line-soft pt-4">
                {t.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.avatar} alt="" className="h-9 w-9 flex-none rounded-full object-cover" />
                ) : (
                  <span
                    aria-hidden
                    className="grid h-9 w-9 flex-none place-items-center rounded-full bg-violet-dim text-[12.5px] font-bold text-violet"
                  >
                    {initials(t.name)}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-bold">{t.name}</span>
                  <span className="block truncate text-[12.5px] text-muted">{t.role}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
