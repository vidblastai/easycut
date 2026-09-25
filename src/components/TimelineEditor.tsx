'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import type { PlayerRef } from '@remotion/player';
import { applyOperations, describeOperation, type ClipTrack, type EdlOperation } from '@/lib/edl/operations';
import { reorderIndexFor, resolveDrag, snapPointsFor, type DragKind } from '@/lib/timeline/drag';
import { TRANSITION_TYPES, type Edl } from '@/lib/edl/types';

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
   *
   * THE INSTANCE, NOT A REF, and that distinction was a real bug. The preview
   * is a `next/dynamic` import with `ssr: false`, so it arrives a commit or two
   * AFTER this component has mounted. A ref object never changes identity, so
   * an effect keyed on one runs exactly once — here, while `.current` was still
   * null — and never again once the player showed up. The listeners were never
   * attached: pressing play played the video and left the playhead sitting at
   * zero. A plain value re-renders when it arrives, so the effect below binds
   * to the player the moment there is one.
   */
  player?: PlayerRef | null;
  /** The working document, lifted so the preview renders the pending edits. */
  onWorkingEdlChange?: (edl: Edl) => void;
  /**
   * Somewhere better than the dock to put the inspector and the change list.
   *
   * Both belong beside the picture rather than under the tracks: in the dock
   * they stole height from the timeline and buried the caption picker behind a
   * scroll. When a layout provides these two nodes they are rendered into them
   * instead, and the dock is nothing but track.
   */
  panels?: { inspector: HTMLElement; changes: HTMLElement } | null;
  /** Fired when something is picked, so the panel can bring its pane forward. */
  onSelect?: () => void;
}

type Selection = { kind: 'segment' | ClipTrack | 'caption'; id: string } | null;

interface DragState {
  kind: DragKind | 'playhead';
  target: Selection;
  startX: number;
  originStart: number;
  originEnd: number;
  moved: boolean;
  /** Where the pointer last was, so an auto-scroll can keep resolving without it. */
  lastClientX: number;
  /** Alt held at any point during the gesture turns snapping off. */
  freeform: boolean;
}

/**
 * Zoom, in pixels per second, as a continuous quantity.
 *
 * It used to be seven fixed stops, which is what a zoom control looks like when
 * nobody has had to work at frame level with it. Every step was a jump of
 * 55–65%, so the scale you actually wanted was almost always between two of
 * them: one stop showed the whole edit and the next showed a quarter of it,
 * and there was nothing in between. Now any scale is reachable and the stops
 * are gone.
 *
 * The top end puts a 30fps frame thirteen pixels wide, which is the point past
 * which more zoom buys nothing. The bottom end is computed per video — the
 * scale at which the whole thing fits the window — because "further out than
 * the whole video" is not a view of anything.
 */
const MAX_PPS = 400;
const DEFAULT_PPS = 32;
/** One press of − or +. A ratio rather than an amount, because zoom is geometric. */
const ZOOM_STEP = 1.3;
/** How hard a wheel notch bites. One notch is about 12%. */
const WHEEL_ZOOM = 0.0022;
/**
 * How close, in SCREEN pixels, counts as a snap.
 *
 * Pixels rather than seconds because it has to feel the same at every zoom: a
 * fixed number of seconds is an invisible hair at 210px/s and half the screen
 * at 12px/s.
 */
const SNAP_PX = 7;
const TRACK_LABEL_W = 92;
/** How close to the edge starts an auto-scroll, and how fast it goes. */
const AUTOSCROLL_EDGE_PX = 48;
const AUTOSCROLL_MAX_PX_PER_FRAME = 18;

