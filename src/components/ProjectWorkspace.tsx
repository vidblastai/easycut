'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import dynamic from 'next/dynamic';
import type { PlayerRef } from '@remotion/player';
import { TimelineEditor } from '@/components/TimelineEditor';
import { TimelineDock } from '@/components/TimelineDock';
import { AppShell } from '@/components/shell/AppShell';
import type { RecentProject } from '@/components/shell/Sidebar';
import { Stepper, type StepKey } from '@/components/shell/Stepper';
import { STAGES as PIPELINE_STAGES, STAGE_LABELS } from '@/lib/pipeline/types';
import { CaptionStudio } from '@/components/captions/CaptionStudio';
import { CaptionBand } from '@/components/captions/CaptionPreview';
import { captionPresetFor } from '@/lib/captions/presets';
import { IconCheck, IconDownload, IconPlus, IconSliders } from '@/components/shell/Icons';
import { AddedList, CutRibbon, Glance, TheCut } from '@/components/export/ExportReport';
import { CopyButton } from '@/components/CopyButton';
import type { EdlOperation } from '@/lib/edl/operations';
import type { CaptionStyle, Edl } from '@/lib/edl/types';
import { explainFailure } from '@/lib/ui/failure';
import { dimensionsFor, qualityOfRender, QUALITY_SLOWDOWN, type RenderQuality } from '@/lib/render/quality';
import Link from 'next/link';

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
    /** Null until the sweeper has taken the original footage. */
    sourceDeletedAt: string | null;
    sourceExpiresAt: string | null;
  };
  job: {
    status: string;
    stage: string;
    stageLabel: string;
    progress: number;
    progressLabel: string;
    errorMessage: string | null;
    startedAt: string | null;
    queuedAt: string | null;
    /** Set once nothing has moved for long enough to be worth saying so. */
    stalled: { reason: 'never-started' | 'no-progress'; forSec: number; selfHosted: boolean } | null;
    log: Array<{ stage: string; status: string; ms: number; message: string }>;
  } | null;
  edl: { id: string; version: number; document: Edl | null } | null;
  renders: Array<{
    id: string;
    aspect: string;
    width: number;
    height: number;
    status: string;
    progress: number;
    url: string | null;
    renderMs: number | null;
  }>;
}

const POLL_MS = 1800;

