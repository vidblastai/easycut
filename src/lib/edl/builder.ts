import { randomUUID } from 'node:crypto';
import type { DirectorPlan } from '@/lib/director/schema';
import type { FormatMode, StylePreset } from '@/lib/styles/presets';
import { pacingFor } from '@/lib/styles/presets';
import { layoutPlan } from '@/lib/styles/layouts';
import { TimeMapper } from '@/lib/timeline/time-mapper';
import type { Transcript } from '@/lib/transcribe/types';
import { buildCaptions } from './captions';
import {
  ASPECT_DIMENSIONS,
  type Aspect,
  type BrollClip,
  type Edl,
  type GraphicElement,
  type OverlayElement,
  type PunchIn,
  type Segment,
  type SfxCue,
  type TransitionCue,
  type TransitionType,
} from './types';

/**
 * Assembles the EDL.
 *
 * This is where three independent things — the mechanical cut list, the
 * director's creative plan, and the style preset — are reconciled into one
 * document, and where every cue is translated from source time into output
 * time. Nothing downstream re-derives any of it.
 *
 * The recurring hazard here is **collision**: the director plans cues against a
 * transcript, unaware that a cut will move them, that two of them will land on
 * the same second, or that one will cover the speaker's face at the punchline.
 * Most of the code below is about resolving those collisions deterministically.
 */

export interface BuildEdlInput {
  projectId: string;
  style: StylePreset;
  mode: FormatMode;
  aspect: Aspect;
  fps: number;
  transcript: Transcript;
  plan: DirectorPlan;
  segments: Segment[];
  source: Edl['source'];
  reframe: Edl['reframe'];
  /** Layers skipped because a provider was missing. */
  degraded: string[];
}

export function buildEdl(input: BuildEdlInput): Edl {
  const { style, mode, plan, segments, transcript } = input;
  const pacing = pacingFor(style, mode);
  const mapper = new TimeMapper(segments);
  const durationSec = mapper.outputDuration;
  const dimensions = ASPECT_DIMENSIONS[input.aspect];

  /* ------------------------------- captions ------------------------------- */

  const captions = buildCaptions({
    words: transcript.words,
    mapper,
    style: style.captionStyle,
    emphasis: plan.emphasis,
    outputDurationSec: durationSec,
  });

  /* -------------------------------- b-roll -------------------------------- */

  const broll = placeBroll(plan, mapper, durationSec, pacing.brollDurationSec, captions, layoutPlan(style.layout).alwaysOn);

  /* ------------------------------- graphics ------------------------------- */

  const graphics = placeGraphics(plan, mapper, durationSec, broll, style.accent);

  /* ------------------------------ punch-ins ------------------------------- */

  const punchIns = placePunchIns(plan, mapper, durationSec, broll, pacing.punchInScale, input.reframe);

  /* ----------------------------- transitions ------------------------------ */

  const transitions = placeTransitions(mapper, style.transitions, pacing.transitionDensity, durationSec);

  /* --------------------------------- sfx ---------------------------------- */

  const sfx = placeSfx(plan, mapper, durationSec, transitions, graphics, broll);

  /* ------------------------------- overlays ------------------------------- */

  const overlays = placeOverlays(input, plan, mapper, durationSec);

  return {
    version: '1.0',
    projectId: input.projectId,
    styleId: style.id,
    format: {
      aspect: input.aspect,
      width: dimensions.width,
      height: dimensions.height,
      fps: input.fps,
      layout: style.layout,
      durationSec,
    },
    source: input.source,
    segments,
    captions,
    captionStyle: style.captionStyle,
    broll,
    graphics,
    overlays,
    transitions,
    punchIns,
    reframe: input.reframe,
    sfx,
    music: null, // attached by the asset stage once a track is chosen
    audio: {
      targetLufs: -14,
      denoise: true,
      highPassHz: 80,
      compress: true,
    },
    deliverable: {
      title: plan.deliverable.title,
      socialCaption: plan.deliverable.socialCaption,
      hashtags: plan.deliverable.hashtags,
      thumbnailAtSec: pickThumbnailTime(durationSec, punchIns, broll),
      chapters: plan.chapters
        .map((c) => ({ atSec: mapper.toOutputClamped(c.atSec), title: c.title }))
        .filter((c) => c.atSec > 1 && c.atSec < durationSec - 2),
    },
    degraded: input.degraded,
  };
}

/* ---------------------------------------------------------------- b-roll */

