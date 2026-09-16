'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import type { PlayerRef } from '@remotion/player';
import { applyOperations, describeOperation, type ClipTrack, type EdlOperation } from '@/lib/edl/operations';
import type { Edl } from '@/lib/edl/types';

/**
 * The timeline editor.
 *
 * The rest of the product is built so you never have to open this. But "never
 * have to" is not "can't" — when the AI puts a B-roll insert half a second
 * early, or keeps a line you wanted gone, you need to fix that yourself rather
 * than re-roll the whole edit and hope.
 *
 * Three decisions shape it:
 *
 *  1. **Edits are local until you commit.** Every drag applies to a working copy
 *     and the preview updates instantly. Re-rendering per drag would be absurd,
 *     and a commit-per-keystroke would turn the version history into noise. One
 *     "Apply" sends the whole accumulated stack.
 *
 *  2. **Undo replays operations rather than snapshotting documents.** The stack
 *     IS the edit, so undo is truncating it and re-applying from the original.
 *     That also means what you previewed is exactly what the server recomputes.
 *
 *  3. **It snaps to things that matter.** Cut points, caption boundaries, the
 *     playhead. Frame-accurate dragging with a mouse is a fantasy; landing on
 *     the beat you meant is the actual goal.
 */

interface TimelineEditorProps {
  edl: Edl;
  /** Commits the accumulated operations. Resolves when the server has them. */
  onCommit: (operations: EdlOperation[]) => Promise<void>;
  busy?: boolean;
  /**
   * The preview, so the timeline can drive it.
   *
   * This is what turns a diagram into an instrument. Without it the playhead is
   * a line on a chart and you are trimming blind; with it, dragging the playhead
   * scrubs the video and pressing play walks the playhead. One transport, two
   * views of the same moment.
   */
  playerRef?: React.RefObject<PlayerRef | null>;
  /** The working document, lifted so the preview renders the pending edits. */
  onWorkingEdlChange?: (edl: Edl) => void;
}

type Selection = { kind: 'segment' | ClipTrack | 'caption'; id: string } | null;

interface DragState {
  kind: 'move' | 'trim-start' | 'trim-end' | 'playhead';
  target: Selection;
  startX: number;
  originStart: number;
  originEnd: number;
  moved: boolean;
}

/** Zoom steps in pixels per second. */
const ZOOMS = [12, 20, 32, 50, 80, 130, 210];
const SNAP_PX = 7;
const TRACK_LABEL_W = 92;

