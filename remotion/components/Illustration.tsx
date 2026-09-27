import React from 'react';
import { useCurrentFrame } from 'remotion';
import type { ArtIdle, ArtPart, Illustration as Art } from '../../src/lib/assets/illustration';
import { easeOutCubic, easeOutExpo, easeOutSoftBack, kf, stagger } from '../lib/motion';
import { seeded } from '../lib/timing';

/**
 * The drawing: a sequence of beats the camera travels through.
 *
 * ── The two notes this answers ──────────────────────────────────────────
 *
 * First: "it should not be like a still image… it's sitting there until the
 * motion graphics finish." Answered by the camera and the idle motion below,
 * which never stop.
 *
 * Then: "it's just an animated picture. It should make an arrow go down, and
 * the thing that was on screen swipes up and away, and down there is the next
 * thing." That one is structural, and it is the difference between a picture
 * that moves and a scene that HAPPENS.
 *
 * So a drawing is no longer one composition. It is a tall canvas with its
 * beats stacked down it — beat 0 in the top 1000 units, beat 1 in the next
 * 1000 — and the camera travels down it as the voice moves on. Nothing fades
 * out: the previous beat leaves upward because the camera left it behind,
 * which is exactly what the reference edits do, and it is why they read as
 * something happening rather than as a slide changing.
 *
 * Three layers of motion, and only the first ends:
 *
 *   1. **Entry.** Each piece of a beat arrives, five frames after the last.
 *   2. **Travel.** The camera pans from beat to beat, and pushes in slowly the
 *      whole time it is on any of them. It never settles — the instant it
 *      stops, the frame reads as a photograph.
 *   3. **Idle.** A piece that has landed keeps moving on its own.
 *
 * Parallax ties them together: each piece carries a depth, and the camera's
 * drift is multiplied by it, so near things travel further than far things.
 *
 * ── What it will not do ─────────────────────────────────────────────────
 *
 * Every value below is a transform or an opacity, and the markup is inlined
 * rather than loaded. No filters on moving groups — a drop shadow on something
 * that moves is a per-frame re-rasterise of the whole drawing, and this
 * renderer has paid for that mistake once already at ten frames a second. And
 * Remotion's `<Img>` cannot decode an SVG in headless Chromium, so an
 * illustration loaded as an image would render in the editor and not in the
 * export, which is the worst failure this layer could have.
 */

export type { Illustration as Art } from '../../src/lib/assets/illustration';

/** Frames between one piece of a beat landing and the next starting. */
const PART_STAGGER = 5;

/** How long a piece takes to arrive. */
const ENTER_FRAMES = 12;

/**
 * The pan between two beats.
 *
 * Short on purpose. The camera crosses the boundary between two squares, and
 * however continuous the backdrop is, the moment in the middle belongs to
 * neither beat — so it wants to be over quickly. Fourteen frames read as a
 * dissolve through an empty frame; ten reads as a move.
 */
const TRAVEL_FRAMES = 10;

export const Illustration: React.FC<{
  art: Art;
  /** Frame the first beat starts on, relative to the scene. */
  at: number;
  /** Rendered width and height, in pixels. */
  size: number;
  /** How long the scene runs, so the beats can be paced across all of it. */
  durationInFrames: number;
  /** Anything seeded — drift direction, idle phases — hangs off this. */
  seed: string;
}> = ({ art, at, size, durationInFrames, seed }) => {
  const frame = useCurrentFrame();

  /*
   * The window is ONE beat, not the whole strip.
   *
   * The drawing's viewBox spans every beat stacked vertically; what the viewer
   * sees is a square window onto it, and the camera slides the content under
   * that window. Rendering the whole strip would draw three beats at a third
   * of the size each, which is the bug you get for free if you pass the
   * drawing's own viewBox straight through.
   */
  const [minX, minY, width] = parseViewBox(art.viewBox);
  const band = bandHeight(art, width);
  const cx = minX + width / 2;

  const plan = planStages(art.stages, at, durationInFrames);
  const camera = cameraAt(frame, plan, band, width, seed);

  return (
    <svg
      viewBox={`${minX} ${minY} ${width} ${band}`}
      width={size}
      height={size}
      style={{ overflow: 'hidden', display: 'block' }}
    >
      {/*
        Gradients first, and outside the camera group: a `<defs>` is never
        painted, so transforming it would cost a group for nothing, and a
        gradient defined after the shape that references it still resolves.
      */}
      {art.defs ? <defs dangerouslySetInnerHTML={{ __html: art.defs }} /> : null}
      {/*
        The camera is one group around everything, not a transform per part: a
        push applied per part would scale each piece about its own centre and
        the composition would come apart as it zoomed. The push is taken about
        the middle of the beat CURRENTLY under the window, which is the pan
        offset plus half a band — otherwise beat three zooms toward beat one.
      */}
      <g
        transform={
          `translate(0 ${(-camera.y).toFixed(2)}) ` +
          about(cx, minY + camera.y + band / 2, `scale(${camera.scale.toFixed(4)})`)
        }
      >
        {art.parts.map((part, i) => (
          <Part
            key={i}
            part={part}
            index={i}
            at={partStartsAt(art, part, i, plan)}
            frame={frame}
            camera={camera}
            band={band}
            width={width}
            seed={seed}
          />
        ))}
      </g>
    </svg>
  );
};