function placeBroll(
  plan: DirectorPlan,
  mapper: TimeMapper,
  durationSec: number,
  durationRange: [number, number],
  captions: Edl['captions'],
  /**
   * True when the layout gives B-roll its own half of the frame.
   *
   * Then it is not an insert at all — it is the other half of the video, on
   * screen from the first frame to the last. The rules that keep an insert from
   * covering the speaker stop applying, and any second it does not cover is a
   * black rectangle beside somebody's face.
   */
  alwaysOn: boolean,
): BrollClip[] {
  const clips: BrollClip[] = [];

  for (const cue of plan.broll) {
    const start = mapper.toOutputClamped(cue.atSec);
    const length = clampNumber(cue.durationSec, durationRange[0], durationRange[1]);
    let end = Math.min(durationSec - 0.3, start + length);
    if (end - start < 0.6) continue;

    // Never overlap another insert — two B-rolls at once is incoherent.
    const overlaps = clips.some((c) => start < c.outEndSec + 0.4 && end > c.outStartSec - 0.4);
    if (overlaps) continue;

    // Never start on the first second: the viewer has to see who is talking
    // before we cut away from them. Not so in a permanent slot, where nothing
    // is being covered up.
    if (!alwaysOn && start < 1.2) continue;

    // Don't cover the very end — an insert as the video finishes strands the speaker.
    if (!alwaysOn && start > durationSec - 1.5) continue;

    // Trim so the insert ends on a caption boundary rather than mid-word.
    const boundary = captions.find((c) => c.endSec >= end && c.startSec <= end);
    if (boundary && boundary.endSec - end < 0.5) end = boundary.endSec;

    clips.push({
      id: `broll-${clips.length}`,
      outStartSec: start,
      outEndSec: end,
      kind: cue.kind,
      url: '', // resolved by the asset stage
      clipStartSec: 0,
      scale: 1,
      kenBurns: cue.kind === 'stock-video' ? 'none' : 'in',
      audioGainDb: -60, // speech keeps playing underneath, always
      opacity: 1,
      intent: cue.intent,
      query: cue.query,
    });
  }

  const ordered = clips.sort((a, b) => a.outStartSec - b.outStartSec);
  return alwaysOn ? fillBrollGaps(ordered, durationSec, durationRange[1]) : ordered;
}

/**
 * Leaves no hole in a permanent B-roll slot.
 *
 * The director places inserts where the script names something; a slot that is
 * on screen throughout needs cover everywhere else too. Each gap is filled by
 * replaying its nearest neighbour from the top — a real clip in the document,
 * with its own id and its own `clipStartSec`, rather than a renderer trick.
 * That keeps the timeline honest: what you see in the editor is what plays, and
 * you can replace any one of them by typing a different query.
 *
 * Runs are capped so a twenty-second hole is four clips rather than one stock
 * shot held until it freezes.
 */
function fillBrollGaps(clips: BrollClip[], durationSec: number, maxRunSec: number): BrollClip[] {
  if (!clips.length) return clips;

  const run = Math.max(2, maxRunSec);
  const out: BrollClip[] = [];
  let cursor = 0;
  let minted = 0;

  /** Whichever placed clip is nearest the hole — the one before it, by preference. */
  const nearest = (at: number) =>
    [...clips].sort((a, b) => Math.abs(a.outStartSec - at) - Math.abs(b.outStartSec - at))[0];

  const cover = (from: number, to: number) => {
    const source = nearest(from);
    for (let at = from; to - at > 0.4; at += run) {
      out.push({
        ...source,
        id: `broll-fill-${minted++}`,
        outStartSec: at,
        outEndSec: Math.min(to, at + run),
        clipStartSec: 0,
        intent: `${source.intent} — filling the slot`,
      });
    }
  };

  for (const clip of clips) {
    if (clip.outStartSec - cursor > 0.4) cover(cursor, clip.outStartSec);
    out.push(clip);
    cursor = Math.max(cursor, clip.outEndSec);
  }
  if (durationSec - cursor > 0.4) cover(cursor, durationSec);

  return out.sort((a, b) => a.outStartSec - b.outStartSec);
}

/* -------------------------------------------------------------- graphics */

