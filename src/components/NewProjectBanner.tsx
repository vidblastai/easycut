'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { LogoMark } from '@/components/Logo';
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
          'rounded-[20px] px-6 py-11 text-ink transition-[transform,box-shadow] duration-200',
          'min-h-[140px] sm:py-14',
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

        {/* A timeline ruler along the bottom edge — the same ticks the studio
            draws under its tracks. It says "this is where footage becomes an
            edit" without a word, and it belongs to this app rather than to
            every other tool with a coloured rectangle on its dashboard. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-3"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, rgba(13,13,16,0.26) 0 1px, transparent 1px 12px),' +
              'repeating-linear-gradient(90deg, rgba(13,13,16,0.40) 0 1.5px, transparent 1.5px 60px)',
            backgroundSize: '100% 6px, 100% 11px',
            backgroundPosition: 'left bottom, left bottom',
            backgroundRepeat: 'repeat-x',
          }}
        />

        {/* The mark, whole, as a watermark on the right.
            It bled off that edge at first, which is exactly the wrong edge: the
            triangle points right, so the point — the only part that identifies
            it — was the part being cut. A mark you cannot recognise is not
            branding, it is a smudge. */}
        <LogoMark
          size={128}
          className={clsx(
            'pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 text-ink transition-opacity duration-300 sm:right-12',
            over ? 'opacity-[0.20]' : 'opacity-[0.13]',
          )}
        />

        {/* Centred and stacked. The icon-beside-label lockup is the shape every
            editor's dashboard already has. */}
        <span className="relative block text-center">
          <span className="block text-[24px] font-extrabold leading-tight tracking-[-0.035em] sm:text-[30px]">
            {over ? 'Drop it' : 'New video'}
          </span>
          <span className="mt-1 block text-[13px] font-semibold text-ink/65">
            {over ? 'Let go and we\u2019ll take it from here' : 'Drop your footage here, or click to browse'}
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