/* ------------------------------------------------------------------ beats */

interface StagePlan {
  /** Frame each beat takes over on. */
  startsAt: number[];
  /** How long each beat holds, travel included. */
  length: number;
}

/**
 * When each beat gets the screen.
 *
 * Evenly, because the drawing does not know what is being said over which part
 * of it — and an uneven split guessed from part counts is worse than no guess,
 * since a beat with one big object in it needs as long to read as a beat with
 * four small ones.
 */
function planStages(stages: number, at: number, durationInFrames: number): StagePlan {
  const count = Math.max(1, stages);
  // The last beat keeps a moment of its own at the end rather than running to
  // the cut, so the scene never leaves mid-move.
  const usable = Math.max(count * (TRAVEL_FRAMES + 10), durationInFrames - at - 6);
  const length = usable / count;
  return { startsAt: Array.from({ length: count }, (_, i) => at + i * length), length };
}

/**
 * When a piece arrives, which is not simply its beat's start.
 *
 * A connector — the arrow that leads down to the next beat — has to be drawn
 * BEFORE the camera follows it, or it explains a move that already happened.
 * So it starts most of the way through its own beat, just ahead of the travel.
 * Everything else staggers from the top of the beat.
 */
function partStartsAt(art: Art, part: ArtPart, index: number, plan: StagePlan): number {
  const start = plan.startsAt[Math.min(part.stage, plan.startsAt.length - 1)];
  if (part.enter === 'draw' && part.stage < art.stages - 1) {
    return start + plan.length * 0.62;
  }
  /*
   * A beat's pieces start arriving DURING the pan, not after it.
   *
   * Waiting for the camera to land means the viewer watches an empty square
   * slide into place and then fill up, which is two events where there should
   * be one. Starting them three frames in means the beat is already forming as
   * it arrives — the way a whip pan onto a set that is already dressed reads.
   */
  const within = art.parts.filter((other) => other.stage === part.stage).indexOf(part);
  const lead = part.stage === 0 ? 0 : 3;
  return start + lead + stagger(within < 0 ? index : within, PART_STAGGER);
}

interface Camera {
  scale: number;
  /** Where the camera has travelled to down the strip, in viewBox units. */
  y: number;
  /** Drift within the current beat, which parallax is measured against. */
  driftX: number;
  driftY: number;
}

/**
 * The move that never stops.
 *
 * Two motions added together: a pan that steps from beat to beat, and a push
 * and drift that runs continuously underneath it. The push is deliberately not
 * a keyframe table — a table implies an end, and this is the one thing in the
 * renderer that must still be going when the scene cuts away.
 */
function cameraAt(frame: number, plan: StagePlan, band: number, width: number, seed: string): Camera {
  let stage = 0;
  for (let i = plan.startsAt.length - 1; i >= 0; i--) {
    if (frame >= plan.startsAt[i]) {
      stage = i;
      break;
    }
  }

  /*
   * The pan: expo out, so it leaves hard and arrives soft.
   *
   * That asymmetry is what makes the outgoing beat read as being LEFT BEHIND
   * rather than as sliding away politely — the same curve every whip pan in
   * the reference edits uses.
   */
  const travel =
    stage === 0
      ? 0
      : kf(
          frame,
          [
            [plan.startsAt[stage], stage - 1],
            [plan.startsAt[stage] + TRAVEL_FRAMES, stage],
          ],
          easeOutExpo,
        );

  const into = Math.min(1, Math.max(0, frame - plan.startsAt[stage]) / Math.max(1, plan.length));
  const angle = seeded(seed, stage) * Math.PI * 2;

  return {
    // Resets each beat: a push that accumulated across three beats would end
    // the scene cropped into a corner of the last one.
    scale: 1.02 + into * 0.1,
    y: travel * band,
    driftX: Math.cos(angle) * width * 0.07 * into,
    driftY: Math.sin(angle) * band * 0.05 * into,
  };
}

