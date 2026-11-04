/**
 * Real edits, one per style, for the style pickers.
 *
 * Every file here is an actual EasyCut export: the same raw take run through
 * each style on the live pipeline, trimmed to a few seconds where that style's
 * character shows. A style without an entry falls back to the drawn preview.
 *
 * Files live in `public/styles/`: `<style>-<format>.mp4` and a `.jpg` poster.
 */

export type ExampleFormat = 'short' | 'long';

export interface StyleExample {
  src: string;
  poster: string;
}

const example = (style: string, format: ExampleFormat): StyleExample => ({
  src: `/styles/${style}-${format}.mp4`,
  poster: `/styles/${style}-${format}.jpg`,
});

/** Which styles have a real example, per format. */
const AVAILABLE: Record<ExampleFormat, string[]> = {
  short: ['breakdown', 'clean', 'commentary', 'documentary', 'explainer', 'news', 'punchy', 'reaction', 'split', 'stacked', 'tutorial', 'vlog'],
  long: ['essay', 'podcast', 'sidebar', 'signal', 'slate'],
};

export function styleExample(style: string, format: ExampleFormat): StyleExample | null {
  return AVAILABLE[format].includes(style) ? example(style, format) : null;
}