function placeGraphics(
  plan: DirectorPlan,
  mapper: TimeMapper,
  durationSec: number,
  broll: BrollClip[],
  accent: string,
): GraphicElement[] {
  const graphics: GraphicElement[] = [];

  for (const cue of plan.graphics) {
    const start = mapper.toOutputClamped(cue.atSec);
    const end = Math.min(durationSec - 0.2, start + cue.durationSec);
    if (end - start < 0.5) continue;

    // A graphic on top of B-roll is two competing focal points.
    if (broll.some((b) => start < b.outEndSec && end > b.outStartSec)) continue;
    // One graphic at a time.
    if (graphics.some((g) => start < g.outEndSec + 0.3 && end > g.outStartSec - 0.3)) continue;

    graphics.push({
      id: `graphic-${graphics.length}`,
      type: cue.type,
      outStartSec: start,
      outEndSec: end,
      animation: animationFor(cue.type),
      ...positionFor(cue.type),
      scale: 1,
      text: cue.text,
      subtext: cue.subtext,
      items: cue.items,
      assetUrl: null, // resolved by the asset stage
      iconQuery: cue.iconQuery,
      imagePrompt: cue.imagePrompt,
      color: accent,
    });
  }

  // A title card belongs at frame zero, not wherever the director timestamped it.
  if (plan.titleCard) {
    graphics.unshift({
      id: 'graphic-title',
      type: 'title-card',
      outStartSec: 0,
      outEndSec: Math.min(3, durationSec),
      animation: 'slide-up',
      x: 0.5,
      y: 0.5,
      scale: 1,
      text: plan.titleCard.text,
      subtext: plan.titleCard.subtext,
      items: [],
      assetUrl: null,
      iconQuery: '',
      imagePrompt: '',
      color: accent,
    });
  }

  return graphics.sort((a, b) => a.outStartSec - b.outStartSec);
}

function animationFor(type: GraphicElement['type']): GraphicElement['animation'] {
  switch (type) {
    case 'stat': return 'count-up';
    case 'list': return 'slide-up';
    case 'arrow': return 'draw';
    case 'title-card': return 'slide-up';
    case 'quote': return 'fade';
    default: return 'pop';
  }
}

/** Keeps graphics clear of the caption band and the speaker's face. */
function positionFor(type: GraphicElement['type']): { x: number; y: number } {
  switch (type) {
    case 'title-card': return { x: 0.5, y: 0.5 };
    case 'list': return { x: 0.5, y: 0.34 };
    case 'stat': return { x: 0.5, y: 0.24 };
    case 'quote': return { x: 0.5, y: 0.42 };
    case 'arrow': return { x: 0.68, y: 0.4 };
    default: return { x: 0.76, y: 0.22 };
  }
}

/* ------------------------------------------------------------- punch-ins */

function placePunchIns(
  plan: DirectorPlan,
  mapper: TimeMapper,
  durationSec: number,
  broll: BrollClip[],
  scaleRange: [number, number],
  reframe: Edl['reframe'],
): PunchIn[] {
  const result: PunchIn[] = [];
  // Punch in toward the face when we know where it is.
  const focus = reframe?.keyframes[0] ?? { cx: 0.5, cy: 0.42 };

  for (const cue of plan.punchIns) {
    const start = mapper.toOutputClamped(cue.atSec);
    const end = Math.min(durationSec - 0.2, start + cue.durationSec);
    if (end - start < 0.8) continue;
    // Invisible during an insert, and jarring immediately after one.
    if (broll.some((b) => start < b.outEndSec + 0.3 && end > b.outStartSec - 0.3)) continue;
    // Back-to-back punch-ins read as a zoom wobble.
    if (result.some((p) => start < p.outEndSec + 1 && end > p.outStartSec - 1)) continue;

    const intensity = cue.intensity === 'strong' ? 1 : cue.intensity === 'subtle' ? 0 : 0.5;
    result.push({
      id: `punch-${result.length}`,
      outStartSec: start,
      outEndSec: end,
      scale: scaleRange[0] + (scaleRange[1] - scaleRange[0]) * intensity,
      x: focus.cx,
      y: focus.cy,
      easing: cue.intensity === 'strong' ? 'snap' : 'ramp',
    });
  }
  return result;
}

/* ----------------------------------------------------------- transitions */

/**
 * Decorated transitions go ONLY on visible cuts — seams where the source
 * timestamps jump. Putting a whip pan on a continuous piece of footage is the
 * clearest tell of an automated edit.
 */
function placeTransitions(
  mapper: TimeMapper,
  palette: TransitionType[],
  density: number,
  durationSec: number,
): TransitionCue[] {
  const decorative = palette.filter((t) => t !== 'cut' && t !== 'none');
  if (!decorative.length || density <= 0) return [];

  const cuts = mapper.cutPoints();
  const transitions: TransitionCue[] = [];

  cuts.forEach((atSec, index) => {
    if (atSec < 0.5 || atSec > durationSec - 0.5) return;
    // Deterministic spacing rather than randomness: a stable EDL re-renders
    // identically, which matters for caching and for user trust.
    const shouldDecorate = (index % Math.max(1, Math.round(1 / density))) === 0;
    if (!shouldDecorate) return;

    transitions.push({
      id: `transition-${transitions.length}`,
      atSec,
      type: decorative[index % decorative.length],
      durationSec: 0.24,
    });
  });

  return transitions;
}

