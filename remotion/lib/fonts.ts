import { continueRender, delayRender } from 'remotion';
import { CAPTION_FONTS, FALLBACK_STACK, fontStackFor } from '../../src/lib/captions/fonts';

/**
 * Typography for the renderer.
 *
 * Four things this gets right that the obvious implementation does not:
 *
 *  1. **Only the font in use.** An EDL names one caption family. Loading all
 *     sixteen would be fifteen wasted font fetches on every cold render worker,
 *     paid per video, for type that never appears on screen.
 *  2. **Weight discipline.** Unrestricted, a font CDN hands back every weight in
 *     every subset — dozens of requests before a single frame is drawn. Each
 *     family in the registry declares the weights it actually uses.
 *  3. **Waiting, so every frame matches.** A frame-by-frame render must not
 *     start until the face is resident, or the first second comes out in the
 *     fallback and the rest does not.
 *  4. **A font CDN must never fail a video.**
 *
 * The fourth is why this does not use `@remotion/google-fonts`, which is
 * otherwise exactly the right tool. Its `loadFont()` opens a `delayRender()`
 * handle per weight and clears them only when the fetch resolves — so on a
 * network where fonts.gstatic.com is unreachable (a corporate proxy, an offline
 * render host, Google Fonts having a bad day) those handles stay open and
 * Remotion kills the render:
 *
 *     Timeout (30000ms) exceeded rendering the component initially.
 *     Open delayRender() handles: "Fetching Plus Jakarta Sans font …"
 *
 * Nothing outside that module can clear them. So the stylesheet is injected
 * here and the wait is ours: one handle, a bounded race, cleared in `finally`
 * whichever way it goes. An unreachable CDN now costs one timeout and a
 * fallback face, which is what "never fails a video" has to mean.
 */

/** How long a render will wait for type before deciding to go without it. */
const FONT_TIMEOUT_MS = 12_000;

const started = new Map<string, string>();

function cssUrl(familyId: string, weights: string[]): string {
  return (
    'https://fonts.googleapis.com/css2?family=' +
    encodeURIComponent(familyId).replace(/%20/g, '+') +
    ':wght@' +
    weights.join(';') +
    // Not `swap`: mid-render a swap would change the type between frames.
    // `block` holds the text invisible while we wait, and we control the wait.
    '&display=block'
  );
}

/**
 * Force the browser to fetch the face rather than waiting until something is
 * painted in it. `document.fonts.load` needs a size in the shorthand or it
 * silently matches nothing.
 */
async function fetchFaces(familyId: string, weights: string[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all(
    weights.map((weight) => document.fonts.load(`${weight} 100px "${familyId}"`)),
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([
    promise,
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms)),
  ]);
}

export function ensureCaptionFont(familyId: string): string {
  const font = CAPTION_FONTS.find((f) => f.id === familyId);
  if (!font) {
    // An EDL naming a family we do not ship is not worth failing a render over.
    console.warn(`[easycut] unknown caption font "${familyId}", using the system stack`);
    return FALLBACK_STACK;
  }

  const stack = fontStackFor(font.id);
  const already = started.get(font.id);
  if (already) return already;
  started.set(font.id, stack);

  if (typeof document === 'undefined') return stack;

  // One handle, ours, cleared on every path — including the timeout.
  let handle: number | null = null;
  try {
    handle = delayRender(`Caption font: ${font.id}`, {
      // Our own race resolves first; this is only the backstop if something
      // below throws in a way we did not anticipate.
      timeoutInMilliseconds: FONT_TIMEOUT_MS + 8_000,
    });
  } catch {
    // No render to delay (the Player in the browser). Fetch anyway, silently.
  }

  const done = () => {
    if (handle !== null) continueRender(handle);
    handle = null;
  };

  try {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUrl(font.id, font.weights);

    // `document.fonts.load` matches against @font-face rules that exist NOW.
    // Called before the stylesheet has parsed it matches nothing, resolves
    // immediately, and the render starts in the fallback while the real face
    // arrives a frame or two later — the exact inconsistency this waits to
    // avoid. So the fetch is chained off the stylesheet, and an errored
    // stylesheet resolves rather than rejects: there is simply nothing to wait
    // for, and the fallback is already correct.
    const stylesheetReady = new Promise<void>((resolve) => {
      link.onload = () => resolve();
      link.onerror = () => resolve();
    });
    document.head.appendChild(link);

    withTimeout(stylesheetReady.then(() => fetchFaces(font.id, font.weights)), FONT_TIMEOUT_MS)
      .then((result) => {
        if (result === 'timeout') {
          console.warn(
            `[easycut] ${font.id} did not arrive in ${FONT_TIMEOUT_MS / 1000}s — rendering in the system stack`,
          );
        }
      })
      .catch(() => {
        console.warn(`[easycut] ${font.id} could not be fetched — rendering in the system stack`);
      })
      .finally(done);
  } catch {
    // Injecting the stylesheet failed outright. Nothing to wait for.
    done();
  }

  return stack;
}

/** Chrome outside the captions — titles, stat cards, lower thirds. */
export const FONT_FAMILY = (() => {
  try {
    return ensureCaptionFont('Plus Jakarta Sans');
  } catch {
    return FALLBACK_STACK;
  }
})();
