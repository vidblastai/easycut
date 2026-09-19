'use client';

import { useState } from 'react';
import { clsx } from 'clsx';

/**
 * The button that takes the money.
 *
 * It POSTs and then navigates, rather than being a plain link to a checkout
 * URL, because a Stripe checkout session has to be created per customer at the
 * moment they click — a URL baked into the page at build time would be one
 * session shared by everybody who ever loads it.
 *
 * Every failure is shown under the button in words. A payment button that
 * silently does nothing is the most expensive bug a product can ship: the
 * customer concludes the product is broken, and nothing in any log says a
 * person tried to pay and could not.
 */
export function PlanButton({
  plan,
  label,
  featured,
  /** False when there is no Stripe key — then this is an ordinary sign-up link. */
  buyable,
  className,
}: {
  plan: string;
  label: string;
  featured?: boolean;
  buyable: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };

      if (response.status === 401) {
        // Not signed in. Come back to this plan afterwards rather than dropping
        // them on a dashboard having forgotten what they were doing.
        //
        // A whole-page navigation rather than the router: sign-in is a
        // different auth context, and `useRouter().push` needs React context
        // this button cannot count on having — on a deployment without the
        // auth provider mounted it throws, and the button dies mid-click with
        // the spinner still on it.
        setBusy(false);
        window.location.href = `/sign-in?redirect_url=${encodeURIComponent(`/pricing?plan=${plan}`)}`;
        return;
      }
      if (!response.ok || !body.url) {
        setError(body.error ?? 'Could not start checkout. Try again in a moment.');
        setBusy(false);
        return;
      }
      // A full navigation, not router.push: checkout is on Stripe's domain.
      window.location.href = body.url;
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  };

  if (!buyable) {
    return (
      <a href="/new" className={clsx(featured ? 'btn-primary' : 'btn-ghost', 'w-full justify-center', className)}>
        {label}
      </a>
    );
  }

  return (
    <div className={clsx('w-full', className)}>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        data-plan={plan}
        className={clsx(featured ? 'btn-primary' : 'btn-ghost', 'w-full justify-center')}
      >
        {busy ? 'Opening checkout…' : label}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-[12px] leading-snug text-warn">
          {error}
        </p>
      ) : null}
    </div>
  );
}
