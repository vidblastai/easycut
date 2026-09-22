/**
 * Finished videos, made with EasyCut, to play on the homepage.
 *
 * DELIBERATELY EMPTY, and the section does not render while it is. This is the
 * most persuasive thing a video product can put on its homepage and also the
 * easiest to fake — a stock clip captioned "made with EasyCut" is a claim
 * about output quality that nobody can check and that is untrue.
 *
 * Fill it with real exports. Anything here should be a file the product
 * actually produced, ideally from a creator who agreed to it being shown.
 *
 *     { src: '/showcase/colin.mp4', poster: '/showcase/colin.jpg',
 *       who: 'Colin', seconds: 33, style: 'Punchy' }
 *
 * Put the files in `public/showcase/`. A poster frame is worth having — the
 * grid should look like something before anybody presses play.
 */

export interface ShowcaseVideo {
  /** Path under /public, or an absolute URL. */
  src: string;
  poster?: string | null;
  /** Whose video it is — a first name is enough. */
  who: string;
  /** Runtime, for the badge. */
  seconds: number;
  /** The style it was cut in, which is the part that makes it useful. */
  style?: string;
}

export const SHOWCASE: ShowcaseVideo[] = [];
