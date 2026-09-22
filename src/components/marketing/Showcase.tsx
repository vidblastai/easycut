'use client';

import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { SHOWCASE } from '@/content/showcase';

/**
 * Finished videos, playing.
 *
 * Renders nothing until `src/content/showcase.ts` has real exports in it. A
 * grid of stock footage captioned "made with EasyCut" is a claim about output
 * quality that nobody can check and that would not be true.
 *
 * Muted and looping until you click one, which is the convention every feed
 * has taught people: autoplay with sound is the fastest way to make somebody
 * close a tab, and a grid of static posters does not show that the cuts are
 * any good.
 */
export function Showcase() {
  const [playing, setPlaying] = useState<number | null>(null);
  const refs = useRef<Array<HTMLVideoElement | null>>([]);

  if (!SHOWCASE.length) return null;

  const toggle = (i: number) => {
    const el = refs.current[i];
    if (!el) return;
    // One at a time: several videos with sound is a mess, and the browser
    // will not let most of them play anyway.
    refs.current.forEach((other, j) => {
      if (other && j !== i) other.muted = true;
    });
    el.muted = !el.muted;
    void el.play().catch(() => {});
    setPlaying(el.muted ? null : i);
  };

  return (
    <section className="relative z-10 border-t border-line py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-[46ch] text-center">
          <h2 className="text-3xl font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
            These came out of EasyCut.
          </h2>
          <p className="mt-4 text-muted">
            Finished videos, nothing touched afterwards. Tap one for sound.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SHOWCASE.map((video, i) => (
            <button
              key={video.src}
              type="button"
              onClick={() => toggle(i)}
              aria-label={`${playing === i ? 'Mute' : 'Play'} ${video.who}’s video`}
              className="group relative block overflow-hidden rounded-2xl border border-line bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet"
              style={{ aspectRatio: '9 / 16' }}
            >
              <video
                ref={(el) => {
                  refs.current[i] = el;
                }}
                src={video.src}
                poster={video.poster ?? undefined}
                muted
                loop
                playsInline
                autoPlay
                preload="metadata"
                className="h-full w-full object-cover"
              />

              <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-ink/80 px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-chalk backdrop-blur">
                {video.who} · {formatSeconds(video.seconds)}
              </span>

              {video.style ? (
                <span className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-violet/85 px-2 py-1 text-[11px] font-bold text-ink">
                  {video.style}
                </span>
              ) : null}

              <span
                aria-hidden
                className={clsx(
                  'pointer-events-none absolute bottom-3 right-3 grid h-8 w-8 place-items-center rounded-full bg-ink/80 text-chalk backdrop-blur transition-opacity',
                  playing === i ? 'opacity-0' : 'opacity-100 group-hover:opacity-100',
                )}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M2 4.5a5.5 5.5 0 0 1 0 7M5 6a2.6 2.6 0 0 1 0 4M8.5 2.5 12 5v6l-3.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
