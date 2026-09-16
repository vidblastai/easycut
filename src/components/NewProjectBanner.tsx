'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { IconPlus } from '@/components/shell/Icons';
import { looksLikeVideo, setPendingUpload } from '@/lib/ui/pending-upload';

/**
 * The one thing this app is for, at the top of the screen.
 *
 * It is a button and a drop target at once, because those are the same
 * intention and making someone choose between them costs a screen. Dropping
 * footage here does not upload from the dashboard — it carries the file into
 * the wizard with the first question already answered, so the flow is still
 * one flow rather than two ways in that behave differently.
 *
 * The window-level drag listener is what makes it discoverable: the moment a
 * file is over the page the banner lights up, so nobody has to guess whether
 * this is a target or just a button.
 */
export function NewProjectBanner() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [armed, setArmed] = useState(false);   // a file is somewhere over the page
  const [over, setOver] = useState(false);     // …and specifically over this
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      if (!looksLikeVideo(file)) {
        setError(`${file.name} is not a video. MP4, MOV and WebM all work.`);
        return;
      }
      setError(null);
      setPendingUpload(file);
      router.push('/new');
    },
    [router],
  );

  // Light up while a file is over the page. `dragenter`/`dragleave` fire for
  // every element the pointer crosses, so the counter is what stops it
  // flickering off each time the cursor moves between two children.
  useEffect(() => {
    let depth = 0;
    const isFile = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

    const enter = (e: DragEvent) => {
      if (!isFile(e)) return;
      depth += 1;
      setArmed(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setArmed(false);
    };
    const drop = () => {
      depth = 0;
      setArmed(false);
    };
    // Without this the browser navigates away to the dropped file.
    const over_ = (e: DragEvent) => {
      if (isFile(e)) e.preventDefault();
    };

    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over_);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over_);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          accept(e.dataTransfer.files?.[0]);
        }}
        className={clsx(
          'group relative flex w-full items-center justify-center overflow-hidden',
          'rounded-[20px] px-6 py-10 text-ink transition-[transform,box-shadow] duration-200',
          'min-h-[128px] sm:py-12',
          over ? 'scale-[1.005] shadow-glow' : 'hover:-translate-y-0.5 hover:shadow-glow',
        )}
        style={{
          transitionTimingFunction: 'var(--ease)',
          // A flat fill at this size reads as a coloured rectangle. The sheen is
          // one radial highlight from the top-left, which is where light comes
          // from everywhere else in this interface.
          background:
            'radial-gradient(130% 190% at 10% -40%, rgba(255,255,255,0.30), rgba(255,255,255,0) 58%),' +
            'linear-gradient(103deg, #7A57F0 0%, #9B7BFF 52%, #B7A2FF 100%)',
        }}
      >
        {/* The dashed inset only appears with a file in the air, so the button
            looks like a button until the moment it needs to look like a target. */}
        <span
          aria-hidden
          className={clsx(
            'pointer-events-none absolute inset-2.5 rounded-[14px] border-2 border-dashed transition-opacity duration-200',
            armed ? 'border-ink/35 opacity-100' : 'opacity-0',
          )}
        />

        <span className="relative flex items-center gap-4">
          <span
            className={clsx(
              'grid h-11 w-11 flex-none place-items-center rounded-xl bg-ink/90 transition-transform duration-200',
              over ? 'scale-110' : 'group-hover:scale-105',
            )}
          >
            <IconPlus className="h-5 w-5 text-violet" />
          </span>
          <span className="text-left">
            <span className="block text-[21px] font-extrabold tracking-[-0.03em] sm:text-[24px]">
              {over ? 'Drop it' : 'New video'}
            </span>
            <span className="block text-[13px] font-semibold text-ink/65">
              {over ? 'Let go and we\u2019ll take it from here' : 'Drop your footage here, or click to browse'}
            </span>
          </span>
        </span>

        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => accept(e.target.files?.[0])}
        />
      </button>

      {error ? (
        <p role="alert" className="mt-2.5 text-[12.5px] text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
