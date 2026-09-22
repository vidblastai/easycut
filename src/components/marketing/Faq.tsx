'use client';

import { useState } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';

/**
 * The questions people actually ask before paying, in three groups.
 *
 * Grouped rather than one list of ten, because the three things somebody is
 * weighing are different in kind — will it make a good video, will I be able
 * to use it, and what is this going to cost me — and a flat list makes you
 * read all of the first to find out whether the third is answered.
 *
 * Every answer is checked against what the code actually does, and the numbers
 * are passed in from the plan definitions rather than typed here: a FAQ is the
 * part of a site people quote back at you, so it is the worst possible place
 * for a figure that used to be true.
 */

export interface FaqGroup {
  id: string;
  label: string;
  items: Array<{ q: string; a: React.ReactNode }>;
}

export function Faq({ groups }: { groups: FaqGroup[] }) {
  const [active, setActive] = useState(groups[0]?.id ?? '');
  const shown = groups.find((g) => g.id === active) ?? groups[0];
  if (!shown) return null;

  return (
    <section className="relative z-10 border-t border-line py-24">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-16">
        <div>
          <h2 className="text-3xl font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
            Still have questions?
          </h2>
          <p className="mt-4 max-w-[34ch] text-muted">
            Anything not answered here, ask — including the awkward ones about what happens to
            your footage.
          </p>
          <a href="mailto:hello@easycut.ai" className="btn-ghost mt-6 inline-flex">
            Contact us
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>

        <div>
          <div role="tablist" aria-label="Question topics" className="inline-flex rounded-full border border-line bg-charcoal p-1">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                role="tab"
                aria-selected={group.id === shown.id}
                data-faq-tab={group.id}
                onClick={() => setActive(group.id)}
                className={clsx(
                  'rounded-full px-4 py-2 text-[13px] font-bold transition-colors',
                  group.id === shown.id ? 'bg-chalk text-ink' : 'text-muted hover:text-chalk',
                )}
              >
                {group.label}
              </button>
            ))}
          </div>

          <div className="mt-6 border-t border-line-soft">
            {shown.items.map((item) => (
              /* `<details>` rather than more state: it opens before hydration,
                 it is keyboard accessible for free, and search engines read
                 the answers. `key` includes the group so switching tabs
                 collapses what was open rather than leaving a stray row. */
              <details key={`${shown.id}-${item.q}`} className="group border-b border-line-soft py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15.5px] font-bold tracking-[-0.01em] marker:hidden">
                  {item.q}
                  <span
                    aria-hidden
                    className="grid h-6 w-6 flex-none place-items-center rounded-full border border-line text-muted transition-transform group-open:rotate-45"
                  >
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </span>
                </summary>
                <p className="mt-3 max-w-[64ch] text-[14.5px] leading-relaxed text-muted">{item.a}</p>
              </details>
            ))}
          </div>

          <p className="mt-6 text-[13px] text-faint">
            The full detail on retention and sub-processors is in the{' '}
            <Link href="/privacy" className="font-semibold text-violet hover:underline">
              privacy policy
            </Link>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
