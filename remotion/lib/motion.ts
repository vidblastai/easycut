/**
 * The motion language the animated scenes are built from.
 *
 * `timing.ts` holds the house spring the whole video shares. This file is
 * narrower and stricter: it is the vocabulary a *scene* animates in, and it
 * exists because the reference edits we are chasing are not made of springs.
 * They are made of keyframe tables with a hard ease-out, staggered four frames
 * apart, and they hold perfectly still once they have assembled.
 *
 * Three rules hold everywhere below, and breaking any of them is a bug:
 *
 *   1. Every value here is a pure function of the frame. No timers, no state,
 *      no Math.random — a resumed Lambda render has to produce the same pixels
 *      as the chunk before it, and a scene that drifts shows a visible seam.
 *
 *   2. Nothing returns a `filter`. A full-frame layer is exactly where a
 *      per-frame blur costs the most, and it is what used to make the editor
 *      stutter at every cut. Where the references show motion blur we draw
 *      ghost copies along the motion vector instead — same read, pure
 *      transform and opacity.
 *
 *   3. Ease out, not in-out. Measured off the references: a move covers ~80%
 *      of its distance in its first third. `easeOutExpo` is the default for
 *      that reason, and in-out is not exported at all.
 */

/* ------------------------------------------------------------------ easing */

export type Ease = (t: number) => number;

export const linear: Ease = (t) => t;

/** The house curve. Almost everything in the references is this. */
export const easeOutExpo: Ease = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** Slightly softer landing, for things that travel a long way. */
export const easeOutQuint: Ease = (t) => 1 - Math.pow(1 - t, 5);

/** For a card growing into place — decelerates without the expo's hard stop. */
/**
 * Slow, then fast, then slow — the only in-out curve in this file.
 *
 * Everything that ARRIVES eases out hard: in-out on an entrance reads as a
 * corporate template, and the house rule says so. A camera is the exception
 * and the reason is physical. A zoom that starts at full speed is a cut, and
 * one that stops dead is a jolt; a real operator winds a lens up and lets it
 * down. Quintic rather than cubic because the point is for the middle to be
 * conspicuously faster than the ends, which is the modern push.
 */
export const easeInOutQuint: Ease = (t) =>
  t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;

export const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - t, 3);

