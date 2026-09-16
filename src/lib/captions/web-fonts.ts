'use client';

import { CAPTION_FONTS, findCaptionFont } from './fonts';
import {
  cdnStylesheet,
  faceCss,
  FONT_MANIFEST_PATH,
  type FontManifest,
} from './local-fonts';

/**
 * Loading a caption face in the browser, for the picker's preview.
 *
 * Same files as the renderer, which is the point. `npm run fonts` puts the
 * Latin faces in public/fonts, and both the preview here and the render in
 * remotion/lib/fonts.ts declare those files rather than asking a CDN. Before
 * that they each got whatever Google was serving at the moment they ran, from
 * two different machines, which quietly undercut the one promise this picker
 * makes: that what you see is what exports.
 *
 * Anything not on disk still falls back to the CDN, so skipping the setup step
 * costs nothing it did not already cost.
 *
 * On demand rather than all sixteen up front: a person opening the picker sees
 * a dozen presets, and pulling every weight of every family to render the ones
 * they scrolled past costs about a megabyte for nothing.
 */

const injected = new Set<string>();

let manifestOnce: Promise<FontManifest> | null = null;
function localManifest(): Promise<FontManifest> {
  if (!manifestOnce) {
    manifestOnce = fetch(`/${FONT_MANIFEST_PATH}`)
      .then((response) => (response.ok ? (response.json() as Promise<FontManifest>) : {}))
      .catch(() => ({}));
  }
  return manifestOnce;
}

function declare(css: string, familyId: string): void {
  const style = document.createElement('style');
  style.dataset.captionFont = familyId;
  style.textContent = css;
  document.head.appendChild(style);
}

/** Idempotent. Never throws — a missing face falls back, it does not break the page. */
export function loadCaptionFont(familyId: string): void {
  if (typeof document === 'undefined') return;
  if (injected.has(familyId)) return;

  const font = findCaptionFont(familyId);
  if (!font) return;
  injected.add(familyId);

  void localManifest()
    .then((manifest) => {
      const faces = manifest[font.id];
      if (faces?.length) {
        declare(faceCss(font.id, faces, (file) => `/${file}`, 'swap'), font.id);
        return;
      }

      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cdnStylesheet(font.id, font.weights, 'swap');
      // A font that fails to load is a fallback, not an error worth surfacing.
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    })
    .catch(() => {
      /* A page that cannot inject a stylesheet still renders in the fallback. */
    });
}

/** Every family a set of styles will need, loaded together. */
export function preloadCaptionFonts(familyIds: Iterable<string>): void {
  for (const id of new Set(familyIds)) loadCaptionFont(id);
}

/** All sixteen — for the font tab, where they are all on screen at once. */
export function loadAllCaptionFonts(): void {
  preloadCaptionFonts(CAPTION_FONTS.map((f) => f.id));
}
