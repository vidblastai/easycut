'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { StylePreview } from '@/components/styles/StylePreview';
import { detectFormat, probeInBrowser, type Detected } from '@/lib/styles/detect';
import type { Layout } from '@/lib/edl/types';
import { IconArrowRight, IconCheck } from '@/components/shell/Icons';
import { readDefaultCaptionPreset } from '@/lib/captions/default-preset';
import { takePendingUpload } from '@/lib/ui/pending-upload';

/**
 * The upload wizard: one question per screen.
 *
 * The previous version stacked five sections on one page. Everything was
 * visible, which sounds like a virtue and is not — a person who has never
 * edited a video opened it and saw five decisions they did not know how to
 * make, all at once, with the submit button greyed out at the bottom for a
 * reason that was three screens up. One question at a time turns the same
 * five decisions into a conversation, and each screen can afford to explain
 * itself because it is the only thing on the page.
 *
 * Every question has a working default, so the only one that can actually
 * block the wizard is the file.
 */

interface StyleOption {
  id: string;
  name: string;
  tagline: string;
  bestFor: string;
  accent: string;
  layout: Layout;
  formats: ('short' | 'long')[];
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

/**
 * Three, where there were four.
 *
 * "Where is it going?" is gone. It asked about distribution when what it needed
 * was a fact about the file — nobody shoots vertical for YouTube — and it asked
 * it before the person had seen anything to choose between. The footage answers
 * it, and the answer decides which styles are even worth showing.
 */
const QUESTIONS = ['footage', 'style', 'state'] as const;
type Question = (typeof QUESTIONS)[number];

export function UploadFlow({ styles, formats }: { styles: StyleOption[]; formats: FormatOption[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [at, setAt] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [override, setOverride] = useState<'short' | 'long' | null>(null);
  const mode = override ?? detected?.mode ?? 'short';
  const [styleId, setStyleId] = useState(styles[0]?.id ?? 'clean');
  const [inputMode, setInputMode] = useState<'raw' | 'roughcut'>('raw');
  const [note, setNote] = useState('');

  const [phase, setPhase] = useState<Phase>('choose');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const question: Question = QUESTIONS[at];
  const busy = phase !== 'choose';
  const format = useMemo(() => formats.find((f) => f.mode === mode), [formats, mode]);

  /* Only the styles that suit this footage. A split screen offered on a
     widescreen edit is an offer to make something that will look wrong — and
     when the detection flips, a style that is no longer on the list quietly
     falls back to one that is, rather than submitting something unbuildable. */
  const choices = useMemo(() => styles.filter((s) => s.formats.includes(mode)), [styles, mode]);
  const chosen = choices.some((s) => s.id === styleId) ? styleId : (choices[0]?.id ?? styleId);
  const style = useMemo(() => styles.find((s) => s.id === chosen), [styles, chosen]);

  const pickFile = useCallback((next: File | null) => {
    setError(null);
    if (!next) return;
    if (!next.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(next.name)) {
      setError('That does not look like a video file. MP4, MOV and WebM all work.');
      return;
    }
    setFile(next);
    setOverride(null);
    setDetected(null);

    // Shape and length come out of the file's own header, which is a few
    // kilobytes — so the verdict lands in the moment the file is chosen rather
    // than after a round trip on a two-gigabyte upload.
    void probeInBrowser(next).then((probe) => setDetected(detectFormat(probe)));

    // Choosing a file is an answer, so move on rather than making them
    // confirm the thing they just did.
    setAt(1);
  }, []);

  // A file dropped on the dashboard banner is waiting here. Adopting it skips
  // the question it already answered, so dropping and clicking land in the same
  // place rather than being two different flows.
  useEffect(() => {
    const dropped = takePendingUpload();
    if (dropped) pickFile(dropped);
  }, [pickFile]);

  // Enter advances, which is what every form on the web has taught people to
  // expect — except in the note field, where it would submit mid-sentence.
  useEffect(() => {
    if (busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (at < QUESTIONS.length - 1) setAt((n) => n + 1);
      else if (file) void submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, busy, file]);

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
          styleId: chosen,
          // Whatever this browser last chose in the caption gallery. Absent is
          // fine — the edit style names its own caption look.
          captionPreset: readDefaultCaptionPreset() ?? undefined,
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

  if (busy) {
    return (
      <Uploading
        phase={phase}
        progress={progress}
        filename={file?.name ?? ''}
      />
    );
  }

  return (
    <div className="pb-4">
      <Rail at={at} answered={{ footage: Boolean(file), style: true, state: true }} onGo={setAt} />

      <div key={question} className="mt-7 animate-rise">
        {question === 'footage' ? (
          <Ask
            title="Start with your footage"
            sub="One file. We'll work out the rest — length, shape, where the cuts go."
          >
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
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
              className={clsx(
                'grid cursor-pointer place-items-center rounded-[18px] border border-dashed px-6 py-16 text-center transition-colors',
                dragging ? 'border-violet bg-violet-dim' : 'border-line bg-charcoal hover:border-violet/50',
              )}
            >
              <input
                ref={inputRef}
                id="upload-file"
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <div>
                  <p className="text-[15px] font-semibold">{file.name}</p>
                  <p className="mt-1 text-[13px] text-muted">
                    {formatBytes(file.size)} — click to choose a different file
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-[17px] font-bold">Drop your video here</p>
                  <p className="mt-1.5 text-[13px] text-muted">MP4, MOV, WebM — or click to browse</p>
                </div>
              )}
            </div>
          </Ask>
        ) : null}

        {question === 'style' ? (
          <Ask
            title="Pick a style"
            sub="The shape of the video, and everything that follows from it — captions, B-roll, pacing, sound."
          >
            {/* What was decided about the footage, and how to disagree with it.
                A guess presented as a fact is worse than the question it
                replaced. */}
            <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-charcoal px-3 py-2.5 text-[12.5px]">
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider"
                style={{ background: 'rgba(155,123,255,.14)', color: '#B39AFF' }}
              >
                {format?.label ?? (mode === 'short' ? 'Short form' : 'Long form')}
              </span>
              <span className="text-muted">
                {override
                  ? `You've set this one to ${override === 'short' ? 'a short' : 'long form'}.`
                  : detected
                    ? detected.reason
                    : 'Reading your footage…'}
              </span>
              <button
                type="button"
                onClick={() => setOverride(override ? null : mode === 'short' ? 'long' : 'short')}
                className="ml-auto font-semibold text-muted underline decoration-line underline-offset-4 hover:text-chalk"
              >
                {override ? 'Use what we detected' : `Make it ${mode === 'short' ? 'long form' : 'a short'}`}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {choices.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-style={s.id}
                  aria-pressed={chosen === s.id}
                  onClick={() => setStyleId(s.id)}
                  className={clsx(
                    'rounded-2xl border p-3 text-left transition-colors',
                    chosen === s.id
                      ? 'border-violet bg-violet-dim'
                      : 'border-line bg-charcoal hover:bg-charcoal2',
                  )}
                >
                  <StylePreview
                    layout={s.layout}
                    aspect={mode === 'short' ? '9:16' : '16:9'}
                    accent={s.accent}
                    className={mode === 'short' ? 'mx-auto w-[58%]' : 'w-full'}
                  />
                  <p className="mt-3 flex items-center gap-2 text-[14px] font-bold">
                    <span className="h-2 w-2 rounded-full" style={{ background: s.accent }} />
                    {s.name}
                  </p>
                  <p className="mt-1 text-[12.5px] leading-snug text-muted">{s.tagline}</p>
                </button>
              ))}
            </div>

            <p className="mt-4 text-[12.5px] text-faint">
              {choices.find((s) => s.id === chosen)?.bestFor}
            </p>
          </Ask>
        ) : null}

        {question === 'state' ? (
          <Ask
            title="How finished is it?"
            sub="The only thing we need to know before touching your cut."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Choice
                selected={inputMode === 'raw'}
                onClick={() => setInputMode('raw')}
                title="Completely raw"
                body="Straight off the camera. We'll cut the pauses, the ums, the false starts and the takes you redid."
              />
              <Choice
                selected={inputMode === 'roughcut'}
                onClick={() => setInputMode('roughcut')}
                title="Already trimmed"
                body="You cut your own mistakes. We'll respect your edit and only add the layers on top."
              />
            </div>

            <div className="mt-6">
              <label htmlFor="upload-note" className="label">
                Anything we should know? <span className="text-faint">Optional</span>
              </label>
              <input
                id="upload-note"
                type="text"
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. keep the bit about pricing, skip the intro small talk"
                className="mt-2 w-full rounded-xl border border-line bg-charcoal px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted/60 focus:border-violet"
              />
            </div>
          </Ask>
        ) : null}

      </div>

      {error ? (
        <p className="mt-5 rounded-xl border border-bad/40 bg-bad/[0.08] px-4 py-3 text-[13px] text-bad">{error}</p>
      ) : null}

      <div className="mt-8 flex items-center gap-3">
        {at > 0 ? (
          <button type="button" onClick={() => setAt(at - 1)} className="btn-ghost">
            Back
          </button>
        ) : null}

        {at < QUESTIONS.length - 1 ? (
          <button
            type="button"
            onClick={() => setAt(at + 1)}
            disabled={at === 0 && !file}
            className="btn-primary ml-auto"
          >
            {at === 0 && !file ? 'Choose a file first' : 'Continue'}
            <IconArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={!file} className="btn-primary ml-auto px-6 py-3">
            Make my video
            <IconArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {at === QUESTIONS.length - 1 && file ? (
        <p className="mt-4 text-[12.5px] text-faint">
          {file.name} · {format?.label} · {style?.name} ·{' '}
          {inputMode === 'raw' ? 'Completely raw' : 'Already trimmed'}
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- pieces */

function Ask({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[22px] font-extrabold">{title}</h2>
      <p className="mt-1.5 text-[13.5px] text-muted">{sub}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** The wizard's own position — distinct from the four-step pipeline above it. */
function Rail({
  at,
  answered,
  onGo,
}: {
  at: number;
  answered: Record<Question, boolean>;
  onGo: (n: number) => void;
}) {
  return (
    <ol className="flex gap-2">
      {QUESTIONS.map((q, i) => {
        const past = i < at;
        return (
          <li key={q} className="flex-1">
            <button
              type="button"
              onClick={() => (past || answered[QUESTIONS[i]]) && onGo(i)}
              disabled={!past && i !== at && !answered[q]}
              aria-label={`Question ${i + 1} of ${QUESTIONS.length}`}
              aria-current={i === at ? 'step' : undefined}
              className={clsx(
                'h-1 w-full rounded-full transition-colors',
                i <= at ? 'bg-violet' : 'bg-line',
                past && 'cursor-pointer hover:bg-violet-hover',
              )}
              style={{ transitionDuration: '0.32s' }}
            />
          </li>
        );
      })}
    </ol>
  );
}

function Choice({
  selected,
  onClick,
  title,
  body,
  foot,
  badge,
  dot,
  tags,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  body: string;
  foot?: string;
  badge?: string;
  dot?: string;
  tags?: string[];
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        // A <button> centres its content vertically, which floats the shorter
        // card's title off its neighbour's baseline in a stretched row. Column
        // flex from the top is what keeps paired titles aligned.
        'flex flex-col items-start justify-start rounded-[18px] border p-5 text-left transition-colors',
        selected
          ? 'border-violet bg-violet-dim'
          : 'border-line bg-charcoal hover:border-line/80 hover:bg-charcoal2',
      )}
    >
      <span className="flex w-full items-center gap-2">
        {dot ? <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: dot }} aria-hidden /> : null}
        <span className="font-bold">{title}</span>
        {badge ? (
          <span className="ml-auto rounded-md bg-ink/60 px-2 py-0.5 text-[11px] font-semibold text-muted">
            {badge}
          </span>
        ) : null}
        {selected && !badge ? <IconCheck className="ml-auto h-4 w-4 text-violet" /> : null}
      </span>
      <span className="mt-1.5 text-[13px] leading-relaxed text-chalk/80">{body}</span>
      {foot ? <span className="mt-1 text-[11.5px] leading-relaxed text-muted">{foot}</span> : null}
      {tags?.length ? (
        <span className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-muted">
              {t}
            </span>
          ))}
        </span>
      ) : null}
    </button>
  );
}

function Uploading({ phase, progress, filename }: { phase: Phase; progress: number; filename: string }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="card mt-7 p-6">
      <div className="flex items-center justify-between text-[14px]">
        <span className="font-semibold">
          {phase === 'uploading' ? 'Uploading your footage' : 'Starting the edit'}
        </span>
        <span className="tabular-nums text-muted">{phase === 'uploading' ? `${pct}%` : ''}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink">
        <div
          className={clsx(
            'h-full rounded-full bg-violet',
            phase === 'uploading' ? 'transition-[width] duration-200' : 'animate-pulseDot',
          )}
          style={{ width: phase === 'uploading' ? `${Math.max(3, pct)}%` : '100%' }}
        />
      </div>
      <p className="mt-3 text-[12.5px] text-faint">
        {filename} — keep this tab open until the upload finishes.
      </p>
    </div>
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
