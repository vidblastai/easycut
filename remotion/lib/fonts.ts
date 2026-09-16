import { continueRender, delayRender, staticFile } from 'remotion';
import { CAPTION_FONTS, FALLBACK_STACK, fontStackFor } from '../../src/lib/captions/fonts';
import {
  cdnStylesheet,
  faceCss,
  FONT_MANIFEST_PATH,
  type FontManifest,
} from '../../src/lib/captions/local-fonts';

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
 *  4. **A font CDN must never fail a video, or quietly change it.**
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
 *
 * Better still is not to ask the CDN. `npm run fonts` puts the Latin faces in
 * `public/fonts`, and when a family is there it is declared straight from disk:
 * no network, no wait, and no way for the type to change between one render and
 * the next because something upstream moved. The CDN stays as the fallback for
 * whatever was not fetched — a family added since setup, a script outside
 * Latin — so nothing gets worse if the step is skipped.
 *
 * That fallback is not theoretical. On a host behind a TLS-intercepting proxy
 * the headless browser does not trust the proxy's CA, every Google stylesheet
 * fails `ERR_CERT_AUTHORITY_INVALID`, and the video comes out in the system
 * stack with nothing in the log that looks like an error. Local files are
 * immune to all of it.
 */

/** How long a render will wait for type before deciding to go without it. */
const FONT_TIMEOUT_MS = 12_000;

const started = new Map<string, string>();

let manifestOnce: Promise<FontManifest> | null = null;

/**
 * What `scripts/fetch-fonts.ts` left behind, read once per renderer process.
 *
 * Absent is the normal case before setup has run, and means "use the CDN" —
 * never an error.
 */
function localManifest(): Promise<FontManifest> {
  if (!manifestOnce) {
    manifestOnce = fetch(staticFile(FONT_MANIFEST_PATH))
      .then((response) => (response.ok ? (response.json() as Promise<FontManifest>) : {}))
      .catch(() => ({}));
  }
  return manifestOnce;
}

/** Declare the faces we have on disk. No network, so nothing to wait for. */
function declareLocal(familyId: string, faces: FontManifest[string]): void {
  const style = document.createElement('style');
  style.dataset.easycutFont = familyId;
  // `block` rather than `swap`: mid-render a swap would change the type between
  // one frame and the next.
  style.textContent = faceCss(familyId, faces, (file) => staticFile(file), 'block');
  document.head.appendChild(style);
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

  // `document.fonts.load` matches against the @font-face rules that exist NOW.
  // Called before the rules are in the document it matches nothing, resolves
  // immediately, and the render starts in the fallback while the real face
  // arrives a frame or two later — the exact inconsistency this waits to avoid.
  // So in both paths the fetch is chained off the declaration being in place,
  // and a stylesheet that errors resolves rather than rejects: there is simply
  // nothing left to wait for, and the fallback is already correct.
  const declared = async (): Promise<void> => {
    const faces = (await localManifest())[font.id];
    if (faces?.length) {
      declareLocal(font.id, faces);
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cdnStylesheet(font.id, font.weights, 'block');
    await new Promise<void>((resolve) => {
      link.onload = () => resolve();
      link.onerror = () => resolve();
      document.head.appendChild(link);
    });
  };

  try {
    withTimeout(declared().then(() => fetchFaces(font.id, font.weights)), FONT_TIMEOUT_MS)
      .then((result) => {
        if (result === 'timeout') {
          console.warn(
            `[easycut] ${font.id} did not arrive in ${FONT_TIMEOUT_MS / 1000}s — rendering in the system stack.` +
              ` Run \`npm run fonts\` to keep the faces on disk.`,
          );
        }
      })
      .catch(() => {
        console.warn(`[easycut] ${font.id} could not be fetched — rendering in the system stack`);
      })
      .finally(done);
  } catch {
    // Declaring the face failed outright. Nothing to wait for.
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
