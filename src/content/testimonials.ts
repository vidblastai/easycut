/**
 * What customers have said, in their own words.
 *
 * DELIBERATELY EMPTY. The section that renders this does not appear at all
 * while the list is, which is the only honest way to ship a testimonial block
 * before there are testimonials — an invented quote attributed to an invented
 * person is a lie printed on the homepage, and it is a hard one to walk back
 * once somebody has quoted it at you.
 *
 * To turn the section on, add real entries:
 *
 *     { quote: 'It cut a 40-minute podcast into six shorts before my coffee.',
 *       name: 'Priya Raman', role: 'Host, The Long Way Round' }
 *
 * `avatar` is a path under /public, or left out for initials.
 */

export interface Testimonial {
  quote: string;
  name: string;
  /** What they do — the part that makes the quote worth reading. */
  role: string;
  avatar?: string | null;
}

export const TESTIMONIALS: Testimonial[] = [];