/* -------------------------------------------------------------------- sfx */

function placeSfx(
  plan: DirectorPlan,
  mapper: TimeMapper,
  durationSec: number,
  transitions: TransitionCue[],
  graphics: GraphicElement[],
  broll: BrollClip[],
): SfxCue[] {
  const cues: SfxCue[] = [];
  const push = (atSec: number, sound: SfxCue['sound'], gainDb: number) => {
    if (atSec < 0.05 || atSec > durationSec - 0.05) return;
    // Two effects within 150 ms is a click, not punctuation.
    if (cues.some((c) => Math.abs(c.atSec - atSec) < 0.15)) return;
    cues.push({ id: `sfx-${cues.length}`, atSec, sound, gainDb });
  };

  // Director-chosen cues first — they have the context.
  for (const cue of plan.sfx) push(mapper.toOutputClamped(cue.atSec), cue.sound, -14);
  // Then the structural ones the director can't see, because they depend on cuts.
  for (const t of transitions) push(t.atSec, t.type === 'zoom-punch' ? 'impact' : 'whoosh', -15);
  for (const g of graphics) if (g.type !== 'title-card') push(g.outStartSec, 'pop', -17);
  for (const b of broll) push(b.outStartSec, 'swipe', -18);

  return cues.sort((a, b) => a.atSec - b.atSec);
}

/* --------------------------------------------------------------- overlays */

function placeOverlays(
  input: BuildEdlInput,
  plan: DirectorPlan,
  mapper: TimeMapper,
  durationSec: number,
): OverlayElement[] {
  const overlays: OverlayElement[] = [];
  const { overlays: enabled } = input.style;

  if (enabled.progressBar) {
    overlays.push({
      id: 'overlay-progress',
      type: 'progress-bar',
      outStartSec: 0,
      outEndSec: durationSec,
      text: '',
      subtext: '',
      color: input.style.accent,
      opacity: 0.9,
    });
  }

  if (enabled.lowerThird && plan.lowerThird) {
    overlays.push({
      id: 'overlay-lower-third',
      type: 'lower-third',
      // Held until the viewer has settled, then gone. A name card that outstays
      // its welcome is the most common amateur mistake in this layer.
      outStartSec: Math.min(1.5, durationSec * 0.05),
      outEndSec: Math.min(durationSec, Math.min(1.5, durationSec * 0.05) + 4),
      text: plan.lowerThird.text,
      subtext: plan.lowerThird.subtext,
      color: input.style.accent,
      opacity: 1,
    });
  }

  if (enabled.vignette) {
    overlays.push({ id: 'overlay-vignette', type: 'vignette', outStartSec: 0, outEndSec: durationSec, text: '', subtext: '', color: '#000000', opacity: 0.35 });
  }
  if (enabled.grain) {
    overlays.push({ id: 'overlay-grain', type: 'grain', outStartSec: 0, outEndSec: durationSec, text: '', subtext: '', color: '#FFFFFF', opacity: 0.05 });
  }

  for (const chapter of plan.chapters) {
    const atSec = mapper.toOutputClamped(chapter.atSec);
    if (atSec < 3 || atSec > durationSec - 6) continue;
    overlays.push({
      id: `overlay-chapter-${overlays.length}`,
      type: 'chapter-card',
      outStartSec: atSec,
      outEndSec: atSec + 2.4,
      text: chapter.title,
      subtext: '',
      color: input.style.accent,
      opacity: 1,
    });
  }

  return overlays;
}

/* --------------------------------------------------------------- helpers */

/**
 * The thumbnail wants a frame where the speaker is large and unobstructed —
 * which is exactly what a punch-in is. Failing that, a point a third of the way
 * in, away from any insert.
 */
function pickThumbnailTime(durationSec: number, punchIns: PunchIn[], broll: BrollClip[]): number {
  const candidate = punchIns[0] ? punchIns[0].outStartSec + 0.4 : durationSec * 0.32;
  const covered = broll.some((b) => candidate >= b.outStartSec && candidate <= b.outEndSec);
  return covered ? Math.max(0.5, durationSec * 0.08) : candidate;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function newProjectId(): string {
  return randomUUID();
}
