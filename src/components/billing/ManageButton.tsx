'use client';

import { useState } from 'react';
import { clsx } from 'clsx';

/**
 * "Manage your subscription" — a round trip to Stripe for a one-time URL.
 *
 * Same shape as the checkout button and for the same reason: a portal session
 * is per-customer and short-lived, so it cannot be a link rendered into the
 * page. The most likely failure here is not a network one but an unconfigured
 * portal in the Stripe dashboard, and the route turns that into a sentence
 * naming the page to go and fix, which is printed right here.
 */
export function ManageButton({ label = 'Manage subscription', className }: { label?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/billing/portal', { method: 'POST' });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !body.url) {
        setError(body.error ?? 'Could not open the billing portal.');
        setBusy(false);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError('Could not reach the server. Try again in a moment.');
      setBusy(false);
    }
  };

  return (
    <div className={clsx('min-w-0', className)}>
      <button type="button" onClick={open} disabled={busy} data-billing="portal" className="btn-ghost">
        {busy ? 'Opening…' : label}
      </button>
      {error ? (
        <p role="alert" className="mt-2 max-w-[46ch] text-[12px] leading-snug text-warn">
          {error}
        </p>
      ) : null}
    </div>
  );
}
