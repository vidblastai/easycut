import { TESTIMONIALS, averageStars, type Testimonial } from '@/content/testimonials';
import { Avatar } from '@/components/marketing/Avatar';

/**
 * The review wall.
 *
 * Each card is a rating, a headline, the words, and the person — in that
 * order, because that is the order somebody skimming reads them in. The
 * average above the wall is computed from the cards below it rather than
 * typed, so the two can never disagree.
 *
 * Everything on the page comes from `src/content/testimonials.ts`; see the
 * note at the top of that file about replacing the placeholders before
 * launch.
 */
export function Testimonials() {
  if (!TESTIMONIALS.length) return null;

  const average = averageStars();

  return (
    <section className="relative z-10 border-t border-line bg-[#0B0B0E] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <h2 className="max-w-2xl text-3xl font-extrabold tracking-[-0.03em] sm:text-[40px]">
            What people say once they stop editing.
          </h2>

          <div className="flex items-center gap-2.5">
            <Stars count={Math.round(average)} className="h-[17px] w-[17px]" />
            <b className="text-[17px] font-extrabold">{average.toFixed(1)}</b>
            <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-faint">
              {TESTIMONIALS.length} review{TESTIMONIALS.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        {/* No `items-start`: the cards in a row share a height, and the
            `flex-1` on the quote pushes every byline onto the same line. */}
        <div className="mt-8 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <ReviewCard key={t.name} review={t} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ReviewCard({ review }: { review: Testimonial }) {
  return (
    <figure className="flex h-full flex-col gap-2.5 rounded-2xl border border-line bg-charcoal p-5">
      <Stars count={review.stars} className="h-[13px] w-[13px]" />
      <h3 className="text-[15px] font-bold tracking-[-0.015em]">{review.title}</h3>
      <blockquote className="flex-1 text-[13.5px] leading-[1.6] text-muted">{review.quote}</blockquote>

      {/* The person, under a rule: the quote is the content and the byline is
          what makes it worth anything, so they are separated rather than run
          together. */}
      <figcaption className="mt-1.5 flex items-center gap-2.5 border-t border-line-soft pt-3.5">
        <Avatar name={review.name} photo={review.photo} className="h-9 w-9" />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-bold leading-tight">
            {review.name}
            {review.handle ? (
              <span className="ml-1.5 font-semibold text-faint">@{review.handle}</span>
            ) : null}
          </span>
          <span className="block truncate text-[12px] leading-tight text-muted">{review.role}</span>
        </span>
      </figcaption>
    </figure>
  );
}

const STAR = 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z';

/** Five stars, the unlit ones dimmed rather than missing — a four-star rating
 *  has to read as four OUT OF FIVE, and four lonely stars reads as five. */
function Stars({ count, className }: { count: number; className?: string }) {
  return (
    <span className="inline-flex gap-0.5 text-violet" role="img" aria-label={`${count} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className} style={i < count ? undefined : { opacity: 0.22 }}>
          <path d={STAR} />
        </svg>
      ))}
    </span>
  );
}
