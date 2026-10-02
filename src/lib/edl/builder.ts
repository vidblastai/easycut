import { randomUUID } from 'node:crypto';
import type { DirectorPlan } from '@/lib/director/schema';
import type { PlannedScene } from '@/lib/director/scenes';
import type { FormatMode, StylePreset } from '@/lib/styles/presets';
import { pacingFor } from '@/lib/styles/presets';
import { layoutPlan } from '@/lib/styles/layouts';
import { LOOK_META } from '@/lib/scenes/looks';
import { TimeMapper } from '@/lib/timeline/time-mapper';
import type { Transcript } from '@/lib/transcribe/types';
import { buildCaptions } from './captions';
import { cuesForDensity, thinCues, transitionCues } from './sfx-cues';
import { sfxDefaultGain, type SfxName } from '@/lib/assets/sfx';
import { fallbackScene } from './scene-fallback';
import { hasPlayerChrome } from './safe-area';
import { punchMoments, type Busy } from './punch-script';
import { trimToWords } from '@/lib/text';
import {
  ASPECT_DIMENSIONS,
  hasSideRoom,
  iconRowPlacement,
  ICON_ROW_BELOW_COUNT,
  type IconSide,
  type Aspect,
  type ClipTransition,
  type BrollClip,
  type Edl,
  type GraphicElement,
  type IconCue,
  type OverlayElement,
  type PunchIn,
  type PunchMove,
  type Segment,
  type SfxCue,
  type TransitionCue,
  type TransitionType,
  type AnimatedScene,
  type SceneLook,
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
  /** Passages the scene pass chose, in SOURCE time. Empty is normal. */
  scenes?: PlannedScene[];
  segments: Segment[];
  source: Edl['source'];
  reframe: Edl['reframe'];
  /** Layers skipped because a provider was missing. */
  degraded: string[];
  /**
   * Whether the finished video carries the EasyCut mark.
   *
   * Comes from the plan the footage was uploaded under, not from the style or
   * the director — it is a commercial fact about the account, so it is passed
   * in rather than decided here.
   */
  watermark?: boolean;
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

  const broll = placeBroll(
    plan,
    mapper,
    durationSec,
    pacing.brollDurationSec,
    captions,
    layoutPlan(style.layout).alwaysOn,
    /*
     * A layout whose B-roll owns half the frame gets no treatment either.
     *
     * Same reason the transitions go to `cut`: that slot is not an insert, it
     * is the other half of the video, on screen from the first frame to the
     * last. Grain running for four minutes down one side of a split screen is
     * a filter on the video, and the `overlays` layer is where a filter on the
     * video belongs.
     */
    layoutPlan(style.layout).alwaysOn ? 'none' : style.brollOverlay,
    style.accent,
    // A layout that gives B-roll a permanent half has nothing to transition
    // INTO — the slot is on screen from the first frame — so those cut.
    layoutPlan(style.layout).alwaysOn ? ['cut'] : style.clipTransitions,
  );

  /* ------------------------------- graphics ------------------------------- */

  const graphics = placeGraphics(plan, mapper, durationSec, broll, style.accent, dimensions);

  /* --------------------------------- scenes -------------------------------- */

  const scenes = placeScenes(
    input.scenes ?? [],
    mapper,
    durationSec,
    broll,
    style.accent,
    style.sceneLook,
    style.clipTransitions[0] ?? null,
  );

  /*
   * A video always leaves here with at least one scene in it.
   *
   * Everything above this line can legitimately produce none: the pass can
   * decline, the cut can eat the passage it chose, a B-roll insert can land on
   * top of it. Each of those is defensible on its own and the sum of them is
   * not — what comes out the other side is a talking head with captions, which
   * is the video this product exists to stop people shipping.
   *
   * So if nothing survived, one is chosen deterministically by reading the
   * transcript. It is placed here, at the end of the builder, rather than back
   * at the pass, because this is the only point that knows whether anything
   * actually made it onto the timeline.
   *
   * Somebody who declined the layer still gets none: `stripLayers` runs after
   * this and empties the track. Guaranteeing one here and honouring the
   * refusal there keeps the two decisions in the one place each belongs.
   */
  const sceneNotes: string[] = [];
  if (!scenes.length) {
    const rescued = fallbackScene(transcript, mapper, durationSec, broll, style.accent, style.sceneLook);
    if (rescued) {
      scenes.push(rescued);
      // Recorded, because "the model chose this" and "nothing else was left"
      // are different facts about the same video and used to look identical.
      sceneNotes.push(`animated scene chosen from the transcript (${rescued.kind}) — the AI pass placed none`);
    } else {
      sceneNotes.push('animated scenes (nothing in the transcript could carry one)');
    }
  }

  /* ------------------------------ punch-ins ------------------------------- */

  /*
   * Everything that takes the frame off the speaker, in one list.
   *
   * A punch-in during an insert is invisible and one immediately after it is
   * jarring — and that is as true of a scene and a full-frame graphic as it
   * is of B-roll. Checking only B-roll is what used to put a crash zoom on
   * the two seconds between an animated scene and the insert after it.
   */
  const punchIns = placePunchIns(
    plan,
    mapper,
    transcript,
    durationSec,
    [...broll, ...scenes, ...graphics.filter((g) => g.type === 'title-card')],
    pacing.punchInScale,
    input.reframe,
    pacing.punchMoves,
    pacing.punchInEverySec,
  );

  /* ----------------------------- transitions ------------------------------ */

  const transitions = placeTransitions(mapper, style.transitions, pacing.transitionDensity, durationSec);

  /* ------------------------------ icon cards ------------------------------ */

  // After the three layers it defers to, because it needs to see what they
  // took: a card is punctuation on the speaker's frame, and there is no
  // speaker's frame while a scene or a B-roll insert is up.
  const icons = placeIcons(
    plan,
    transcript,
    mapper,
    durationSec,
    broll,
    graphics,
    scenes,
    LOOK_META[style.sceneLook].tone,
    dimensions,
  );

  /* --------------------------------- sfx ---------------------------------- */

  // Last of the cue layers, because it now reads all of them: a sound lands on
  // a transition, and until the inserts and the icon cards are placed there is
  // nothing for it to land on.
  const sfx = placeSfx(plan, mapper, durationSec, transitions, graphics, broll, icons, dimensions, pacing.sfxDensity);

  /* ------------------------------- overlays ------------------------------- */

  const overlays = placeOverlays(input, plan, mapper, durationSec, dimensions);

  return {
    version: '1.0',
    projectId: input.projectId,
    styleId: style.id,
    watermark: input.watermark ?? false,
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
    icons,
    scenes,
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
      // The audio crosses every cut a breath before the picture does. See
      // `jCutSec` — it is the difference between an edit and a splice.
      jCutSec: 0.14,
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
    degraded: [...input.degraded, ...sceneNotes],
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
  /** The treatment every insert in this style wears. */
  /*
   * One treatment, or a vocabulary to cycle.
   *
   * A style used to name a single overlay and every insert in the video wore
   * it, which is the same all-or-nothing shape the B-roll source had: a video
   * where all eleven inserts are grained reads as a filter applied to the
   * whole edit rather than as a treatment chosen per shot. A list cycles the
   * way `clipTransitions` does, so consecutive inserts differ inside one
   * coherent set and the same footage re-cuts the same way.
   */
  overlay: Edl['broll'][number]['overlay'] | Array<Edl['broll'][number]['overlay']>,
  /** The video's accent, for the treatments that recolour the picture. */
  accent: string,
  /** The style's vocabulary of enter/exit moves, cycled per insert. */
  transitions: readonly ClipTransition[],
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
      /*
       * Cycled through the style's vocabulary rather than fixed.
       *
       * One transition for every insert in a video reads as a template; a
       * different one each time reads as random. Cycling a style's short list
       * gives consecutive inserts different moves out of one coherent set, and
       * it is deterministic, so re-running the same footage gives the same
       * edit.
       */
      enter: transitions[clips.length % transitions.length],
      // The same move, so the insert travels in one direction through its
      // whole life: in from the right, out past the left.
      exit: transitions[clips.length % transitions.length],
      kind: cue.kind,
      url: '', // resolved by the asset stage
      clipStartSec: 0,
      scale: 1,
      kenBurns: cue.kind === 'stock-video' ? 'none' : 'in',
      audioGainDb: -60, // speech keeps playing underneath, always
      opacity: 1,
      intent: cue.intent,
      query: cue.query,
      overlay: Array.isArray(overlay) ? overlay[clips.length % overlay.length] : overlay,
      accent,
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

/* ---------------------------------------------------------------- scenes */

/**
 * Put the chosen scenes on the finished timeline.
 *
 * The pass chose passages in the SOURCE, and by the time we get here the cut
 * has removed some of what was between them, so every boundary has to be
 * mapped. A scene that kept its source timestamps would drift further out of
 * sync with the voice with every removal before it — and a faceless scene that
 * is out of sync with the voice is the whole feature failing.
 */
export function placeScenes(
  planned: PlannedScene[],
  mapper: TimeMapper,
  durationSec: number,
  broll: BrollClip[],
  accent: string,
  look: SceneLook,
  /** The style's signature move. Null leaves it to the look's own entry. */
  signature: ClipTransition | null = null,
): AnimatedScene[] {
  const scenes: AnimatedScene[] = [];

  for (const cue of planned) {
    const start = mapper.toOutputClamped(cue.startSec);
    const end = Math.min(durationSec - 0.2, mapper.toOutputClamped(cue.endSec));
    // The cut may have removed most of the passage this scene was chosen for,
    // in which case there is no longer a moment to cover.
    if (end - start < 1.6) continue;

    // A scene already replaces the frame; B-roll under it would never be seen.
    if (broll.some((b) => start < b.outEndSec && end > b.outStartSec)) continue;
    if (scenes.some((s) => start < s.outEndSec + 1 && end > s.outStartSec - 1)) continue;

    scenes.push({
      id: `scene-${scenes.length}`,
      outStartSec: start,
      outEndSec: end,
      // The style's signature move, not a rotating one: a scene takes the
      // whole frame, and the two or three in a video should arrive the same
      // way as each other.
      enter: signature,
      exit: signature,
      kind: cue.kind,
      look,
      backdrop: cue.backdrop,
      headline: cue.headline,
      items: cue.items,
      iconQueries: cue.iconQueries,
      // Drawn later, in the assets stage: the selection pass says WHERE and
      // WHAT, the illustration pass draws it.
      art: null,
      // Fetched later, in the asset stage — this is the deterministic half.
      iconSvgs: cue.iconQueries.map(() => null),
      photoUrls: cue.items.map(() => null),
      accent,
      reason: cue.reason,
    });
  }

  return scenes;
}

/* ------------------------------------------------------------- icon cards */

/** How long a row sits after its last card lands. */
const ICON_HOLD_SEC = 2;

/**
 * Cards this close together belong to the same row.
 *
 * Wider than it was, and the reason is the count below. A row rising from the
 * floor has to have three cards, so the window has to be long enough that
 * three nouns in the same breath actually land in the same row — at 2.5s a
 * sentence with its objects spread across it produced a two and a one, and
 * under the hard count that is one row and one discard rather than one row.
 */
const ICON_ROW_WINDOW_SEC = 5;

/** Three side by side is the most a vertical frame can hold and stay readable. */
const ICON_ROW_MAX = 3;

/**
 * The icon cards, snapped to the words that earn them.
 *
 * ── Snapping, and why it is the whole job ───────────────────────────────
 *
 * A card that lands a few frames off the word does not read as "slightly
 * late", it reads as broken — the eye is very good at this, which is why the
 * effect works at all. The director's `atSec` is a reading of the transcript
 * and is routinely a tenth of a second out; the transcript's own word
 * timestamps are not. So the director names the WORD, and the real moment is
 * looked up here.
 *
 * ── Rows ────────────────────────────────────────────────────────────────
 *
 * Cards said close together are one row that arrives one card at a time and
 * leaves all at once, because that is what the sentence does: "bananas and
 * apples" is one thought with two nouns in it. Grouping here rather than in
 * the director is deliberate — it is bookkeeping, it has an exact answer, and
 * a model asked to do it will sometimes put the apple in its own row.
 */
function placeIcons(
  plan: DirectorPlan,
  transcript: Transcript,
  mapper: TimeMapper,
  durationSec: number,
  broll: BrollClip[],
  graphics: GraphicElement[],
  scenes: AnimatedScene[],
  tone: 'light' | 'dark',
  dimensions: { width: number; height: number },
): IconCue[] {
  const placed: Array<{ atSec: number; word: string; query: string }> = [];

  for (const cue of plan.icons) {
    if (!cue.query.trim()) continue;

    const sourceSec = snapToWord(transcript, cue.word, cue.atSec);
    const at = mapper.toOutput(sourceSec);
    // `toOutput` returns null for a moment that was cut away. A card for a
    // sentence the edit removed is not a card with bad timing, it is a card
    // for something the viewer never hears.
    if (at === null || at < 0.2 || at > durationSec - 0.8) continue;

    // Three layers already own the frame when they are up. A card over any of
    // them is a second focal point competing with the first.
    if (broll.some((b) => at >= b.outStartSec - 0.2 && at <= b.outEndSec + 0.2)) continue;
    if (scenes.some((sc) => at >= sc.outStartSec - 0.2 && at <= sc.outEndSec + 0.2)) continue;
    if (graphics.some((g) => at >= g.outStartSec - 0.4 && at <= g.outEndSec + 0.4)) continue;

    // Two cards on the same word is the same card twice.
    if (placed.some((other) => Math.abs(other.atSec - at) < 0.25)) continue;

    placed.push({ atSec: at, word: cue.word, query: cue.query.trim() });
  }

  placed.sort((a, b) => a.atSec - b.atSec);

  /* ------------------------------- into rows ------------------------------ */

  const rows: Array<typeof placed> = [];
  for (const card of placed) {
    const row = rows[rows.length - 1];
    const previous = row?.[row.length - 1];
    if (row && previous && card.atSec - previous.atSec <= ICON_ROW_WINDOW_SEC && row.length < ICON_ROW_MAX) {
      row.push(card);
    } else {
      rows.push([card]);
    }
  }

  /*
   * ── How many cards there are decides where they go ──────────────────────
   *
   * A full set of three is a GROUP, and a group belongs on the horizontal:
   * side by side, centred, rising out of the floor under the words. That is
   * the shape the effect was designed around and it reads the same in either
   * aspect — three across the middle is balanced, and stacking them in a
   * column beside the subject makes a list out of something that is not one.
   *
   * One or two cards are not a group, and from the floor they look like a
   * group that failed to arrive — one on its own reads as something that
   * happened rather than something designed, and two read as a third that
   * did not load. Those go out to the side instead, where a single big card in
   * an empty margin is a deliberate-looking thing on its own.
   *
   * Which leaves the case with nowhere to put them: a vertical frame has no
   * margin, because the subject fills it. There a short row is dropped.
   */
  const roomBeside = hasSideRoom(dimensions.width, dimensions.height);
  const usable = rows.filter((row) => row.length === ICON_ROW_BELOW_COUNT || roomBeside);

  /*
   * And short rows alternate sides.
   *
   * Counted over the rows that actually take a side, not over all of them, so
   * a three-card group in between does not silently eat a turn and leave two
   * consecutive singles stacked in the same margin.
   */
  let sidesTaken = 0;

  return usable
    .map((row, index) => {
      const side: IconSide =
        row.length === ICON_ROW_BELOW_COUNT ? 'below' : sidesTaken++ % 2 === 0 ? 'right' : 'left';
      return { row, index, side };
    })
    .map(({ row, index, side }) => {
      const outStartSec = row[0].atSec;
      const last = row[row.length - 1].atSec;
      const next = usable[index + 1]?.[0]?.atSec ?? Infinity;

      /*
       * And it leaves before anything takes the frame off it.
       *
       * Each CARD is already kept out of a B-roll insert or a scene, but the
       * row outlives its last card by `ICON_HOLD_SEC`, and nothing was
       * checking where that hold ended. So a row whose cards all landed safely
       * in the clear could still be sitting there two seconds later when the
       * insert cut in — which is how three icons ended up parked on top of a
       * full-frame shot, holding through the whole of it.
       */
      const covered = [...broll, ...scenes]
        .map((clip) => clip.outStartSec)
        .filter((startsAt) => startsAt > outStartSec);
      const takenOver = covered.length ? Math.min(...covered) : Infinity;

      // A row leaves before the next one arrives, and never overruns the edit.
      const outEndSec = Math.min(last + ICON_HOLD_SEC, next - 0.3, takenOver - 0.2, durationSec - 0.1);

      return {
        id: `icon-${index}`,
        outStartSec,
        outEndSec,
        // Under the captions, or out in the side margin — see `iconRowPlacement`.
        ...(({ x, y }) => ({ x, y }))(
          iconRowPlacement(row.length, dimensions.width, dimensions.height, side),
        ),
        side,
        tone,
        cards: row.map((card) => ({
          // Relative to the row, so dragging it on the timeline keeps the
          // cards' spacing instead of leaving them behind.
          offsetSec: Math.max(0, card.atSec - outStartSec),
          word: card.word,
          query: card.query,
          /*
           * Labelled only where the picture cannot say it on its own.
           *
           * A glyph beside the word that was just spoken needs no caption —
           * that is the scene saying the same thing twice in two sizes, and
           * it is why the rule was no type at all. A PROPER NOUN is the other
           * case: nobody reads "Gemini" off a four-pointed star, and a brand
           * icon without its name is a logo quiz.
           */
          label: isProperNoun(card.word) ? card.word : '',
          markup: null,
          iconId: '',
        })),
      };
    })
    // A row that has to leave almost as soon as it lands is a flicker. Better
    // no card than one the viewer only half sees.
    .filter((cue) => cue.outEndSec - cue.outStartSec >= 0.7);
}

/**
 * The real timestamp of the word the director named.
 *
 * Searched around the director's own guess rather than across the whole
 * transcript, because a common word said six times would otherwise snap to the
 * first one — which is a card in the wrong sentence, and worse than the small
 * error it was fixing. Nothing found within the window means the guess stands.
 */
export function snapToWord(transcript: Transcript, word: string, nearSec: number): number {
  const wanted = word.trim().toLowerCase().replace(/[^a-z0-9']/g, '');
  if (!wanted) return nearSec;

  const WINDOW_SEC = 2;
  let best: { startSec: number; distance: number } | null = null;

  for (const candidate of transcript.words) {
    const distance = Math.abs(candidate.startSec - nearSec);
    if (distance > WINDOW_SEC) continue;
    const text = candidate.text.toLowerCase().replace(/[^a-z0-9']/g, '');
    // `startsWith` both ways, so "banana" matches the spoken "bananas" and a
    // director who wrote "bananas" matches a spoken "banana".
    if (!text || !(text.startsWith(wanted) || wanted.startsWith(text))) continue;
    if (!best || distance < best.distance) best = { startSec: candidate.startSec, distance };
  }

  return best?.startSec ?? nearSec;
}

/* -------------------------------------------------------------- graphics */

function placeGraphics(
  plan: DirectorPlan,
  mapper: TimeMapper,
  durationSec: number,
  broll: BrollClip[],
  accent: string,
  frame: { width: number; height: number },
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
      // The director's choice wins; `animationFor` is the fallback, and is
      // what runs for the (common) case where it did not express one.
      animation: cue.animation ?? animationFor(cue.type),
      ...positionFor(cue.type, frame),
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
    // The moving graphics carry their own motion, so the entrance has to stay
    // out of its way: a counter that also springs is two animations fighting
    // over the same second. They come up quietly and let the move be the move.
    case 'counter': return 'fade';
    case 'progress-ring': return 'fade';
    case 'bar-chart': return 'slide-up';
    case 'checklist': return 'fade';
    case 'underline': return 'fade';
    case 'badge': return 'bounce';
    case 'icon': return 'spin-in';
    default: return 'pop';
  }
}

/**
 * The graphics that move out to the side when there is a side to move to.
 *
 * A number is a small, self-contained object: it reads perfectly well in a
 * column beside the subject, and putting it there gets it off their face. The
 * ones left out are left out for a reason — a list, a quote and a checklist
 * are blocks of TEXT whose line length is the thing that makes them readable,
 * and squeezing them into a third of the frame sets them four words to a line;
 * an underline has to stay with the word it underlines; a title card is the
 * whole frame by definition; and an arrow already points from somewhere.
 */
const SIDE_GRAPHICS = new Set<GraphicElement['type']>([
  'stat', 'counter', 'progress-ring', 'badge', 'bar-chart',
]);

/** Where a side-placed graphic sits: out in the margin, above the middle. */
const GRAPHIC_SIDE_X = 0.79;
const GRAPHIC_SIDE_Y = 0.36;

/**
 * Keeps graphics clear of the caption band and the speaker's face.
 *
 * In a widescreen frame "clear of the speaker's face" stops meaning ABOVE it
 * and starts meaning BESIDE it. The subject is framed centrally whatever the
 * aspect, so a 16:9 picture has two empty columns either side of them while a
 * 9:16 picture has none — and a number pinned to the horizontal centre of a
 * wide frame is a number sitting on top of the person talking.
 */
function positionFor(
  type: GraphicElement['type'],
  frame: { width: number; height: number },
): { x: number; y: number } {
  if (hasSideRoom(frame.width, frame.height) && SIDE_GRAPHICS.has(type)) {
    return { x: GRAPHIC_SIDE_X, y: GRAPHIC_SIDE_Y };
  }

  switch (type) {
    case 'title-card': return { x: 0.5, y: 0.5 };
    case 'list': return { x: 0.5, y: 0.34 };
    case 'stat': return { x: 0.5, y: 0.24 };
    case 'counter': return { x: 0.5, y: 0.26 };
    case 'progress-ring': return { x: 0.5, y: 0.27 };
    case 'bar-chart': return { x: 0.5, y: 0.32 };
    case 'checklist': return { x: 0.5, y: 0.33 };
    case 'badge': return { x: 0.5, y: 0.18 };
    case 'underline': return { x: 0.5, y: 0.3 };
    case 'quote': return { x: 0.5, y: 0.42 };
    case 'arrow': return { x: 0.68, y: 0.4 };
    default: return { x: 0.76, y: 0.22 };
  }
}

/* ------------------------------------------------------------- punch-ins */

/**
 * The camera moves, placed from the script rather than on a clock.
 *
 * `punchMoments` decides WHICH moments and which move; this decides where the
 * camera is pointing and how far it goes, because this is the layer that
 * knows where the face is and what the style's travel is.
 *
 * The director's own cues come in as HINTS, not as placements. It read the
 * whole transcript and sometimes knows which line is the one, which is worth
 * a thumb on the scale — but a model asked for timestamps returns a spread,
 * and a spread is the metronome this was built to stop.
 */
function placePunchIns(
  plan: DirectorPlan,
  mapper: TimeMapper,
  transcript: Transcript,
  durationSec: number,
  busy: Busy[],
  scaleRange: [number, number],
  reframe: Edl['reframe'],
  moves: PunchMove[],
  cadenceSec: [number, number],
): PunchIn[] {
  // Punch in toward the face when we know where it is.
  const focus = reframe?.keyframes[0] ?? { cx: 0.5, cy: 0.42 };

  /*
   * Sentences in OUTPUT seconds, and only the ones that survived the cut.
   *
   * A sentence the silence pass removed has no time on this timeline at all,
   * and `toOutputClamped` would pin it to the nearest surviving frame — which
   * is how you get three punch-ins stacked on one moment.
   */
  const sentences = transcript.sentences
    .map((s) => ({
      ...s,
      startSec: mapper.toOutput(s.startSec),
      endSec: mapper.toOutput(s.endSec),
    }))
    .filter((s): s is typeof s & { startSec: number; endSec: number } =>
      s.startSec !== null && s.endSec !== null && s.endSec > s.startSec);

  const moments = punchMoments({
    sentences,
    busy,
    hints: plan.punchIns.map((cue) => mapper.toOutputClamped(cue.atSec)),
    palette: moves,
    cadenceSec,
    durationSec,
    // The opening is the speaker earning attention. The same number the
    // scene director is held to, for the same reason.
    hookSec: 2.5,
  });

  return moments.map((moment, i) => ({
    id: `punch-${i}`,
    outStartSec: moment.startSec,
    outEndSec: moment.endSec,
    // Strength is the signal's, so the hardest emphasis in the script gets
    // the most travel the style allows and an ambient drift gets the least.
    scale: scaleRange[0] + (scaleRange[1] - scaleRange[0]) * moment.strength,
    x: focus.cx,
    y: focus.cy,
    move: moment.move,
    reason: moment.reason,
  }));
}

/**
 * A word that names something rather than describing it.
 *
 * Capitalised mid-sentence is the whole test. It is the one signal a
 * transcript actually carries — ASR capitalises brands and product names and
 * leaves ordinary nouns alone — and it is right far more often than a list of
 * known brands would be, which would be out of date the week after it shipped.
 */
export function isProperNoun(word: string): boolean {
  const trimmed = word.trim();
  if (trimmed.length < 2 || trimmed.length > 18) return false;
  if (!/^[A-Z]/.test(trimmed)) return false;
  // All caps is usually the transcript shouting, or an acronym the icon
  // library had no hope of matching anyway.
  return trimmed !== trimmed.toUpperCase();
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
  icons: IconCue[],
  frame: { width: number; height: number },
  sfxDensity: number,
): SfxCue[] {
  const cues: SfxCue[] = [];
  const push = (atSec: number, sound: SfxCue['sound'], gainDb: number, reason: string) => {
    if (atSec < 0.05 || atSec > durationSec - 0.05) return;
    // Two effects within 150 ms is a click, not punctuation.
    if (cues.some((c) => Math.abs(c.atSec - atSec) < 0.15)) return;
    cues.push({ id: `sfx-${cues.length}`, atSec, sound, gainDb, reason });
  };

  // Director-chosen cues first — they have the context, and where one of them
  // collides with a structural cue below it is the structural one that goes.
  for (const cue of plan.sfx) push(mapper.toOutputClamped(cue.atSec), cue.sound, -14, 'chosen by the edit');
  // Then the structural ones the director can't see, because they depend on cuts.
  for (const t of transitions) {
    push(t.atSec, t.type === 'zoom-punch' ? 'impact' : 'whoosh', -15, `${t.type} between shots`);
  }
  for (const g of graphics) if (g.type !== 'title-card') push(g.outStartSec, 'pop', -17, `${g.type} appears`);

  /*
   * And the ones that belong to a MOVE.
   *
   * This used to be one line — a swipe on every insert's entrance, whatever
   * the insert actually did — so a glitch got a swipe, a fade got a swipe, and
   * nothing at all marked an insert LEAVING. The sound now comes from the
   * transition, lands where that transition starts, and is silent for the two
   * transitions that are supposed to be silent. See `sfx-cues.ts`.
   */
  /*
   * `sfxDensity` is the style's request for restraint, and it is also what
   * makes long form quieter than short without a `mode` check anywhere in
   * here: every style's long profile asks for about half the density of its
   * short one. Half the density drops the icon accents first and the soft
   * transitions next, and never the full-frame moves — see `cuesForDensity`.
   */
  for (const cue of thinCues(cuesForDensity(transitionCues(broll, icons, frame), sfxDensity))) {
    push(cue.atSec, cue.sound, sfxDefaultGain(cue.sound as SfxName) + cue.gainTrimDb, cue.reason);
  }

  return cues.sort((a, b) => a.atSec - b.atSec);
}

/* --------------------------------------------------------------- overlays */

function placeOverlays(
  input: BuildEdlInput,
  plan: DirectorPlan,
  mapper: TimeMapper,
  durationSec: number,
  dimensions: { width: number; height: number },
): OverlayElement[] {
  const overlays: OverlayElement[] = [];
  const { overlays: enabled } = input.style;

  /*
   * The burned-in progress bar is a SHORT-form device.
   *
   * It exists because a vertical feed has no scrubber: the viewer cannot see
   * how much is left, so drawing it buys real retention. A long-form video is
   * watched inside a player that already has one, in the same place, over the
   * same pixels — so the second bar is not a retention trick there, it is a
   * duplicate sitting under YouTube's own, and the instant the controls fade
   * in they cover it. Six of the ten long-form styles asked for one.
   */
  if (enabled.progressBar && !hasPlayerChrome(dimensions.width, dimensions.height)) {
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

  /*
   * Chapters are a long-form device.
   *
   * A section break is how a viewer navigates twenty minutes; in a forty-second
   * short it is a title card interrupting the only thought the video has. The
   * rule-based director only emits them for long form, but the schema the AI
   * director answers against does not care, so the guard belongs here too.
   */
  for (const chapter of hasPlayerChrome(dimensions.width, dimensions.height) ? plan.chapters : []) {
    const atSec = mapper.toOutputClamped(chapter.atSec);
    if (atSec < 3 || atSec > durationSec - 6) continue;
    overlays.push({
      id: `overlay-chapter-${overlays.length}`,
      type: 'chapter-card',
      outStartSec: atSec,
      outEndSec: atSec + 2.4,
      // One line, so it is capped here rather than left to the renderer to
      // clip: the director writes these and nothing bounds their length.
      text: trimToWords(chapter.title, 52),
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
