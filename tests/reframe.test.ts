import { describe, expect, it } from 'vitest';
import { retimeTrack, sampleReframe, smoothTrack, trackSubject } from '@/lib/reframe';
import { layoutSegments, TimeMapper } from '@/lib/timeline/time-mapper';
import type { ReframeTrack } from '@/lib/edl/types';

const WIDTH = 64;
const HEIGHT = 36;

/** A frame with a bright block of `size` centred on the normalised position. */
function frameWithSubject(cx: number, cy: number, size = 10, background = 20): Uint8Array {
  const frame = new Uint8Array(WIDTH * HEIGHT).fill(background);
  const px = Math.round(cx * (WIDTH - 1));
  const py = Math.round(cy * (HEIGHT - 1));

  for (let y = py - size / 2; y < py + size / 2; y++) {
    for (let x = px - size / 2; x < px + size / 2; x++) {
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 0 || ix >= WIDTH || iy < 0 || iy >= HEIGHT) continue;
      frame[iy * WIDTH + ix] = 230;
    }
  }
  return frame;
}

describe('subject tracking', () => {
  it('follows a subject across the frame rather than sitting at the centre', () => {
    // The subject walks from the left third to the right third.
    const positions = [0.25, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.75, 0.75];
    const samples = trackSubject(positions.map((cx) => frameWithSubject(cx, 0.4)));

    expect(samples).toHaveLength(positions.length);

    const first = samples[1].cx;
    const last = samples[samples.length - 1].cx;

    // The regression this pins: an over-weighted centre prior produced a track
    // that never left 0.5, which reads as "stable" but is really a centre crop.
    expect(last).toBeGreaterThan(first + 0.15);
    expect(last).toBeGreaterThan(0.55);
    expect(first).toBeLessThan(0.45);
  });

  it('locates a subject that is sitting perfectly still', () => {
    // The normal shot: a person on a tripod who barely moves. Background
    // subtraction sees nothing happening here, so a motion-only tracker would
    // fall back to a centre crop on exactly the footage that most needs
    // reframing. A tight, high-contrast blob is evidence on its own.
    const still = Array.from({ length: 8 }, () => frameWithSubject(0.25, 0.4));
    const samples = trackSubject(still);
    const last = samples[samples.length - 1];

    expect(last.cx).toBeLessThan(0.36);
    expect(last.confidence).toBeGreaterThan(0.6);
  });

  it('distrusts evidence smeared across the whole frame', () => {
    // Low-level noise everywhere, with no concentrated subject: there is
    // nothing to track, so we frame on the prior rather than chase the noise.
    const noisy = Array.from({ length: 6 }, (_, f) => {
      const frame = new Uint8Array(WIDTH * HEIGHT);
      for (let i = 0; i < frame.length; i++) frame[i] = 40 + ((i * 31 + f * 7) % 24);
      return frame;
    });
    const samples = trackSubject(noisy);
    const last = samples[samples.length - 1];

    expect(last.cx).toBeGreaterThan(0.35);
    expect(last.cx).toBeLessThan(0.65);
  });

  it('returns nothing for no frames', () => {
    expect(trackSubject([])).toEqual([]);
  });
});

describe('crop smoothing', () => {
  const options = {
    sourceWidth: 1920,
    sourceHeight: 1080,
    targetAspect: 1080 / 1920,
    durationSec: 5,
    headroom: 0.06,
  };

  it('keeps the crop window inside the source frame', () => {
    const samples = [0.02, 0.05, 0.5, 0.95, 0.98].map((cx, i) => ({
      timeSec: i * 0.25,
      cx,
      cy: 0.4,
      confidence: 1,
    }));

    const track = smoothTrack(samples, options);
    const halfWidth = track.keyframes[0].w / 2;

    // A crop that ran off the edge would render as a black bar down one side.
    for (const kf of track.keyframes) {
      expect(kf.cx).toBeGreaterThanOrEqual(halfWidth - 1e-9);
      expect(kf.cx).toBeLessThanOrEqual(1 - halfWidth + 1e-9);
    }
  });

  it('ignores a jitter smaller than the dead zone', () => {
    const jitter = Array.from({ length: 12 }, (_, i) => ({
      timeSec: i * 0.25,
      cx: 0.5 + (i % 2 === 0 ? 0.008 : -0.008),
      cy: 0.4,
      confidence: 1,
    }));

    const track = smoothTrack(jitter, options);
    const xs = track.keyframes.map((k) => k.cx);
    // A crop that chased every wobble looks like a drunk camera operator.
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.02);
  });
});

describe('re-timing onto the output clock', () => {
  // 0–5s kept, 5–8s cut, 8–12s kept.
  const mapper = new TimeMapper(
    layoutSegments([
      { sourceStartSec: 0, sourceEndSec: 5 },
      { sourceStartSec: 8, sourceEndSec: 12 },
    ]),
  );

  const sourceTrack: ReframeTrack = {
    method: 'saliency',
    keyframes: [
      { outSec: 0, cx: 0.3, cy: 0.4, w: 0.5 },
      { outSec: 4, cx: 0.4, cy: 0.4, w: 0.5 },
      { outSec: 6.5, cx: 0.9, cy: 0.4, w: 0.5 }, // inside the removed region
      { outSec: 10, cx: 0.7, cy: 0.4, w: 0.5 },
    ],
  };

  it('moves keyframes onto output time and drops the cut ones', () => {
    const track = retimeTrack(sourceTrack, mapper);

    expect(track.keyframes.map((k) => k.outSec)).toEqual([0, 4, 7]);
    // The regression this pins: consuming source-time keyframes as output time
    // makes the crop drift further behind the picture as the video runs.
    expect(track.keyframes.find((k) => k.cx === 0.9)).toBeUndefined();
  });

  it('still frames the shot when every keyframe was cut away', () => {
    const allCut: ReframeTrack = {
      method: 'saliency',
      keyframes: [{ outSec: 6, cx: 0.8, cy: 0.5, w: 0.4 }],
    };
    const track = retimeTrack(allCut, mapper);

    expect(track.keyframes).toHaveLength(1);
    expect(track.keyframes[0].outSec).toBe(0);
    expect(track.keyframes[0].w).toBe(0.4);
  });
});

describe('sampling the track', () => {
  const track: ReframeTrack = {
    method: 'saliency',
    keyframes: [
      { outSec: 0, cx: 0.3, cy: 0.4, w: 0.5 },
      { outSec: 10, cx: 0.7, cy: 0.4, w: 0.5 },
    ],
  };

  it('holds the endpoints outside the track', () => {
    expect(sampleReframe(track, -1).cx).toBe(0.3);
    expect(sampleReframe(track, 99).cx).toBe(0.7);
  });

  it('eases between keyframes instead of cornering', () => {
    const mid = sampleReframe(track, 5).cx;
    expect(mid).toBeCloseTo(0.5, 5);

    // Smoothstep: near the ends the curve is flatter than a straight line.
    const early = sampleReframe(track, 1).cx;
    expect(early).toBeLessThan(0.3 + 0.4 * 0.1);
  });
});
