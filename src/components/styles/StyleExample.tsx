'use client';

import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import type { Layout } from '@/lib/edl/types';
import { styleExample, type ExampleFormat } from '@/content/style-examples';
import { StylePreview } from '@/components/styles/StylePreview';

/**
 * A style's real example edit, playing — or its drawn preview when there is no
 * example yet.
 *
 * A picker can hold fifteen of these, so each one loads nothing until it
 * scrolls into view and pauses again when it leaves: fifteen videos decoding at
 * once would stall a phone. Muted and looping, like a feed.
 */
export function StyleExample({
  style,
  layout,
  aspect,
  accent,
  className,
  chapterCards,
}: {
  style: string;
  layout: Layout;
  aspect: '9:16' | '16:9';
  accent: string;
  className?: string;
  chapterCards?: boolean;
}) {
  const format: ExampleFormat = aspect === '9:16' ? 'short' : 'long';
  // A style made only for one shape still has a real example in that shape;
  // cropped to the tile, the middle of the frame — where the speaker is —
  // shows better than a drawing.
  const example = styleExample(style, format) ?? styleExample(style, format === 'short' ? 'long' : 'short');
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
  }, [example?.src]);

  if (!example) return <StylePreview layout={layout} aspect={aspect} accent={accent} className={className} chapterCards={chapterCards} />;

  return (
    <div
      className={clsx('relative overflow-hidden rounded-[10px] bg-ink', className)}
      style={{ aspectRatio: aspect === '9:16' ? '9 / 16' : '16 / 9' }}
    >
      <video
        ref={ref}
        src={example.src}
        poster={example.poster}
        muted
        loop
        playsInline
        preload="none"
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
  );
}
