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
 * Every entry is a real Google Font available through @remotion/google-fonts,
 * so the renderer can fetch exactly the one an EDL names and nothing else.
 */

export interface CaptionFont {
  /** What the EDL stores, and what CSS asks for. */
  id: string;
  /** The @remotion/google-fonts submodule name. */
  module: string;
  /** Weights we actually fetch — the rest are dead bytes on every render. */
  weights: string[];
  /** What it is for, in the editor's own words. */
  vibe: string;
  /** Loose grouping for the picker. */
  group: 'geometric' | 'grotesque' | 'condensed' | 'rounded' | 'serif' | 'display';
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
