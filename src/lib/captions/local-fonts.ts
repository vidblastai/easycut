/**
 * The caption faces that `npm run fonts` put on disk, and how to declare them.
 *
 * Shared by the two places that draw captions — the Remotion renderer and the
 * picker's live preview — for the same reason `paint.ts` is shared: the README
 * promises that "what you pick is what exports", and two copies of the type
 * are two chances for that to stop being true.
 *
 * It was already half untrue. Both sides asked Google Fonts for a stylesheet,
 * so the preview and the render each got whatever version of the family the CDN
 * was serving at that moment, from two different machines, possibly weeks
 * apart. Now both declare the same files.
 *
 * A missing manifest is the normal case before setup has run, and means "use
 * the CDN" — never an error.
 */

export interface LocalFace {
  weight: string;
  /** Path under public/, e.g. `fonts/anton/400-latin.woff2`. */
  file: string;
  unicodeRange: string;
}

export type FontManifest = Record<string, LocalFace[]>;

/** Where fetch-fonts.ts writes the index, relative to public/. */
export const FONT_MANIFEST_PATH = 'fonts/manifest.json';

/**
 * The Google Fonts stylesheet for a family, for when the files are not on disk.
 *
 * `display` differs by caller and it matters: a render must not let the face
 * swap in halfway through, because the frames before the swap would come out in
 * a different typeface from the frames after it. A browser preview should swap,
 * because the alternative is invisible text while the network thinks about it.
 */
export function cdnStylesheet(familyId: string, weights: string[], display: 'block' | 'swap'): string {
  return (
    'https://fonts.googleapis.com/css2?family=' +
    encodeURIComponent(familyId).replace(/%20/g, '+') +
    ':wght@' +
    weights.join(';') +
    `&display=${display}`
  );
}

/**
 * `@font-face` rules for the files we have.
 *
 * `url` is supplied by the caller because the two runtimes resolve a public
 * path differently: Remotion has `staticFile()`, and the Next app serves
 * public/ from the site root.
 */
export function faceCss(
  familyId: string,
  faces: LocalFace[],
  url: (file: string) => string,
  display: 'block' | 'swap',
): string {
  return faces
    .map(
      (face) =>
        `@font-face{font-family:"${familyId}";font-style:normal;font-weight:${face.weight};` +
        `font-display:${display};src:url(${url(face.file)}) format("woff2");` +
        `unicode-range:${face.unicodeRange};}`,
    )
    .join('\n');
}
