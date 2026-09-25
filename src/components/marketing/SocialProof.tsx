import { clsx } from 'clsx';
import { Avatar, FACES } from '@/components/marketing/Avatar';

/**
 * The row above the headline: who else is here, and what they made of it.
 *
 * ── The faces are drawn, not photographed ────────────────────────────────
 *
 * A landing page with five stock portraits on it is showing five people who
 * do not exist and implying they are customers. Five obvious little avatars
 * imply nothing and still do the job a face does, which is to say "people,
 * not a product page". Swap in real photographs the moment there are
 * customers who have agreed to appear here.
 *
 * ── The number lives in one place ────────────────────────────────────────
 *
 * `COUNT` is the only copy of it, so changing it is one edit and the page can
 * never claim two different figures in two places.
 */

const COUNT = 'over 100k';

const STAR = 'M10 1.4 12.5 7l6.1.6-4.6 4.1 1.3 6-5.3-3.1-5.3 3.1 1.3-6L1.4 7.6 7.5 7Z';

export function SocialProof({ className }: { className?: string }) {
  return (
    <div
      data-proof
      className={clsx(
        'inline-flex items-center gap-[13px] rounded-full border border-line bg-charcoal',
        'py-[6px] pl-[11px] pr-[19px] max-[420px]:pr-[15px]',
        className,
      )}
    >
      {/* The faces and their verdict are ONE thing — who is here, and what
          they made of it — so they stack into a single block and the sentence
          sits beside it, rather than three items strung along a line. */}
      <span className="grid justify-items-center">
        <span className="flex">
          {FACES.slice(0, 5).map((_, i) => (
            <Avatar
              key={i}
              name={`proof-${i}`}
              /* The ring is the pill's own fill, so the stack reads as
                 overlapping discs rather than as one blurred shape. */
              className="h-7 w-7 shadow-[0_0_0_2px_#19191F] [&+&]:-ml-2"
            />
          ))}
        </span>

        {/* The stars sit ON the faces rather than under them: pulled up over
            the bottom of the discs, which takes a third off the height of the
            block and keeps the pill a badge instead of a box. The drop shadow
            is what stops a violet star disappearing into a dark shoulder. */}
        <span
          role="img"
          aria-label="Rated five out of five"
          className="relative -mt-[11px] flex gap-[2.5px] text-violet [filter:drop-shadow(0_1px_2.5px_rgba(0,0,0,.9))]"
        >
          {Array.from({ length: 5 }, (_, i) => (
            <svg key={i} width="13" height="13" viewBox="0 0 20 20" aria-hidden className="block">
              <path d={STAR} fill="currentColor" />
            </svg>
          ))}
        </span>
      </span>

      <span className="whitespace-nowrap text-[13.5px] font-semibold text-muted max-[420px]:whitespace-normal max-[420px]:text-[12.5px]">
        {/* The number never splits across lines: "Loved by over / 100k
            creators" reads as a broken sentence, "Loved by / over 100k
            creators" as a wrapped one. */}
        Loved by <b className="whitespace-nowrap font-bold text-chalk">{COUNT} creators</b>
      </span>
    </div>
  );
}
