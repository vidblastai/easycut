'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { IconUpload } from './Icons';
import { looksLikeVideo, setPendingUpload } from '@/lib/ui/pending-upload';

/**
 * "Upload footage", from wherever you happen to be.
 *
 * ── Why this is not just a link to /new ─────────────────────────────────
 *
 * It was. And a link to the wizard is a link to a SCREEN — you arrive, find
 * the drop zone, and pick the file there. That is one more page between
 * wanting to upload and uploading, every single time, on the one action this
 * whole product exists for.
 *
 * This opens the file picker where you stand. The file then travels into the
 * wizard through `setPendingUpload`, which is the same handoff the dashboard
 * banner uses, so there is still exactly ONE upload flow — you just enter it
 * with the first question already answered.
 *
 * It is also a drop target, because a button and a drop target are the same
 * intention and making somebody choose between them costs a screen. The
 * window-level drag listener lights it up the moment a file is over the page,
 * so nobody has to guess whether it takes drops.
 */

export function useUploadHandoff() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [armed, setArmed] = useState(false); // a file is somewhere over the page
  const [over, setOver] = useState(false); //   …and specifically over this
  const [error, setError] = useState<string | null>(null);

  const accept = useCallback(
    (file: File | null | undefined) => {
      setOver(false);
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

  /* Light up while a file is anywhere over the page. `dragenter`/`dragleave`
     fire for every element the pointer crosses, so a counter is what stops the
     highlight flickering off as the cursor passes between children. */
  useEffect(() => {
    let depth = 0;
    const hasFile = (e: DragEvent) => e.dataTransfer?.types?.includes('Files');
    const enter = (e: DragEvent) => { if (hasFile(e)) { depth++; setArmed(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) { setArmed(false); setOver(false); } };
    const drop = () => { depth = 0; setArmed(false); setOver(false); };
    // Without this the browser opens the file instead, which navigates away
    // from the app and loses whatever was on screen.
    const over_ = (e: DragEvent) => { if (hasFile(e)) e.preventDefault(); };
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

  /** Spread onto whatever element should take the drop. */
  const dropProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); accept(e.dataTransfer.files?.[0]); },
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="video/*"
      className="hidden"
      onChange={(e) => {
        accept(e.target.files?.[0]);
        // Cleared so choosing the SAME file twice still fires a change event —
        // otherwise a second attempt after a mistake looks like a dead button.
        e.target.value = '';
      }}
    />
  );

  return { open: () => inputRef.current?.click(), input, dropProps, armed, over, error };
}

/**
 * The sidebar's version: a nav row that matches the links above it.
 *
 * A button rather than a Link, because it opens the OS file picker rather than
 * going anywhere — and the two must not look identical, or the file dialog
 * appearing reads as a bug.
 */
export function SidebarUpload() {
  const { open, input, dropProps, armed, over, error } = useUploadHandoff();
  return (
    <li>
      <button
        type="button"
        onClick={open}
        {...dropProps}
        title={error ?? 'Choose a video, or drop one here'}
        className={clsx(
          'group flex w-full items-center gap-[11px] whitespace-nowrap rounded-[9px] px-[11px] py-2.5 text-left text-[13.5px] font-medium transition-colors md:py-[9px]',
          over
            ? 'bg-violet text-ink'
            : armed
              ? 'bg-violet-dim text-chalk ring-1 ring-violet/60'
              : error
                ? 'text-bad hover:bg-charcoal'
                : 'text-muted hover:bg-charcoal hover:text-chalk',
        )}
      >
        <IconUpload
          className={clsx(
            'h-[17px] w-[17px] flex-none transition-colors',
            over ? 'text-ink' : armed ? 'text-violet' : 'text-faint group-hover:text-muted',
          )}
        />
        {armed ? 'Drop it here' : 'Upload footage'}
      </button>
      {input}
    </li>
  );
}

/**
 * The topbar's version, for screens where the sidebar is not the obvious place
 * to look — the editor, where your attention is on the picture.
 */
export function TopbarUpload({ className }: { className?: string }) {
  const { open, input, dropProps, armed, over, error } = useUploadHandoff();
  return (
    <>
      <button
        type="button"
        onClick={open}
        {...dropProps}
        title={error ?? 'Choose a video, or drop one here'}
        className={clsx('btn-ghost', over && 'border-violet bg-violet text-ink', armed && !over && 'border-violet/60', className)}
      >
        <IconUpload className="h-4 w-4" />
        {armed ? 'Drop it here' : 'Upload footage'}
      </button>
      {input}
    </>
  );
}
