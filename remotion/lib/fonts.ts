import { continueRender, delayRender } from 'remotion';
import { CAPTION_FONTS, FALLBACK_STACK, fontStackFor } from '../../src/lib/captions/fonts';

/* Every caption face, imported statically so the bundler can see them, and
   CALLED lazily so a render only ever fetches the one the EDL names. The import
   itself is metadata and a function — cheap. The loadFont() call is the network. */
import * as PlusJakartaSans from '@remotion/google-fonts/PlusJakartaSans';
import * as Inter from '@remotion/google-fonts/Inter';
import * as Poppins from '@remotion/google-fonts/Poppins';
import * as Montserrat from '@remotion/google-fonts/Montserrat';
import * as Outfit from '@remotion/google-fonts/Outfit';
import * as Figtree from '@remotion/google-fonts/Figtree';
import * as ArchivoBlack from '@remotion/google-fonts/ArchivoBlack';
import * as Anton from '@remotion/google-fonts/Anton';
import * as BebasNeue from '@remotion/google-fonts/BebasNeue';
import * as Oswald from '@remotion/google-fonts/Oswald';
import * as Rubik from '@remotion/google-fonts/Rubik';
import * as Fredoka from '@remotion/google-fonts/Fredoka';
import * as LuckiestGuy from '@remotion/google-fonts/LuckiestGuy';
import * as SpaceGrotesk from '@remotion/google-fonts/SpaceGrotesk';
import * as PlayfairDisplay from '@remotion/google-fonts/PlayfairDisplay';
import * as Lora from '@remotion/google-fonts/Lora';

type Loader = { loadFont: (style: string, opts: Record<string, unknown>) => { fontFamily: string; waitUntilDone: () => Promise<unknown> } };

const LOADERS: Record<string, Loader> = {
  PlusJakartaSans, Inter, Poppins, Montserrat, Outfit, Figtree,
  ArchivoBlack, Anton, BebasNeue, Oswald, Rubik, Fredoka,
  LuckiestGuy, SpaceGrotesk, PlayfairDisplay, Lora,
} as unknown as Record<string, Loader>;

/**
 * Typography for the renderer.
 *
 * Three things this gets right that the naive `loadFont()` call does not:
 *
 *  1. **Only the font in use.** An EDL names one caption family. Loading all
 *     sixteen would be fifteen wasted font fetches on every cold render worker,
 *     paid per video, for type that never appears on screen.
 *  2. **Weight and subset discipline.** Unrestricted, the helper fetches every
 *     weight in every subset — dozens of requests before a single frame is
 *     drawn. Each family in the registry declares the weights it actually uses.
 *  3. **A font CDN must never fail a video.** If fonts.gstatic.com is slow,
 *     blocked by a corporate proxy, or unreachable from a locked-down render
 *     host, the render continues in a near-identical system stack. Captions in
 *     a fallback sans are enormously better than no video at all.
 *
 * `ensureCaptionFont` is idempotent, so a composition may call it on every
 * render without re-fetching.
 */
const loaded = new Set<string>();

/**
 * Stop a font's network failure from killing the render.
 *
 * `waitUntilDone()` is caught below, but that is not the only promise in play:
 * `@remotion/google-fonts` also drives `FontFace.load()`, whose rejection
 * surfaces as an unhandled rejection on the page — and Remotion treats an
 * unhandled page error as a failed render. So the documented promise ("a font
 * CDN must never fail a video") was not actually true: point a render at a
 * network where fonts.gstatic.com is unreachable — a corporate proxy, an
 * offline host, Google Fonts having a bad day — and the whole video failed
 * instead of falling back to the system stack.
 *
 * The guard is deliberately narrow. It swallows a rejection only when it names
 * a font host or reads as a font-loading network error; anything else still
 * fails the render, because a genuine bug in a composition should.
 */
let guardInstalled = false;
function guardFontFailures(): void {
  if (guardInstalled || typeof window === 'undefined') return;
  guardInstalled = true;

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const text = String(
      (reason && (reason.message ?? reason.toString?.())) ?? reason ?? '',
    );
    const isFontFailure =
      /fonts\.gstatic\.com|fonts\.googleapis\.com/.test(text) ||
      /A network error occurred/i.test(text) ||
      (reason instanceof Error && reason.name === 'NetworkError');

    if (!isFontFailure) return;
    event.preventDefault();
    console.warn('[easycut] a web font could not be fetched; rendering with the system stack');
  });
}

export function ensureCaptionFont(familyId: string): string {
  const font = CAPTION_FONTS.find((f) => f.id === familyId);
  if (!font) {
    // An EDL naming a family we do not ship is not worth failing a render over.
    console.warn(`[easycut] unknown caption font "${familyId}", using the system stack`);
    return FALLBACK_STACK;
  }

  const stack = fontStackFor(font.id);
  if (loaded.has(font.id)) return stack;
  loaded.add(font.id);

  guardFontFailures();

  const loader = LOADERS[font.module];
  if (!loader) return stack;

  try {
    const handle = delayRender(`Loading ${font.id}`, { timeoutInMilliseconds: 12_000 });
    const { waitUntilDone } = loader.loadFont('normal', {
      weights: font.weights,
      subsets: ['latin'],
      ignoreTooManyRequestsWarning: true,
    });
    waitUntilDone()
      .catch(() => {
        // Keep the family name — the browser falls through the stack on its own.
        console.warn(`[easycut] ${font.id} unavailable, rendering with the system stack`);
      })
      .finally(() => continueRender(handle));
  } catch {
    // The helper itself is unavailable (offline bundle). Nothing to wait for.
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
