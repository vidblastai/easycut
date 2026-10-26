'use client';

import React from 'react';
import { clsx } from 'clsx';
import { MAX_INSPO, VISUAL_INSPO } from '@/lib/assets/visual-inspo';

/**
 * Pick the looks you like, by pointing at them.
 *
 * Multi-select, ordered, capped at three. The order shows on the tile as a
 * number because it is a real choice: the first pick sets the world the
 * animated scenes are drawn in, and the made inserts cycle through the picks
 * in this order. A fourth click does nothing rather than silently dropping
 * the first — somebody who wants to swap one out should see that they have to.
 *
 * Nothing picked is a valid answer and means the default realism, so the
 * screen never blocks the wizard.
 */
export function InspoPicker({
  value,
  onChange,
  className,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  className?: string;
}) {
  const full = value.length >= MAX_INSPO;

  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else if (!full) onChange([...value, id]);
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[12.5px] text-muted">
          {value.length
            ? `${value.length} of ${MAX_INSPO} picked — the first one leads.`
            : `Pick up to ${MAX_INSPO}. Skip it and the pictures stay realistic.`}
        </p>
        {value.length ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[12.5px] text-muted underline decoration-line underline-offset-4 hover:text-chalk"
          >
            Clear
          </button>
        ) : null}
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {VISUAL_INSPO.map((inspo) => {
          const order = value.indexOf(inspo.id);
          const on = order >= 0;
          const locked = !on && full;
          return (
            <li key={inspo.id} className="flex">
              <button
                type="button"
                data-inspo={inspo.id}
                aria-pressed={on}
                disabled={locked}
                onClick={() => toggle(inspo.id)}
                className={clsx(
                  'group flex h-full w-full flex-col overflow-hidden rounded-2xl border text-left transition-colors',
                  on ? 'border-violet ring-1 ring-violet/60' : 'border-line hover:border-line2',
                  locked && 'cursor-not-allowed opacity-45',
                )}
              >
                <span
                  className="relative block aspect-[4/5] w-full"
                  style={{ background: `${inspo.figure}, ${inspo.paint}` }}
                >
                  {/* A soft vignette, so every tile reads as a photograph
                      rather than a colour swatch. */}
                  <span
                    className="absolute inset-0"
                    style={{ background: 'radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,.28) 100%)' }}
                  />
                  {on ? (
                    <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-violet text-[12px] font-bold text-ink tabular-nums">
                      {order + 1}
                    </span>
                  ) : null}
                </span>
                <span className={clsx('block flex-1 px-3 py-2.5', on ? 'bg-violet-dim' : 'bg-charcoal group-hover:bg-charcoal2')}>
                  <span className="block text-[13.5px] font-bold">{inspo.name}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">{inspo.blurb}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
