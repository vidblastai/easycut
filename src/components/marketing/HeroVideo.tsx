'use client';

import { useRef, useState } from 'react';

/**
 * A real finished video, playing in a phone, next to the headline.
 *
 * The one thing a visitor wants to know about a video editor is what comes
 * out of it, and a drawing cannot answer that. This is an actual EasyCut
 * export of one raw take: muted and looping until it is tapped, the way every
 * feed has taught people to expect, because autoplay with sound closes tabs.
 */
export function HeroVideo({ src, poster }: { src: string; poster: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    el.muted = !el.muted;
    if (!el.muted) el.currentTime = 0;
    void el.play().catch(() => {});
    setMuted(el.muted);
  };

  return (
    <figure className="mx-auto w-full max-w-[300px] sm:max-w-[320px]">
      <button
        type="button"
        onClick={toggle}
        aria-label={muted ? 'Play the example with sound' : 'Mute the example'}
        className="group relative block w-full overflow-hidden rounded-[34px] border-[6px] border-[#1E1E25] bg-ink shadow-[0_40px_120px_-30px_rgba(155,123,255,0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet"
        style={{ aspectRatio: '9 / 16' }}
      >
        <video
          ref={ref}
          src={src}
          poster={poster}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <span className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-black/65 px-3 py-1.5 text-[12.5px] font-semibold text-white backdrop-blur transition group-hover:bg-black/80">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M11 5 6 9H3v6h3l5 4z" />
            {muted ? <path d="m22 9-6 6m0-6 6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />}
          </svg>
          {muted ? 'Tap for sound' : 'Sound on'}
        </span>
      </button>
      <figcaption className="mt-3 text-center text-[12.5px] text-muted">
        A real EasyCut edit of one raw phone take.
      </figcaption>
    </figure>
  );
}
