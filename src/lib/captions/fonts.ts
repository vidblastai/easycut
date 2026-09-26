/**
 * The caption typefaces.
 *
 * Captions are the product. Most short-form is watched muted, so the type IS
 * the video — which makes "which font" a real product decision rather than a
 * preference toggle, and makes an arbitrary font picker the wrong shape. A
 * thousand Google Fonts would mostly be ways to make a video look worse.
 *
 * So this is a curated set, chosen against three constraints that most faces
 * fail:
 *
 *  1. **It has to survive being small on a phone, over moving footage.** That
 *     means open counters, generous x-height, and enough weight up top that a
 *     stroke or a shadow has something to hold on to.
 *  2. **It has to have a heavy weight.** Caption faces live at 700–900. A
 *     family whose boldest is 600 reads as timid at 5% of frame height.
 *  3. **It has to be distinct from its neighbours here.** Two geometric sans
 *     that differ only in the leg of the R is a longer list, not a better one.
 *
 * Every entry is a real Google Font, so the renderer can fetch exactly the one
 * an EDL names, in exactly the weights it uses, and nothing else.
 */

export interface CaptionFont {
  /** What the EDL stores, and what CSS asks for. */
  id: string;
  /**
   * The @remotion/google-fonts submodule name.
   *
   * Kept as the family's canonical PascalCase id — it is how the registry is
   * cross-checked against that package's catalogue, so a typo in `id` shows up
   * as a mismatch rather than as a silent fallback at render time.
   */
  module: string;
  /** Weights we actually fetch — the rest are dead bytes on every render. */
  weights: string[];
  /** What it is for, in the editor's own words. */
  vibe: string;
  /** Loose grouping for the picker. */
  group: 'geometric' | 'grotesque' | 'condensed' | 'rounded' | 'serif' | 'display' | 'script';
  /**
   * Caps-only faces. Setting `uppercase: false` against one of these is a lie
   * the renderer cannot honour, so the editor stops offering the choice.
   */
  capsOnly?: boolean;
}