export function TimelineEditor({
  edl: committedEdl,
  onCommit,
  busy = false,
  player = null,
  onWorkingEdlChange,
  panels = null,
  onSelect,
}: TimelineEditorProps) {
  const [ops, setOps] = useState<EdlOperation[]>([]);
  const [redoStack, setRedoStack] = useState<EdlOperation[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [playhead, setPlayhead] = useState(0);
  const [pps, setPps] = useState(DEFAULT_PPS);
  const [warning, setWarning] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  // Read by push/undo/redo so they can decide everything before calling a
  // setter, rather than deciding inside one.
  const opsRef = useRef(ops);
  opsRef.current = ops;
  const redoRef = useRef(redoStack);
  redoRef.current = redoStack;
  const ppsRef = useRef(pps);
  ppsRef.current = pps;

  /**
   * Live geometry while a drag is in flight. The clip follows the cursor from
   * here; the operation is only pushed on release, so a drag that gets
   * cancelled costs nothing and the undo stack stays one entry per gesture.
   */
  const [dragPreview, setDragPreview] = useState<
    { id: string; start: number; end: number; kind: DragState['kind']; snappedTo: number | null } | null
  >(null);
  const dragPreviewRef = useRef(dragPreview);
  dragPreviewRef.current = dragPreview;

  /** The working document: the committed EDL with every pending edit applied. */
  const { edl, rejected } = useMemo(
    () => applyOperations(committedEdl, ops),
    [committedEdl, ops],
  );

  useEffect(() => { if (selection) onSelect?.(); }, [selection, onSelect]);

  /** The same document, readable from a listener registered once on mount. */
  const edlRef = useRef(edl);
  edlRef.current = edl;

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
    player?.seekTo(Math.round(clamped * fps));
  }, [duration, fps, player]);

  /** Player → timeline, so playback walks the playhead. */
  useEffect(() => {
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
  }, [player, fps]);

  /**
   * Zooming, anchored.
   *
   * Changing pixels-per-second while leaving scrollLeft alone means the moment
   * under your cursor is not the moment under your cursor afterwards — zoom in
   * twice on a ten-minute edit and you are looking at a different minute. So a
   * zoom records what was under a chosen screen position and puts it back there
   * once the new scale has been laid out.
   */
  const zoomAnchor = useRef<{ sec: number; screenX: number } | null>(null);

  /**
   * How wide the tracks are allowed to be, watched rather than measured once.
   *
   * The bottom of the zoom range is "the whole video fits", which depends on
   * the window — and the dock is resizable, so it changes while you work.
   */
  const [viewport, setViewport] = useState(960);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewport(Math.max(240, el.clientWidth - TRACK_LABEL_W - 24));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** The scale at which the whole edit is exactly one screen wide. */
  const fitPps = duration > 0 ? viewport / duration : DEFAULT_PPS;
  // Never further out than the whole video — that is a view of nothing — but
  // short clips are still allowed to breathe rather than being pinned wide.
  const minPps = Math.max(0.4, Math.min(fitPps, 12));

  const zoomTo = useCallback((nextPps: number, atClientX?: number) => {
    const clamped = Math.max(minPps, Math.min(MAX_PPS, nextPps));
    if (Math.abs(clamped - ppsRef.current) < 1e-4) return;

    const el = scrollRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      // The cursor if there is one, otherwise the playhead, otherwise the
      // middle of the view — in that order, because that is the order of what
      // the person is looking at.
      const screenX = atClientX != null
        ? atClientX - rect.left - TRACK_LABEL_W
        : Math.min(Math.max(playhead * ppsRef.current - el.scrollLeft, 0), el.clientWidth - TRACK_LABEL_W);
      zoomAnchor.current = { sec: (el.scrollLeft + screenX) / ppsRef.current, screenX };
    }
    setPps(clamped);
  }, [minPps, playhead]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const held = zoomAnchor.current;
    zoomAnchor.current = null;
    if (!el || !held) return;
    el.scrollLeft = Math.max(0, held.sec * pps - held.screenX);
  }, [pps]);

  /** Fit the whole edit in the window — the "where am I" button. */
  const zoomToFit = useCallback(() => {
    if (!duration) return;
    zoomAnchor.current = { sec: 0, screenX: 0 };
    setPps(Math.max(minPps, Math.min(MAX_PPS, fitPps)));
  }, [duration, fitPps, minPps]);

  // Resizing the dock moves the floor — the whole video fits at a different
  // scale — so a view that was legal can stop being. Pull it back in rather
  // than leaving the slider pinned past its own end.
  useEffect(() => {
    setPps((current) => Math.max(minPps, Math.min(MAX_PPS, current)));
  }, [minPps]);

  /**
   * The slider's position, 0 to 1, and its inverse.
   *
   * Logarithmic, because zoom is multiplicative: the difference between 4 and 8
   * pixels per second is the same GESTURE as the difference between 200 and
   * 400, and a linear slider would spend nine tenths of its travel in the
   * zoomed-in half where nobody needs the resolution.
   */
  const zoomFraction = Math.max(0, Math.min(1, Math.log(pps / minPps) / Math.log(MAX_PPS / minPps)));
  const ppsAtFraction = useCallback(
    (t: number) => minPps * Math.pow(MAX_PPS / minPps, Math.max(0, Math.min(1, t))),
    [minPps],
  );

  /**
   * The wheel, behaving the way every editor's wheel behaves.
   *
   * Registered by hand rather than with onWheel because zooming has to call
   * preventDefault — otherwise ctrl+wheel zooms the whole page — and React's
   * synthetic wheel listener is passive, where preventDefault does nothing.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        // Continuous, and bounded per event: a trackpad can report a delta of
        // several hundred in one go, and an unbounded exponent turns that into
        // a jump from the whole edit to two seconds of it.
        const bite = Math.max(-80, Math.min(80, -event.deltaY));
        zoomToRef.current(ppsRef.current * Math.exp(bite * WHEEL_ZOOM), event.clientX);
        return;
      }
      // Shift-wheel, and any mouse or trackpad that reports a horizontal
      // delta, pans. A plain vertical wheel is left to the page.
      const horizontal = event.shiftKey ? event.deltaY : event.deltaX;
      if (horizontal !== 0) {
        event.preventDefault();
        el.scrollLeft += horizontal;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomToRef = useRef(zoomTo);
  zoomToRef.current = zoomTo;

  /**
   * Keep the playhead on screen.
   *
   * A ten-minute edit is twenty thousand pixels wide at this zoom, so pressing
   * End, or simply letting it play, used to walk the playhead off the right of
   * the window and leave you looking at a static picture of second four.
   *
   * It scrolls only when the playhead has actually left the comfortable middle
   * band, and never while you are dragging — the timeline yanking itself
   * sideways under a clip you are holding is how a drag ends up somewhere you
   * did not choose.
   *
   * And never on a zoom, which is the subtler version of the same mistake. A
   * zoom is anchored on the moment under the cursor; this effect ran afterwards
   * and dragged the view back to wherever the playhead was parked, so zooming
   * into second ninety while the playhead sat at zero silently snapped you back
   * to the top. Looking somewhere other than the playhead is a thing people do
   * on purpose.
   */
  const followedPlayhead = useRef(playhead);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || dragRef.current) return;
    if (followedPlayhead.current === playhead) return;
    followedPlayhead.current = playhead;

    const x = playhead * ppsRef.current;
    const viewLeft = el.scrollLeft;
    const viewWidth = el.clientWidth - TRACK_LABEL_W;
    const margin = Math.min(160, viewWidth * 0.18);

    if (x < viewLeft + margin) {
      el.scrollTo({ left: Math.max(0, x - margin), behavior: 'auto' });
    } else if (x > viewLeft + viewWidth - margin) {
      el.scrollTo({ left: x - viewWidth + margin, behavior: 'auto' });
    }
  }, [playhead]);

  const togglePlay = useCallback(() => {
    if (!player) { setPlaying((p) => !p); return; }
    player.toggle();
  }, [player]);

  /* ─────────────────────────────────────────────── op plumbing ─── */

  /**
   * Add one operation to the pending stack.
   *
   * Everything is decided BEFORE any setter is called. React may invoke a state
   * updater more than once — it does exactly that in development, to surface
   * impurity — so a setter called from inside another setter's updater runs
   * twice. Undo and redo both did that, and the symptom was redo restoring two
   * copies of one edit: a stack of three went to two on undo and came back as
   * four.
   */
  const push = useCallback((op: EdlOperation) => {
    const next = [...opsRef.current, op];
    // Applying against the live document tells us immediately whether the edit
    // is possible, so the user gets the reason instead of silence.
    const result = applyOperations(committedEdl, next);
    const failed = result.rejected.at(-1);
    if (failed) {
      setWarning(failed.reason);
      return;
    }

    // An edit that changed nothing has no business in the undo history. Nudging
    // a clip against a neighbour it cannot pass used to leave a step behind
    // that undid to exactly the same picture; three of those in a row and the
    // history stops describing what the user did.
    if (JSON.stringify(result.edl) === JSON.stringify(edlRef.current)) return;

    setWarning(null);
    setOps(next);
    setRedoStack([]);
  }, [committedEdl]);

  const undo = useCallback(() => {
    const current = opsRef.current;
    if (!current.length) return;
    setOps(current.slice(0, -1));
    setRedoStack([...redoRef.current, current[current.length - 1]]);
    setWarning(null);
  }, []);

  const redo = useCallback(() => {
    const stack = redoRef.current;
    if (!stack.length) return;
    setOps([...opsRef.current, stack[stack.length - 1]]);
    setRedoStack(stack.slice(0, -1));
    setWarning(null);
  }, []);

  const commit = useCallback(async () => {
    if (!ops.length) return;
    await onCommit(ops);
    setOps([]);
    setRedoStack([]);
    setSelection(null);
  }, [ops, onCommit]);

  /* ───────────────────────────────────────────────── snapping ─── */

  /**
   * Times worth landing on exactly: cuts, cue edges, the two ends.
   *
   * Deliberately NOT keyed on the playhead. It used to be one of the points in
   * here, which meant the whole list was rebuilt on every `frameupdate` —
   * thirty times a second during playback. On a ten-minute video that is 301
   * captions and 75 segments, for a value that only matters while something is
   * being dragged. The playhead is appended at drag time instead.
   *
   * Each point remembers whose edge it is, so the clip being dragged can be
   * excluded by identity. Excluding by value — which is what this did before —
   * silently drops a neighbour that happens to start at the same instant, and
   * on a cut-to-cut timeline that is most of them.
   */
  const snapPoints = useMemo(() => snapPointsFor(edl), [edl]);

  /* Both of these are rebuilt on every render otherwise — which during a drag
     is every pointermove. The ruler's labels and the captions' text do not
     change while a clip is moving, so they are computed when the document
     does. */
  const ticks = useMemo(() => tickTimes(duration, pps), [duration, pps]);
  const captionText = useMemo(
    () => new Map(edl.captions.map((c) => [c.id, c.words.map((w) => w.text).join(' ')])),
    [edl.captions],
  );

  /**
   * Snapping, as a setting rather than only as a held key.
   *
   * Alt-to-ignore is right for the one drag where a clip refuses to sit just
   * off a cut. It is the wrong shape for the other case — deliberately placing
   * a run of things off the grid — where holding a modifier through every
   * gesture is the interface arguing with you. Every editing suite has the
   * toggle for exactly that reason, on N in most of them.
   */
  const [snapping, setSnapping] = useState(true);

  /** The shortcut sheet. Shown on `?`, which is where every app of this shape puts it. */
  const [showKeys, setShowKeys] = useState(false);

  /* ────────────────────────────────────────────────── dragging ─── */

  const secAtClientX = useCallback((clientX: number): number => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft - TRACK_LABEL_W;
    return Math.max(0, Math.min(duration, x / pps));
  }, [pps, duration]);

  /**
   * Everything the pointer handlers need, in a ref.
   *
   * The handlers are registered once, on mount. They used to be re-registered
   * on every render, which during a drag is every pointermove — add and remove
   * a listener per frame, and a stale closure any time the re-subscribe lost a
   * race. A ref is the boring fix: the listeners never change, and they always
   * read current values.
   */
  const live = useRef({ pps, duration, snapPoints, playhead, edl, snapPx: SNAP_PX, snapping });
  live.current = { pps, duration, snapPoints, playhead, edl, snapPx: SNAP_PX, snapping };

  // Same reason: the listeners are registered once, so the functions they call
  // have to be reachable through something that does not go stale.
  const seekRef = useRef(seek);
  seekRef.current = seek;
  const pushRef = useRef(push);
  pushRef.current = push;
  const secAtClientXRef = useRef(secAtClientX);
  secAtClientXRef.current = secAtClientX;

  const beginDrag = (
    event: React.PointerEvent,
    kind: DragState['kind'],
    target: Selection,
    originStart: number,
    originEnd: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    // Captured on currentTarget, not target. `target` is whatever child the
    // cursor happened to be over — a trim handle, a label — and a capture on a
    // node React may swap out mid-gesture is a drag that dies halfway.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      kind, target, startX: event.clientX, originStart, originEnd,
      moved: false, lastClientX: event.clientX, freeform: event.altKey,
    };
    if (target) setSelection(target);
  };

  /**
   * One pointer handler for every clip on the timeline.
   *
   * Each clip used to carry three inline closures — move, trim-start,
   * trim-end — which meant every clip's props changed identity on every render
   * and `React.memo` could never skip one. During a drag that is a re-render of
   * all four hundred of them per pointermove: measured at 41ms a move on a
   * four-minute edit, so the clip you were dragging lagged the cursor by two
   * frames and the whole gesture felt like it was happening underwater.
   *
   * Delegation fixes it at the root. The clips are now plain data, the handler
   * reads which one was hit off the DOM, and React skips the 399 that did not
   * move.
   */
  const beginDragFromEvent = (event: React.PointerEvent) => {
    const hit = (event.target as HTMLElement).closest('[data-clip-id]') as HTMLElement | null;
    if (!hit) {
      // Anywhere that is not a clip means "nothing". Without it the only way to
      // put the inspector down is to pick up something else.
      setSelection(null);

      /*
       * And it means "go there", which is what every editor does and what this
       * one used to do only on a 28px strip of ruler. Scrubbing is how you find
       * the frame you are about to cut on; making it a hunt for a thin band at
       * the top makes the most-used gesture the hardest one to land.
       *
       * Two places are deliberately NOT a scrub: the track-label gutter down
       * the left, and the horizontal scrollbar along the bottom — capturing the
       * pointer there would take the scrollbar away from the person using it.
       * Both are measured off the scroll box rather than guessed from the event
       * target, which is whatever child the cursor happened to be over.
       */
      const el = scrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const onScrollbar = event.clientY - rect.top > el.clientHeight;
      const inGutter = event.clientX - rect.left < TRACK_LABEL_W;
      if (onScrollbar || inGutter) return;

      beginDrag(event, 'playhead', null, 0, 0);
      seek(secAtClientX(event.clientX));
      return;
    }

    const id = hit.dataset.clipId;
    const track = hit.dataset.track as Selection extends null ? never : string;
    if (!id || !track) return;

    const span = spanOf(edl, track, id);
    if (!span) return;

    const handle = (event.target as HTMLElement).dataset.handle;
    const kind: DragState['kind'] = handle === 'start' ? 'trim-start' : handle === 'end' ? 'trim-end' : 'move';
    beginDrag(event, kind, { kind: track as Exclude<Selection, null>['kind'], id }, span.start, span.end);
  };

  /* Auto-scroll while dragging near an edge. Without it you can only move a
     clip as far as the visible window, which on a ten-minute edit is a few
     seconds. */
  const autoScroll = useRef<number | null>(null);
  /** The frame a queued drag resolve is waiting on, so only one is ever in flight. */
  const pendingMove = useRef<number | null>(null);
  const stopAutoScroll = () => {
    if (autoScroll.current !== null) cancelAnimationFrame(autoScroll.current);
    autoScroll.current = null;
    if (pendingMove.current !== null) cancelAnimationFrame(pendingMove.current);
    pendingMove.current = null;
  };

  useEffect(() => {
    /** Resolve the geometry from the pointer position and hand it to the view. */
    const resolveFrom = (clientX: number) => {
      const drag = dragRef.current;
      if (!drag || !drag.target) return;
      const { pps: scale, duration: dur, snapPoints: points, playhead: head } = live.current;

      const geometry = resolveDrag({
        kind: drag.kind as DragKind,
        originStart: drag.originStart,
        originEnd: drag.originEnd,
        deltaSec: (clientX - drag.startX) / scale,
        // The playhead is a snap target, appended here so the memo above does
        // not have to be invalidated thirty times a second.
        snapPoints: [...points, { at: head, ownerId: null }],
        draggingId: drag.target.id,
        toleranceSec: SNAP_PX / scale,
        durationSec: dur,
        disableSnap: drag.freeform || !live.current.snapping,
      });

      setDragPreview({ id: drag.target.id, ...geometry, kind: drag.kind });
    };

    const tickAutoScroll = () => {
      autoScroll.current = null;
      const drag = dragRef.current;
      const el = scrollRef.current;
      if (!drag || !el || drag.kind === 'playhead') return;

      const rect = el.getBoundingClientRect();
      const fromLeft = drag.lastClientX - (rect.left + TRACK_LABEL_W);
      const fromRight = rect.right - drag.lastClientX;

      let by = 0;
      if (fromLeft < AUTOSCROLL_EDGE_PX) {
        by = -ramp(AUTOSCROLL_EDGE_PX - fromLeft);
      } else if (fromRight < AUTOSCROLL_EDGE_PX) {
        by = ramp(AUTOSCROLL_EDGE_PX - fromRight);
      }
      if (by === 0) return;

      const before = el.scrollLeft;
      el.scrollLeft = before + by;
      // The pointer has not moved, but the timeline under it has — so the drag
      // has to be re-resolved against the new scroll offset, or the clip stops
      // dead at the edge while the view slides past it.
      if (el.scrollLeft !== before) {
        drag.startX -= el.scrollLeft - before;
        resolveFrom(drag.lastClientX);
      }
      autoScroll.current = requestAnimationFrame(tickAutoScroll);
    };

    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      drag.lastClientX = event.clientX;
      if (event.altKey) drag.freeform = true;
      if (Math.abs(event.clientX - drag.startX) > 2) drag.moved = true;

      if (drag.kind === 'playhead') {
        seekRef.current(secAtClientXRef.current(event.clientX));
        return;
      }

      // One resolve per painted frame, never one per event.
      //
      // A 120Hz mouse — or any mouse while the main thread is busy — delivers
      // several pointermoves between two frames, and each one used to re-render
      // the whole timeline for a picture nobody would ever see. On a long edit
      // that is where the drag's stutter came from: the work was real, the
      // frames it produced were thrown away.
      if (pendingMove.current === null) {
        pendingMove.current = requestAnimationFrame(() => {
          pendingMove.current = null;
          const current = dragRef.current;
          if (current) resolveFrom(current.lastClientX);
        });
      }
      if (autoScroll.current === null) autoScroll.current = requestAnimationFrame(tickAutoScroll);
    };

    const finish = (commitIt: boolean) => {
      const drag = dragRef.current;
      dragRef.current = null;
      stopAutoScroll();
      const preview = dragPreviewRef.current;
      setDragPreview(null);
      if (!commitIt || !drag || !drag.moved || !drag.target || !preview) return;

      const { kind, id } = drag.target;
      const { edl: doc } = live.current;

      if (kind === 'segment') {
        // Segment edges are source-side: dragging the left edge trims into the
        // footage rather than moving the clip, because output order is the cut.
        const segment = doc.segments.find((s) => s.id === id);
        if (!segment) return;
        if (drag.kind === 'trim-start') {
          const delta = preview.start - drag.originStart;
          pushRef.current({ op: 'segment.trim', id, sourceStartSec: segment.sourceStartSec + delta * segment.speed });
        } else if (drag.kind === 'trim-end') {
          const delta = preview.end - drag.originEnd;
          pushRef.current({ op: 'segment.trim', id, sourceEndSec: segment.sourceEndSec + delta * segment.speed });
        } else {
          const toIndex = reorderIndexFor(doc.segments, id, (preview.start + preview.end) / 2);
          const from = doc.segments.findIndex((s) => s.id === id);
          // Dropping a clip back where it started is not an edit, and logging
          // it as "Reordered clips" made the pending list lie.
          if (toIndex !== from) pushRef.current({ op: 'segment.reorder', id, toIndex });
        }
        return;
      }

      if (kind === 'caption') {
        pushRef.current({ op: 'caption.time', id, startSec: preview.start, endSec: preview.end });
        return;
      }

      if (drag.kind === 'move') pushRef.current({ op: 'clip.move', track: kind, id, outStartSec: preview.start });
      else pushRef.current({ op: 'clip.trim', track: kind, id, outStartSec: preview.start, outEndSec: preview.end });
    };

    const onUp = () => finish(true);
    // A cancelled pointer — the browser took the gesture for a scroll, the
    // window lost focus, a touch was interrupted — used to leave dragRef set,
    // so the next pointermove carried on dragging with no button held.
    const onCancel = () => finish(false);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      stopAutoScroll();
    };
  }, []);

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

      // Everything below is an unmodified key. Without this, Cmd+S offered to
      // save the page AND split the clip, and Cmd+, opened preferences while
      // nudging the selection back a frame.
      if (mod && event.key.toLowerCase() !== 'd') return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!selection) return;
        event.preventDefault();
        if (selection.kind === 'segment') push({ op: 'segment.delete', id: selection.id });
        else if (selection.kind === 'caption') push({ op: 'caption.delete', id: selection.id });
        else push({ op: 'clip.delete', track: selection.kind, id: selection.id });
        setSelection(null);
        return;
      }

      /**
       * Nudge whatever is selected, one frame at a time.
       *
       * A mouse cannot place a cue on a specific frame at any zoom you can
       * still see the whole edit at, and "nearly on the beat" is the one thing
       * a person opens a timeline to fix. `,` and `.` are where an editor's
       * hand already is; shift makes it a second.
       */
      // Holding shift turns `,` and `.` into `<` and `>` on most layouts, which
      // is why the second-sized nudge quietly did nothing at all: the handler
      // was looking for a character the keyboard had stopped sending. The
      // physical key is the thing that was pressed, so that is what decides.
      const back = event.key === ',' || event.key === '<' || event.code === 'Comma';
      const forward = event.key === '.' || event.key === '>' || event.code === 'Period';

      if (back || forward) {
        if (!selection) return;
        event.preventDefault();
        const step = (event.shiftKey ? 1 : 1 / fps) * (back ? -1 : 1);

        if (selection.kind === 'segment') {
          // A segment's position IS the running order, so nudging it would mean
          // re-cutting. Nudge its source instead: the same frames, shifted.
          const seg = edl.segments.find((x) => x.id === selection.id);
          if (seg) {
            push({
              op: 'segment.trim',
              id: seg.id,
              sourceStartSec: seg.sourceStartSec + step,
              sourceEndSec: seg.sourceEndSec + step,
            });
          }
          return;
        }
        if (selection.kind === 'caption') {
          const cue = edl.captions.find((c) => c.id === selection.id);
          if (cue) push({ op: 'caption.time', id: cue.id, startSec: cue.startSec + step, endSec: cue.endSec + step });
          return;
        }
        const item = clipById(edl, selection.kind, selection.id);
        if (item) push({ op: 'clip.move', track: selection.kind, id: selection.id, outStartSec: item.start + step });
        return;
      }

      // Duplicate, at the playhead, so "another one of those" is one key.
      if (mod && event.key.toLowerCase() === 'd') {
        if (!selection || selection.kind === 'segment' || selection.kind === 'caption') return;
        event.preventDefault();
        const item = clipById(edl, selection.kind, selection.id);
        if (!item) return;
        push({
          op: 'clip.add',
          track: selection.kind,
          atSec: playhead,
          durationSec: Math.max(0.2, item.end - item.start),
          value: item.label ?? '',
          id: `${selection.kind}-${Math.random().toString(36).slice(2, 8)}`,
        });
        return;
      }

      if (event.code === 'Space' || event.key.toLowerCase() === 'k') {
        event.preventDefault();
        togglePlay();
        return;
      }

      // Zoom from the keyboard, the same geometric step as the buttons.
      if (event.key === '-' || event.key === '_') { event.preventDefault(); zoomTo(ppsRef.current / ZOOM_STEP); return; }
      if (event.key === '=' || event.key === '+') { event.preventDefault(); zoomTo(ppsRef.current * ZOOM_STEP); return; }
      if (event.key === '0') { event.preventDefault(); zoomToFit(); return; }

      if (event.key === '?') {
        event.preventDefault();
        setShowKeys((open) => !open);
        return;
      }
      if (event.key === 'Escape') {
        setShowKeys(false);
        setSelection(null);
        return;
      }

      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setSnapping((on) => !on);
        return;
      }

      /**
       * Trim the selection to the playhead.
       *
       * Park the playhead on the frame you want, press `[` to make that the
       * start or `]` to make it the end. It is the one trim that needs no
       * pointer precision at all, which is exactly what somebody who has never
       * opened an editor needs: they can already hear where the line should
       * begin, and the keyboard turns that into an exact edit.
       */
      if (event.key === '[' || event.key === ']') {
        if (!selection) return;
        event.preventDefault();
        const toStart = event.key === '[';

        if (selection.kind === 'segment') {
          const segment = edl.segments.find((x) => x.id === selection.id);
          if (!segment || playhead <= segment.outStartSec || playhead >= segment.outEndSec) {
            setWarning('Park the playhead inside the clip first.');
            return;
          }
          // Output time is the running order; the trim itself is source-side.
          const offset = (playhead - segment.outStartSec) * segment.speed;
          push(
            toStart
              ? { op: 'segment.trim', id: segment.id, sourceStartSec: segment.sourceStartSec + offset }
              : { op: 'segment.trim', id: segment.id, sourceEndSec: segment.sourceStartSec + offset },
          );
          return;
        }

        if (selection.kind === 'caption') {
          const cue = edl.captions.find((c) => c.id === selection.id);
          if (!cue) return;
          push({
            op: 'caption.time',
            id: cue.id,
            startSec: toStart ? playhead : cue.startSec,
            endSec: toStart ? cue.endSec : playhead,
          });
          return;
        }

        const item = clipById(edl, selection.kind, selection.id);
        if (!item) return;
        push({
          op: 'clip.trim',
          track: selection.kind,
          id: selection.id,
          outStartSec: toStart ? playhead : item.start,
          outEndSec: toStart ? item.end : playhead,
        });
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
  }, [selection, playhead, edl, fps, duration, push, undo, redo, seek, togglePlay, zoomTo, zoomToFit]);

  /* ───────────────────────────────────────────────── rendering ─── */

  const geometry = (id: string, start: number, end: number) =>
    dragPreview?.id === id ? { start: dragPreview.start, end: dragPreview.end } : { start, end };

  const activeSegment = edl.segments.find((s) => playhead >= s.outStartSec && playhead < s.outEndSec);

  /* ───────────────────────────────────── the two side panes ─── */
  /* What is selected, and what you have changed. They used to sit under the
     tracks, inside the dock — which took height from the one part of this
     screen that genuinely wants it, and put the caption picker somewhere you
     had to scroll a timeline to reach. When the layout offers somewhere better
     they are rendered there instead, through a portal: the state stays here,
     where the selection and the operation stack live, and only the DOM moves. */
  const inspectorPane = <Inspector edl={edl} selection={selection} onChange={push} />;

  const changesPane = (
    <div>
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted/70">
        Pending changes {ops.length ? `(${ops.length})` : ''}
      </h4>
      {ops.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          Drag to move, drag an edge to trim. <b className="text-chalk">S</b> splits at the
          playhead, <b className="text-chalk">[</b> and <b className="text-chalk">]</b> trim the
          selection to it, <b className="text-chalk">,</b> and <b className="text-chalk">.</b>{' '}
          nudge it a frame (hold shift for a second),{' '}
          <b className="text-chalk">&#8984;D</b> duplicates,{' '}
          <b className="text-chalk">Delete</b> removes, <b className="text-chalk">&#8984;Z</b> undoes.
          <b className="text-chalk"> N</b> turns snapping off and on; holding{' '}
          <b className="text-chalk">Alt</b> ignores it for one drag. Press{' '}
          <b className="text-chalk">?</b> for the rest. Nothing re-renders until you apply.
        </p>
      ) : (
        <ol data-pending-ops className="mt-2 space-y-1 text-xs text-muted">
          {ops.map((op, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-mono text-faint">{String(i + 1).padStart(2, '0')}</span>
              {describeOperation(op)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  return (
    <>
      {panels ? createPortal(inspectorPane, panels.inspector) : null}
      {panels ? createPortal(changesPane, panels.changes) : null}

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

        <div className="mx-1 h-5 w-px bg-line" />

        {/* Snapping, visible. A drag that jumps to a cut when you did not ask
            it to is indistinguishable from a bug unless you can see that
            snapping is on and turn it off. */}
        <button
          type="button"
          data-snapping={snapping ? 'on' : 'off'}
          onClick={() => setSnapping((on) => !on)}
          title={snapping ? 'Snapping is on (N)' : 'Snapping is off (N)'}
          aria-pressed={snapping}
          className={clsx(
            'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
            snapping
              ? 'border-violet/50 bg-violet-dim text-violet'
              : 'border-line text-muted hover:text-chalk',
          )}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 2v6a4 4 0 0 0 8 0V2" />
            <path d="M4 6h3M9 6h3" />
          </svg>
          Snap
        </button>

        <div className="ml-auto flex items-center gap-2">
          {/* Zoom, as one continuous control.
              The buttons multiply rather than add, and the slider is
              logarithmic, so a given distance of travel is the same change in
              scale wherever you start from. */}
          <div className="flex items-center gap-1.5">
            <ToolButton
              onClick={() => zoomTo(pps / ZOOM_STEP)}
              disabled={pps <= minPps + 1e-4}
              title="Zoom out (Ctrl/Cmd + wheel)"
            >
              &minus;
            </ToolButton>

            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={zoomFraction}
              data-zoom
              onChange={(e) => zoomTo(ppsAtFraction(Number(e.target.value)))}
              aria-label="Timeline zoom"
              title={`${pps.toFixed(1)} pixels per second`}
              className="zoom-slider h-4 w-24 cursor-ew-resize sm:w-32"
            />

            <ToolButton
              onClick={() => zoomTo(pps * ZOOM_STEP)}
              disabled={pps >= MAX_PPS - 1e-4}
              title="Zoom in (Ctrl/Cmd + wheel)"
            >
              +
            </ToolButton>
          </div>

          <ToolButton onClick={zoomToFit} title="Fit the whole video in the window">Fit</ToolButton>
          <ToolButton onClick={() => setShowKeys(true)} title="Keyboard shortcuts (?)">?</ToolButton>

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
        <div data-warning className="border-b border-line bg-warn/[0.07] px-4 py-2 text-xs text-warn">{warning}</div>
      ) : null}
      {rejected.length ? (
        <div className="border-b border-line bg-bad/[0.07] px-4 py-2 text-xs text-bad">
          {rejected.length} edit{rejected.length === 1 ? '' : 's'} could not be applied.
        </div>
      ) : null}

      {/* ────────────────────────────────────────────── the tracks ─── */}
      <div
        ref={scrollRef}
        data-timeline-scroll
        className="relative overflow-x-auto overflow-y-hidden"
        // Anywhere that is not a clip means "nothing". Without it the only way
        // to put the inspector down is to pick up something else.
        onPointerDown={beginDragFromEvent}
      >
        <div style={{ width: width + TRACK_LABEL_W, minWidth: '100%' }}>
          {/* ruler */}
          <div
            className="sticky top-0 z-20 flex h-7 cursor-ew-resize select-none border-b border-line bg-charcoal"
            onPointerDown={(e) => { beginDrag(e, 'playhead', null, 0, 0); seek(secAtClientX(e.clientX)); }}
          >
            <div className="shrink-0 border-r border-line" style={{ width: TRACK_LABEL_W }} />
            <div className="relative" style={{ width }}>
              {/* The mark is drawn at every tick; the LABEL is dropped when it
                  would run off the end. A timecode is about 44px wide, and one
                  hanging past the last frame made the timeline wider than the
                  edit — which is why Fit could never quite fit. */}
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute top-0 border-l border-line pl-1 font-mono text-[10px] leading-7 text-faint"
                  style={{ left: t * pps, color: '#6E6E7C' }}
                >
                  {t * pps + 46 <= width ? formatTc(t) : ''}
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
                  id={segment.id}
                  track="segment"
                  left={g.start * pps}
                  width={Math.max(6, (g.end - g.start) * pps)}
                  selected={selected}
                  dragging={dragPreview?.id === segment.id}
                  tone={segment.reason === 'hook' ? 'hook' : 'video'}
                  startSec={g.start}
                  endSec={g.end}
                  text={`${segment.reason === 'hook' ? 'HOOK · ' : ''}${segment.text || 'clip'}`}
                />
              );
            })}
          </Track>

          <Track label="Captions" labelHint={`${edl.captions.length}`}>
            {edl.captions.map((cue) => {
              const g = geometry(cue.id, cue.startSec, cue.endSec);
              return (
                <Clip
                  key={cue.id}
                  id={cue.id}
                  track="caption"
                  left={g.start * pps}
                  width={Math.max(4, (g.end - g.start) * pps)}
                  selected={selection?.kind === 'caption' && selection.id === cue.id}
                  dragging={dragPreview?.id === cue.id}
                  tone="caption"
                  startSec={g.start}
                  endSec={g.end}
                  text={captionText.get(cue.id) ?? ''}
                />
              );
            })}
          </Track>

          <Track label="B-roll" labelHint={`${edl.broll.length}`}>
            {edl.broll.map((clip) => {
              const g = geometry(clip.id, clip.outStartSec, clip.outEndSec);
              return (
                <Clip
                  key={clip.id}
                  id={clip.id}
                  track="broll"
                  left={g.start * pps}
                  width={Math.max(6, (g.end - g.start) * pps)}
                  selected={selection?.kind === 'broll' && selection.id === clip.id}
                  dragging={dragPreview?.id === clip.id}
                  tone="broll"
                  startSec={g.start}
                  endSec={g.end}
                  text={clip.query || 'B-roll'}
                />
              );
            })}
          </Track>

          <Track label="Graphics" labelHint={`${edl.graphics.length}`}>
            {edl.graphics.map((clip) => {
              const g = geometry(clip.id, clip.outStartSec, clip.outEndSec);
              return (
                <Clip
                  key={clip.id}
                  id={clip.id}
                  track="graphics"
                  left={g.start * pps}
                  width={Math.max(6, (g.end - g.start) * pps)}
                  selected={selection?.kind === 'graphics' && selection.id === clip.id}
                  dragging={dragPreview?.id === clip.id}
                  tone="graphic"
                  startSec={g.start}
                  endSec={g.end}
                  text={clip.text || clip.type}
                />
              );
            })}
          </Track>

          <Track label="Punch-ins" labelHint={`${edl.punchIns.length}`}>
            {edl.punchIns.map((clip) => {
              const g = geometry(clip.id, clip.outStartSec, clip.outEndSec);
              return (
                <Clip
                  key={clip.id}
                  id={clip.id}
                  track="punchIns"
                  left={g.start * pps}
                  width={Math.max(6, (g.end - g.start) * pps)}
                  selected={selection?.kind === 'punchIns' && selection.id === clip.id}
                  dragging={dragPreview?.id === clip.id}
                  tone="punch"
                  startSec={g.start}
                  endSec={g.end}
                  text={`${clip.scale.toFixed(2)}×`}
                />
              );
            })}
          </Track>

          {/* Instants rather than spans, so they get markers, not blocks.

              Both marks are drawn a few pixels wide but grabbed through a
              16px-wide invisible button. A 3px target is a target you miss, and
              missing it deselects instead — the marker looked broken when the
              only thing wrong was the size of the hitbox. */}
          <Track label="Sound" labelHint={`${edl.sfx.length + edl.transitions.length} cues`} lanes>
            {edl.sfx.map((cue) => (
              <button
                key={cue.id}
                type="button"
                data-clip-id={cue.id}
                data-track="sfx"
                data-selected={selection?.kind === 'sfx' && selection.id === cue.id ? 'true' : undefined}
                title={`${cue.sound} · ${formatTc(cue.atSec)}`}
                className="group absolute top-0 flex h-[19px] w-4 -translate-x-1/2 cursor-grab touch-none items-center justify-center"
                style={{ left: (dragPreview?.id === cue.id ? dragPreview.start : cue.atSec) * pps }}
              >
                <span
                  className={clsx(
                    'h-[13px] w-[3px] rounded-full transition-colors',
                    selection?.kind === 'sfx' && selection.id === cue.id
                      ? 'bg-chalk shadow-[0_0_6px_rgba(245,245,247,.7)]'
                      : 'bg-warn group-hover:bg-chalk',
                  )}
                />
              </button>
            ))}

            {/* A transition is an instant too, but it has a LENGTH — the cue is
                drawn at the cut and the diamond marks where it starts. Dragging
                it moves the whole thing; the inspector changes how long it
                lasts, because 40ms of drag precision is not how anybody wants
                to set a quarter-second dissolve. */}
            {edl.transitions.map((cue) => {
              const at = dragPreview?.id === cue.id ? dragPreview.start : cue.atSec;
              const chosen = selection?.kind === 'transitions' && selection.id === cue.id;
              return (
                <button
                  key={cue.id}
                  type="button"
                  data-clip-id={cue.id}
                  data-track="transitions"
                  data-selected={chosen ? 'true' : undefined}
                  title={`${cue.type} · ${cue.durationSec.toFixed(2)}s at ${formatTc(cue.atSec)}`}
                  className="group absolute bottom-0 flex h-[19px] w-4 -translate-x-1/2 cursor-grab touch-none items-center justify-center"
                  style={{ left: at * pps }}
                >
                  <span
                    className="pointer-events-none absolute h-[2px] rounded-full bg-violet/45"
                    style={{ width: Math.max(2, cue.durationSec * pps), left: '50%' }}
                  />
                  <span
                    className={clsx(
                      'relative h-2 w-2 rotate-45 rounded-[2px] transition-colors',
                      chosen ? 'bg-chalk shadow-[0_0_6px_rgba(245,245,247,.7)]' : 'bg-violet group-hover:bg-chalk',
                    )}
                  />
                </button>
              );
            })}
          </Track>

          {/* What the drag is actually doing, in numbers.
              Dragging against a waveform gets you close; the readout is how you
              know you landed on 4.20 and not 4.17, which is the difference
              between a cut on the breath and a cut through it. */}
          {dragPreview ? (
            <div
              className="pointer-events-none absolute top-8 z-40 whitespace-nowrap rounded-md border border-line bg-ink/95 px-2 py-1 font-mono text-[10.5px] tabular-nums text-chalk shadow-card backdrop-blur"
              style={{
                left: Math.max(
                  TRACK_LABEL_W + 4,
                  Math.min(
                    TRACK_LABEL_W + dragPreview.start * pps,
                    TRACK_LABEL_W + width - 150,
                  ),
                ),
              }}
            >
              {dragPreview.kind === 'move' ? (
                <>
                  {formatTc(dragPreview.start)}
                  {dragPreview.end > dragPreview.start ? (
                    <span className="text-faint"> &rarr; {formatTc(dragPreview.end)}</span>
                  ) : null}
                </>
              ) : (
                <>
                  {formatTc(dragPreview.start)}&ndash;{formatTc(dragPreview.end)}
                  <span className="text-violet"> {(dragPreview.end - dragPreview.start).toFixed(2)}s</span>
                </>
              )}
              {dragPreview.snappedTo != null ? <span className="text-warn"> snap</span> : null}
            </div>
          ) : null}

          {/* The line a drag snapped onto.
              Snapping you cannot see is indistinguishable from the timeline
              jumping on its own — the guide is what turns "it moved by itself"
              into "it landed on the cut". */}
          {dragPreview?.snappedTo != null ? (
            <div
              className="pointer-events-none absolute top-0 z-30 w-px bg-warn"
              style={{
                left: TRACK_LABEL_W + dragPreview.snappedTo * pps,
                height: '100%',
                boxShadow: '0 0 10px rgba(245,196,83,.75)',
              }}
            />
          ) : null}

          {/* playhead, drawn over everything */}
          <div
            className="pointer-events-none absolute top-0 z-30 w-px bg-chalk"
            style={{ left: TRACK_LABEL_W + playhead * pps, height: '100%', boxShadow: '0 0 8px rgba(245,245,247,.5)' }}
          />
        </div>
      </div>

      {showKeys ? <ShortcutSheet onClose={() => setShowKeys(false)} /> : null}

      {/* Only when there is nowhere better to put them. See `panels` above. */}
      {panels ? null : (
        <div className="grid gap-4 border-t border-line p-4 sm:grid-cols-2">
          {inspectorPane}
          {changesPane}
        </div>
      )}
      </div>
    </>
  );
}

