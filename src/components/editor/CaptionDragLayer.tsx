'use client';

import React from 'react';
import { clsx } from 'clsx';
import {
  CAPTION_PLACEMENT_BOUNDS,
  framedPositionX,
  framedPositionY,
  framedWidthRatio,
  type CaptionStyle,
} from '@/lib/edl/types';

/**
 * Dragging the words around on the picture.
 *
 * ── Why this and not two number fields ──────────────────────────────────
 *
 * Because where a caption goes is a decision about what it is covering, and
 * you cannot see what it is covering from a number. "A bit higher, and over to
 * the left so it stops sitting on his hand" is one gesture here and a guessing
 * game anywhere else — which is what it was: `positionY` existed, the editor
 * could set it, and the renderer clamped it into a six-per-cent band, so the
 * only vertical positions the product actually offered were the six per cent
 * the presets were being held inside.
 *
 * ── The overlay maps 1:1 to the frame ───────────────────────────────────
 *
 * This is placed over the preview box, which already carries the
 * composition's aspect ratio and which the Player fills exactly — so there is
 * no letterboxing inside it and a fraction of this element IS a fraction of
 * the frame. Nothing here has to know the video's pixel size, which is the
 * part that usually goes wrong and goes wrong differently on every aspect.
 *
 * ── It writes a placement, not a positionY ──────────────────────────────
 *
 * `placement` is null until somebody drags, and null means the automatic rule.
 * Keeping those two states apart is what lets the band go on doing its job —
 * stopping twenty presets drifting away from each other — without it also
 * overruling a person who has said exactly where they want the words.
 */
export function CaptionDragLayer({
  style,
  onChange,
  className,
}: {
  style: CaptionStyle;
  /** Live, on every pointer move. Null puts the words back on the rule. */
  onChange: (placement: { x: number; y: number } | null) => void;
  className?: string;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const [snapped, setSnapped] = React.useState<'x' | 'y' | 'both' | null>(null);

  // Where the words are now, in the same fractions the renderer uses — so the
  // handle is over the caption rather than near it.
  const y = framedPositionY(style);
  const x = framedPositionX(style) ?? 0.5;
  const placed = style.placement !== null;

  /** The block's rough footprint, for something the size of the words to grab. */
  const widthFraction = framedWidthRatio(style);
  const heightFraction = Math.min(0.5, style.fontSizeRatio * style.lineHeight * Math.max(1, style.maxLines) * 1.35);

  const move = React.useCallback(
    (event: PointerEvent | React.PointerEvent, grab: { dx: number; dy: number }) => {
      const rect = box.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;

      let nx = (event.clientX - rect.left) / rect.width - grab.dx;
      let ny = (event.clientY - rect.top) / rect.height - grab.dy;

      /*
       * Snap to the middle and to where the rule would have put it.
       *
       * Both are places people aim for and neither is hittable by hand at this
       * size: the preview is a few hundred pixels wide, so dead centre is a
       * two-pixel target. Shift holds the exact position for the cases where a
       * caption is deliberately just off-centre.
       */
      const free = event.shiftKey;
      const SNAP = 0.02;
      const onX = !free && Math.abs(nx - 0.5) < SNAP;
      const onY = !free && Math.abs(ny - framedPositionY({ positionY: style.positionY })) < SNAP;
      if (onX) nx = 0.5;
      if (onY) ny = framedPositionY({ positionY: style.positionY });
      setSnapped(onX && onY ? 'both' : onX ? 'x' : onY ? 'y' : null);

      const [lowX, highX] = CAPTION_PLACEMENT_BOUNDS.x;
      const [lowY, highY] = CAPTION_PLACEMENT_BOUNDS.y;
      onChange({
        x: Math.min(highX, Math.max(lowX, nx)),
        y: Math.min(highY, Math.max(lowY, ny)),
      });
    },
    [onChange, style.positionY],
  );

  const start = (event: React.PointerEvent) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    /*
     * Grabbed by the point under the cursor, not by the centre.
     *
     * Without the offset the caption jumps so its middle is under the pointer
     * the instant you press, which reads as the drag having already moved
     * something before you moved anything.
     */
    const grab = {
      dx: (event.clientX - rect.left) / rect.width - x,
      dy: (event.clientY - rect.top) / rect.height - y,
    };

    setDragging(true);
    const onMove = (e: PointerEvent) => move(e, grab);
    const onUp = () => {
      setDragging(false);
      setSnapped(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // On the window, not the element: a fast drag leaves the handle behind and
    // an element listener stops getting moves the moment it does.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /** Arrow keys, for the last per cent that a pointer cannot land on. */
  const nudge = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.05 : 0.005;
    const by: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = by[event.key];
    if (!delta) return;
    event.preventDefault();
    const [lowX, highX] = CAPTION_PLACEMENT_BOUNDS.x;
    const [lowY, highY] = CAPTION_PLACEMENT_BOUNDS.y;
    onChange({
      x: Math.min(highX, Math.max(lowX, x + delta[0])),
      y: Math.min(highY, Math.max(lowY, y + delta[1])),
    });
  };

  const showing = hover || dragging;

  return (
    <div
      ref={box}
      className={clsx('absolute inset-0 z-10', className)}
      // The layer itself never takes the pointer — only the handle does — or
      // it would sit between the person and everything else on the picture.
      style={{ pointerEvents: 'none' }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      {/* The lines it snapped to, drawn only while they are holding. */}
      {dragging && (snapped === 'x' || snapped === 'both') ? (
        <span className="absolute inset-y-0 left-1/2 w-px bg-violet/70" />
      ) : null}
      {dragging && (snapped === 'y' || snapped === 'both') ? (
        <span
          className="absolute inset-x-0 h-px bg-violet/70"
          style={{ top: `${framedPositionY({ positionY: style.positionY }) * 100}%` }}
        />
      ) : null}

      <div
        role="slider"
        tabIndex={0}
        aria-label="Caption position"
        aria-valuetext={`${Math.round(x * 100)}% across, ${Math.round(y * 100)}% down`}
        aria-valuenow={Math.round(y * 100)}
        aria-valuemin={Math.round(CAPTION_PLACEMENT_BOUNDS.y[0] * 100)}
        aria-valuemax={Math.round(CAPTION_PLACEMENT_BOUNDS.y[1] * 100)}
        onPointerDown={start}
        onKeyDown={nudge}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className={clsx(
          'absolute rounded-lg border-2 border-dashed outline-none transition-colors',
          dragging ? 'cursor-grabbing border-violet bg-violet/10' : 'cursor-grab',
          !dragging && showing ? 'border-chalk/60 bg-chalk/[0.06]' : null,
          !showing ? 'border-transparent' : null,
        )}
        style={{
          pointerEvents: 'auto',
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          width: `${widthFraction * 100}%`,
          height: `${heightFraction * 100}%`,
          transform: 'translate(-50%, -50%)',
          touchAction: 'none',
        }}
      >
        {showing ? (
          <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink/90 px-2 py-0.5 font-mono text-[10px] tabular-nums text-chalk shadow-card">
            {Math.round(x * 100)}% · {Math.round(y * 100)}%
          </span>
        ) : null}

        {/* Only once there is something to undo. A reset offered before the
            first drag is a control for a state nobody is in. */}
        {placed && showing && !dragging ? (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onChange(null)}
            className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-ink/90 px-2 py-0.5 text-[10.5px] font-semibold text-muted hover:text-chalk"
          >
            Put it back
          </button>
        ) : null}
      </div>
    </div>
  );
}