export const CAPTION_FONTS: CaptionFont[] = [
  {
    id: 'Plus Jakarta Sans',
    module: 'PlusJakartaSans',
    weights: ['400', '600', '700', '800'],
    vibe: 'The brand face. Neutral, modern, never the loudest thing on screen.',
    group: 'geometric',
  },
  {
    id: 'Inter',
    module: 'Inter',
    weights: ['500', '600', '700', '900'],
    vibe: 'Reads as interface, not as decoration. Good when the words are technical.',
    group: 'grotesque',
  },
  {
    id: 'Poppins',
    module: 'Poppins',
    weights: ['500', '600', '700', '800'],
    vibe: 'Perfect circles, friendly. The default look of a lot of good short-form.',
    group: 'geometric',
  },
  {
    id: 'Montserrat',
    module: 'Montserrat',
    weights: ['600', '700', '800', '900'],
    vibe: 'Wide and confident. Holds up at 900 better than almost anything else.',
    group: 'geometric',
  },
  {
    id: 'Outfit',
    module: 'Outfit',
    weights: ['500', '600', '700', '800'],
    vibe: 'Geometric with the corners softened. Clean without being cold.',
    group: 'geometric',
  },
  {
    id: 'Figtree',
    module: 'Figtree',
    weights: ['500', '600', '700', '900'],
    vibe: 'Humanist and warm. Sounds like a person talking rather than a brand.',
    group: 'grotesque',
  },
  {
    id: 'Archivo Black',
    module: 'ArchivoBlack',
    weights: ['400'],
    vibe: 'One weight, and it is a wall. Maximum presence per pixel.',
    group: 'grotesque',
  },
  {
    id: 'Anton',
    module: 'Anton',
    weights: ['400'],
    vibe: 'Tall, condensed, immovable. Fits long lines without shrinking them.',
    group: 'condensed',
  },
  {
    id: 'Saira Condensed',
    module: 'SairaCondensed',
    weights: ['900'],
    /*
     * Measured against the reference, not chosen by eye.
     *
     * The two-tone look this was added for sets a heavy condensed grotesque
     * that runs about 10.2 character-widths to one cap height. Anton runs 8.4
     * and has to be set a fifth larger to fill the same line, which reads as
     * heavier and taller than the reference; Archivo Black runs 16.8 and
     * cannot be squeezed into it at all. Saira Condensed at 900 runs 10.6 —
     * within four per cent — so a line of it lands at the reference's size.
     */
    vibe: 'Heavy condensed grotesque. Fills a line at the size it was drawn.',
    group: 'condensed',
  },
  {
    id: 'Bebas Neue',
    module: 'BebasNeue',
    weights: ['400'],
    vibe: 'Caps-only poster type. Wants letter-spacing and room to breathe.',
    group: 'condensed',
    capsOnly: true,
  },
  {
    id: 'Oswald',
    module: 'Oswald',
    weights: ['500', '600', '700'],
    vibe: 'Newsroom lower-third. Serious, narrow, reads fast.',
    group: 'condensed',
  },
  {
    id: 'Rubik',
    module: 'Rubik',
    weights: ['500', '600', '700', '800'],
    vibe: 'Rounded terminals. Takes the edge off a hard message.',
    group: 'rounded',
  },
  {
    id: 'Fredoka',
    module: 'Fredoka',
    weights: ['500', '600', '700'],
    vibe: 'Chunky and round. Playful without going full cartoon.',
    group: 'rounded',
  },
  {
    id: 'Luckiest Guy',
    module: 'LuckiestGuy',
    weights: ['400'],
    vibe: 'Comic-book shout. Built for a thick stroke and a hard drop shadow.',
    group: 'display',
    capsOnly: true,
  },
  {
    id: 'Space Grotesk',
    module: 'SpaceGrotesk',
    weights: ['500', '600', '700'],
    vibe: 'Slightly odd, slightly technical. Good for product and engineering.',
    group: 'grotesque',
  },
  {
    id: 'Playfair Display',
    module: 'PlayfairDisplay',
    weights: ['600', '700', '800'],
    vibe: 'High-contrast serif. Editorial, documentary, deliberately unhurried.',
    group: 'serif',
  },
  {
    id: 'Lora',
    module: 'Lora',
    weights: ['500', '600', '700'],
    vibe: 'Warm reading serif. For long-form where captions are an aid, not a hook.',
    group: 'serif',
  },

  /* ─────────────────────────────────────────────────────── scripts ───
   *
   * The one thing the registry had none of, and the reason a whole family of
   * looks was impossible: the style where a heavy condensed line is
   * interrupted by ONE word in a brush script, larger, slanted, in its own
   * colour. Without a script face the best that could be offered was a
   * rounded cartoon display face, which reads as a completely different
   * product.
   *
   * These are single-weight by nature — a brush script has one weight, the
   * one the brush made — so asking for 700 gets you a synthesised fake.
   * `fontWeight` is deliberately not offered against them in the picker.
   */
  {
    id: 'Yellowtail',
    module: 'Yellowtail',
    weights: ['400'],
    vibe: 'A single brush stroke, heavy and connected. The one-word highlight face.',
    group: 'script',
  },
  {
    id: 'Kaushan Script',
    module: 'KaushanScript',
    weights: ['400'],
    vibe: 'Brush script with a forward lean. Energetic without being loose.',
    group: 'script',
  },
  {
    id: 'Pacifico',
    module: 'Pacifico',
    weights: ['400'],
    vibe: 'Rounded surf-shop script. Friendly, wide, very legible small.',
    group: 'script',
  },
  {
    id: 'Caveat',
    module: 'Caveat',
    weights: ['400', '700'],
    vibe: 'Handwriting rather than lettering — an aside, a note, a correction.',
    group: 'script',
  },
  {
    id: 'Great Vibes',
    module: 'GreatVibes',
    weights: ['400'],
    vibe: 'Formal copperplate script. For elegance, never for emphasis.',
    group: 'script',
  },
];

export const CAPTION_FONT_IDS = CAPTION_FONTS.map((f) => f.id);

export function findCaptionFont(id: string): CaptionFont | undefined {
  return CAPTION_FONTS.find((f) => f.id === id);
}

/**
 * The stack every caption falls back through.
 *
 * A font CDN must never fail a video. If fonts.gstatic.com is slow, blocked by
 * a corporate proxy, or unreachable from a locked-down render host, the render
 * continues in a near-identical system face. Captions in a fallback sans are
 * enormously better than no video at all.
 */
export const FALLBACK_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const SERIF_FALLBACK_STACK =
  'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';

/** The `font-family` value for a style, fallbacks included. */
export function fontStackFor(id: string): string {
  const font = findCaptionFont(id);
  const tail = font?.group === 'serif' ? SERIF_FALLBACK_STACK : FALLBACK_STACK;
  return `"${id}", ${tail}`;
}
