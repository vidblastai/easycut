'use client';

import React from 'react';
import { clsx } from 'clsx';
import { IconCheck } from '@/components/shell/Icons';

/**
 * The pieces of "What goes in it", rebuilt to be read at a glance.
 *
 * The step used to be one page seven sections tall: every layer with a
 * paragraph, then every caption look, all twenty-five scene looks, the B-roll
 * source, its treatment and the transitions, stacked. Every option was there,
 * which was right, and every option was on screen at once, which was not —
 * nobody could see what they were actually getting.
 *
 * Now the step is a short summary of the edit. The layers are a grid of real
 * stills, one tap each. Every look is a row that says what you will get, with
 * a picture of it, and opens its picker in place when you want to change it.
 */

export interface LayerTile {
  key: string;
  label: string;
  /** One short line. */
  body: string;
  /** A real still of the layer, under /public. Omitted, a drawn stand-in. */
  image?: string;
}

export function LayerGrid({
  layers,
  on,
  onToggle,
}: {
  layers: LayerTile[];
  on: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  return (
    <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
      {layers.map((layer) => {
        const active = on[layer.key];
        return (
          <li key={layer.key}>
            <button
              type="button"
              data-layer={layer.key}
              aria-pressed={active}
              onClick={() => onToggle(layer.key)}
              title={layer.body}
              className={clsx(
                'group relative block w-full overflow-hidden rounded-xl border text-left transition-colors',
                active ? 'border-violet/60 bg-violet-dim' : 'border-line bg-charcoal hover:border-line2',
              )}
            >
              <span className="relative block aspect-square overflow-hidden bg-ink">
                {layer.image ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={layer.image}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className={clsx(
                      'h-full w-full object-cover transition duration-200',
                      active ? '' : 'opacity-35 grayscale',
                    )}
                  />
                ) : (
                  <IconCardStandIn dim={!active} />
                )}
                <span
                  aria-hidden
                  className={clsx(
                    'absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full border transition-colors',
                    active ? 'border-violet bg-violet text-ink' : 'border-white/40 bg-black/40',
                  )}
                >
                  {active ? <IconCheck className="h-3 w-3" /> : null}
                </span>
              </span>
              <span className="block px-2.5 py-2">
                <span className={clsx('block truncate text-[12.5px] font-bold', active ? '' : 'text-muted')}>{layer.label}</span>
                <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted">{layer.body}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** An icon card as the renderer draws one: a rounded chip, an icon, a word. */
function IconCardStandIn({ dim }: { dim: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className={clsx('h-full w-full transition', dim ? 'opacity-35 grayscale' : '')} role="presentation">
      <defs>
        <linearGradient id="icon-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2A2A36" />
          <stop offset="1" stopColor="#101016" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill="url(#icon-ground)" />
      <rect x="26" y="24" width="48" height="52" rx="12" fill="#F4F2EE" />
      <circle cx="50" cy="45" r="11" fill="none" stroke="#9B7BFF" strokeWidth="4" />
      <path d="M50 39v6l4 3" fill="none" stroke="#9B7BFF" strokeWidth="3.5" strokeLinecap="round" />
      <rect x="36" y="62" width="28" height="5" rx="2.5" fill="#1A1A22" opacity="0.7" />
    </svg>
  );
}

/**
 * One line of the edit: what it is, what you are getting, and a way to change
 * it. Opens its picker underneath itself rather than sending you anywhere.
 */
export function SettingRow({
  label,
  value,
  hint,
  thumb,
  open,
  onToggle,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  thumb: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={clsx('overflow-hidden rounded-2xl border transition-colors', open ? 'border-violet/50 bg-charcoal' : 'border-line bg-charcoal')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3.5 p-3 text-left hover:bg-charcoal2/60"
      >
        <span className="block h-[68px] w-[52px] flex-none overflow-hidden rounded-lg border border-line bg-ink">{thumb}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11.5px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</span>
          <span className="mt-0.5 block truncate text-[15px] font-bold">{value}</span>
          {hint ? <span className="mt-0.5 block truncate text-[12px] text-muted">{hint}</span> : null}
        </span>
        <span
          className={clsx(
            'flex-none rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors',
            open ? 'border-violet bg-violet text-ink' : 'border-line text-chalk',
          )}
        >
          {open ? 'Done' : 'Change'}
        </span>
      </button>
      {open ? <div className="border-t border-line px-3.5 pb-4 pt-1">{children}</div> : null}
    </div>
  );
}

/** A still filling a row's thumbnail. */
export function Thumb({ src, position = 'center' }: { src: string; position?: string }) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" style={{ objectPosition: position }} />
  );
}