/** Overshoots once and settles. Use sparingly; on text it reads as cheap. */
export const easeOutBack: Ease = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** A single, slower overshoot — the pop a UI element makes appearing. */
export const easeOutSoftBack: Ease = (t) => {
  const c1 = 1.1;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/* --------------------------------------------------------- keyframe tables */

export type Keyframes = ReadonlyArray<readonly [frame: number, value: number]>;

/**
 * Read a keyframe table at a frame.
 *
 * Written as a table rather than a chain of `interpolate` calls because a
 * table reads like a timeline: you can see the whole move at once, and a
 * reviewer can check it against the reference without running anything.
 * Outside the table it clamps — a scene holds its last pose, it does not drift
 * past it.
 */
export function kf(frame: number, table: Keyframes, ease: Ease = easeOutExpo): number {
  if (!table.length) return 0;
  const first = table[0];
  if (frame <= first[0]) return first[1];

  for (let i = 1; i < table.length; i++) {
    const [at, value] = table[i];
    if (frame <= at) {
      const [prevAt, prevValue] = table[i - 1];
      const span = at - prevAt;
      if (span <= 0) return value;
      const t = ease(Math.min(1, Math.max(0, (frame - prevAt) / span)));
      return prevValue + (value - prevValue) * t;
    }
  }

  return table[table.length - 1][1];
}

/** The same table read for several channels at once (x/y, or a colour ramp). */
export function kfMany(
  frame: number,
  table: ReadonlyArray<readonly [frame: number, values: readonly number[]]>,
  ease: Ease = easeOutExpo,
): number[] {
  if (!table.length) return [];
  const width = table[0][1].length;
  const out: number[] = [];
  for (let channel = 0; channel < width; channel++) {
    out.push(
      kf(
        frame,
        table.map(([at, values]) => [at, values[channel] ?? 0] as const),
        ease,
      ),
    );
  }
  return out;
}

/**
 * When the nth member of a repeated group starts.
 *
 * Four frames is not arbitrary: it is what the reference UI build measures at,
 * for avatars, for rows, and for the badges that follow them. Three feels
 * hurried and six feels like a slideshow.
 */
export const STAGGER = 4;

export function stagger(index: number, every = STAGGER, from = 0): number {
  return from + index * every;
}

/* ----------------------------------------------------------------- entries */

/**
 * How something arrives.
 *
 * Deliberately not a style object: a caller composes these into one transform
 * string in the order that suits it, and nesting three wrapper divs to apply
 * three transforms is how you lose a centring `translate(-50%, -50%)`.
 */
export interface Entry {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotate: number;
}

const AT_REST: Entry = { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 };

export function transformOf(entry: Entry, extra = ''): string {
  const parts: string[] = [];
  if (entry.x || entry.y) parts.push(`translate3d(${entry.x.toFixed(2)}px, ${entry.y.toFixed(2)}px, 0)`);
  if (entry.scale !== 1) parts.push(`scale(${entry.scale.toFixed(4)})`);
  if (entry.rotate) parts.push(`rotate(${entry.rotate.toFixed(3)}deg)`);
  if (extra) parts.push(extra);
  // An empty transform must be 'none', never '' — and never concatenated with
  // anything, because `translate(...) none` throws the whole declaration away.
  return parts.length ? parts.join(' ') : 'none';
}

/** Up from below, fading. The default for text and for list rows. */
export function riseIn(frame: number, at = 0, travel = 26, frames = 9): Entry {
  const t = kf(frame, [[at, 0], [at + frames, 1]]);
  return { ...AT_REST, opacity: t, y: travel * (1 - t) };
}

/** Scale from small with one overshoot. The default for icons and badges. */
export function popIn(frame: number, at = 0, frames = 10, from = 0.6): Entry {
  const t = kf(frame, [[at, 0], [at + frames, 1]], easeOutSoftBack);
  const fade = kf(frame, [[at, 0], [at + Math.round(frames * 0.5), 1]], easeOutCubic);
  return { ...AT_REST, opacity: fade, scale: from + (1 - from) * t };
}

/** Sideways and stopping hard — the carousel move. Pair with `ghosts`. */
export function slideIn(frame: number, at = 0, from = 900, frames = 5): Entry {
  const t = kf(frame, [[at, 0], [at + frames, 1]]);
  return { ...AT_REST, opacity: kf(frame, [[at, 0], [at + 2, 1]], easeOutCubic), x: from * (1 - t) };
}

/** Straight fade, for a look that crossfades rather than moves. */
export function fadeIn(frame: number, at = 0, frames = 12): Entry {
  return { ...AT_REST, opacity: kf(frame, [[at, 0], [at + frames, 1]], easeOutCubic) };
}

/**
 * A slow, never-ending push-in.
 *
 * The documentary look lives on this. It has no keyframes on purpose — the
 * moment it stops, the frame reads as a still, and the whole effect is that it
 * never quite settles.
 */
export function drift(frame: number, perFrame = 0.001, base = 1): number {
  return base + frame * perFrame;
}

/* ------------------------------------------------------------ motion blur */

/**
 * Ghost copies along a motion vector, standing in for motion blur.
 *
 * The reference carousel smears hard on entry, and the honest way to get that
 * is an SVG blur on a moving group. We do not do the honest way: a filter on a
 * moving element forces the compositor to re-rasterise it every frame, and
 * this renderer has already been through one round of that costing the editor
 * ten frames a second.
 *
 * Five samples trailing back along the direction of travel, opacity falling
 * off, reads as the same thing at 30fps and costs five transforms.
 *
 * Returns an empty array when the element is near rest, so the ghosts are not
 * paid for during the 90% of a scene that is holding still.
 */
export function ghosts(
  travelPx: number,
  samples = 5,
): Array<{ x: number; opacity: number }> {
  if (Math.abs(travelPx) < 6) return [];
  const out: Array<{ x: number; opacity: number }> = [];
  for (let i = 1; i <= samples; i++) {
    const t = i / (samples + 1);
    out.push({ x: travelPx * t, opacity: (1 - t) * 0.5 });
  }
  return out;
}

/* ---------------------------------------------------------------- readouts */

/**
 * A figure counting up to its value.
 *
 * Reads the suffix off the target so "95%", "63K" and "$1.2M" all count
 * without the unit flickering — the reference counts 92→95 with the per-cent
 * sign nailed down the whole way.
 */
export function countUp(frame: number, at: number, frames: number, target: string): string {
  const match = target.match(/^([^0-9-]*)(-?[\d.,]+)(.*)$/);
  if (!match) return target;
  const [, prefix, digits, suffix] = match;
  const value = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(value)) return target;

  const t = kf(frame, [[at, 0], [at + frames, 1]], easeOutQuint);
  const decimals = digits.includes('.') ? digits.split('.')[1].length : 0;
  const now = value * t;
  return `${prefix}${now.toFixed(decimals)}${suffix}`;
}

/** How much of a stroke is drawn, as a dash offset over its own length. */
export function drawOn(frame: number, at: number, frames: number, length: number): number {
  return length * (1 - kf(frame, [[at, 0], [at + frames, 1]], easeOutCubic));
}

/**
 * Words revealed a group at a time.
 *
 * Groups, not letters: the documentary reference brings in "95%" then "ВАШИХ"
 * then "ИДЕЙ", and letter-by-letter on a two-second scene is unreadable.
 * Returns how many of `count` groups are showing at this frame.
 */
export function revealed(frame: number, at: number, every: number, count: number): number {
  if (frame < at) return 0;
  return Math.min(count, Math.floor((frame - at) / every) + 1);
}

/**
 * How far along the rise is, eased.
 *
 * Quadratic-out: `1 - (1 - t)²`. Fitted to the reference frame by frame — a
 * cubic decelerates too hard and arrives looking like it was dragged, a linear
 * ramp looks like a slide transition.
 */
export function riseProgress(frame: number, riseFrames: number): number {
  const t = Math.min(1, Math.max(0, frame / riseFrames));
  return 1 - (1 - t) * (1 - t);
}