export function TimelineEditor({
  edl: committedEdl,
  onCommit,
  busy = false,
  playerRef,
  onWorkingEdlChange,
}: TimelineEditorProps) {
  const [ops, setOps] = useState<EdlOperation[]>([]);
  const [redoStack, setRedoStack] = useState<EdlOperation[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [playhead, setPlayhead] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(2);
  const [warning, setWarning] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  /**
   * Live geometry while a drag is in flight. The clip follows the cursor from
   * here; the operation is only pushed on release, so a drag that gets
   * cancelled costs nothing and the undo stack stays one entry per gesture.
   */
  const [dragPreview, setDragPreview] = useState<
    { id: string; start: number; end: number; kind: DragState['kind'] } | null
  >(null);
  const dragPreviewRef = useRef(dragPreview);
  dragPreviewRef.current = dragPreview;

  /** The working document: the committed EDL with every pending edit applied. */
  const { edl, rejected } = useMemo(
    () => applyOperations(committedEdl, ops),
    [committedEdl, ops],
  );

  const pps = ZOOMS[zoomIndex];
  const duration = edl.format.durationSec;
  const width = Math.max(320, duration * pps);
  const fps = edl.format.fps || 30;

  const [playing, setPlaying] = useState(false);

  /* ───────────────────────────────────────────── player binding ─── */

  // Hand the pending edit up so the preview shows what you are editing, not
  // what was last rendered.
  useEffect(() => { onWorkingEdlChange?.(edl); }, [edl, onWorkingEdlChange]);

  /** Timeline → player. */
  const seek = useCallback((sec: number) => {
    const clamped = Math.max(0, Math.min(duration, sec));
    setPlayhead(clamped);
    playerRef?.current?.seekTo(Math.round(clamped * fps));
  }, [duration, fps, playerRef]);

  /** Player → timeline, so playback walks the playhead. */
  useEffect(() => {
    const player = playerRef?.current;
    if (!player) return;

    const onFrame = (e: { detail: { frame: number } }) => setPlayhead(e.detail.frame / fps);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    player.addEventListener('frameupdate', onFrame);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);
    return () => {
      player.removeEventListener('frameupdate', onFrame);
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
    };
  }, [playerRef, fps]);

  const togglePlay = useCallback(() => {
    const player = playerRef?.current;
    if (!player) { setPlaying((p) => !p); return; }
    player.toggle();
  }, [playerRef]);

  /* ─────────────────────────────────────────────── op plumbing ─── */

  const push = useCallback((op: EdlOperation) => {
    setOps((current) => {
      const next = [...current, op];
      // Applying against the live document tells us immediately whether the
      // edit is possible, so the user gets the reason instead of silence.
      const result = applyOperations(committedEdl, next);
      const failed = result.rejected.at(-1);
      if (failed) {
        setWarning(failed.reason);
        return current;
      }
      setWarning(null);
      return next;
    });
    setRedoStack([]);
  }, [committedEdl]);

  const undo = useCallback(() => {
    setOps((current) => {
      if (!current.length) return current;
      const last = current[current.length - 1];
      setRedoStack((r) => [...r, last]);
      return current.slice(0, -1);
    });
    setWarning(null);
  }, []);

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (!stack.length) return stack;
      const op = stack[stack.length - 1];
      setOps((current) => [...current, op]);
      return stack.slice(0, -1);
    });
  }, []);

  const commit = useCallback(async () => {
    if (!ops.length) return;
    await onCommit(ops);
    setOps([]);
    setRedoStack([]);
    setSelection(null);
  }, [ops, onCommit]);

  /* ───────────────────────────────────────────────── snapping ─── */

  /** Times worth landing on exactly: cuts, cue edges, the playhead, the ends. */
  const snapPoints = useMemo(() => {
    // Deliberately NOT keyed on the playhead. It used to be one of the points
    // in here, which meant this whole set was rebuilt and re-sorted on every
    // `frameupdate` — thirty times a second during playback. On a ten-minute
    // video that is 301 captions and 75 segments, so ~760 insertions and a
    // sort of the same, per frame, for a value that only matters while
    // something is being dragged. The playhead is considered in `snap` below
    // instead, where it costs one comparison.
    const points = new Set<number>([0, duration]);
    for (const s of edl.segments) { points.add(s.outStartSec); points.add(s.outEndSec); }
    for (const c of edl.captions) { points.add(c.startSec); points.add(c.endSec); }
    for (const b of edl.broll) { points.add(b.outStartSec); points.add(b.outEndSec); }
    for (const g of edl.graphics) { points.add(g.outStartSec); points.add(g.outEndSec); }
    return [...points].sort((a, b) => a - b);
  }, [edl, duration]);

  const snap = useCallback((sec: number, exclude: number[] = []): number => {
    const tolerance = SNAP_PX / pps;
    let best = sec;
    let bestGap = tolerance;

    const consider = (point: number) => {
      if (exclude.some((e) => Math.abs(e - point) < 1e-6)) return;
      const gap = Math.abs(point - sec);
      if (gap < bestGap) { bestGap = gap; best = point; }
    };

    for (const point of snapPoints) consider(point);
    // Still a snap target — just not one the memo above has to be invalidated
    // for on every frame of playback.
    consider(playhead);

    return Math.max(0, Math.min(duration, best));
  }, [snapPoints, playhead, pps, duration]);

  /* ────────────────────────────────────────────────── dragging ─── */

  const secAtClientX = useCallback((clientX: number): number => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft - TRACK_LABEL_W;
    return Math.max(0, Math.min(duration, x / pps));
  }, [pps, duration]);

  const beginDrag = (
    event: React.PointerEvent,
    kind: DragState['kind'],
    target: Selection,
    originStart: number,
    originEnd: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    dragRef.current = { kind, target, startX: event.clientX, originStart, originEnd, moved: false };
    if (target) setSelection(target);
  };

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const deltaSec = (event.clientX - drag.startX) / pps;
      if (Math.abs(event.clientX - drag.startX) > 2) drag.moved = true;

      if (drag.kind === 'playhead') {
        seek(secAtClientX(event.clientX));
        return;
      }
      setDragPreview({
        id: drag.target?.id ?? '',
        start: drag.kind === 'trim-end' ? drag.originStart : snap(drag.originStart + deltaSec, [drag.originStart]),
        end: drag.kind === 'trim-start' ? drag.originEnd : snap(drag.originEnd + deltaSec, [drag.originEnd]),
        kind: drag.kind,
      });
    };

    const onUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      const preview = dragPreviewRef.current;
      setDragPreview(null);
      if (!drag || !drag.moved || !drag.target || !preview) return;

      const { kind, id } = drag.target;

      if (kind === 'segment') {
        // Segment edges are source-side: dragging the left edge trims into the
        // footage rather than moving the clip, because output order is the cut.
        const segment = edl.segments.find((s) => s.id === id);
        if (!segment) return;
        if (drag.kind === 'trim-start') {
          const delta = preview.start - drag.originStart;
          push({ op: 'segment.trim', id, sourceStartSec: segment.sourceStartSec + delta * segment.speed });
        } else if (drag.kind === 'trim-end') {
          const delta = preview.end - drag.originEnd;
          push({ op: 'segment.trim', id, sourceEndSec: segment.sourceEndSec + delta * segment.speed });
        } else {
          const index = nearestIndex(edl.segments.map((s) => s.outStartSec), preview.start);
          push({ op: 'segment.reorder', id, toIndex: index });
        }
        return;
      }

      if (kind === 'caption') {
        push({ op: 'caption.time', id, startSec: preview.start, endSec: preview.end });
        return;
      }

      if (drag.kind === 'move') push({ op: 'clip.move', track: kind, id, outStartSec: preview.start });
      else push({ op: 'clip.trim', track: kind, id, outStartSec: preview.start, outEndSec: preview.end });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [pps, secAtClientX, snap, push, edl.segments, seek]);

  /* ──────────────────────────────────────────────── keyboard ─── */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;

      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!selection) return;
        event.preventDefault();
        if (selection.kind === 'segment') push({ op: 'segment.delete', id: selection.id });
        else if (selection.kind === 'caption') push({ op: 'caption.delete', id: selection.id });
        else push({ op: 'clip.delete', track: selection.kind, id: selection.id });
        setSelection(null);
        return;
      }

      if (event.code === 'Space' || event.key.toLowerCase() === 'k') {
        event.preventDefault();
        togglePlay();
        return;
      }

      if (event.key.toLowerCase() === 's') {
        const segment = edl.segments.find((s) => playhead > s.outStartSec && playhead < s.outEndSec);
        if (segment) { event.preventDefault(); push({ op: 'segment.split', id: segment.id, atOutSec: playhead }); }
        return;
      }

      // J / L step a second back and forward — the shuttle keys every editor's
      // left hand already knows.
      if (event.key.toLowerCase() === 'j') { event.preventDefault(); seek(playhead - 1); return; }
      if (event.key.toLowerCase() === 'l') { event.preventDefault(); seek(playhead + 1); return; }
      if (event.key === 'Home') { event.preventDefault(); seek(0); return; }
      if (event.key === 'End') { event.preventDefault(); seek(duration); return; }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const step = event.shiftKey ? 1 : 1 / fps;
        seek(playhead + (event.key === 'ArrowRight' ? step : -step));
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, playhead, edl.segments, fps, duration, push, undo, redo, seek, togglePlay]);

  /* ───────────────────────────────────────────────── rendering ─── */

  const geometry = (id: string, start: number, end: number) =>
    dragPreview?.id === id ? { start: dragPreview.start, end: dragPreview.end } : { start, end };

  const activeSegment = edl.segments.find((s) => playhead >= s.outStartSec && playhead < s.outEndSec);

  return (
    <div className="card overflow-hidden">
      {/* ─────────────────────────────────────────────── toolbar ─── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <button
          type="button"
          onClick={togglePlay}
          title="Play or pause (Space)"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-violet text-ink transition-colors hover:bg-violet-hover"
        >
          {playing ? (
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <rect x="4" y="2.5" width="3" height="11" rx="1" /><rect x="9" y="2.5" width="3" height="11" rx="1" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9-5.5-9-5.5Z" /></svg>
          )}
        </button>

        <span className="rounded-md bg-ink px-2 py-1 font-mono text-[11px] tabular-nums text-muted">
          {formatTc(playhead)} / {formatTc(duration)}
        </span>

        <div className="mx-1 h-5 w-px bg-line" />

        <AddMenu atSec={playhead} onAdd={push} />

        <ToolButton
          onClick={() => {
            const s = edl.segments.find((x) => playhead > x.outStartSec && playhead < x.outEndSec);
            if (s) push({ op: 'segment.split', id: s.id, atOutSec: playhead });
          }}
          disabled={!activeSegment}
          title="Split the clip under the playhead (S)"
        >
          Split
        </ToolButton>

        <ToolButton
          onClick={() => {
            if (!selection) return;
            if (selection.kind === 'segment') push({ op: 'segment.delete', id: selection.id });
            else if (selection.kind === 'caption') push({ op: 'caption.delete', id: selection.id });
            else push({ op: 'clip.delete', track: selection.kind, id: selection.id });
            setSelection(null);
          }}
          disabled={!selection}
          title="Delete what's selected (Delete)"
        >
          Delete
        </ToolButton>

        <div className="mx-1 h-5 w-px bg-line" />

        <ToolButton onClick={undo} disabled={!ops.length} title="Undo (Cmd/Ctrl+Z)">Undo</ToolButton>
        <ToolButton onClick={redo} disabled={!redoStack.length} title="Redo (Cmd/Ctrl+Shift+Z)">Redo</ToolButton>

        <div className="ml-auto flex items-center gap-2">
          <ToolButton onClick={() => setZoomIndex((z) => Math.max(0, z - 1))} disabled={zoomIndex === 0} title="Zoom out">&minus;</ToolButton>
          <ToolButton onClick={() => setZoomIndex((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoomIndex === ZOOMS.length - 1} title="Zoom in">+</ToolButton>

          <button
            type="button"
            onClick={() => void commit()}
            disabled={!ops.length || busy}
            className="btn-primary px-4 py-2 text-xs"
          >
            {busy ? 'Rendering…' : ops.length ? `Apply ${ops.length} change${ops.length === 1 ? '' : 's'}` : 'No changes'}
          </button>
        </div>
      </div>

      {warning ? (
        <div className="border-b border-line bg-warn/[0.07] px-4 py-2 text-xs text-warn">{warning}</div>
      ) : null}
      {rejected.length ? (
        <div className="border-b border-line bg-bad/[0.07] px-4 py-2 text-xs text-bad">
          {rejected.length} edit{rejected.length === 1 ? '' : 's'} could not be applied.
        </div>
      ) : null}

      {/* ────────────────────────────────────────────── the tracks ─── */}
      <div ref={scrollRef} className="relative overflow-x-auto overflow-y-hidden">
        <div style={{ width: width + TRACK_LABEL_W, minWidth: '100%' }}>
          {/* ruler */}
          <div
            className="sticky top-0 z-20 flex h-7 cursor-ew-resize select-none border-b border-line bg-charcoal"
            onPointerDown={(e) => { beginDrag(e, 'playhead', null, 0, 0); seek(secAtClientX(e.clientX)); }}
          >
            <div className="shrink-0 border-r border-line" style={{ width: TRACK_LABEL_W }} />
            <div className="relative" style={{ width }}>
              {tickTimes(duration, pps).map((t) => (
                <span
                  key={t}
                  className="absolute top-0 border-l border-line pl-1 font-mono text-[10px] leading-7 text-faint"
                  style={{ left: t * pps, color: '#6E6E7C' }}
                >
                  {formatTc(t)}
                </span>
              ))}
            </div>
          </div>

          <Track label="Video" labelHint={`${edl.segments.length} clips`}>
            <SpeechTrack edl={edl} pps={pps} />
            {edl.segments.map((segment) => {
              const g = geometry(segment.id, segment.outStartSec, segment.outEndSec);
              const selected = selection?.kind === 'segment' && selection.id === segment.id;
              return (
                <Clip
                  key={segment.id}
                  left={g.start * pps}
                  width={Math.max(6, (g.end - g.start) * pps)}
                  selected={selected}
                  tone={segment.reason === 'hook' ? 'hook' : 'video'}
                  onPointerDown={(e) => beginDrag(e, 'move', { kind: 'segment', id: segment.id }, segment.outStartSec, segment.outEndSec)}
                  onTrimStart={(e) => beginDrag(e, 'trim-start', { kind: 'segment', id: segment.id }, segment.outStartSec, segment.outEndSec)}
                  onTrimEnd={(e) => beginDrag(e, 'trim-end', { kind: 'segment', id: segment.id }, segment.outStartSec, segment.outEndSec)}
                >
                  {segment.reason === 'hook' ? 'HOOK · ' : ''}{segment.text || 'clip'}
                </Clip>
              );
            })}
          </Track>

          <Track label="Captions" labelHint={`${edl.captions.length}`}>
            {edl.captions.map((cue) => {
              const g = geometry(cue.id, cue.startSec, cue.endSec);
              return (
                <Clip
                  key={cue.id}
                  left={g.start * pps}
                  width={Math.max(4, (g.end - g.start) * pps)}
                  selected={selection?.kind === 'caption' && selection.id === cue.id}
                  tone="caption"
                  onPointerDown={(e) => beginDrag(e, 'move', { kind: 'caption', id: cue.id }, cue.startSec, cue.endSec)}
                  onTrimStart={(e) => beginDrag(e, 'trim-start', { kind: 'caption', id: cue.id }, cue.startSec, cue.endSec)}
                  onTrimEnd={(e) => beginDrag(e, 'trim-end', { kind: 'caption', id: cue.id }, cue.startSec, cue.endSec)}
                >
                  {cue.words.map((w) => w.text).join(' ')}
                </Clip>
              );
            })}
          </Track>

          <Track label="B-roll" labelHint={`${edl.broll.length}`}>
            {edl.broll.map((clip) => {
              const g = geometry(clip.id, clip.outStartSec, clip.outEndSec);
              return (
                <Clip
                  key={clip.id}
                  left={g.start * pps}
                  width={Math.max(6, (g.end - g.start) * pps)}
                  selected={selection?.kind === 'broll' && selection.id === clip.id}
                  tone="broll"
                  onPointerDown={(e) => beginDrag(e, 'move', { kind: 'broll', id: clip.id }, clip.outStartSec, clip.outEndSec)}
                  onTrimStart={(e) => beginDrag(e, 'trim-start', { kind: 'broll', id: clip.id }, clip.outStartSec, clip.outEndSec)}
                  onTrimEnd={(e) => beginDrag(e, 'trim-end', { kind: 'broll', id: clip.id }, clip.outStartSec, clip.outEndSec)}
                >
                  {clip.query || 'B-roll'}
                </Clip>
              );
            })}
          </Track>

          <Track label="Graphics" labelHint={`${edl.graphics.length}`}>
            {edl.graphics.map((clip) => {
              const g = geometry(clip.id, clip.outStartSec, clip.outEndSec);
              return (
                <Clip
                  key={clip.id}
                  left={g.start * pps}
                  width={Math.max(6, (g.end - g.start) * pps)}
                  selected={selection?.kind === 'graphics' && selection.id === clip.id}
                  tone="graphic"
                  onPointerDown={(e) => beginDrag(e, 'move', { kind: 'graphics', id: clip.id }, clip.outStartSec, clip.outEndSec)}
                  onTrimStart={(e) => beginDrag(e, 'trim-start', { kind: 'graphics', id: clip.id }, clip.outStartSec, clip.outEndSec)}
                  onTrimEnd={(e) => beginDrag(e, 'trim-end', { kind: 'graphics', id: clip.id }, clip.outStartSec, clip.outEndSec)}
                >
                  {clip.text || clip.type}
                </Clip>
              );
            })}
          </Track>

          <Track label="Punch-ins" labelHint={`${edl.punchIns.length}`}>
            {edl.punchIns.map((clip) => {
              const g = geometry(clip.id, clip.outStartSec, clip.outEndSec);
              return (
                <Clip
                  key={clip.id}
                  left={g.start * pps}
                  width={Math.max(6, (g.end - g.start) * pps)}
                  selected={selection?.kind === 'punchIns' && selection.id === clip.id}
                  tone="punch"
                  onPointerDown={(e) => beginDrag(e, 'move', { kind: 'punchIns', id: clip.id }, clip.outStartSec, clip.outEndSec)}
                  onTrimStart={(e) => beginDrag(e, 'trim-start', { kind: 'punchIns', id: clip.id }, clip.outStartSec, clip.outEndSec)}
                  onTrimEnd={(e) => beginDrag(e, 'trim-end', { kind: 'punchIns', id: clip.id }, clip.outStartSec, clip.outEndSec)}
                >
                  {clip.scale.toFixed(2)}&times;
                </Clip>
              );
            })}
          </Track>

          {/* Instants rather than spans, so they get markers, not blocks. */}
          <Track label="Sound" labelHint={`${edl.sfx.length} cues`} compact>
            {edl.sfx.map((cue) => (
              <button
                key={cue.id}
                type="button"
                onPointerDown={(e) => beginDrag(e, 'move', { kind: 'sfx', id: cue.id }, cue.atSec, cue.atSec)}
                onClick={() => setSelection({ kind: 'sfx', id: cue.id })}
                title={cue.sound}
                className={clsx(
                  'absolute top-1 h-5 w-[3px] -translate-x-1/2 cursor-grab rounded-full transition-colors',
                  selection?.kind === 'sfx' && selection.id === cue.id ? 'bg-chalk' : 'bg-warn',
                )}
                style={{ left: (dragPreview?.id === cue.id ? dragPreview.start : cue.atSec) * pps }}
              />
            ))}
            {edl.transitions.map((cue) => (
              <span
                key={cue.id}
                title={cue.type}
                className="absolute bottom-1 h-2 w-2 -translate-x-1/2 rotate-45 rounded-[2px] bg-violet"
                style={{ left: cue.atSec * pps }}
              />
            ))}
          </Track>

          {/* playhead, drawn over everything */}
          <div
            className="pointer-events-none absolute top-0 z-30 w-px bg-chalk"
            style={{ left: TRACK_LABEL_W + playhead * pps, height: '100%', boxShadow: '0 0 8px rgba(245,245,247,.5)' }}
          />
        </div>
      </div>

      {/* ───────────────────────────────────────── inspector + log ─── */}
      <div className="grid gap-4 border-t border-line p-4 sm:grid-cols-2">
        <Inspector edl={edl} selection={selection} onChange={push} />

        <div>
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted/70">
            Pending changes {ops.length ? `(${ops.length})` : ''}
          </h4>
          {ops.length === 0 ? (
            <p className="mt-2 text-xs text-muted">
              Drag a clip to move it, drag its edges to trim. <b className="text-chalk">S</b> splits at
              the playhead, <b className="text-chalk">Delete</b> removes what&rsquo;s selected,{' '}
              <b className="text-chalk">&#8984;Z</b> undoes. Nothing re-renders until you apply.
            </p>
          ) : (
            <ol className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs text-muted">
              {ops.map((op, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-mono text-faint">{String(i + 1).padStart(2, '0')}</span>
                  {describeOperation(op)}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────── sub-components ─── */

/**
 * Where the speech is, drawn behind the clips.
 *
 * You trim against sound, not against labels — the whole point of a waveform is
 * seeing the breath before the sentence so you know where to cut. We already
 * have word-level timings in the EDL, so this is drawn from the transcript
 * rather than by decoding audio: it is free, exact about where words start and
 * stop, and available before any audio has loaded.
 */
function SpeechTrack({ edl, pps }: { edl: Edl; pps: number }) {
  const bars = useMemo(() => {
    const duration = edl.format.durationSec;
    if (!duration) return [];
    const count = Math.min(1400, Math.max(40, Math.round(duration * 14)));

    // Flattened ONCE. This used to sit inside the loop below, which rebuilt the
    // whole word list for every bar — fine at nine cues, and 1,400 × 2,400
    // words on a ten-minute video. Three and a half million array writes to
    // draw one waveform, every time the captions change.
    const words = edl.captions.flatMap((c) => c.words);

    // Bars and words both run forward in time, so a cursor that only ever
    // advances answers every bar in one pass instead of scanning from the
    // start each time: O(bars + words) rather than O(bars × words).
    let cursor = 0;

    return Array.from({ length: count }, (_, i) => {
      const at = (i / count) * duration;
      while (cursor < words.length && words[cursor].endSec + 0.02 < at) cursor += 1;

      const word = words[cursor];
      if (!word || at < word.startSec - 0.02) return 0.1;

      // Height varies within the word so it reads as speech, not a block.
      const through = (at - word.startSec) / Math.max(0.05, word.endSec - word.startSec);
      return 0.35 + Math.sin(through * Math.PI) * 0.55 + (word.emphasis ? 0.1 : 0);
    });
  }, [edl.captions, edl.format.durationSec]);

  if (!bars.length) return null;

  // The width has to be the video's duration in timeline pixels, not the lane's.
  // `inset-0` stretched the bars across whatever width the lane happened to
  // have, so on any window wider than the edit the speech carried on for
  // seconds after the last clip ended — a waveform that disagrees with the
  // clips above it is worse than no waveform, because people trim against it.
  return (
    <div
      className="pointer-events-none absolute inset-y-0 left-0 flex items-center gap-px overflow-hidden px-px opacity-40"
      style={{ width: edl.format.durationSec * pps }}
    >
      {bars.map((h, i) => (
        <span
          key={i}
          className="flex-1 rounded-[1px] bg-violet"
          style={{ height: `${Math.min(92, h * 100)}%`, minWidth: 1 }}
        />
      ))}
    </div>
  );
}

function Track({
  label,
  labelHint,
  compact,
  children,
}: {
  label: string;
  labelHint?: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={clsx('flex border-b border-line-soft', compact ? 'h-8' : 'h-11')}
         style={{ borderBottomColor: '#232330' }}>
      <div
        className="sticky left-0 z-10 flex shrink-0 flex-col justify-center border-r border-line bg-charcoal px-3"
        style={{ width: TRACK_LABEL_W }}
      >
        <span className="text-[11px] font-semibold leading-tight">{label}</span>
        {labelHint ? <span className="font-mono text-[9px] text-faint">{labelHint}</span> : null}
      </div>
      <div className="relative flex-1">{children}</div>
    </div>
  );
}

const TONES: Record<string, string> = {
  video: 'bg-violet/25 border-violet/40 text-chalk',
  hook: 'bg-violet/50 border-violet text-ink font-bold',
  caption: 'bg-charcoal2 border-line text-muted',
  broll: 'bg-ok/20 border-ok/40 text-chalk',
  graphic: 'bg-warn/20 border-warn/40 text-chalk',
  punch: 'bg-bad/15 border-bad/35 text-chalk',
};

function Clip({
  left,
  width,
  selected,
  tone,
  children,
  onPointerDown,
  onTrimStart,
  onTrimEnd,
}: {
  left: number;
  width: number;
  selected: boolean;
  tone: keyof typeof TONES;
  children: React.ReactNode;
  onPointerDown: (e: React.PointerEvent) => void;
  onTrimStart: (e: React.PointerEvent) => void;
  onTrimEnd: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      className={clsx(
        'group absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-md border px-2 text-[11px] leading-[26px] active:cursor-grabbing',
        TONES[tone],
        selected && 'ring-2 ring-chalk ring-offset-1 ring-offset-charcoal',
      )}
      style={{ left, width }}
    >
      <span className="pointer-events-none block truncate">{children}</span>

      {/* Trim handles: invisible until hover, so the timeline stays calm. */}
      <span
        onPointerDown={onTrimStart}
        className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-chalk/0 group-hover:bg-chalk/40"
      />
      <span
        onPointerDown={onTrimEnd}
        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-chalk/0 group-hover:bg-chalk/40"
      />
    </div>
  );
}

/** Editing the content of whatever is selected, rather than only its timing. */
function Inspector({
  edl,
  selection,
  onChange,
}: {
  edl: Edl;
  selection: Selection;
  onChange: (op: EdlOperation) => void;
}) {
  if (!selection) {
    return (
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted/70">Nothing selected</h4>
        <p className="mt-2 text-xs text-muted">Click a clip to edit what&rsquo;s in it.</p>
      </div>
    );
  }

  if (selection.kind === 'caption') {
    const cue = edl.captions.find((c) => c.id === selection.id);
    if (!cue) return null;
    return (
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted/70">Caption</h4>
        <input
          key={cue.id}
          defaultValue={cue.words.map((w) => w.text).join(' ')}
          onBlur={(e) => {
            const text = e.target.value.trim();
            if (text && text !== cue.words.map((w) => w.text).join(' ')) {
              onChange({ op: 'caption.text', id: cue.id, text });
            }
          }}
          className="mt-2 w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-violet"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {cue.words.map((word, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onChange({ op: 'caption.emphasis', id: cue.id, wordIndex: i, emphasis: !word.emphasis })}
              className={clsx(
                'rounded border px-2 py-0.5 text-[11px] font-semibold transition-colors',
                word.emphasis ? 'border-violet bg-violet-dim text-violet' : 'border-line text-muted hover:text-chalk',
              )}
              title="Toggle emphasis"
            >
              {word.text}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-faint">Click a word to emphasise it.</p>
      </div>
    );
  }

  if (selection.kind === 'broll') {
    const clip = edl.broll.find((c) => c.id === selection.id);
    if (!clip) return null;
    return (
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted/70">B-roll</h4>
        <input
          key={clip.id}
          defaultValue={clip.query}
          onBlur={(e) => {
            const query = e.target.value.trim();
            if (query && query !== clip.query) {
              onChange({ op: 'clip.update', track: 'broll', id: clip.id, patch: { query } });
            }
          }}
          className="mt-2 w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-violet"
          placeholder="What should this show?"
        />
        <p className="mt-2 text-[11px] text-faint">
          {clip.intent || 'Concrete nouns work best — "airplane window clouds", not "travel".'}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(['none', 'in', 'out', 'pan-left', 'pan-right'] as const).map((kb) => (
            <button
              key={kb}
              type="button"
              onClick={() => onChange({ op: 'clip.update', track: 'broll', id: clip.id, patch: { kenBurns: kb } })}
              className={clsx(
                'rounded border px-2 py-0.5 text-[11px] font-semibold',
                clip.kenBurns === kb ? 'border-violet text-violet' : 'border-line text-muted hover:text-chalk',
              )}
            >
              {kb}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (selection.kind === 'graphics') {
    const clip = edl.graphics.find((c) => c.id === selection.id);
    if (!clip) return null;
    return (
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted/70">{clip.type}</h4>
        <input
          key={`${clip.id}-t`}
          defaultValue={clip.text}
          onBlur={(e) => onChange({ op: 'clip.update', track: 'graphics', id: clip.id, patch: { text: e.target.value } })}
          className="mt-2 w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-violet"
        />
        <input
          key={`${clip.id}-s`}
          defaultValue={clip.subtext}
          onBlur={(e) => onChange({ op: 'clip.update', track: 'graphics', id: clip.id, patch: { subtext: e.target.value } })}
          placeholder="Caption underneath"
          className="mt-2 w-full rounded-lg border border-line bg-ink px-3 py-2 text-xs outline-none focus:border-violet"
        />
      </div>
    );
  }

  if (selection.kind === 'segment') {
    const segment = edl.segments.find((s) => s.id === selection.id);
    if (!segment) return null;
    return (
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted/70">Clip</h4>
        <p className="mt-2 font-mono text-[11px] text-muted">
          source {segment.sourceStartSec.toFixed(2)}–{segment.sourceEndSec.toFixed(2)}
          {' → '}out {segment.outStartSec.toFixed(2)}–{segment.outEndSec.toFixed(2)}
        </p>
        <p className="mt-1 text-xs text-muted">{segment.text || 'No speech in this clip.'}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[0.75, 1, 1.25, 1.5].map((speed) => (
            <button
              key={speed}
              type="button"
              onClick={() => onChange({ op: 'segment.speed', id: segment.id, speed })}
              className={clsx(
                'rounded border px-2 py-0.5 text-[11px] font-semibold',
                Math.abs(segment.speed - speed) < 0.01 ? 'border-violet text-violet' : 'border-line text-muted hover:text-chalk',
              )}
            >
              {speed}&times;
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (selection.kind === 'sfx') {
    const cue = edl.sfx.find((c) => c.id === selection.id);
    if (!cue) return null;
    return (
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted/70">Sound effect</h4>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(['whoosh', 'pop', 'riser', 'impact', 'click', 'swipe', 'ding', 'sub-drop'] as const).map((sound) => (
            <button
              key={sound}
              type="button"
              onClick={() => onChange({ op: 'clip.update', track: 'sfx', id: cue.id, patch: { sound } })}
              className={clsx(
                'rounded border px-2 py-0.5 text-[11px] font-semibold',
                cue.sound === sound ? 'border-violet text-violet' : 'border-line text-muted hover:text-chalk',
              )}
            >
              {sound}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

/**
 * Insert a clip at the playhead.
 *
 * Deleting what the AI chose was only ever half of fine-tuning — "put a whoosh
 * here" is the other half, and without it the timeline is a veto rather than an
 * instrument.
 */
function AddMenu({ atSec, onAdd }: { atSec: number; onAdd: (op: EdlOperation) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const add = (op: EdlOperation) => { onAdd(op); setOpen(false); };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Add something at the playhead"
        className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-chalk transition-colors hover:bg-charcoal2"
      >
        + Add
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-charcoal shadow-card">
          <MenuItem onClick={() => add({ op: 'clip.add', track: 'broll', atSec, durationSec: 2, value: '' })}>
            B-roll insert
            <span className="block text-[10px] font-normal text-muted">2s — type what it shows</span>
          </MenuItem>
          <MenuItem onClick={() => add({ op: 'clip.add', track: 'graphics', atSec, durationSec: 2.5, value: 'Label', graphicType: 'icon' })}>
            Icon + label
          </MenuItem>
          <MenuItem onClick={() => add({ op: 'clip.add', track: 'graphics', atSec, durationSec: 2.5, value: '100', graphicType: 'stat' })}>
            Stat card
          </MenuItem>
          <MenuItem onClick={() => add({ op: 'clip.add', track: 'punchIns', atSec, durationSec: 2, value: '' })}>
            Punch-in
          </MenuItem>
          <div className="border-t border-line-soft px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-faint">
            Sound
          </div>
          <div className="flex flex-wrap gap-1 p-2 pt-0">
            {(['whoosh', 'pop', 'impact', 'swipe', 'riser', 'ding', 'click', 'sub-drop'] as const).map((sound) => (
              <button
                key={sound}
                type="button"
                onClick={() => add({ op: 'clip.add', track: 'sfx', atSec, durationSec: 0.4, value: sound })}
                className="rounded border border-line px-2 py-0.5 text-[11px] font-semibold text-muted transition-colors hover:border-violet hover:text-violet"
              >
                {sound}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-2 text-left text-xs font-semibold text-chalk transition-colors hover:bg-charcoal2"
    >
      {children}
    </button>
  );
}

function ToolButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-chalk transition-colors hover:bg-charcoal2 disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/* ───────────────────────────────────────────────────────── helpers ─── */

function formatTc(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Ruler ticks at a spacing that keeps labels from colliding at any zoom. */
function tickTimes(duration: number, pps: number): number[] {
  const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120];
  const step = candidates.find((c) => c * pps > 64) ?? 300;
  const out: number[] = [];
  for (let t = 0; t <= duration; t += step) out.push(Number(t.toFixed(3)));
  return out;
}

function nearestIndex(starts: number[], target: number): number {
  let index = 0;
  for (let i = 0; i < starts.length; i++) if (target >= starts[i]) index = i;
  return index;
}
