'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { IconCheck } from '@/components/shell/Icons';

/**
 * Copy, with the one thing a copy button has to get right: saying it worked.
 *
 * Without the confirmation people click twice, then select the text by hand
 * anyway, which is the state this replaced. The fallback matters too —
 * `navigator.clipboard` is undefined on a page served over plain HTTP, which
 * is exactly how this app runs on someone's own machine.
 */
export function CopyButton({
  text,
  label = 'Copy',
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const field = document.createElement('textarea');
        field.value = text;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        document.execCommand('copy');
        field.remove();
      }
      setState('done');
    } catch {
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 2200);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition-colors',
        state === 'done'
          ? 'border-ok/40 text-ok'
          : state === 'failed'
            ? 'border-bad/40 text-bad'
            : 'border-line text-muted hover:bg-charcoal2 hover:text-chalk',
        className,
      )}
    >
      {state === 'done' ? <IconCheck className="h-3 w-3" /> : null}
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Select it manually' : label}
    </button>
  );
}