/**
 * One beat's height.
 *
 * A model that claims three beats but draws a square canvas has put them side
 * by side or on top of each other; showing a third of that square would crop
 * the drawing to a letterbox slot. Where the arithmetic gives a band that is
 * far from square, the canvas is trusted over the claim.
 */
function bandHeight(art: Art, width: number): number {
  const [, , , height] = parseViewBox(art.viewBox);
  const stages = Math.max(1, art.stages);
  const band = height / stages;
  return band > width * 0.55 ? band : height;
}

/* ------------------------------------------------------------------ parts */

const Part: React.FC<{
  part: ArtPart;
  index: number;
  at: number;
  frame: number;
  camera: Camera;
  width: number;
  band: number;
  seed: string;
}> = ({ part, index, at, frame, camera, width, band, seed }) => {
  const entry = enterOf(part, frame, at, width, band);

  /*
   * Parallax: the camera's drift, weighted by how near the piece is.
   *
   * Depth 0.5 is the picture plane and moves with the camera exactly; a
   * foreground piece overshoots it and a background piece lags, which is the
   * whole of the effect. Scaled small — a strong parallax on a 1000-unit
   * canvas tears the composition apart within a second.
   */
  const lean = (part.depth - 0.5) * 1.5;
  const parallaxX = -camera.driftX * lean;
  const parallaxY = -camera.driftY * lean;

  const idle = idleOf(part.idle, frame, at, index, width, band, seed);

  /*
   * Everything pivots on the PIECE, not on the canvas.
   *
   * Using the drawing's centre here is a mistake you only see once and then
   * cannot unsee: a `spin` on a small object in the corner does not turn the
   * object, it swings it around the whole picture in a wide circle, and a part
   * popping in appears to slide out of the middle of the frame.
   */
  const transform = about(
    part.pivot.x,
    part.pivot.y,
    `translate(${(entry.x + parallaxX + idle.x).toFixed(2)} ${(entry.y + parallaxY + idle.y).toFixed(2)})` +
      ` scale(${(entry.scale * idle.scale).toFixed(4)})` +
      ` rotate(${(entry.rotate + idle.rotate).toFixed(3)})`,
  );

  // A self-drawing stroke: `pathLength="1"` was injected at parse time, so one
  // dash is the whole line and the offset walks it on from end to end.
  const drawing =
    part.enter === 'draw'
      ? {
          strokeDasharray: 1,
          strokeDashoffset: kf(frame, [[at, 1], [at + ENTER_FRAMES + 6, 0]], easeOutCubic),
        }
      : undefined;

  return (
    <g
      opacity={entry.opacity}
      transform={transform}
      style={drawing}
      dangerouslySetInnerHTML={{ __html: part.markup }}
    />
  );
};

interface Pose {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotate: number;
}

/** How a piece arrives, per the hint it was drawn with. */
function enterOf(part: ArtPart, frame: number, at: number, width: number, band: number): Pose {
  const t = kf(frame, [[at, 0], [at + ENTER_FRAMES, 1]], part.enter === 'grow' ? easeOutCubic : easeOutSoftBack);
  const fade = kf(frame, [[at, 0], [at + Math.round(ENTER_FRAMES * 0.5), 1]], easeOutCubic);
  const rest: Pose = { opacity: fade, x: 0, y: 0, scale: 1, rotate: 0 };

  switch (part.enter) {
    case 'rise':
      return { ...rest, y: band * 0.09 * (1 - t) };
    case 'slide-left':
      return { ...rest, x: width * 0.2 * (1 - t) };
    case 'slide-right':
      return { ...rest, x: -width * 0.2 * (1 - t) };
    case 'grow':
      return { ...rest, scale: 0.4 + 0.6 * t };
    case 'draw':
      // The stroke reveals itself; moving it as well reads as two effects on
      // one element, and the line ends up arriving twice.
      return { ...rest, opacity: kf(frame, [[at, 0], [at + 3, 1]], easeOutCubic) };
    case 'pop':
    default:
      return { ...rest, scale: 0.86 + 0.14 * t };
  }
}

