import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

/**
 * A place on the marketing page for a real recording to go.
 *
 * Drop a file into `public/marketing` named after the slot — `hero.mp4`,
 * `before-after.gif`, `captions.webm` — and it appears here on the next
 * request. Until then the slot draws itself, so the page is never a grey box
 * with "video coming soon" in it, and never ships a broken <img>.
 *
 * Videos autoplay muted and looping, which is the only kind of autoplay a
 * browser allows and the only kind worth having: this is an illustration, not
 * something anyone chose to watch. `playsInline` keeps iOS from taking the
 * whole screen for it.
 *
 * Order matters. A hand-made recording of the real thing beats anything drawn
 * in CSS, so a file always wins — but the drawn version has to be good enough
 * to ship on its own, because on day one it is what everybody sees.
 */

const EXTENSIONS = ['webm', 'mp4', 'gif', 'webp', 'png', 'jpg'] as const;
const VIDEO = new Set(['webm', 'mp4']);

/** Which file, if any, is standing in this slot right now. */
function resolve(slot: string): { src: string; ext: string } | null {
  for (const ext of EXTENSIONS) {
    const file = `marketing/${slot}.${ext}`;
    if (existsSync(join(process.cwd(), 'public', file))) return { src: `/${file}`, ext };
  }
  return null;
}

export function MediaSlot({
  slot,
  alt,
  className,
  children,
}: {
  /** Base filename under public/marketing, without the extension. */
  slot: string;
  /** Read out when the slot holds a real file. The drawn fallback is decorative. */
  alt: string;
  className?: string;
  /** What to draw when there is no file — not a placeholder, a finished thing. */
  children: ReactNode;
}) {
  const found = resolve(slot);
  if (!found) return <>{children}</>;

  if (VIDEO.has(found.ext)) {
    return (
      <video
        className={clsx('block h-full w-full object-cover', className)}
        src={found.src}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={alt}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={clsx('block h-full w-full object-cover', className)} src={found.src} alt={alt} />
  );
}
