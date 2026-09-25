/**
 * The review wall.
 *
 * ── Read this before launch ──────────────────────────────────────────────
 *
 * The six entries below are PLACEHOLDERS with placeholder names, and the page
 * no longer says so — which means they must be replaced with real people
 * before the site goes live. A named quote is a claim about a specific person;
 * shipping these as they stand attributes words to people who do not exist.
 *
 * The plan is that they get swapped for real customers, which is a text edit
 * per entry and nothing else — same fields, same layout, same sizes:
 *
 *     name    → their real name
 *     handle  → their @, or drop the field
 *     role    → what they do
 *     photo   → '/people/marcus.jpg' (put the file in public/people/)
 *
 * Without `photo` a drawn stand-in face appears at exactly the size the
 * photograph will take, so adding the pictures changes nothing else.
 *
 * The quotes themselves are written to size the layout and to say the things
 * this product actually does. Replace them with what customers really say —
 * real ones are always better, and they are the only ones that are true.
 */

export interface Testimonial {
  /** 1–5. The average printed above the wall is computed from these. */
  stars: number;
  /** The one line somebody skimming will read. */
  title: string;
  quote: string;
  name: string;
  /** Their @, without the @. Optional. */
  handle?: string;
  /** What they do — the part that makes the quote worth reading. */
  role: string;
  /** A path under /public. Without it, a drawn stand-in face. */
  photo?: string | null;
}

export const TESTIMONIALS: Testimonial[] = [
  {
    stars: 5,
    title: 'The part I always skipped',
    quote:
      'I had four months of footage sitting on a drive because editing it was the tax on posting. The first upload came back cut, captioned and scored in about eight minutes. That drive is nearly empty now.',
    name: 'Marcus Reed',
    handle: 'marcusbuilds',
    role: 'Founder, B2B software',
  },
  {
    stars: 5,
    title: 'It found the B-roll I would have looked for',
    quote:
      'I said "the calculator you use to price things" and it put a shot of exactly that on the line where I said it. I did not brief it. I did not pick from a library. It knew what the sentence was about.',
    name: 'Priya Nair',
    handle: 'priyamakes',
    role: 'Marketing lead, agency',
  },
  {
    stars: 4,
    title: 'Reaction style sold it',
    quote:
      'Full frame while I talk, corner box the second a picture comes up, back again. That is the edit I was paying somebody two hundred a video for, and it does it on the first pass.',
    name: 'Jordan Ellis',
    handle: 'jordanonline',
    role: 'Creator, short-form',
  },
  {
    stars: 5,
    title: 'Both formats without two tools',
    quote:
      'The YouTube edit and the vertical clips are the same app and the same subscription. I upload each one as what it is and get it back cut properly for where it is going.',
    name: 'Sofia Marchetti',
    handle: 'sofiacuts',
    role: 'Podcast producer',
  },
  {
    stars: 5,
    title: 'The ums are gone and I did not ask',
    quote:
      'I stopped doing second takes. It cuts the pauses and the false starts, and the captions stay in time afterwards, which is the bit every other tool gets wrong.',
    name: 'Daniel Okafor',
    role: 'Consultant',
  },
  {
    stars: 4,
    title: 'Re-cutting is free, so I experiment',
    quote:
      'Picking a style is not a decision I have to get right. I have run the same talk through four looks in an afternoon and kept the one that landed.',
    name: 'Hannah Lindqvist',
    handle: 'hannahteaches',
    role: 'Course creator',
  },
];

/** The average, read off the wall rather than typed, so it cannot drift. */
export function averageStars(reviews: Testimonial[] = TESTIMONIALS): number {
  if (!reviews.length) return 0;
  return reviews.reduce((total, r) => total + r.stars, 0) / reviews.length;
}
