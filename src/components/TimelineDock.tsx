'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The bottom dock, with a top edge you can drag.
 *
 * It used to be a fixed 38% of the window, which is a reasonable default and
 * the wrong answer for half the work done in it. Seven lanes, a ruler, a
 * toolbar and the inspector do not fit in 340 pixels on a laptop, so setting a
 * caption's words — the most common edit there is — meant scrolling a panel to
 * find the field and scrolling back to see what changed. Meanwhile the opposite
 * is true while you are watching the picture: then the dock is in the way.
 *
 * Every editing suite solves this the same way, by letting you drag the seam.
 * The size is remembered per browser, because the right split is a property of
 * the person and their screen rather than of the video.
 */

const MIN_VH = 22;
const MAX_VH = 74;
const DEFAULT_VH = 38;
const STORAGE_KEY = 'easycut.dock-height-vh';

export function TimelineDock({ children }: { children: React.ReactNode }) {
  const [vh, setVh] = useState(DEFAULT_VH);
  const vhRef = useRef(vh);
  vhRef.current = vh;

  // Read after mount, never during render: the server has no localStorage, and
  // a height that differs between the two is a hydration mismatch.
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(saved) && saved >= MIN_VH && saved <= MAX_VH) setVh(saved);
    } catch {
      /* private browsing, blocked storage — the default is fine */
    }
  }, []);

  const remember = useCallback((next: number) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(Math.round(next)));
    } catch {
      /* nothing to do about it, and nothing depends on it */
    }
  }, []);

  const drag = useRef<{ startY: number; startVh: number } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startVh: vhRef.current };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const from = drag.current;
    if (!from) return;
    // Dragging UP makes the dock taller, which is the direction the edge moves.
    const grown = ((from.startY - event.clientY) / window.innerHeight) * 100;
    setVh(clamp(from.startVh + grown, MIN_VH, MAX_VH));
  };

  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    remember(vhRef.current);
  };

  const nudge = (by: number) => {
    const next = clamp(vhRef.current + by, MIN_VH, MAX_VH);
    setVh(next);
    remember(next);
  };

  return (
    <div className="flex-none border-t border-line-soft bg-[#0B0B0E]" style={{ height: `${vh}vh` }}>
      {/* The seam. Thin to look at, 10px to hit — a 2px grab target is a target
          you fight with, and this one sits right where the pointer travels. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the timeline"
        aria-valuenow={Math.round(vh)}
        aria-valuemin={MIN_VH}
        aria-valuemax={MAX_VH}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => { setVh(DEFAULT_VH); remember(DEFAULT_VH); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') { event.preventDefault(); nudge(3); }
          if (event.key === 'ArrowDown') { event.preventDefault(); nudge(-3); }
        }}
        className="group -mt-px flex h-2.5 w-full cursor-row-resize touch-none items-center justify-center outline-none"
      >
        <span className="h-[3px] w-10 rounded-full bg-line transition-colors group-hover:bg-violet group-focus-visible:bg-violet" />
      </div>

      <div className="h-[calc(100%-0.625rem)] overflow-y-auto px-3 pb-3">{children}</div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
