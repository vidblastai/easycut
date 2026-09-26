'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * What the editor's playback actually costs, on the machine watching it.
 *
 * Turned on with `?perf` in the address bar and off the rest of the time. It
 * exists because a stutter is a property of a machine, a codec and a file, and
 * none of those travel: a preview that keeps perfect time on one computer can
 * hitch on every cut on another, and there is no way to tell which from the
 * outside. This reports the two numbers that settle it — how many frames the
 * browser missed, and the longest single gap between them — plus where the
 * worst gap landed relative to the nearest cut, which is the difference
 * between "everything is slow" and "the cuts are".
 */
export function PlaybackMeter({ cutsSec, playheadSec }: { cutsSec: number[]; playheadSec: () => number }) {
  const [line, setLine] = useState('measuring…');
  const state = useRef({ last: 0, frames: 0, dropped: 0, worst: 0, worstAt: 0, since: 0 });

  useEffect(() => {
    let raf = 0;
    const tick = (t: number) => {
      const s = state.current;
      if (s.last) {
        const gap = t - s.last;
        s.frames += 1;
        // Anything past a frame and a half at 60Hz is a frame the screen
        // repeated — that is what "it stutters" means, measured.
        if (gap > 25) s.dropped += 1;
        if (gap > s.worst) { s.worst = gap; s.worstAt = playheadSec(); }
      }
      s.last = t;
      if (!s.since) s.since = t;
      if (t - s.since >= 1000) {
        const nearest = cutsSec.reduce<number | null>(
          (best, c) => (best === null || Math.abs(c - s.worstAt) < Math.abs(best - s.worstAt) ? c : best),
          null,
        );
        const rel = nearest === null ? '—' : `${(s.worstAt - nearest).toFixed(2)}s from a cut`;
        setLine(
          `${Math.round((s.frames * 1000) / (t - s.since))} fps · ${s.dropped} dropped · worst ${Math.round(s.worst)}ms · ${rel}`,
        );
        s.frames = 0; s.dropped = 0; s.worst = 0; s.since = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cutsSec, playheadSec]);

  return (
    <div
      style={{ fontVariantNumeric: 'tabular-nums' }}
      className="pointer-events-none absolute left-3 top-3 z-50 rounded-md bg-black/75 px-2 py-1 text-[11px] font-medium text-white"
    >
      {line}
    </div>
  );
}
