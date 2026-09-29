'use client';

import React from 'react';
import { OVERLAY_COPY } from '@/lib/edl/overlay-copy';
import { OverlayGrid } from '@/components/broll/OverlaySwatch';
import type { BrollOverlay } from '@/lib/edl/types';

/**
 * What every insert in this video wears.
 *
 * The grid itself lives in `OverlaySwatch`, shared with the editor's panel, so
 * the same twelve options look the same in both places and a treatment added
 * to the list appears in both with no further work. What belongs here and
 * nowhere else is the "let the style choose" state: up front, before anything
 * is cut, "nothing chosen" means the edit style's own pick, and the header
 * says which one that is rather than leaving it abstract.
 */
export function OverlayPicker({
  value,
  onChange,
  styleDefault,
  className,
}: {
  /** The chosen treatment, or null for "whatever this edit style does". */
  value: BrollOverlay | null;
  onChange: (overlay: BrollOverlay | null) => void;
  /** What the style would pick, so "let the style choose" means something. */
  styleDefault: BrollOverlay;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-bold">What the inserts wear</h3>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[12px] text-muted underline decoration-line underline-offset-4 hover:text-chalk"
          >
            Let the style choose
          </button>
        ) : (
          <span className="text-[12px] text-faint">
            The style&rsquo;s own pick &mdash; {OVERLAY_COPY[styleDefault].label.toLowerCase()}
          </span>
        )}
      </div>

      <OverlayGrid value={value} onPick={onChange} />
    </div>
  );
}
