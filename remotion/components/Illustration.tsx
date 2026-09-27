import React from 'react';
import { useCurrentFrame } from 'remotion';
import type { ArtIdle, ArtPart, Illustration as Art } from '../../src/lib/assets/illustration';
import { easeOutCubic, easeOutSoftBack, kf, stagger } from '../lib/motion';
import { seeded } from '../lib/timing';

/**
 * The drawing, arriving in pieces and then refusing to sit still.
 *
 * ── The note this was rebuilt to answer ─────────────────────────────────
 *
 * "It should not be like a still image. It's just an animation, and then it's
 * sitting there until the motion graphics finish." That was exactly right, and
 * it is what a naive assemble-then-hold produces: every piece lands inside the
 * first second and the remaining three are a PNG.
 *
 * Reading the reference edits frame by frame, nothing in them is ever still.
 * Over four seconds of a wallet on a desk the camera pushes in the whole time,
 * the notes slide out one at a time, a dashed arrow draws itself across the
 * board, and the clock's hands turn. There is no hold. So there are three
 * layers of motion here, and only the first one ends:
 *
 *   1. **Entry.** Each part arrives, five frames after the last.
 *   2. **Camera.** A slow push and drift across the whole scene, from the
 *      first frame to the last, with no keyframes and no settle — the moment
 *      it stops, the frame reads as a photograph.
 *   3. **Idle.** Once a part has landed it keeps moving on its own: a bob, a
 *      sway, a turn. Small enough not to be distracting, large enough that the
 *      eye never decides the picture has finished.
 *
 * Parallax ties the first two together. Each part carries a depth, and the
 * camera's drift is multiplied by it, so near things travel further than far
 * things. That is what makes a flat SVG read as a space rather than a sticker.
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

/** Frames between one piece landing and the next starting. */
const PART_STAGGER = 5;

/** How long a piece takes to arrive. */
const ENTER_FRAMES = 12;

export const Illustration: React.FC<{
  art: Art;
  /** Frame the first part arrives on, relative to the scene. */
  at: number;
  /** Rendered width and height, in pixels. */
  size: number;
  /** How long the scene runs, so the camera can pace itself across all of it. */
  durationInFrames: number;
  /** Anything seeded — drift direction, idle phases — hangs off this. */
  seed: string;
}> = ({ art, at, size, durationInFrames, seed }) => {
  const frame = useCurrentFrame();

  /*
   * The drawing's own centre, read off the viewBox.
   *
   * Everything is scaled and rotated about it, so a piece grows into place
   * rather than growing out of the drawing's top-left corner — which is what
   * an unqualified `scale()` on an SVG group does, and which looks like a bug
   * every single time.
   */
  const [minX, minY, width, height] = parseViewBox(art.viewBox);
  const cx = minX + width / 2;
  const cy = minY + height / 2;

  const camera = cameraAt(frame, durationInFrames, width, height, seed);

  return (
    <svg
      viewBox={art.viewBox}
      width={size}
      height={size}
      style={{ overflow: 'visible', display: 'block' }}
    >
      {/*
        Gradients first, and outside the camera group: a `<defs>` is never
        painted, so transforming it would cost a group for nothing, and a
        gradient defined after the shape that references it still resolves.
      */}
      {art.defs ? <defs dangerouslySetInnerHTML={{ __html: art.defs }} /> : null}
      {/*
        The camera is one group around everything, not a transform per part.
        A push applied per part would scale each piece about its own centre and
        the composition would come apart as it zoomed.
      */}
      <g transform={about(cx, cy, `scale(${camera.scale.toFixed(4)})`)}>
        {art.parts.map((part, i) => (
          <Part
            key={i}
            part={part}
            index={i}
            at={at + stagger(i, PART_STAGGER)}
            frame={frame}
            camera={camera}
            height={height}
            width={width}
            seed={seed}
          />
        ))}
      </g>
    </svg>
  );
};

interface Camera {
  scale: number;
  /** Where the camera has travelled to, in viewBox units. */
  x: number;
  y: number;
}

/**
 * The move that never stops.
 *
 * No keyframe table on purpose: a table implies an end, and this is the one
 * thing in the renderer that must still be going when the scene cuts away.
 * The drift direction is seeded off the scene id so two scenes in one video do
 * not push the same way, and so a resumed render produces identical pixels.
 */
