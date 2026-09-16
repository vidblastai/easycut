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
import { CaptionStudio } from '@/components/captions/CaptionStudio';
import { CaptionBand } from '@/components/captions/CaptionPreview';
import { captionPresetFor } from '@/lib/captions/presets';
import { IconDownload, IconPlus } from '@/components/shell/Icons';
import { CopyButton } from '@/components/CopyButton';
import type { EdlOperation } from '@/lib/edl/operations';
import type { CaptionStyle, Edl } from '@/lib/edl/types';
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

export function ProjectWorkspace({
  projectId,
  styles,
  recents,
}: {
  projectId: string;
  styles: StyleOption[];
  recents: RecentProject[];
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
  const step: StepKey =
    project.status === 'processing' || project.status === 'draft'
      ? 'editing'
      : mode === 'studio'
        ? 'tune'
        : 'done';

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
            <Stepper current={step} onStepClick={(k) => k !== 'tune' && setMode('simple')} />
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
        <>
          {doc ? (
            <button type="button" onClick={() => setMode('studio')} className="btn-ghost">
              Fine-tune
            </button>
          ) : null}
          {project.previewUrl ? (
            <a href={project.previewUrl} download className="btn-primary">
              <IconDownload className="h-4 w-4" />
              Download
            </a>
          ) : (
            <Link href="/new" className="btn-ghost">
              <IconPlus className="h-4 w-4" />
              New video
            </Link>
          )}
        </>
      }
    >
      <div className="px-4 pt-5 sm:px-8">
        <div className="measure">
          <Stepper current={step} onStepClick={(k) => k === 'tune' && doc && setMode('studio')} />
        </div>
      </div>

      <main className="min-w-0 flex-1 px-4 pb-20 sm:px-8">
        <div className="measure">
          <div className="pt-6">
            <h1 className="text-[26px] font-extrabold">{project.title}</h1>
            <p className="mt-1.5 text-[13px] text-muted">
              {project.mode === 'short' ? 'Short form' : 'Long form'} ·{' '}
              {styles.find((s) => s.id === project.styleId)?.name ?? project.styleId}
              {project.durationSec ? ` · ${formatDuration(project.durationSec)}` : ''}
              {project.costUsd > 0 ? ` · ${project.costUsd < 0.01 ? '<$0.01' : `$${project.costUsd.toFixed(2)}`} to make` : ''}
            </p>
          </div>

          {project.status === 'failed' ? (
            <FailureCard message={project.errorMessage ?? job?.errorMessage ?? 'Unknown error'} />
          ) : null}

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.35fr_1fr]">
            {/* ----------------------------------------------------- the video */}
            <div>
              {project.status === 'processing' || !project.previewUrl ? (
                <ProgressPanel job={job} mode={project.mode} />
              ) : (
                <div className="card overflow-hidden">
                  {/* The shape has to live on a box that is only ever that
                      shape. `width: 100%` plus `max-height` describes a
                      DIFFERENT rectangle the moment the height clamps, and the
                      video then letterboxes itself inside it — black bars on a
                      correctly rendered 9:16 file, which reads as a broken
                      render rather than a broken stylesheet. */}
                  {/* Black belongs to the picture, not to the room it sits in
                      — a black gutter beside a correctly sized 9:16 video is
                      indistinguishable from a letterboxed render. */}
                  <div className="flex justify-center">
                    <div
                      className="bg-black"
                      style={{
                        aspectRatio: project.mode === 'short' ? '9 / 16' : '16 / 9',
                        height: '70vh',
                        maxWidth: '100%',
                      }}
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
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-line p-4">
                    <a href={project.previewUrl} download className="btn-primary">
                      <IconDownload className="h-4 w-4" />
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
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-bold">Caption for your post</h3>
                    {/* The last thing between a finished video and a posted one
                        is pasting this somewhere. Selecting it by hand on a
                        phone is the whole reason people give up here. */}
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

              {doc ? <WhatWeDid edl={doc} /> : null}
            </div>

            {/* ---------------------------------------------------- the tweaks */}
            <aside className="space-y-4">
              {error ? (
                <div className="rounded-xl border border-bad/40 bg-bad/[0.08] px-4 py-3 text-sm text-bad">
                  {error}
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

              <TweakPanel
                disabled={busy || project.status === 'processing'}
                edl={doc}
                styles={styles}
                currentStyle={project.styleId}
                onPatch={patch}
                onOpenCaptions={doc ? () => setMode('studio') : undefined}
              />
            </aside>
          </div>
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
