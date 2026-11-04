'use client';

import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';

/**
 * A short real clip that plays only while it is on screen.
 *
 * Pickers hold twenty of these. Each loads nothing until it scrolls into view
 * and pauses again when it leaves, so a grid of real examples costs what the
 * visible few cost — the poster stands in until then.
 */
export function LoopVideo({
  src,
  poster,
  className,
  style,
}: {
  src: string;
  poster?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void el.play().catch(() => {});
        else el.pause();
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [src]);

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden
      className={clsx('h-full w-full object-cover', className)}
      style={style}
    />
  );
}