/**
 * What a piece does for the rest of its beat.
 *
 * Periods are seeded per part, so four pieces bobbing together never sync up
 * into one pulsing blob — which is what a shared clock produces and it looks
 * far worse than no idle at all.
 */
function idleOf(
  kind: ArtIdle,
  frame: number,
  at: number,
  index: number,
  width: number,
  band: number,
  seed: string,
): Pose {
  const rest: Pose = { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 };
  if (kind === 'none') return rest;

  // Fades in as the piece settles: a part still arriving should not also be
  // drifting, or the entry stops reading as an entry.
  const strength = kf(frame, [[at + ENTER_FRAMES, 0], [at + ENTER_FRAMES + 12, 1]], easeOutCubic);
  if (strength <= 0) return rest;

  const phase = seeded(seed, index + 11) * Math.PI * 2;
  // Short enough that a full cycle happens inside a three-second beat: a
  // ninety-frame period on a ninety-frame beat is a slow slide, not a float.
  const period = 38 + seeded(seed, index + 23) * 26;
  const wave = Math.sin((frame / period) * Math.PI * 2 + phase);

  switch (kind) {
    case 'bob':
      return { ...rest, y: wave * band * 0.022 * strength };
    case 'drift':
      return {
        ...rest,
        x: wave * width * 0.026 * strength,
        y: Math.cos((frame / (period * 1.3)) * Math.PI * 2 + phase) * band * 0.016 * strength,
      };
    case 'sway':
      return { ...rest, rotate: wave * 2.4 * strength };
    case 'pulse':
      return { ...rest, scale: 1 + wave * 0.035 * strength };
    case 'tick': {
      /*
       * A hand, not a turntable.
       *
       * Real hands step and overshoot. A smooth rotation on a clock is the
       * single clearest tell that a "clock" is a disc with lines on it, and it
       * was the first thing wrong with ours. Six degrees a step, ten frames
       * apart, settling hard.
       */
      const step = Math.floor((frame - at) / 10);
      const intoStep = ((frame - at) % 10) / 10;
      const settle = 1 - Math.pow(1 - Math.min(1, intoStep * 2.2), 3);
      return { ...rest, rotate: (step + settle) * 6 * strength };
    }
    case 'spin':
      // Continuous, not a wave: a gear, a loading ring, a globe.
      return { ...rest, rotate: (frame - at) * 1.2 * strength };
    default:
      return rest;
  }
}

/** When the first beat has assembled, so a caption knows where to start. */
export function artSettlesAt(art: Art, at: number): number {
  const first = art.parts.filter((part) => part.stage === 0).length || art.parts.length;
  return at + stagger(Math.max(0, first - 1), PART_STAGGER) + ENTER_FRAMES;
}

/**
 * Which beat is on screen at a frame, so a caption can change with it.
 *
 * Exported rather than worked out by the caller, because the pacing lives here
 * and two implementations of it would drift apart the first time either moved.
 */
export function stageAt(art: Art, at: number, durationInFrames: number, frame: number): number {
  const plan = planStages(art.stages, at, durationInFrames);
  for (let i = plan.startsAt.length - 1; i >= 0; i--) {
    if (frame >= plan.startsAt[i]) return i;
  }
  return 0;
}

/**
 * The frame a beat takes over on.
 *
 * A caption that changes with the beat has to animate IN on that frame — a
 * `key` remount alone is not enough, because the look's slots read the scene's
 * own frame counter and would find the entry long finished.
 */
export function stageStartsAt(art: Art, at: number, durationInFrames: number, stage: number): number {
  const plan = planStages(art.stages, at, durationInFrames);
  return plan.startsAt[Math.min(Math.max(0, stage), plan.startsAt.length - 1)];
}

/** `transform` about a point, which SVG has no shorthand for. */
function about(cx: number, cy: number, inner: string): string {
  return `translate(${cx} ${cy}) ${inner} translate(${-cx} ${-cy})`;
}

function parseViewBox(viewBox: string): [number, number, number, number] {
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  // A malformed viewBox would otherwise put NaN into every transform above and
  // the whole drawing would silently vanish.
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return [0, 0, 1000, 1000];
  return parts as [number, number, number, number];
}
