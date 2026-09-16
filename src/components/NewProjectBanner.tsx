'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { LogoMark } from '@/components/Logo';
import { IconUpload } from '@/components/shell/Icons';
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
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      if (!looksLikeVideo(file)) {
        setError(`${file.name} is not a video. MP4, MOV and WebM all work.`);
        return;
      }
      setError(null);
      setOver(false);
      setPendingUpload(file);

      // The routing and the next screen's mount take about this long anyway.
      // The animation spends that time saying "got it" rather than leaving the
      // click looking like it did nothing — which is what makes people click a
      // second time. Someone who has asked for less motion just goes.
      const reduced =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        router.push('/new');
        return;
      }
      setSending(true);
      window.setTimeout(() => router.push('/new'), 560);
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
        disabled={sending}
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
          over ? 'scale-[1.01] shadow-glow' : 'hover:-translate-y-0.5 hover:shadow-glow',
          sending && 'ec-accept shadow-glow',
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
        {/* The surface itself has to answer "can I let go here?", not just the
            outline. A white wash over the gradient does it in one transition
            that works everywhere — interpolating between two gradients does
            not animate in every browser, so swapping `background-image` would
            snap on some machines and slide on others. */}
        <span
          aria-hidden
          className={clsx(
            'pointer-events-none absolute inset-0 bg-white transition-opacity duration-200',
            over ? 'opacity-[0.22]' : 'opacity-0 group-hover:opacity-[0.08]',
          )}
          style={{ transitionTimingFunction: 'var(--ease)' }}
        />

        {/* Two stages, because they answer different questions. A file is
            somewhere over the page: a dashed outline says "there is a target
            here". A file is over THIS: the outline goes solid and closes in,
            saying "this one, let go". */}
        <span
          aria-hidden
          className={clsx(
            'pointer-events-none absolute rounded-[14px] border-2 transition-all duration-200',
            over
              ? 'inset-[7px] border-solid border-ink/55 opacity-100'
              : armed
                ? 'inset-2.5 border-dashed border-ink/35 opacity-100'
                : 'inset-2.5 border-dashed border-ink/35 opacity-0',
          )}
          style={{ transitionTimingFunction: 'var(--ease)' }}
        />

        {/* A timeline ruler along the bottom edge — the same ticks the studio
            draws under its tracks. It says "this is where footage becomes an
            edit" without a word, and it belongs to this app rather than to
            every other tool with a coloured rectangle on its dashboard. */}
        <span
          aria-hidden
          className={clsx('pointer-events-none absolute inset-x-0 bottom-0 h-3', sending && 'ec-scrub')}
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

        {/* Centred and stacked, with the disc above rather than beside — the
            icon-beside-label lockup is the shape every editor's dashboard
            already has. */}
        <span className="relative flex flex-col items-center text-center">
          <span className="relative mb-3 grid h-[54px] w-[54px] place-items-center">
            {/* The ring that goes out after the arrow. Rendered only while
                sending so it cannot be seen sitting still at scale 1. */}
            {sending ? (
              <span
                aria-hidden
                className="ec-ripple absolute inset-0 rounded-full border-2 border-ink/50"
              />
            ) : null}
            <span
              className={clsx(
                'relative grid h-[54px] w-[54px] place-items-center overflow-hidden rounded-full bg-ink/90 transition-transform duration-200',
                over ? 'scale-110' : 'group-hover:scale-105',
              )}
              style={{ transitionTimingFunction: 'var(--ease)' }}
            >
              {/* The disc clips, so the arrow leaves through its top edge
                  rather than fading in mid-air — posted into a slot, not
                  evaporating.

                  The pitch (24px arrow + 32px gap = 56px) has to exceed the
                  disc's own 54px, or the second arrow is already in view while
                  the first is still centred and the button sits there showing
                  two of them. The animation moves by exactly one pitch. */}
              <span
                className={clsx(
                  'absolute inset-x-0 top-[15px] flex flex-col items-center gap-8',
                  sending && 'ec-feed',
                )}
              >
                <IconUpload className="h-6 w-6 flex-none text-violet" />
                <IconUpload className="h-6 w-6 flex-none text-violet" />
              </span>
            </span>
          </span>

          <span className="block text-[24px] font-extrabold leading-tight tracking-[-0.035em] sm:text-[30px]">
            {sending ? 'Got it' : over ? 'Drop it' : 'New video'}
          </span>
          <span className="mt-1 block text-[13px] font-semibold text-ink/65">
            {sending
              ? 'Taking it into the edit\u2026'
              : over
                ? 'Let go and we\u2019ll take it from here'
                : 'Drop your footage here, or click to browse'}
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
