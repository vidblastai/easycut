import { continueRender, delayRender } from 'remotion';
import { loadFont } from '@remotion/google-fonts/PlusJakartaSans';

/**
 * Typography for the renderer.
 *
 * Two things this fixes over the naive `loadFont()` call:
 *
 *  1. **Weight and subset discipline.** Unrestricted, the helper fetches every
 *     weight in every subset — 56 network requests before a single frame is
 *     drawn, paid on every cold render worker. We use four weights and Latin,
 *     so that is what we ask for.
 *
 *  2. **A font CDN must never fail a video.** If fonts.gstatic.com is slow,
 *     blocked by a corporate proxy, or unreachable from a locked-down render
 *     host, the render continues in a near-identical system stack. Captions in
 *     a fallback sans are enormously better than no video at all.
 */

const FALLBACK_STACK =
  '"Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

let resolved = FALLBACK_STACK;

try {
  const handle = delayRender('Loading Plus Jakarta Sans', { timeoutInMilliseconds: 12_000 });

  const { fontFamily, waitUntilDone } = loadFont('normal', {
    // 400 body, 600 controls, 700 headings, 800 captions — see the brand kit.
    weights: ['400', '600', '700', '800'],
    subsets: ['latin'],
    ignoreTooManyRequestsWarning: true,
  });

  resolved = `${fontFamily}, ${FALLBACK_STACK}`;

  waitUntilDone()
    .catch(() => {
      // Keep the family name — the browser falls through the stack on its own.
      console.warn('[easycut] web font unavailable, rendering with the system stack');
    })
    .finally(() => continueRender(handle));
} catch {
  // The helper itself is unavailable (offline bundle). Nothing to wait for.
}

/** Use this everywhere in the renderer rather than a bare family name. */
export const FONT_FAMILY = resolved;
