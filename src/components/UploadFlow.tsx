'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { StylePreview } from '@/components/styles/StylePreview';
import { detectFormat, probeInBrowser, type Detected } from '@/lib/styles/detect';
import type { Layout } from '@/lib/edl/types';
import { IconArrowRight, IconCheck } from '@/components/shell/Icons';
import { Stepper, type StepKey } from '@/components/shell/Stepper';
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

/**
 * The layers a person can decline before anything is made.
 *
 * These existed already, as switches on a finished video — turn one off and it
 * re-renders from cached analysis for nothing. Which is fine, and is not the
 * same as being asked. Somebody who knows they never want music should not have
 * to watch a video get scored and then unscore it.
 */
const LAYERS = [
  { key: 'captions', label: 'Captions', body: 'Word by word, timed to the syllable.' },
  { key: 'broll', label: 'B-roll', body: 'Real footage cut in where you name something concrete.' },
  { key: 'graphics', label: 'Graphics', body: 'Stat cards, lists and icons for the numbers you say.' },
  { key: 'sfx', label: 'Sound effects', body: 'Whooshes on the cuts, pops on the graphics.' },
  { key: 'punchIns', label: 'Punch-ins', body: 'A second camera that pushes in on your point.' },
  { key: 'music', label: 'Music', body: 'A bed that ducks under your voice and lifts between lines.' },
] as const;

type LayerKey = (typeof LAYERS)[number]['key'];

type Phase = 'choose' | 'uploading' | 'starting';

/**
 * Two decisions, and dropping the file in is not one of them.
 *
 * The file is how you start, not something you decide — numbering it pushed the
 * first real choice to position two and made the whole thing read as longer
 * than it is. So the drop lives at the top of the first question, and the
 * question is the style.
 *
 * "Where is it going?" is gone for a different reason: it asked about
 * distribution when what it needed was a fact about the file — nobody shoots
 * vertical for YouTube — and it asked it before the person had seen anything to
 * choose between. The footage answers it, and the answer decides which styles
 * are even worth showing.
 */
const QUESTIONS = ['style', 'edits'] as const;

/** Which of the four steps each question belongs to. */
const STEP_OF: Record<Question, StepKey> = { style: 'style', edits: 'edits' };
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
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(
    () => Object.fromEntries(LAYERS.map((l) => [l.key, true])) as Record<LayerKey, boolean>,
  );
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

  /** What they have declined, for the line that summarises the whole thing. */
  const off = LAYERS.filter((l) => !layers[l.key]).map((l) => l.label.toLowerCase());

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
          // Only the ones being declined: the default is everything on, and a
          // request that spells out six `true`s says nothing the absence did not.
          layers: Object.fromEntries(Object.entries(layers).filter(([, on]) => !on)),
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
      {/* One stepper, not two. The wizard's own hairline rail said the same
          thing as the four steps above it, in a second visual language. */}
      <Stepper current={STEP_OF[question]} onStepClick={(k) => setAt(QUESTIONS.indexOf(k as Question))} />

      <div key={question} className="mt-7 animate-rise">
        {question === 'style' ? (
          <Ask
            title="Pick a style"
            sub="The shape of the video, and everything that follows from it — captions, B-roll, pacing, sound."
          >
            {/* The file, as a strip rather than a screen of its own. Dropping
                it in is how you start, not a decision — it does not deserve a
                step, and it does not deserve a page. */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pickFile(e.dataTransfer.files?.[0] ?? null);
              }}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); inputRef.current?.click(); }
              }}
              role="button"
              tabIndex={0}
              className={clsx(
                'mb-4 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 transition-colors',
                file ? 'py-3' : 'py-8 justify-center text-center',
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
                <>
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-violet-dim text-violet">
                    <IconArrowRight className="h-4 w-4 -rotate-90" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">{file.name}</span>
                    <span className="block font-mono text-[11.5px] text-muted">{formatBytes(file.size)}</span>
                  </span>
                  <span className="flex-none text-[12.5px] text-muted underline decoration-line underline-offset-4">
                    Choose another
                  </span>
                </>
              ) : (
                <span>
                  <span className="block text-[15px] font-bold">Drop your video here</span>
                  <span className="mt-1 block text-[12.5px] text-muted">MP4, MOV, WebM — or click to browse</span>
                </span>
              )}
            </div>

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

        {question === 'edits' ? (
          <Ask
            title="What goes in it"
            sub="Everything is on by default. Turn off anything you do not want and it is never made — you are not paying for a layer you then delete."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {LAYERS.map((layer) => (
                <button
                  key={layer.key}
                  type="button"
                  data-layer={layer.key}
                  aria-pressed={layers[layer.key]}
                  onClick={() => setLayers((now) => ({ ...now, [layer.key]: !now[layer.key] }))}
                  className={clsx(
                    'flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
                    layers[layer.key]
                      ? 'border-violet/50 bg-violet-dim'
                      : 'border-line bg-charcoal text-muted hover:bg-charcoal2',
                  )}
                >
                  <span
                    className={clsx(
                      'mt-0.5 grid h-4 w-4 flex-none place-items-center rounded-[5px] border transition-colors',
                      layers[layer.key] ? 'border-violet bg-violet text-ink' : 'border-line',
                    )}
                  >
                    {layers[layer.key] ? <IconCheck className="h-2.5 w-2.5" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-bold">{layer.label}</span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-muted">{layer.body}</span>
                  </span>
                </button>
              ))}
            </div>

            <h3 className="mt-7 text-[13px] font-bold">How finished is the footage?</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
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
            Apply and make my video
            <IconArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {at === QUESTIONS.length - 1 && file ? (
        <p className="mt-4 text-[12.5px] text-faint">
          {file.name} · {format?.label} · {style?.name} ·{' '}
          {inputMode === 'raw' ? 'Completely raw' : 'Already trimmed'}
          {off.length ? ` · no ${off.join(', ')}` : ''}
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
