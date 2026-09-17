'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';

/**
 * How much footage is left this month, at the bottom of the sidebar.
 *
 * A meter is only worth showing if it changes a decision, so this one earns its
 * place by appearing before the refusal rather than after it: the moment
 * somebody is close to the line, the bar turns and the upgrade link appears. A
 * person who discovers their allowance at the point of being turned away feels
 * tricked; the same fact, seen a week earlier, is just information.
 *
 * It fetches for itself rather than being threaded as a prop through every page
 * that renders the shell — one small request, no prop drilling, and the read
 * also rolls the billing period forward when it is due.
 */

interface Usage {
  metered: boolean;
  plan?: { id: string; name: string; footageMinutes: number };
  minutesUsed?: number;
  minutesRemaining?: number;
  periodEnd?: string;
}

export function UsageMeter() {
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/usage')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (live) setUsage(data); })
      // A meter that cannot load is a meter that shows nothing. It is not
      // worth an error state in a sidebar.
      .catch(() => {});
    return () => { live = false; };
  }, []);

  if (!usage?.metered || !usage.plan) return null;

  const total = usage.plan.footageMinutes;
  const used = Math.min(total, usage.minutesUsed ?? 0);
  const fraction = total > 0 ? used / total : 0;
  const low = fraction >= 0.8;
  const empty = (usage.minutesRemaining ?? 0) <= 0;

  return (
    <div className="hidden border-t border-line-soft px-4 pb-1 pt-3 md:block">
      <div className="flex items-baseline justify-between gap-2">
        <span className="eyebrow">{usage.plan.name}</span>
        <span
          className={clsx(
            'font-mono text-[10.5px] tabular-nums',
            empty ? 'text-bad' : low ? 'text-warn' : 'text-faint',
          )}
        >
          {Math.round(used)}/{total} min
        </span>
      </div>

      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink">
        <div
          className={clsx(
            'h-full rounded-full transition-[width] duration-500',
            empty ? 'bg-bad' : low ? 'bg-warn' : 'bg-violet',
          )}
          style={{ width: `${Math.max(2, fraction * 100)}%` }}
        />
      </div>

      <p className="mt-1.5 text-[10.5px] leading-snug text-faint">
        {empty ? (
          <>
            No footage left this month.{' '}
            <Link href="/pricing" className="font-semibold text-violet hover:underline">
              Upgrade
            </Link>
          </>
        ) : low ? (
          <>
            {Math.round(usage.minutesRemaining ?? 0)} min left.{' '}
            <Link href="/pricing" className="font-semibold text-violet hover:underline">
              Need more?
            </Link>
          </>
        ) : (
          <>Resets {formatReset(usage.periodEnd)}</>
        )}
      </p>
    </div>
  );
}

function formatReset(iso: string | undefined): string {
  if (!iso) return 'monthly';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'monthly';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
