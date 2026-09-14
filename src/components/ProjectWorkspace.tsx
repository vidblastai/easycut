'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { TimelineEditor } from '@/components/TimelineEditor';
import type { EdlOperation } from '@/lib/edl/operations';
import type { Edl } from '@/lib/edl/types';

/**
 * The editor.
 *
 * Its whole design brief was "do not look like an editor". There is no
 * timeline, no layers panel, no keyframes. There is the finished video, a plain
 * list of what we did to it, and a small set of changes phrased as things a
 * person would actually want ("more B-roll", "different music", "bigger
 * captions"). Every change is free, because it replays cached analysis.
 */

interface StyleOption {
  id: string;
  name: string;
  accent: string;
  tagline: string;
}

interface ProjectState {
  project: {
    id: string;
    title: string;
    mode: 'short' | 'long';
    styleId: string;
    inputMode: string;
    status: 'draft' | 'processing' | 'ready' | 'failed';
    errorMessage: string | null;
    durationSec: number | null;
    previewUrl: string | null;
    thumbnailUrl: string | null;
    socialCaption: string | null;
    hashtags: string[];
    costUsd: number;
  };
  job: {
    status: string;
    stage: string;
    stageLabel: string;
    progress: number;
    progressLabel: string;
    errorMessage: string | null;
    log: Array<{ stage: string; status: string; ms: number; message: string }>;
  } | null;
  edl: { id: string; version: number; document: Edl | null } | null;
  renders: Array<{ id: string; aspect: string; status: string; progress: number; url: string | null; renderMs: number | null }>;
}

const POLL_MS = 1800;