/* ────────────────────────────────────────────────── sub-components ─── */

/**
 * Every key the timeline listens for, on one card.
 *
 * The product is for people who have never opened an editor, and the fastest
 * way to make one of them faster is not another button — it is showing them
 * that the keys exist at all. Discoverable beats clever: `?` is the one place
 * people already look.
 */
function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const groups: Array<[string, Array<[string, string]>]> = [
    ['Playing', [
      ['Space  K', 'Play or pause'],
      ['J  L', 'A second back / forward'],
      ['← →', 'A frame back / forward'],
      ['⇧← ⇧→', 'A second back / forward'],
      ['Home  End', 'Jump to the start / end'],
    ]],
    ['Editing', [
      ['S', 'Split the clip under the playhead'],
      ['[  ]', 'Trim the selection to the playhead'],
      [',  .', 'Nudge the selection a frame'],
      ['⇧,  ⇧.', 'Nudge it a second'],
      ['⌘D', 'Duplicate at the playhead'],
      ['Delete', 'Remove what is selected'],
      ['⌘Z  ⇧⌘Z', 'Undo / redo'],
    ]],
    ['Looking', [
      ['⌘ + wheel', 'Zoom where the pointer is'],
      ['⇧ + wheel', 'Scroll sideways'],
      ['−  =', 'Zoom out / in'],
      ['0', 'Fit the whole edit'],
      ['N', 'Snapping off and on'],
      ['Alt + drag', 'Ignore snapping for one drag'],
      ['Esc', 'Deselect'],
    ]],
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-full w-full max-w-3xl overflow-y-auto rounded-2xl border border-line bg-charcoal p-5 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-bold text-chalk">Keyboard</h3>
          <button type="button" onClick={onClose} className="text-xs text-muted hover:text-chalk">
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-5 sm:grid-cols-3">
          {groups.map(([title, rows]) => (
            <div key={title}>
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted/70">{title}</h4>
              <dl className="mt-2 space-y-1.5">
                {rows.map(([keys, what]) => (
                  <div key={keys} className="flex items-baseline gap-2">
                    <dt className="w-20 shrink-0 whitespace-nowrap font-mono text-[10.5px] text-violet">{keys}</dt>
                    <dd className="text-[11px] leading-snug text-muted">{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>

        <p className="mt-4 border-t border-line-soft pt-3 text-[11px] text-faint">
          Nothing here re-renders the video. Edits pile up until you press Apply.
        </p>
      </div>
    </div>
  );
}


/**
 * Where the speech is, drawn behind the clips.
 *
 * You trim against sound, not against labels — the whole point of a waveform is
 * seeing the breath before the sentence so you know where to cut. We already
 * have word-level timings in the EDL, so this is drawn from the transcript
 * rather than by decoding audio: it is free, exact about where words start and
 * stop, and available before any audio has loaded.
 */
const SpeechTrack = React.memo(function SpeechTrack({ edl, pps }: { edl: Edl; pps: number }) {
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
});

function Track({
  label,
  labelHint,
  lanes,
  children,
}: {
  label: string;
  labelHint?: string;
  /**
   * Two rows of markers in one track, each with the full height to itself.
   *
   * Sound cues and transitions both belong at a cut, so they land on the same
   * pixel constantly — and a hitbox tall enough to grab is then a hitbox that
   * swallows its neighbour's clicks. Splitting the track in half means the two
   * never compete for a pointer.
   */
  lanes?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={clsx('flex border-b border-line-soft', lanes ? 'h-10' : 'h-11')}
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

const Clip = React.memo(function Clip({
  id,
  track,
  left,
  width,
  selected,
  dragging,
  tone,
  startSec,
  endSec,
  text,
}: {
  /** On the element as well as in React, so a drag can be driven and measured. */
  id: string;
  track: string;
  left: number;
  width: number;
  selected: boolean;
  dragging?: boolean;
  tone: keyof typeof TONES;
  /** Where it sits, for the tooltip — a clip's exact times are otherwise unknowable. */
  startSec: number;
  endSec: number;
  /**
   * The label, as a plain string rather than children.
   *
   * `children` is a fresh React element on every render, so a memoised Clip
   * compared its props, found one that always differed, and re-rendered
   * anyway — which is how four hundred clips came to re-render on every
   * pointermove of a drag. Every prop here is now a primitive, so the
   * comparison can actually succeed.
   */
  text: string;
}) {
  const handle = width >= 14 ? Math.max(4, Math.min(8, Math.round(width * 0.2))) : 0;

  return (
    <div
      data-clip-id={id}
      data-track={track}
      data-selected={selected || undefined}
      // The label is truncated at almost every zoom, and the times are not
      // written anywhere until you pick the clip up. Hovering should answer
      // both questions without changing anything.
      title={`${text}\n${formatTc(startSec)} – ${formatTc(endSec)}  ·  ${(endSec - startSec).toFixed(2)}s`}
      className={clsx(
        'group absolute top-1 bottom-1 cursor-grab touch-none select-none overflow-hidden rounded-md border px-2 text-[11px] leading-[26px] active:cursor-grabbing',
        TONES[tone],
        selected && 'ring-2 ring-chalk ring-offset-1 ring-offset-charcoal',
        // A clip mid-drag floats over its neighbours rather than being clipped
        // by whichever one happens to come later in the DOM.
        dragging && 'z-20 opacity-90 shadow-card ring-1 ring-chalk/50',
      )}
      style={{ left, width, touchAction: 'none' }}
    >
      <span className="pointer-events-none block truncate">{text}</span>

      {/* Trim handles: invisible until hover, so the timeline stays calm.

          Their width is a fraction of the clip's, never a constant. Eight
          pixels a side is right for a two-second clip and catastrophic for a
          caption: a 16px cue was ENTIRELY handle, so every attempt to move one
          trimmed it instead. There is always a middle left to grab, and below
          fourteen pixels there are no handles at all — a clip that thin is
          something you move and nudge, not something you trim by eye. */}
      {handle > 0 ? (
        <>
          <span
            data-handle="start"
            style={{ touchAction: 'none', width: handle }}
            className="absolute inset-y-0 left-0 cursor-ew-resize touch-none bg-chalk/0 group-hover:bg-chalk/40"
          />
          <span
            data-handle="end"
            style={{ touchAction: 'none', width: handle }}
            className="absolute inset-y-0 right-0 cursor-ew-resize touch-none bg-chalk/0 group-hover:bg-chalk/40"
          />
        </>
      ) : null}
    </div>
  );
});

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

  if (selection.kind === 'transitions') {
    const cue = edl.transitions.find((c) => c.id === selection.id);
    if (!cue) return null;
    return (
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted/70">
          Transition <span className="font-mono normal-case text-faint">at {formatTc(cue.atSec)}</span>
        </h4>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {TRANSITION_TYPES.filter((t) => t !== 'none').map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onChange({ op: 'transition.set', id: cue.id, type })}
              className={clsx(
                'rounded border px-2 py-0.5 text-[11px] font-semibold',
                cue.type === type ? 'border-violet text-violet' : 'border-line text-muted hover:text-chalk',
              )}
            >
              {type}
            </button>
          ))}
        </div>
        {/* Set by button, not by drag: a transition is a fifth of a second long,
            which is three pixels at a zoom you can still see the edit at. */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-faint">Length</span>
          {[0.16, 0.24, 0.4, 0.6].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() =>
                onChange({ op: 'clip.trim', track: 'transitions', id: cue.id, outStartSec: cue.atSec, outEndSec: cue.atSec + d })
              }
              className={clsx(
                'rounded border px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                Math.abs(cue.durationSec - d) < 0.02 ? 'border-violet text-violet' : 'border-line text-muted hover:text-chalk',
              )}
            >
              {d.toFixed(2)}s
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (selection.kind === 'punchIns') {
    const clip = edl.punchIns.find((c) => c.id === selection.id);
    if (!clip) return null;
    return (
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted/70">
          Punch-in{' '}
          <span className="font-mono normal-case text-faint">
            {formatTc(clip.outStartSec)}&ndash;{formatTc(clip.outEndSec)}
          </span>
        </h4>
        <p className="mt-2 text-xs text-muted">How far in the camera pushes for this line.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[1.08, 1.15, 1.25, 1.4].map((scale) => (
            <button
              key={scale}
              type="button"
              onClick={() => onChange({ op: 'clip.update', track: 'punchIns', id: clip.id, patch: { scale } })}
              className={clsx(
                'rounded border px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                Math.abs(clip.scale - scale) < 0.01 ? 'border-violet text-violet' : 'border-line text-muted hover:text-chalk',
              )}
            >
              {scale.toFixed(2)}&times;
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

  /**
   * The new clip's identity, decided here rather than inside the reducer.
   *
   * The editor re-applies its whole operation stack on every render to show the
   * pending edit, so anything the reducer invents is re-invented constantly.
   * Deciding it once, at the click, is what makes an added clip a thing you can
   * then pick up.
   */
  const freshId = (track: string) => `${track}-${Math.random().toString(36).slice(2, 8)}`;

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
          <MenuItem onClick={() => add({ op: 'clip.add', track: 'broll', atSec, durationSec: 2, value: '', id: freshId('broll') })}>
            B-roll insert
            <span className="block text-[10px] font-normal text-muted">2s — type what it shows</span>
          </MenuItem>
          <MenuItem onClick={() => add({ op: 'clip.add', track: 'graphics', atSec, durationSec: 2.5, value: 'Label', graphicType: 'icon', id: freshId('graphics') })}>
            Icon + label
          </MenuItem>
          <MenuItem onClick={() => add({ op: 'clip.add', track: 'graphics', atSec, durationSec: 2.5, value: '100', graphicType: 'stat', id: freshId('graphics') })}>
            Stat card
          </MenuItem>
          <MenuItem onClick={() => add({ op: 'clip.add', track: 'punchIns', atSec, durationSec: 2, value: '', id: freshId('punchIns') })}>
            Punch-in
          </MenuItem>
          <div className="border-t border-line-soft px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-faint">
            Transition
          </div>
          <div className="flex flex-wrap gap-1 p-2 pt-0">
            {(['dissolve', 'whip-pan', 'zoom-punch', 'flash', 'glitch', 'slide', 'film-burn'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => add({ op: 'clip.add', track: 'transitions', atSec, durationSec: 0.24, value: type, id: freshId('transitions') })}
                className="rounded border border-line px-2 py-0.5 text-[11px] font-semibold text-muted transition-colors hover:border-violet hover:text-violet"
              >
                {type}
              </button>
            ))}
          </div>

          <div className="border-t border-line-soft px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-faint">
            Sound
          </div>
          <div className="flex flex-wrap gap-1 p-2 pt-0">
            {(['whoosh', 'pop', 'impact', 'swipe', 'riser', 'ding', 'click', 'sub-drop'] as const).map((sound) => (
              <button
                key={sound}
                type="button"
                onClick={() => add({ op: 'clip.add', track: 'sfx', atSec, durationSec: 0.4, value: sound, id: freshId('sfx') })}
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
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
  const step = candidates.find((c) => c * pps > 64) ?? 300;
  const out: number[] = [];
  for (let t = 0; t <= duration; t += step) out.push(Number(t.toFixed(3)));
  return out;
}

/**
 * How fast to auto-scroll, given how far past the edge the pointer is.
 *
 * Squared rather than linear so that resting just inside the edge creeps and
 * pushing hard against it moves, instead of one speed that is either too slow
 * to be useful or too fast to aim with.
 */
function ramp(depthPx: number): number {
  const t = Math.min(1, Math.max(0, depthPx / AUTOSCROLL_EDGE_PX));
  return Math.ceil(t * t * AUTOSCROLL_MAX_PX_PER_FRAME);
}

/** One clip's timing and seed text, whichever track it is on. */
function clipById(
  edl: Edl,
  track: ClipTrack,
  id: string,
): { start: number; end: number; label?: string } | null {
  if (track === 'sfx') {
    const cue = edl.sfx.find((c) => c.id === id);
    return cue ? { start: cue.atSec, end: cue.atSec, label: cue.sound } : null;
  }
  if (track === 'transitions') {
    const cue = edl.transitions.find((c) => c.id === id);
    return cue ? { start: cue.atSec, end: cue.atSec + cue.durationSec, label: cue.type } : null;
  }
  const item = (edl[track] as Array<{ id: string; outStartSec: number; outEndSec: number; query?: string; text?: string }>)
    .find((c) => c.id === id);
  return item ? { start: item.outStartSec, end: item.outEndSec, label: item.query ?? item.text } : null;
}

/**
 * Where something on the timeline sits, by track name, for a drag that starts.
 *
 * Instants — sound cues, transitions — report a zero-length span on purpose:
 * that is what tells `resolveDrag` there is no length to preserve or protect,
 * so the marker follows the pointer instead of being clamped to a minimum.
 */
function spanOf(edl: Edl, track: string, id: string): { start: number; end: number } | null {
  if (track === 'segment') {
    const s = edl.segments.find((x) => x.id === id);
    return s ? { start: s.outStartSec, end: s.outEndSec } : null;
  }
  if (track === 'caption') {
    const c = edl.captions.find((x) => x.id === id);
    return c ? { start: c.startSec, end: c.endSec } : null;
  }
  if (track === 'sfx' || track === 'transitions') {
    const c = (track === 'sfx' ? edl.sfx : edl.transitions).find((x) => x.id === id);
    return c ? { start: c.atSec, end: c.atSec } : null;
  }
  return clipById(edl, track as ClipTrack, id);
}

function nearestIndex(starts: number[], target: number): number {
  let index = 0;
  for (let i = 0; i < starts.length; i++) if (target >= starts[i]) index = i;
  return index;
}
