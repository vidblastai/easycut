'use client';

import React from 'react';
import { clsx } from 'clsx';
import type { BrollSource } from '@/lib/assets/ai-broll';

export interface BrollSourceOffer {
  source: BrollSource;
  label: string;
  body: string;
  /** What the whole video's inserts cost, in dollars. Zero for stock. */
  costUsd: number;
  /** Roughly how much longer the edit takes, in seconds. */
  waitSec: number;
  /** False when the key it needs is not set — shown, greyed, with the reason. */
  available: boolean;
  missing?: string;
  /**
   * How many inserts that price is for.
   *
   * On the tile because the number is the whole explanation for the price, and
   * because it is the figure that changes most between a short and a long
   * edit: the same style that cuts away four times in a minute cuts away
   * seventy-five times in ten. Without it, a long-form quote reads as the
   * software having got the sum wrong.
   */
  inserts?: number;
}

/**
 * Where the B-roll comes from: found, or made.
 *
 * ── Why the price is on the tile ────────────────────────────────────────
 *
 * Because it is the entire decision. These three options are not three
 * flavours of the same thing — they are free-and-instant, three-cents-and-
 * seconds, and dollars-and-minutes, and picking between them without the
 * numbers in front of you is picking blind. So the tile carries what this
 * video will cost and how much longer it will take, computed from the same
 * catalogue the pipeline bills against rather than from a sentence somebody
 * wrote once.
 *
 * ── Stock stays the default ─────────────────────────────────────────────
 *
 * Not out of caution. Stock search finds a literal calculator in 200ms for
 * nothing, and for most cues it is the better answer as well as the cheaper
 * one. Generation is for what a library has never filmed — your product, a
 * diagram, an abstraction — and that is a thing somebody knows about their own
 * video and the software does not.
 */
export function BrollSourcePicker({
  offers,
  value,
  onChange,
  className,
}: {
  offers: readonly BrollSourceOffer[];
  value: BrollSource;
  onChange: (source: BrollSource) => void;
  className?: string;
}) {
  // Every offer prices the same video, so any of them carries the count.
  const inserts = offers.find((o) => o.inserts)?.inserts ?? 0;
  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-bold">Where the B-roll comes from</h3>
        <span className="text-[12px] text-faint">
          {inserts ? `Priced for about ${inserts} insert${inserts === 1 ? '' : 's'}` : 'Stock is free and instant'}
        </span>
      </div>

      <ul className="mt-2 grid gap-2.5 sm:grid-cols-3">
        {offers.map((offer) => {
          const on = value === offer.source;
          return (
            <li key={offer.source}>
              <button
                type="button"
                disabled={!offer.available}
                onClick={() => onChange(offer.source)}
                aria-pressed={on}
                title={offer.available ? undefined : offer.missing}
                className={clsx(
                  'flex h-full w-full flex-col rounded-xl border p-3 text-left transition-colors',
                  on ? 'border-violet bg-violet/[0.07] ring-1 ring-violet/60' : 'border-line',
                  offer.available ? 'hover:border-line2' : 'cursor-not-allowed opacity-45',
                )}
              >
                <span className="text-[13px] font-bold">{offer.label}</span>
                <span className="mt-1 block flex-1 text-[11.5px] leading-snug text-muted">
                  {offer.available ? offer.body : offer.missing}
                </span>

                {offer.available ? (
                  <span className="mt-2.5 flex items-baseline gap-2 font-mono text-[11px] tabular-nums">
                    <span className={clsx(offer.costUsd > 0 ? 'text-chalk' : 'text-ok')}>
                      {offer.costUsd > 0 ? `$${offer.costUsd.toFixed(2)}` : 'free'}
                    </span>
                    <span className="text-faint">{formatWait(offer.waitSec)}</span>
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Only under the choice that costs minutes. A warning on a tile nobody
          picked is noise; on the one they just picked it is the thing they
          needed to know before the progress bar started. */}
      {value === 'ai-video' ? (
        <p className="mt-2.5 rounded-xl border border-warn/40 bg-warn/[0.08] px-3.5 py-2.5 text-[12px] leading-relaxed text-chalk/90">
          Generated clips come from a video model, so this edit will take minutes rather than seconds
          {inserts > 8 ? ` — and at ${inserts} inserts they will not all be made at once` : ''}. Anything
          that fails or times out falls back to a stock clip, and the cost report shows what was
          actually made.
        </p>
      ) : null}
    </div>
  );
}

function formatWait(seconds: number): string {
  if (seconds <= 0) return 'instant';
  if (seconds < 60) return `+${Math.round(seconds)}s`;
  return `+${Math.round(seconds / 60)} min`;
}
