'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';

/**
 * The entire user-facing product surface, in one component.
 *
 * The design constraint was that someone who has never edited a video should
 * finish this screen without reading anything twice. So: one file, one format
 * choice, one look, one optional note. Everything else — resolution, fps,
 * codec, caption font, how hard to cut — is inferred.
 */

interface StyleOption {
  id: string;
  name: string;
  tagline: string;
  bestFor: string;
  accent: string;
}

interface FormatOption {
  mode: 'short' | 'long';
  label: string;
  description: string;
  aspect: string;
  maxDurationSec: number;
  platforms: string[];
}

type Phase = 'choose' | 'uploading' | 'starting';

export function UploadFlow({ styles, formats }: { styles: StyleOption[]; formats: FormatOption[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'short' | 'long'>('short');
  const [styleId, setStyleId] = useState(styles[0]?.id ?? 'clean');
  const [inputMode, setInputMode] = useState<'raw' | 'roughcut'>('raw');
  const [note, setNote] = useState('');

  const [phase, setPhase] = useState<Phase>('choose');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const pickFile = useCallback((next: File | null) => {
    setError(null);
    if (!next) return;
    if (!next.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(next.name)) {
      setError('That does not look like a video file.');
      return;
    }
    setFile(next);
    // A long file is almost certainly meant for long-form; nudge, don't force.
    if (next.size > 400 * 1024 * 1024) setMode('long');
  }, []);

  async function submit() {
    if (!file) return;
    setError(null);
    setPhase('uploading');
    setProgress(0);

    try {
      // 1. Create the project and find out where the bytes should go.
      const createResponse = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          styleId,
          inputMode,
          userNote: note.trim() || undefined,
          filename: file.name,
          contentType: file.type || 'video/mp4',
          sizeBytes: file.size,
        }),
      });

      if (!createResponse.ok) {
        throw new Error((await createResponse.json().catch(() => ({}))).error ?? 'Could not start the project.');
      }
      const created = await createResponse.json();

      // 2. Upload, reporting real progress via XHR (fetch cannot do upload progress).
      await uploadWithProgress(created.upload, file, setProgress);

      // 3. Kick off the pipeline and go watch it.
      setPhase('starting');
      const startResponse = await fetch(`/api/projects/${created.project.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storageKey: created.upload.key,
          contentType: file.type || 'video/mp4',
          sizeBytes: file.size,
        }),
      });

      if (!startResponse.ok) {
        throw new Error((await startResponse.json().catch(() => ({}))).error ?? 'Could not start the edit.');
      }

      router.push(`/projects/${created.project.id}`);
    } catch (e) {
      setError((e as Error).message);
      setPhase('choose');
    }
  }

  const busy = phase !== 'choose';

  return (
    <div className="mt-8 space-y-8">
      {/* ------------------------------------------------------- 1. the file */}
      <section>
        <SectionLabel step="1" title="Your footage" />
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pickFile(e.dataTransfer.files?.[0] ?? null);
          }}
          onClick={() => !busy && inputRef.current?.click()}
          className={clsx(
            'mt-3 cursor-pointer rounded-2xl border border-dashed p-10 text-center transition-colors',
            dragging ? 'border-violet bg-violet-dim' : 'border-line bg-charcoal hover:border-violet/50',
            busy && 'pointer-events-none opacity-60',
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div>
              <p className="text-base font-semibold">{file.name}</p>
              <p className="mt-1 text-sm text-muted">{formatBytes(file.size)} — click to choose a different file</p>
            </div>
          ) : (
            <div>
              <p className="text-base font-semibold">Drop your video here</p>
              <p className="mt-1 text-sm text-muted">MP4, MOV, WebM — or click to browse</p>
            </div>
          )}
        </div>
      </section>

      {/* ----------------------------------------------------- 2. the format */}
      <section>
        <SectionLabel step="2" title="Where is it going?" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {formats.map((format) => (
            <button
              key={format.mode}
              type="button"
              disabled={busy}
              onClick={() => setMode(format.mode)}
              className={clsx(
                'rounded-2xl border p-5 text-left transition-colors',
                mode === format.mode
                  ? 'border-violet bg-violet-dim'
                  : 'border-line bg-charcoal hover:border-line/80 hover:bg-charcoal2',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold">{format.label}</span>
                <span className="rounded-md bg-ink/60 px-2 py-0.5 text-xs font-semibold text-muted">
                  {format.aspect}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-muted">{format.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {format.platforms.map((p) => (
                  <span key={p} className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-muted">
                    {p}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------- 3. state of edit */}
      <section>
        <SectionLabel step="3" title="How finished is it?" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            selected={inputMode === 'raw'}
            disabled={busy}
            onClick={() => setInputMode('raw')}
            title="Completely raw"
            body="Straight off the camera. We'll cut the pauses, the ums, the false starts and the takes you redid."
          />
          <ChoiceCard
            selected={inputMode === 'roughcut'}
            disabled={busy}
            onClick={() => setInputMode('roughcut')}
            title="Already trimmed"
            body="You cut your own mistakes. We'll respect your edit and only add the layers on top."
          />
        </div>
      </section>

      {/* ------------------------------------------------------- 4. the look */}
      <section>
        <SectionLabel step="4" title="Pick a look" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {styles.map((style) => (
            <button
              key={style.id}
              type="button"
              disabled={busy}
              onClick={() => setStyleId(style.id)}
              className={clsx(
                'rounded-2xl border p-4 text-left transition-colors',
                styleId === style.id
                  ? 'border-violet bg-violet-dim'
                  : 'border-line bg-charcoal hover:border-line/80 hover:bg-charcoal2',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: style.accent }} />
                <span className="font-bold">{style.name}</span>
              </div>
              <p className="mt-1.5 text-sm font-medium text-chalk/80">{style.tagline}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{style.bestFor}</p>
            </button>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------- 5. optional note */}
      <section>
        <SectionLabel step="5" title="Anything we should know?" optional />
        <input
          type="text"
          value={note}
          disabled={busy}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. keep the bit about pricing, skip the intro small talk"
          className="mt-3 w-full rounded-xl border border-line bg-charcoal px-4 py-3 text-sm outline-none placeholder:text-muted/60 focus:border-violet"
        />
      </section>

      {/* ----------------------------------------------------------- submit */}
      {error ? (
        <div className="rounded-xl border border-bad/40 bg-bad/[0.08] px-4 py-3 text-sm text-bad">{error}</div>
      ) : null}

      {busy ? (
        <div className="card p-5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">
              {phase === 'uploading' ? 'Uploading your footage' : 'Starting the edit'}
            </span>
            <span className="text-muted">{Math.round(progress * 100)}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink">
            <div
              className="h-full rounded-full bg-violet transition-[width] duration-200"
              style={{ width: `${Math.max(3, progress * 100)}%` }}
            />
          </div>
        </div>
      ) : (
        <button type="button" onClick={submit} disabled={!file} className="btn-primary w-full py-4 text-[15px]">
          {file ? 'Make my video' : 'Choose a file first'}
        </button>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- helpers */

function SectionLabel({ step, title, optional }: { step: string; title: string; optional?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-charcoal2 text-xs font-bold text-violet">
        {step}
      </span>
      <h2 className="text-base font-bold tracking-[-0.02em]">{title}</h2>
      {optional ? <span className="text-xs text-muted">optional</span> : null}
    </div>
  );
}

function ChoiceCard({
  selected,
  disabled,
  onClick,
  title,
  body,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'rounded-2xl border p-5 text-left transition-colors',
        selected ? 'border-violet bg-violet-dim' : 'border-line bg-charcoal hover:border-line/80 hover:bg-charcoal2',
      )}
    >
      <span className="font-bold">{title}</span>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
    </button>
  );
}

/**
 * XHR rather than fetch, purely because fetch still cannot report upload
 * progress. On a 2 GB file the difference between a progress bar and a spinner
 * is the difference between waiting and assuming it's broken.
 */
function uploadWithProgress(
  upload: { method: 'PUT' | 'POST'; url: string; headers: Record<string, string> },
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);

    for (const [header, value] of Object.entries(upload.headers)) {
      xhr.setRequestHeader(header, value);
    }
    if (upload.method === 'POST') {
      xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
      xhr.setRequestHeader('x-filename', file.name);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status}). ${xhr.responseText.slice(0, 160)}`));
    xhr.onerror = () => reject(new Error('Upload failed — check your connection and try again.'));

    xhr.send(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
