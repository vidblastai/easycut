import { Easing, interpolate, spring } from 'remotion';

/**
 * Shared motion language.
 *
 * Every animation in the video pulls from these three helpers so that a pop, a
 * slide and a punch-in all feel like they come from the same editor. Ad-hoc
 * easing curves scattered across components is exactly how automated video
 * starts to look automated.
 */

export const secToFrame = (sec: number, fps: number) => Math.round(sec * fps);

/** The house spring: quick, confident, a touch of overshoot. */
export function pop(frame: number, fps: number, delayFrames = 0, overshoot = true) {
  return spring({
    frame: frame - delayFrames,
    fps,
    config: overshoot
      ? { damping: 12, mass: 0.55, stiffness: 190 }
      : { damping: 200, mass: 0.6, stiffness: 140 },
    durationInFrames: Math.round(fps * 0.5),
  });
}

/**
 * Fades an element in and out around its own lifetime, in frames.
 * Returns 0..1, clamped, with a fade length that never exceeds a third of the
 * element's life — short cues would otherwise be fading the whole time.
 */
export function lifecycleOpacity(
  frame: number,
  durationInFrames: number,
  fadeFrames = 6,
): number {
  const fade = Math.min(fadeFrames, Math.floor(durationInFrames / 3));
  if (fade <= 0) return 1;

  return interpolate(
    frame,
    [0, fade, durationInFrames - fade, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) },
  );
}

/** Eased 0→1 ramp over a window, for punch-ins and Ken Burns moves. */
export function ramp(
  frame: number,
  fromFrame: number,
  toFrame: number,
  easing = Easing.inOut(Easing.cubic),
): number {
  if (toFrame <= fromFrame) return 1;
  return interpolate(frame, [fromFrame, toFrame], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });
}

/**
 * Deterministic pseudo-randomness keyed by a string.
 *
 * Grain, glitch offsets and jitter need to look random but must be identical on
 * every re-render, or a resumed Lambda render produces a visible seam where one
 * chunk's noise doesn't match the next.
 */
export function seeded(seed: string, index: number): number {
  let hash = 2166136261;
  const key = `${seed}:${index}`;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}
