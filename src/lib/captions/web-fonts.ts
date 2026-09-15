'use client';

import { CAPTION_FONTS, findCaptionFont } from './fonts';

/**
 * Loading a caption face in the browser, for the picker's preview.
 *
 * The renderer gets its fonts from @remotion/google-fonts, which is a build-time
 * dependency and cannot run in the page. The picker needs the same families in
 * the same weights, so it asks Google Fonts directly — one stylesheet link per
 * family, injected the first time that family is shown.
 *
 * On demand rather than all sixteen up front: a person opening the picker sees
 * a dozen presets, and pulling every weight of every family to render the ones
 * they scrolled past costs about a megabyte for nothing.
 */

const injected = new Set<string>();

function href(familyId: string, weights: string[]): string {
  const family = familyId.replace(/ /g, '+');
  return `https://fonts.googleapis.com/css2?family=${family}:wght@${weights.join(';')}&display=swap`;
}

/** Idempotent. Never throws — a missing face falls back, it does not break the page. */
export function loadCaptionFont(familyId: string): void {
  if (typeof document === 'undefined') return;
  if (injected.has(familyId)) return;

  const font = findCaptionFont(familyId);
  if (!font) return;
  injected.add(familyId);

  try {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href(font.id, font.weights);
    // A font that fails to load is a fallback, not an error worth surfacing.
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  } catch {
    /* A page that cannot inject a stylesheet still renders in the fallback. */
  }
}

/** Every family a set of styles will need, loaded together. */
export function preloadCaptionFonts(familyIds: Iterable<string>): void {
  for (const id of new Set(familyIds)) loadCaptionFont(id);
}

/** All sixteen — for the font tab, where they are all on screen at once. */
export function loadAllCaptionFonts(): void {
  preloadCaptionFonts(CAPTION_FONTS.map((f) => f.id));
}