export function ProjectWorkspace({
  projectId,
  styles,
  recents,
  canExport4k = false,
}: {
  projectId: string;
  styles: StyleOption[];
  recents: RecentProject[];
  /** Decided on the server from the plan this project was made on. */
  canExport4k?: boolean;
}) {
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
  const [mode, setMode] = useState<'simple' | 'studio'>('simple');

  /**
   * The caption style being edited, before it is committed.
   *
   * Held locally so the picker's preview updates on every click while a render
   * only happens when the user says so — a re-render per colour nudge would be
   * unusable even at zero cost, because each one takes a minute.
   */
  const [draftCaption, setDraftCaption] = useState<CaptionStyle | null>(null);

  /**
   * The live preview, driven by the timeline.
   *
   * In simple mode the finished MP4 is the right thing to show — it is what you
   * will post. In fine-tune mode it is the wrong thing: it shows the last
   * render, not the edit in your hands. So the timeline gets a Remotion Player
   * rendering the WORKING document, and the two share one playhead.
   */
  const playerRef = useRef<PlayerRef | null>(null);
  const [workingEdl, setWorkingEdl] = useState<Edl | null>(null);

  /**
   * The side panel: what's selected, the caption look, what you've changed.
   *
   * All three used to be somewhere worse. The inspector and the change list
   * lived under the tracks, inside the dock, where they took height from the
   * timeline and buried the caption picker behind a scroll. They live here now
   * and the dock is nothing but track. The timeline editor renders into these
   * two nodes through a portal, so the selection and the operation stack stay
   * where they belong.
   */
  const [pane, setPane] = useState<'selected' | 'captions' | 'changes'>('captions');
  const [inspectorHost, setInspectorHost] = useState<HTMLDivElement | null>(null);
  const [changesHost, setChangesHost] = useState<HTMLDivElement | null>(null);

  /**
   * Below `lg` the panel is not on screen at all, so portalling into it would
   * hide the inspector rather than move it. There the editor keeps them under
   * the tracks, which is the right answer when there is nowhere else.
   */
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const panels = wide && inspectorHost && changesHost
    ? { inspector: inspectorHost, changes: changesHost }
    : null;

  const showSelected = useCallback(() => setPane('selected'), []);

  /**
   * The last EDL the server sent.
   *
   * While a render is running the API stops shipping the document — it is
   * 200 KB on a long video and the page polls every 1.8 seconds. That is right
   * for someone waiting on a first edit, and wrong for someone already IN the
   * editor who just hit apply: their status flips to `processing`, the document
   * goes null, and the studio would close under them mid-session. Holding the
   * last one means a re-render leaves the editor exactly where it was.
   */
  const lastDoc = useRef<Edl | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}`, { cache: 'no-store' });
    if (!response.ok) return;
    const next = (await response.json()) as ProjectState;
    // Remembered here rather than during render: a ref written while rendering
    // is a side effect in the wrong phase, even when the value is idempotent.
    if (next.edl?.document) lastDoc.current = next.edl.document;
    setState(next);
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

  /**
   * Run it again.
   *
   * `start` already refuses to stack a second job on a running project, so
   * this is safe to press twice — and most pipeline failures (a dropped
   * connection, a rate limit, a provider hiccup) genuinely do pass on the next
   * attempt. Making somebody re-upload a two-gigabyte file to find that out
   * was the wrong shape of recovery.
   */
  const retry = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/start`, { method: 'POST' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? 'Could not start it again.');
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [projectId, load]);

  const requestExport = useCallback(
    async (body: { aspect?: string; quality?: RenderQuality }) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(`/api/projects/${projectId}/render`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          // A refusal here is a sentence somebody can act on — a 4K request
          // from a plan without it says which plans have it. Swallowing it
          // would leave the button looking broken.
          const payload = await response.json().catch(() => ({}));
          setError(payload.error ?? 'Could not start that export.');
          return;
        }
        await load();
      } catch {
        setError('Could not reach the server. Try again in a moment.');
      } finally {
        setBusy(false);
      }
    },
    [projectId, load],
  );
  const exportAspect = useCallback(
    (aspect: string) => void requestExport({ aspect }),
    [requestExport],
  );

  if (!state) {
    return (
      <AppShell recents={recents}>
        <div className="px-4 py-7 sm:px-8">
          <div className="measure">
            <div className="card h-64 animate-pulse" />
          </div>
        </div>
      </AppShell>
    );
  }

  const { project, job, edl } = state;
  const doc = edl?.document ?? lastDoc.current;
  const captionStyle = draftCaption ?? doc?.captionStyle ?? null;
  const captionDirty = Boolean(draftCaption && doc && !sameStyle(draftCaption, doc.captionStyle));

  /**
   * Where this video is in the four steps.
   *
   * Derived from state rather than tracked: the step is a fact about the
   * project, and a second copy of it would be a second thing to keep in sync
   * with a job that is progressing in another process.
   */
  const step: StepKey = project.status === 'ready' ? 'export' : 'apply';

  const modeLabel = project.mode === 'short' ? 'Short form' : 'Long form';

  /*
   * Re-cutting needs the original footage, and retention takes it away.
   *
   * Every change in this app — a different style, another aspect ratio, a
   * dragged caption — replays cached analysis for free but still has to RENDER,
   * and rendering reads the source file. Once that has been swept, the honest
   * thing is to close the door visibly rather than let somebody make edits that
   * will fail at the last step.
   */
  const footageGone = Boolean(project.sourceDeletedAt);
  const footageExpires = project.sourceExpiresAt ? new Date(project.sourceExpiresAt) : null;
  const daysLeft = footageExpires
    ? Math.ceil((footageExpires.getTime() - Date.now()) / 86_400_000)
    : null;
  const styleName = styles.find((s) => s.id === project.styleId)?.name ?? project.styleId;

  /* ------------------------------------------------------------ 4K ------ */

  /** Whether a 4K export of this project already exists, read off its pixels. */
  const has4k = state.renders.some(
    (r) => r.status === 'succeeded' && qualityOfRender(r.width, r.height) === '4k',
  );

  /** The size the file will be, in the words a spec sheet uses. */
  const fourKSize = doc
    ? (() => {
        const { width, height } = dimensionsFor(doc.format.aspect, '4k');
        return `${width}×${height}`;
      })()
    : '4K';

  /*
   * How long the wait is, from this project's own last render rather than a
   * figure from a benchmark. A ten-minute video and a thirty-second one are an
   * hour apart at 4K, and "about 4× longer" is useless to somebody who never
   * timed the first one.
   */
  const fourKWait = (() => {
    const lastHd = state.renders.find(
      (r) => r.status === 'succeeded' && r.renderMs && qualityOfRender(r.width, r.height) === 'hd',
    );
    if (!lastHd?.renderMs) return `about ${QUALITY_SLOWDOWN['4k']}× longer than the usual export`;
    return approximateDuration((lastHd.renderMs / 1000) * QUALITY_SLOWDOWN['4k']);
  })();

  const commitCaption = async () => {
    if (!captionStyle) return;
    await patch({ captionStyle, captionPreset: captionStyle.preset });
    setDraftCaption(null);
  };

  /* ------------------------------------------------------------ studio --- */
  /* Preview centred, inspector on the right, timeline docked to the bottom —
     the arrangement every editor uses, because the transport belongs under the
     picture and the picture belongs in the middle. It claims the viewport, so
     the dock is always reachable without scrolling. */
  if (mode === 'studio' && doc) {
    const live = workingEdl ?? doc;
    return (
      <AppShell
        recents={recents}
        full
        action={
          <>
            <button type="button" onClick={() => setMode('simple')} className="btn-ghost">
              Done
            </button>
            {captionDirty ? (
              <button type="button" disabled={busy} onClick={() => void commitCaption()} className="btn-primary">
                Apply captions
              </button>
            ) : null}
          </>
        }
      >
        <div className="px-4 pt-3 sm:px-8">
          <div className="measure">
            <Stepper current={step} onStepClick={() => setMode('simple')} />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            {/* The picture, centred in whatever room the inspector leaves. */}
            <div className="flex min-h-[220px] min-w-0 flex-1 items-center justify-center p-3 sm:p-5">
              {/* Capped on a phone. A 9:16 preview given the whole column takes
                  three quarters of the screen, which puts the timeline — the
                  entire reason for being on this screen — below the fold. */}
              <div
                className="max-h-[42vh] overflow-hidden rounded-[14px] bg-black shadow-card sm:max-h-none"
                style={{
                  aspectRatio: project.mode === 'short' ? '9 / 16' : '16 / 9',
                  height: '100%',
                  maxWidth: '100%',
                }}
              >
                <LivePreview edl={live} playerRef={playerRef} />
              </div>
            </div>

            {/* Beside the picture, never inside the timeline. */}
            <aside className="hidden w-[368px] flex-none border-l border-line-soft lg:flex">
              <nav
                aria-label="Side panel"
                className="flex w-[48px] flex-none flex-col gap-1 border-r border-line-soft p-2.5"
              >
                {(
                  [
                    ['selected', 'What\u2019s selected', 'M4.5 3.5l6 16 2.4-6.6 6.6-2.4z'],
                    ['captions', 'Caption look', 'M3 5h18v14H3zM7 14h4M14 14h3'],
                    ['changes', 'What you changed', 'M4 5v5h5M4.6 14a7.6 7.6 0 1 0 1.2-5.6M12 8.5V12l2.5 1.6'],
                  ] as const
                ).map(([key, label, path]) => (
                  <button
                    key={key}
                    type="button"
                    data-pane={key}
                    aria-pressed={pane === key}
                    title={label}
                    onClick={() => setPane(key)}
                    className={clsx(
                      'grid h-9 w-9 place-items-center rounded-[10px] transition-colors',
                      pane === key
                        ? 'bg-violet-dim text-violet'
                        : 'text-faint hover:bg-charcoal2 hover:text-chalk',
                    )}
                  >
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d={path} />
                    </svg>
                  </button>
                ))}
              </nav>

              <div className="min-w-0 flex-1 overflow-y-auto p-4">
                {error ? (
                  <p className="mb-3 rounded-xl border border-bad/40 bg-bad/[0.08] px-3 py-2 text-[12.5px] text-bad">
                    {error}
                  </p>
                ) : null}

                {/* The editor portals into these two, so they are always mounted
                    — `hidden` switches panes without unmounting what it holds. */}
                <div ref={setInspectorHost} hidden={pane !== 'selected'} />
                <div ref={setChangesHost} hidden={pane !== 'changes'} />

                <div hidden={pane !== 'captions'}>
                  {captionStyle ? (
                    <>
                      <h3 className="mb-3 text-[14px] font-bold">Captions</h3>
                      <CaptionStudio
                        style={captionStyle}
                        onChange={setDraftCaption}
                        mode={project.mode}
                        posterUrl={project.thumbnailUrl}
                        compact
                      />
                      {captionDirty ? (
                        <div className="sticky bottom-0 mt-4 flex gap-2 bg-ink/90 py-3 backdrop-blur">
                          <button
                            type="button"
                            onClick={() => setDraftCaption(null)}
                            className="btn-ghost flex-1"
                          >
                            Revert
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void commitCaption()}
                            className="btn-primary flex-1"
                          >
                            Apply
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            </aside>
          </div>

          {/* The dock, with a seam you can drag. Big enough to work in, small
              enough to watch over — which of those you want changes minute to
              minute, so it is the person's call rather than a constant. */}
          <TimelineDock>
            <TimelineEditor
              edl={doc}
              onCommit={applyOperations}
              busy={busy}
              playerRef={playerRef}
              onWorkingEdlChange={setWorkingEdl}
              panels={panels}
              onSelect={showSelected}
            />
          </TimelineDock>
        </div>
      </AppShell>
    );
  }

  /* ------------------------------------------------------------ simple --- */
  return (
    <AppShell
      recents={recents}
      action={
        <Link href="/new" className="btn-ghost">
          <IconPlus className="h-4 w-4" />
          New video
        </Link>
      }
    >
      <div className="px-4 pt-5 sm:px-8">
        <div className="measure">
          <Stepper current={step} />
        </div>
      </div>

      <main className="min-w-0 flex-1 px-4 pb-20 sm:px-8">
        <div className="measure">
          {project.status !== 'ready' || !project.previewUrl ? (
            <div className="pt-6">
              <h1 className="text-[26px] font-extrabold">{project.title}</h1>
              <p className="mt-1.5 text-[13px] text-muted">{modeLabel} · {styleName}</p>

              {project.status === 'failed' ? (
                <FailureCard
                  message={project.errorMessage ?? job?.errorMessage ?? 'Unknown error'}
                  busy={busy}
                  onRetry={retry}
                />
              ) : null}

              <div className="mt-5">
                <ProgressPanel
                  job={job}
                  mode={project.mode}
                  styleName={styleName}
                  failed={project.status === 'failed'}
                />
              </div>
            </div>
          ) : (
            <>
              {/* ------------------------------------------------ the hero ---
                  The finished video IS the page. Watching it is the whole
                  decision — if it is right you post it and never open an
                  editor — so it is not a thumbnail in a sidebar, and the two
                  ways out of here are the same size as the choice between
                  them. */}
              <div
                className={clsx(
                  'grid items-start gap-8 pb-7 pt-6',
                  project.mode === 'short'
                    ? 'lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]'
                    : 'lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]',
                )}
              >
                {/* The shape has to live on a box that is only ever that shape.
                    `width: 100%` plus `max-height` describes a DIFFERENT
                    rectangle the moment the height clamps, and the video then
                    letterboxes itself inside it — black bars on a correctly
                    rendered 9:16 file, which reads as a broken render rather
                    than a broken stylesheet. */}
                <div
                  className="overflow-hidden rounded-[18px] bg-black shadow-card"
                  style={{ aspectRatio: project.mode === 'short' ? '9 / 16' : '16 / 9' }}
                >
                  <video
                    key={project.previewUrl}
                    src={project.previewUrl}
                    poster={project.thumbnailUrl ?? undefined}
                    controls
                    playsInline
                    className="h-full w-full"
                  />
                </div>

                <div className="min-w-0">
                  <h1 className="text-[32px] font-extrabold leading-[1.12] tracking-[-.038em]">
                    {project.title}
                  </h1>
                  <p className="mt-2 text-[13.5px] text-muted">
                    {modeLabel} · {styleName}
                    {project.durationSec ? ` · ${formatDuration(project.durationSec)}` : ''}
                    {doc ? ` · ${doc.format.width}×${doc.format.height}` : ''}
                    {project.costUsd > 0
                      ? ` · ${project.costUsd < 0.01 ? '<$0.01' : `$${project.costUsd.toFixed(2)}`} to make`
                      : ''}
                  </p>

                  <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
                    <a href={project.previewUrl} download className="act act-go">
                      <IconDownload className="h-[19px] w-[19px] flex-none" />
                      <span>
                        Export video
                        <i className="mt-0.5 block font-mono text-[11.5px] font-medium not-italic text-ink/[.62]">
                          MP4{doc ? ` · ${doc.format.width}×${doc.format.height}` : ''}
                          {project.durationSec ? ` · ${formatDuration(project.durationSec)}` : ''}
                        </i>
                      </span>
                    </a>
                    <button
                      type="button"
                      onClick={() => setMode('studio')}
                      disabled={!doc || footageGone}
                      title={footageGone ? 'Your original footage has been deleted, so this video can no longer be re-cut.' : undefined}
                      className="act act-alt"
                    >
                      <IconSliders className="h-[19px] w-[19px] flex-none text-violet" />
                      <span>
                        Open editor
                        <i className="mt-0.5 block text-[11.5px] font-medium not-italic text-muted">
                          {footageGone
                            ? 'Your footage has been deleted'
                            : 'Change any cut, caption or clip'}
                        </i>
                      </span>
                    </button>
                  </div>

                  {footageGone ? (
                    <p className="mt-3 rounded-xl border border-line bg-charcoal px-4 py-3 text-[12.5px] leading-relaxed text-muted">
                      Your original footage has been deleted, so this one is finished — you can still
                      watch and download it, but it can&rsquo;t be re-cut or exported in another shape.{' '}
                      <Link href="/pricing" className="font-semibold text-violet hover:underline">
                        Longer plans keep footage for longer.
                      </Link>
                    </p>
                  ) : daysLeft !== null && daysLeft <= 3 ? (
                    <p className="mt-3 rounded-xl border border-warn/30 bg-warn/[0.06] px-4 py-3 text-[12.5px] leading-relaxed text-warn">
                      {daysLeft <= 0
                        ? 'Your footage is due to be deleted today'
                        : `Your footage is deleted in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}
                      <span className="text-muted"> — after that this video can be watched but not re-cut.</span>
                    </p>
                  ) : null}

                  {doc ? (
                    <>
                      <CutRibbon edl={doc} />
                      <Glance edl={doc} />
                    </>
                  ) : null}

                  {error ? (
                    <p className="mt-4 rounded-xl border border-bad/40 bg-bad/[0.08] px-4 py-3 text-[13px] text-bad">
                      {error}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* -------------------------------------------------- the report */}
              <div className="flex flex-wrap items-center gap-3 border-t border-line-soft pb-3.5 pt-5">
                <h2 className="text-[19px] font-extrabold tracking-[-.03em]">The report</h2>
                <span className="rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Version {edl?.version ?? 1}
                </span>
                <p className="basis-full text-[13px] text-muted">
                  Every decision the edit made, and everything it put on top.
                </p>
              </div>

              <div className="grid items-start gap-3.5">
                {doc ? <TheCut edl={doc} /> : null}
                {doc ? <AddedList edl={doc} /> : null}

                {/* The tweaks are one tall card, so they take a column of
                    their own — stacking everything in the left half left the
                    right half of the page empty on any project without a
                    social caption. */}
                <div className="grid items-start gap-3.5 lg:grid-cols-2">
                  <TweakPanel
                    disabled={busy}
                    edl={doc}
                    styles={styles}
                    currentStyle={project.styleId}
                    onPatch={patch}
                    onOpenCaptions={doc ? () => setMode('studio') : undefined}
                  />

                  <div className="grid gap-3.5">
                  {project.socialCaption ? (
                    <div className="card p-5">
                      <div className="flex items-center gap-3">
                        <h3 className="text-sm font-bold">Caption for your post</h3>
                        {/* The last thing between a finished video and a posted
                            one is pasting this somewhere. Selecting it by hand
                            on a phone is the whole reason people give up. */}
                        <CopyButton
                          className="ml-auto"
                          text={[project.socialCaption, project.hashtags.join(' ')].filter(Boolean).join('\n\n')}
                        />
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-muted">{project.socialCaption}</p>
                      {project.hashtags.length ? (
                        <p className="mt-2 text-sm text-violet">{project.hashtags.join(' ')}</p>
                      ) : null}
                    </div>
                  ) : null}

                    {doc?.degraded.length ? (
                      <div className="card p-4">
                        <h3 className="text-sm font-bold text-warn">Skipped layers</h3>
                        <ul className="mt-2 space-y-1 text-xs text-muted">
                          {doc.degraded.map((item, i) => (
                            <li key={i}>&bull; {item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {/* 4K, opt-in, with the wait on the control.
                        Deliberately its own card rather than a toggle on the
                        aspect buttons: it is the one export decision with a
                        real cost attached, and burying it in a row of shapes
                        would have people pressing it without reading. */}
                    {canExport4k ? (
                      <div className="card p-4">
                        <div className="flex items-baseline justify-between gap-3">
                          <h3 className="text-sm font-bold">Export in 4K</h3>
                          {has4k ? (
                            <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-ok">
                              Done
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-[12.5px] leading-snug text-muted">
                          {footageGone
                            ? 'Not any more — this needs your original footage, which has been deleted.'
                            : `Four times the pixels — ${fourKSize}. Same edit, drawn bigger. ` +
                              `It takes ${fourKWait}, so it is worth it for something going on a ` +
                              'television or footage a client will crop into, and rarely worth it for a feed.'}
                        </p>
                        <button
                          type="button"
                          disabled={busy || footageGone}
                          onClick={() => void requestExport({ quality: '4k' })}
                          className="btn-ghost mt-3"
                        >
                          {has4k ? 'Render 4K again' : 'Render this in 4K'}
                        </button>
                      </div>
                    ) : null}

                    <div className="card p-4">
                      <h3 className="text-sm font-bold">Another shape</h3>
                      <p className="mt-1 text-[12.5px] text-muted">
                        {footageGone
                          ? 'Not any more — this needs your original footage, which has been deleted.'
                          : 'Re-cut for a different feed. Free — it replays the analysis it already has.'}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(['9:16', '1:1', '16:9'] as const)
                          .filter((a) => a !== doc?.format.aspect)
                          .map((aspect) => (
                            <button
                              key={aspect}
                              type="button"
                              disabled={busy || footageGone}
                              onClick={() => void exportAspect(aspect)}
                              className="btn-ghost"
                            >
                              Export {aspect}
                            </button>
                          ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}

/** Two caption styles are the same look when every field matches. */
function sameStyle(a: CaptionStyle, b: CaptionStyle): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Remotion's Player, rendering the same composition the cloud renderer does.
 *
 * Loaded dynamically because it pulls in the whole renderer runtime, which has
 * no business in the bundle for people who never open the timeline.
 */
const Player = dynamic(() => import('@remotion/player').then((m) => m.Player), { ssr: false });
const EasyCutVideo = dynamic(
  () => import('@remotion-app/EasyCutVideo').then((m) => m.EasyCutVideo),
  { ssr: false },
);

function LivePreview({
  edl,
  playerRef,
}: {
  edl: Edl;
  playerRef: React.RefObject<PlayerRef | null>;
}) {
  const fps = edl.format.fps || 30;
  const [failed, setFailed] = useState<string | null>(null);

  // A preview that cannot play the source used to be a black rectangle and a
  // line in the console. It happens for real reasons — a browser without the
  // H.264 and AAC decoders (Chromium built without them, some Linux builds of
  // Firefox), a B-roll URL that has gone away, a dropped connection — and in
  // every one of them the export is still fine, because the export is made by
  // ffmpeg and a headless browser on the server, not by this one. So say that,
  // rather than showing black and letting somebody conclude their video is
  // ruined.
  //
  // The message arrives through the composition's `onMediaError` rather than an
  // error boundary, because a media element fails asynchronously: it throws
  // long after the render that created it, where no boundary can see it.
  // The shape belongs to the box this is placed in — two elements both claiming
  // the aspect is how the picture ends up letterboxed inside its own frame.
  return (
    <div className="relative h-full w-full bg-black">
      {/* A notice over the picture rather than instead of it. One B-roll insert
          whose URL has gone away should not hide the speaker, and a source the
          browser cannot decode leaves black underneath anyway — so the same
          overlay covers both without having to guess which happened. */}
      {failed ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-ink/85 px-4 py-3 text-center backdrop-blur">
          <p className="text-[12.5px] font-bold">This browser can&rsquo;t play part of the preview.</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            Your edit is fine &mdash; the export is made on the server, not here.
          </p>
          <p className="mt-1 w-full truncate text-[10.5px] text-faint" title={failed}>{failed}</p>
        </div>
      ) : null}

      <Player
        ref={playerRef}
        component={EasyCutVideo as never}
        inputProps={{
          edl,
          previewAudio: true,
          // Only the preview gets this. A render without it fails loudly on an
          // undecodable source, which is what you want from a render.
          onMediaError: (message: string) => setFailed((f) => f ?? message),
        } as never}
        durationInFrames={Math.max(1, Math.round(edl.format.durationSec * fps))}
        fps={fps}
        compositionWidth={edl.format.width}
        compositionHeight={edl.format.height}
        style={{ width: '100%', height: '100%' }}
        // The timeline is the transport; a second set of controls inside the
        // frame would be two things claiming to be in charge.
        controls={false}
        errorFallback={({ error }) => {
          // Remotion renders this in place of the frame. The message is handed
          // to state so the block above owns the wording — after the current
          // render, because setting state while React is rendering something
          // else is how you get an infinite loop with a warning in front of it.
          queueMicrotask(() => setFailed(error.message));
          return <div className="h-full w-full bg-black" />;
        }}
        acknowledgeRemotionLicense
      />
    </div>
  );
}

/* ---------------------------------------------------------------- panels */

/**
 * The Apply step: ninety seconds to five minutes of somebody watching a bar.
 *
 * It used to be a spinner, a label and the last five log lines — and the log
 * was only written when the job finished, so for the whole of the wait it was
 * a spinner and a label. Which is the screen people close the tab on.
 *
 * Every stage is listed instead, so the wait has a shape: what is done, what
 * is happening, what is left, and how long each piece took. The same list the
 * pipeline actually runs, from the same constant, so it can never drift into
 * describing work that is not being done.
 */
function ProgressPanel({
  job,
  mode,
  styleName,
  failed = false,
}: {
  job: ProjectState['job'];
  mode: 'short' | 'long';
  styleName: string;
  failed?: boolean;
}) {
  const progress = job?.progress ?? 0;
  const estimate = mode === 'short' ? '~90 seconds' : '~5 minutes';

  // The stages that get their own row. `done` is the finish line, not a step.
  const rows = useMemo(() => PIPELINE_STAGES.filter((st) => st !== 'done'), []);
  const byStage = useMemo(
    () => new Map((job?.log ?? []).map((e) => [e.stage, e])),
    [job?.log],
  );
  const currentIndex = rows.indexOf((job?.stage ?? 'ingest') as (typeof rows)[number]);

  const elapsed = useElapsed(job?.startedAt ?? null, !failed && job?.status === 'running');

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line-soft p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[19px] font-extrabold tracking-[-.03em]">
            {failed ? 'Where it stopped' : job?.progressLabel || 'Getting started'}
          </h2>
          {elapsed !== null ? (
            <span className="font-mono text-[12.5px] tabular-nums text-muted">{formatDuration(elapsed)}</span>
          ) : null}
        </div>
        <p className="mt-1.5 text-[13px] text-muted">
          {failed
            ? `It stopped here. Everything above this line finished — running it again picks up from the start.`
            : `Making a ${mode === 'short' ? 'short' : 'long-form'} cut in the ${styleName} style. ` +
              `Usually ${estimate} start to finish — you can close this tab and come back.`}
        </p>

        {!failed && job?.stalled ? <Stalled stalled={job.stalled} /> : null}

        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-ink">
          <div
            className={clsx(
              'h-full rounded-full transition-[width] duration-500',
              failed ? 'bg-bad/60' : 'bg-violet',
            )}
            style={{ width: `${Math.max(3, progress * 100)}%` }}
          />
        </div>
      </div>

      <ul className="p-2 sm:p-3">
        {rows.map((stage, i) => {
          const entry = byStage.get(stage);
          // On a dead job the stage it was in is where it died — a spinner
          // there would promise work that stopped some time ago.
          const here = i === currentIndex;
          const state = entry
            ? entry.status === 'ok'
              ? 'done'
              : 'warn'
            : here
              ? (failed ? 'dead' : 'now')
              : 'todo';
          return (
            <li
              key={stage}
              className={clsx(
                'grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2 transition-colors',
                state === 'now' && 'bg-violet-dim',
                state === 'dead' && 'bg-bad/[0.08]',
              )}
            >
              <span
                className={clsx(
                  'grid h-4 w-4 place-items-center rounded-full border',
                  state === 'done' && 'border-ok/45 bg-ok/[0.13] text-ok',
                  state === 'warn' && 'border-warn/50 bg-warn/[0.12] text-warn',
                  state === 'now' && 'animate-spin border-violet border-r-transparent',
                  state === 'dead' && 'border-bad/60 bg-bad/[0.14] text-bad',
                  state === 'todo' && 'border-line',
                )}
              >
                {state === 'done' ? <IconCheck className="h-2.5 w-2.5" /> : null}
                {state === 'warn' || state === 'dead' ? (
                  <span className="text-[10px] font-bold leading-none">!</span>
                ) : null}
              </span>

              <span
                className={clsx(
                  'truncate text-[13.5px]',
                  state === 'now' && 'font-semibold text-chalk',
                  state === 'done' && 'text-muted',
                  state === 'warn' && 'text-warn',
                  state === 'dead' && 'font-semibold text-bad',
                  state === 'todo' && 'text-faint',
                )}
              >
                {STAGE_LABELS[stage]}
                {state === 'warn' && entry?.message ? (
                  <span className="ml-2 text-[12px] text-muted">— {entry.message}</span>
                ) : null}
              </span>

              <span className="font-mono text-[11.5px] tabular-nums text-faint">
                {entry ? `${(entry.ms / 1000).toFixed(1)}s` : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Seconds since the job started, ticking while it runs. */
/**
 * "This should have moved by now."
 *
 * A spinner that never stops is the one failure a product can have that gives
 * the person watching it nothing at all — not an error, not a retry, not even
 * a reason to give up. This says which of the two things went wrong and, when
 * it is something the person running the app can fix, what fixes it.
 *
 * Deliberately not an error: nothing is lost, the pipeline is resumable, and
 * the job does continue when a worker comes back. It is a warning about the
 * WAIT, not about the video.
 */
function Stalled({ stalled }: { stalled: NonNullable<ProjectState['job']>['stalled'] }) {
  if (!stalled) return null;
  const waited = howLong(stalled.forSec);

  return (
    <div
      role="status"
      className="mt-4 rounded-xl border border-warn/40 bg-warn/10 px-3.5 py-3 text-[12.5px] leading-relaxed text-chalk/90"
    >
      <b className="font-bold">
        {stalled.reason === 'never-started'
          ? `This has been waiting ${waited} without starting.`
          : `Nothing has moved for ${waited}.`}
      </b>{' '}
      {stalled.reason === 'never-started' ? (
        stalled.selfHosted ? (
          <>
            Nothing is taking jobs off the queue. The worker runs in its own terminal —{' '}
            <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-[11.5px]">npm run worker</code> — and
            if it is already running, check it is not on{' '}
            <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-[11.5px]">QUEUE_DRIVER=memory</code>,
            which gives it a private queue the app never writes to.
          </>
        ) : (
          <>We are busier than usual. Your place in the queue is kept and nothing is lost — leave this and come back.</>
        )
      ) : (
        <>
          Whatever was working on this stopped. Nothing is lost: the edit picks up from the last finished
          stage as soon as a worker takes it again{stalled.selfHosted ? ', which happens when you restart it' : ''}.
        </>
      )}
    </div>
  );
}

/**
 * How long, in words somebody would actually say.
 *
 * "9203 minutes" is true and useless — a project abandoned six days ago reads
 * as a rounding error rather than as something long dead. The unit has to
 * grow with the number or the sentence stops meaning anything.
 */
function howLong(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;

  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? '' : 's'}`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

function useElapsed(startedAt: string | null, running: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running, startedAt]);

  if (!startedAt) return null;
  const started = new Date(startedAt).getTime();
  return Number.isFinite(started) ? Math.max(0, (now - started) / 1000) : null;
}

/**
 * A failure, in words somebody who films themselves would use.
 *
 * It used to print the raw error — two absolute paths and "moov atom not
 * found" — to people who are not editors and are definitely not reading
 * ffprobe output. Worse, that particular message was usually a lie about
 * whose fault it was: it meant OUR upload had truncated their file.
 *
 * The technical text is still here, one click away, because the person who
 * does want it wants all of it.
 */
function FailureCard({
  message,
  busy,
  onRetry,
}: {
  message: string;
  busy: boolean;
  onRetry: () => void;
}) {
  const { headline, advice, retryable } = useMemo(() => explainFailure(message), [message]);

  return (
    <div className="mt-5 rounded-2xl border border-bad/40 bg-bad/[0.07] p-5">
      <h2 className="text-[15px] font-bold text-bad">{headline}</h2>
      {advice ? <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{advice}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {retryable ? (
          <button type="button" onClick={onRetry} disabled={busy} className="btn-primary">
            {busy ? 'Starting…' : 'Try again'}
          </button>
        ) : null}
        <Link href="/new" className="btn-ghost">
          <IconPlus className="h-4 w-4" />
          Start over with a new file
        </Link>
      </div>

      <details className="mt-4 text-[12.5px]">
        <summary className="cursor-pointer text-faint hover:text-muted">What the machine said</summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-ink p-3 font-mono text-[11.5px] leading-relaxed text-muted">
          {message}
        </pre>
      </details>
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
  onOpenCaptions,
}: {
  disabled: boolean;
  edl: Edl | null;
  styles: StyleOption[];
  currentStyle: string;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onOpenCaptions?: () => void;
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

      {/* Four sliders used to live here, which was the whole caption feature:
          size, height, caps and four of the nine animations. The real picker —
          sixteen looks, sixteen faces, colour, motion — is a panel, not a
          sidebar card, so this is the door to it and shows what is behind it. */}
      <button
        type="button"
        disabled={disabled || !onOpenCaptions}
        onClick={onOpenCaptions}
        className="card block w-full p-5 text-left transition-colors hover:border-violet/40 disabled:opacity-50"
      >
        <h3 className="flex items-center gap-2 text-sm font-bold">
          Captions
          <span className="ml-auto text-[12px] font-semibold text-violet">Change</span>
        </h3>
        <CaptionBand
          className="mt-3 rounded-[10px] border border-line bg-[#101015]"
          style={edl.captionStyle}
          text="Your captions"
          frameWidth={edl.format.width}
          frameHeight={edl.format.height}
          aspect="16 / 5"
        />
        <p className="mt-2.5 text-[11.5px] text-muted">
          {captionPresetFor(edl.captionStyle)?.name ?? 'Custom'} &middot; {edl.captionStyle.fontFamily}
          {' '}&middot; {edl.captions.length} cards
        </p>
      </button>

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

/**
 * A wait, in the words somebody would use to describe one.
 *
 * `formatDuration` is a timecode, which is right on a video and wrong on a
 * sentence — "about 27:00" is not how anybody says half an hour. Rounded
 * generously and upward: a wait that comes in early is a good surprise.
 */
function approximateDuration(seconds: number): string {
  const minutes = seconds / 60;
  if (minutes < 1.5) return 'about a minute';
  if (minutes < 55) return `about ${Math.ceil(minutes / 5) * 5} minutes`;
  const hours = minutes / 60;
  if (hours < 1.25) return 'about an hour';
  if (hours < 1.75) return 'about an hour and a half';
  return `about ${Math.round(hours)} hours`;
}