export function ProjectWorkspace({ projectId, styles }: { projectId: string; styles: StyleOption[] }) {
  const [state, setState] = useState<ProjectState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Simple by default, timeline on request.
   *
   * Most people never need the timeline and showing it unprompted would
   * contradict the entire product. But "you never have to open a timeline" is a
   * promise about the default, not a refusal — when the AI puts an insert half a
   * second early, you fix it yourself rather than re-rolling the whole edit.
   */
  const [mode, setMode] = useState<'simple' | 'timeline'>('simple');

  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}`, { cache: 'no-store' });
    if (!response.ok) return;
    setState(await response.json());
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while something is actually happening — a finished project makes
  // no requests at all.
  const isWorking = state?.project.status === 'processing';
  useEffect(() => {
    if (!isWorking) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [isWorking, load]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(`/api/projects/${projectId}/edl`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ render: true, ...body }),
        });
        if (!response.ok) {
          throw new Error((await response.json().catch(() => ({}))).error ?? 'That change could not be applied.');
        }
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [projectId, load],
  );

  const applyOperations = useCallback(
    async (operations: EdlOperation[]) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(`/api/projects/${projectId}/edl`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operations, render: true }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? 'Those edits could not be applied.');
        if (body.rejected?.length) {
          setError(`${body.rejected.length} edit(s) were declined: ${body.rejected[0].reason}`);
        }
        await load();
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [projectId, load],
  );

  const exportAspect = useCallback(
    async (aspect: string) => {
      setBusy(true);
      setError(null);
      try {
        await fetch(`/api/projects/${projectId}/render`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aspect }),
        });
        await load();
      } finally {
        setBusy(false);
      }
    },
    [projectId, load],
  );

  if (!state) {
    return (
      <div className="mx-auto max-w-6xl px-6 pb-24">
        <div className="card h-64 animate-pulse" />
      </div>
    );
  }

  const { project, job, edl } = state;
  const doc = edl?.document ?? null;

  return (
    <div className="mx-auto max-w-6xl px-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">{project.title}</h1>
          <p className="mt-2 text-sm text-muted">
            {project.mode === 'short' ? 'Short form' : 'Long form'} ·{' '}
            {styles.find((s) => s.id === project.styleId)?.name ?? project.styleId}
            {project.durationSec ? ` · ${formatDuration(project.durationSec)}` : ''}
            {project.costUsd > 0 ? ` · $${project.costUsd.toFixed(3)} to make` : ''}
          </p>
        </div>

        {doc ? (
          <div className="flex rounded-xl border border-line p-1">
            {(['simple', 'timeline'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={clsx(
                  'rounded-lg px-3.5 py-1.5 text-xs font-semibold capitalize transition-colors',
                  mode === m ? 'bg-violet text-ink' : 'text-muted hover:text-chalk',
                )}
              >
                {m === 'simple' ? 'Simple' : 'Fine-tune'}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {project.status === 'failed' ? (
        <FailureCard message={project.errorMessage ?? job?.errorMessage ?? 'Unknown error'} />
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        {/* ------------------------------------------------------- the video */}
        <div>
          {project.status === 'processing' || !project.previewUrl ? (
            <ProgressPanel job={job} mode={project.mode} />
          ) : (
            <div className="card overflow-hidden">
              <video
                key={project.previewUrl}
                src={project.previewUrl}
                poster={project.thumbnailUrl ?? undefined}
                controls
                playsInline
                className="w-full bg-black"
                style={{ aspectRatio: project.mode === 'short' ? '9 / 16' : '16 / 9', maxHeight: '70vh' }}
              />
              <div className="flex flex-wrap items-center gap-2 border-t border-line p-4">
                <a href={project.previewUrl} download className="btn-primary">
                  Download
                </a>
                {(['9:16', '1:1', '16:9'] as const)
                  .filter((a) => a !== doc?.format.aspect)
                  .map((aspect) => (
                    <button
                      key={aspect}
                      type="button"
                      disabled={busy}
                      onClick={() => void exportAspect(aspect)}
                      className="btn-ghost"
                    >
                      Export {aspect}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {project.socialCaption ? (
            <div className="card mt-4 p-5">
              <h3 className="text-sm font-bold">Caption for your post</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{project.socialCaption}</p>
              {project.hashtags.length ? (
                <p className="mt-2 text-sm text-violet">{project.hashtags.join(' ')}</p>
              ) : null}
            </div>
          ) : null}

          {doc && mode === 'timeline' ? (
            <div className="mt-4">
              <TimelineEditor edl={doc} onCommit={applyOperations} busy={busy} />
            </div>
          ) : null}

          {doc && mode === 'simple' ? <WhatWeDid edl={doc} /> : null}
        </div>

        {/* ------------------------------------------------------ the tweaks */}
        <aside className="space-y-4">
          {error ? (
            <div className="rounded-xl border border-bad/40 bg-bad/[0.08] px-4 py-3 text-sm text-bad">{error}</div>
          ) : null}

          {doc?.degraded.length ? (
            <div className="card p-4">
              <h3 className="text-sm font-bold text-warn">Skipped layers</h3>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {doc.degraded.map((item, i) => (
                  <li key={i}>• {item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <TweakPanel
            disabled={busy || project.status === 'processing'}
            edl={doc}
            styles={styles}
            currentStyle={project.styleId}
            onPatch={patch}
          />
        </aside>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- panels */

function ProgressPanel({ job, mode }: { job: ProjectState['job']; mode: 'short' | 'long' }) {
  const progress = job?.progress ?? 0;
  const estimate = mode === 'short' ? '~90 seconds' : '~5 minutes';

  return (
    <div className="card flex flex-col items-center justify-center p-12 text-center" style={{ minHeight: 360 }}>
      <div className="relative h-14 w-14">
        <div className="absolute inset-0 rounded-full border-2 border-line" />
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-violet" />
      </div>
      <h2 className="mt-6 text-lg font-bold tracking-[-0.02em]">{job?.progressLabel || 'Getting started'}</h2>
      <p className="mt-2 text-sm text-muted">Usually {estimate} start to finish.</p>

      <div className="mt-6 h-2 w-full max-w-sm overflow-hidden rounded-full bg-ink">
        <div
          className="h-full rounded-full bg-violet transition-[width] duration-500"
          style={{ width: `${Math.max(4, progress * 100)}%` }}
        />
      </div>

      {job?.log.length ? (
        <ul className="mt-6 w-full max-w-sm space-y-1 text-left text-xs text-muted">
          {job.log.slice(-5).map((entry, i) => (
            <li key={i} className="flex items-center justify-between gap-3">
              <span className={clsx('truncate', entry.status === 'degraded' && 'text-warn')}>
                {entry.message || entry.stage}
              </span>
              <span className="shrink-0 tabular-nums text-muted/60">{(entry.ms / 1000).toFixed(1)}s</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FailureCard({ message }: { message: string }) {
  return (
    <div className="mt-6 rounded-2xl border border-bad/40 bg-bad/[0.07] p-5">
      <h2 className="text-sm font-bold text-bad">We couldn&rsquo;t finish this one</h2>
      <p className="mt-2 text-sm text-muted">{message}</p>
    </div>
  );
}

/** A plain-English account of the edit — no jargon, no timeline. */
function WhatWeDid({ edl }: { edl: Edl }) {
  const cut = useMemo(() => {
    const kept = edl.segments.reduce((sum, s) => sum + (s.outEndSec - s.outStartSec), 0);
    return Math.max(0, edl.source.durationSec - kept);
  }, [edl]);

  const items = [
    { label: 'Removed', value: `${cut.toFixed(0)}s of pauses, ums and retakes` },
    { label: 'Cuts', value: `${Math.max(0, edl.segments.length - 1)}` },
    { label: 'Captions', value: `${edl.captions.length} cards` },
    { label: 'B-roll', value: `${edl.broll.length} inserts` },
    { label: 'Graphics', value: `${edl.graphics.length}` },
    { label: 'Sound effects', value: `${edl.sfx.length}` },
    { label: 'Punch-ins', value: `${edl.punchIns.length}` },
    { label: 'Music', value: edl.music ? edl.music.title || 'Added' : 'None' },
    { label: 'Framing', value: edl.reframe ? labelForReframe(edl.reframe.method) : 'Unchanged' },
  ];

  return (
    <div className="card mt-4 p-5">
      <h3 className="text-sm font-bold">What we did</h3>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label}>
            <dt className="text-[11px] uppercase tracking-wider text-muted/70">{item.label}</dt>
            <dd className="mt-0.5 text-sm font-semibold">{item.value}</dd>
          </div>
        ))}
      </dl>

      {edl.broll.length ? (
        <div className="mt-5 border-t border-line pt-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted/70">B-roll we chose</h4>
          <ul className="mt-2 space-y-1.5 text-sm text-muted">
            {edl.broll.slice(0, 6).map((clip) => (
              <li key={clip.id} className="flex items-baseline gap-2">
                <span className="shrink-0 tabular-nums text-xs text-muted/60">{formatDuration(clip.outStartSec)}</span>
                <span className="text-chalk/90">{clip.query}</span>
                {clip.intent ? <span className="truncate text-xs text-muted/70">— {clip.intent}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function labelForReframe(method: string): string {
  switch (method) {
    case 'face-track':
      return 'Tracked to your face';
    case 'saliency':
      return 'Tracked to you';
    case 'manual':
      return 'Set by you';
    default:
      return 'Centred';
  }
}

function TweakPanel({
  disabled,
  edl,
  styles,
  currentStyle,
  onPatch,
}: {
  disabled: boolean;
  edl: Edl | null;
  styles: StyleOption[];
  currentStyle: string;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
}) {
  if (!edl) {
    return (
      <div className="card p-5">
        <h3 className="text-sm font-bold">Change anything</h3>
        <p className="mt-2 text-sm text-muted">
          Once the first edit is done you can restyle it, drop layers or export other shapes — all
          free and instant, because we keep the analysis.
        </p>
      </div>
    );
  }

  const layers: Array<{ key: string; label: string; on: boolean }> = [
    { key: 'captions', label: 'Captions', on: edl.captions.length > 0 },
    { key: 'broll', label: 'B-roll', on: edl.broll.length > 0 },
    { key: 'graphics', label: 'Graphics', on: edl.graphics.length > 0 },
    { key: 'sfx', label: 'Sound effects', on: edl.sfx.length > 0 },
    { key: 'punchIns', label: 'Punch-ins', on: edl.punchIns.length > 0 },
    { key: 'transitions', label: 'Transitions', on: edl.transitions.length > 0 },
    { key: 'music', label: 'Music', on: Boolean(edl.music) },
  ];

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h3 className="text-sm font-bold">Change the look</h3>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {styles.map((style) => (
            <button
              key={style.id}
              type="button"
              disabled={disabled || style.id === currentStyle}
              onClick={() => void onPatch({ styleId: style.id })}
              className={clsx(
                'rounded-xl border px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-100',
                style.id === currentStyle
                  ? 'border-violet bg-violet-dim'
                  : 'border-line bg-charcoal hover:border-line/80 hover:bg-charcoal2 disabled:opacity-40',
              )}
            >
              <span className="flex items-center gap-2 font-semibold">
                <span className="h-2 w-2 rounded-full" style={{ background: style.accent }} />
                {style.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-bold">Turn layers off</h3>
        <p className="mt-1 text-xs text-muted">Anything you don&rsquo;t want.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {layers.map((layer) => (
            <button
              key={layer.key}
              type="button"
              disabled={disabled || !layer.on}
              onClick={() => void onPatch({ layers: { [layer.key]: false } })}
              className={clsx(
                'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                layer.on
                  ? 'border-line bg-charcoal text-chalk hover:border-bad/50 hover:text-bad'
                  : 'border-line/50 bg-charcoal/40 text-muted/50',
              )}
            >
              {layer.on ? `Remove ${layer.label.toLowerCase()}` : `${layer.label} off`}
            </button>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-bold">Captions</h3>
        <div className="mt-3 space-y-3">
          <Slider
            label="Size"
            disabled={disabled}
            value={edl.captionStyle.fontSizeRatio}
            min={0.03}
            max={0.09}
            step={0.004}
            format={(v) => `${Math.round((v / 0.055) * 100)}%`}
            onCommit={(v) => void onPatch({ captionStyle: { fontSizeRatio: v } })}
          />
          <Slider
            label="Height on screen"
            disabled={disabled}
            value={edl.captionStyle.positionY}
            min={0.25}
            max={0.9}
            step={0.02}
            format={(v) => `${Math.round(v * 100)}%`}
            onCommit={(v) => void onPatch({ captionStyle: { positionY: v } })}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => void onPatch({ captionStyle: { uppercase: !edl.captionStyle.uppercase } })}
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              {edl.captionStyle.uppercase ? 'Sentence case' : 'ALL CAPS'}
            </button>
            {(['word-pop', 'karaoke', 'bounce', 'line-fade'] as const)
              .filter((a) => a !== edl.captionStyle.animation)
              .map((animation) => (
                <button
                  key={animation}
                  type="button"
                  disabled={disabled}
                  onClick={() => void onPatch({ captionStyle: { animation } })}
                  className="btn-ghost px-3 py-1.5 text-xs"
                >
                  {animation.replace('-', ' ')}
                </button>
              ))}
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-bold">Music</h3>
        <p className="mt-1 text-xs text-muted">
          {edl.music ? edl.music.title || edl.music.mood : 'No track chosen for this video.'}
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void onPatch({ music: { shuffle: true } })}
          className="btn-ghost mt-3 px-3 py-1.5 text-xs"
        >
          Try a different track
        </button>
      </div>
    </div>
  );
}

/**
 * Commits on release rather than on every pixel of drag — each commit is a
 * re-render, and firing forty of them while someone drags a slider would be
 * both slow and expensive.
 */
function Slider({
  label,
  value,
  min,
  max,
  step,
  disabled,
  format,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  format: (value: number) => string;
  onCommit: (value: number) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  return (
    <label className="block">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted">{label}</span>
        <span className="tabular-nums text-muted/70">{format(local)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        onChange={(e) => setLocal(Number(e.target.value))}
        onMouseUp={() => onCommit(local)}
        onTouchEnd={() => onCommit(local)}
        onKeyUp={() => onCommit(local)}
        className="mt-1.5 w-full accent-violet"
      />
    </label>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}
