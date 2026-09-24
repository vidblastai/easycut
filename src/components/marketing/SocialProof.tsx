import { clsx } from 'clsx';

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

/** Skin and shirt per face: five people, visibly different, nobody real. */
const FACES = [
  { skin: '#E8C9A0', shirt: '#4A4370', room: '#2A2440' },
  { skin: '#8D5C3D', shirt: '#3C5A6E', room: '#1F3242' },
  { skin: '#F0D5B4', shirt: '#5A4A6E', room: '#332A47' },
  { skin: '#6B4530', shirt: '#4C6A55', room: '#23392E' },
  { skin: '#D8A87C', shirt: '#6A4A63', room: '#3D2A3A' },
];

const STAR = 'M10 1.4 12.5 7l6.1.6-4.6 4.1 1.3 6-5.3-3.1-5.3 3.1 1.3-6L1.4 7.6 7.5 7Z';

export function SocialProof({ className }: { className?: string }) {
  return (
    <div
      data-proof
      className={clsx(
        'inline-flex items-center gap-[13px] rounded-full border border-line bg-charcoal',
        'py-[7px] pl-[11px] pr-[19px] max-[420px]:pr-[15px]',
        className,
      )}
    >
      {/* The faces and their verdict are ONE thing — who is here, and what
          they made of it — so they stack into a single block and the sentence
          sits beside it, rather than three items strung along a line. */}
      <span className="grid justify-items-center gap-1">
        <span className="flex">
          {FACES.map((f, i) => (
            <span
              key={i}
              /* The ring is the pill's own fill, so the stack reads as
                 overlapping discs rather than as one blurred shape. */
              className="block h-7 w-7 overflow-hidden rounded-full shadow-[0_0_0_2px_#19191F] [&+&]:-ml-2"
            >
              <svg viewBox="0 0 40 40" aria-hidden className="block h-full w-full">
                <rect width="40" height="40" fill={f.room} />
                {/* Shoulders run the full width of the disc. Stopped short
                    they read as a hill behind a head rather than a person. */}
                <path d="M0 40 C1 29.5, 9 24.5, 20 24.5 C31 24.5, 39 29.5, 40 40 Z" fill={f.shirt} />
                <ellipse cx="20" cy="15.5" rx="7.2" ry="8" fill={f.skin} />
              </svg>
            </span>
          ))}
        </span>

        <span role="img" aria-label="Rated five out of five" className="flex gap-[2.5px] text-violet">
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