function cameraAt(frame: number, durationInFrames: number, width: number, height: number, seed: string): Camera {
  const through = durationInFrames > 0 ? frame / durationInFrames : 0;
  const angle = seeded(seed, 0) * Math.PI * 2;

  return {
    /*
     * 14% over the scene, whatever its length — a fixed per-frame rate would
     * make a six-second scene end up twice as close as a three-second one.
     *
     * These numbers were raised after watching a render: at 8% and 5% the move
     * was real but too slow to read, and four seconds of it still looked like
     * a still frame. The reference edits push and travel far more than feels
     * reasonable written down, and that is what keeps them alive.
     */
    scale: 1.02 + through * 0.14,
    x: Math.cos(angle) * width * 0.1 * through,
    y: Math.sin(angle) * height * 0.1 * through,
  };
}

const Part: React.FC<{
  part: ArtPart;
  index: number;
  at: number;
  frame: number;
  camera: Camera;
  width: number;
  height: number;
  seed: string;
}> = ({ part, index, at, frame, camera, width, height, seed }) => {
  const entry = enterOf(part, frame, at, width, height);

  /*
   * Parallax: the camera's travel, weighted by how near the piece is.
   *
   * Depth 0.5 is the picture plane and moves with the camera exactly; a
   * foreground piece overshoots it and a background piece lags, which is the
   * whole of the effect. Scaled small — a strong parallax on a 1000-unit
   * canvas tears the composition apart within a second.
   */
  const lean = (part.depth - 0.5) * 1.5;
  const parallaxX = -camera.x * lean;
  const parallaxY = -camera.y * lean;

  const idle = idleOf(part.idle, frame, at, index, width, height, seed);

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
function enterOf(part: ArtPart, frame: number, at: number, width: number, height: number): Pose {
  const t = kf(frame, [[at, 0], [at + ENTER_FRAMES, 1]], part.enter === 'grow' ? easeOutCubic : easeOutSoftBack);
  const fade = kf(frame, [[at, 0], [at + Math.round(ENTER_FRAMES * 0.5), 1]], easeOutCubic);
  const rest: Pose = { opacity: fade, x: 0, y: 0, scale: 1, rotate: 0 };

  switch (part.enter) {
    case 'rise':
      return { ...rest, y: height * 0.06 * (1 - t) };
    case 'slide-left':
      return { ...rest, x: width * 0.16 * (1 - t) };
    case 'slide-right':
      return { ...rest, x: -width * 0.16 * (1 - t) };
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
 * What a piece does for the rest of the scene.
 *
 * Periods are deliberately coprime-ish and seeded per part, so four pieces
 * bobbing together never sync up into one pulsing blob — which is what a
 * shared clock produces and it looks far worse than no idle at all.
 */
function idleOf(
  kind: ArtIdle,
  frame: number,
  at: number,
  index: number,
  width: number,
  height: number,
  seed: string,
): Pose {
  const rest: Pose = { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 };
  if (kind === 'none') return rest;

  // Fades in as the piece settles: a part still arriving should not also be
  // drifting, or the entry stops reading as an entry.
  const strength = kf(frame, [[at + ENTER_FRAMES, 0], [at + ENTER_FRAMES + 12, 1]], easeOutCubic);
  if (strength <= 0) return rest;

  const phase = seeded(seed, index + 11) * Math.PI * 2;
  // Short enough that a full cycle happens inside a three-second insert: a
  // ninety-frame period on a ninety-frame scene is a slow slide, not a float.
  const period = 38 + seeded(seed, index + 23) * 26;
  const wave = Math.sin((frame / period) * Math.PI * 2 + phase);

  switch (kind) {
    case 'bob':
      return { ...rest, y: wave * height * 0.022 * strength };
    case 'drift':
      return {
        ...rest,
        x: wave * width * 0.026 * strength,
        y: Math.cos((frame / (period * 1.3)) * Math.PI * 2 + phase) * height * 0.016 * strength,
      };
    case 'sway':
      return { ...rest, rotate: wave * 2.4 * strength };
    case 'pulse':
      return { ...rest, scale: 1 + wave * 0.035 * strength };
    case 'spin':
      // Continuous, not a wave: hands on a clock, a gear, a loading ring. One
      // turn every eight seconds at 30fps.
      return { ...rest, rotate: (frame - at) * 1.5 * strength };
    default:
      return rest;
  }
}

/** When it has done assembling, so the caller knows where its own beats start. */
export function artSettlesAt(art: Art, at: number): number {
  return at + stagger(Math.max(0, art.parts.length - 1), PART_STAGGER) + ENTER_FRAMES;
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
