import { spawn } from 'node:child_process';
import { FFMPEG } from '@/lib/media/ffmpeg';
import type { ReframeTrack, ReframeKeyframe } from '@/lib/edl/types';

/**
 * Turning a landscape talking head into a vertical one.
 *
 * A centre crop works right up until the speaker sits off-centre, gestures out
 * of frame, or stands on the left third because that's where the light was. Then
 * it beheads them, and the whole product looks broken.
 *
 * So: sample the footage cheaply, find the subject in each sample, and produce a
 * smoothed crop path. Two things make this affordable —
 *
 *  1. We sample at 4 fps and 64×36 greyscale. A 10-minute video becomes ~5 MB of
 *     raw pixels streamed through a pipe. No decoding library, no model download.
 *  2. The subject of a locked-off talking head is, reliably, the part of the
 *     frame that MOVES. Temporal variance against a running mean localises a
 *     person more robustly than a face detector does when they turn their head,
 *     and it costs nothing.
 *
 * An optional MediaPipe detector can be plugged in for multi-subject footage;
 * the smoothing and framing logic below is shared by both.
 */

const SAMPLE_FPS = 4;
const SAMPLE_WIDTH = 64;
const SAMPLE_HEIGHT = 36;

export interface SubjectSample {
  timeSec: number;
  /** Normalised subject centre within the source frame. */
  cx: number;
  cy: number;
  /** 0..1 — how strongly we believe there is a subject here. */
  confidence: number;
}

export interface ReframeOptions {
  sourceWidth: number;
  sourceHeight: number;
  targetAspect: number; // width / height
  durationSec: number;
  /** Extra headroom above the face, as a fraction of crop height. */
  headroom: number;
}

/* ------------------------------------------------------------- sampling */

/**
 * Streams tiny greyscale frames out of ffmpeg and returns the raw luma planes.
 * Keeping this separate from the analysis makes the tracker testable with
 * synthetic frames.
 */
export async function sampleLumaFrames(videoPath: string): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, [
      '-v', 'error',
      '-i', videoPath,
      '-vf', `fps=${SAMPLE_FPS},scale=${SAMPLE_WIDTH}:${SAMPLE_HEIGHT}`,
      '-pix_fmt', 'gray',
      '-f', 'rawvideo',
      '-',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const frameSize = SAMPLE_WIDTH * SAMPLE_HEIGHT;
    const chunks: Buffer[] = [];
    let stderr = '';

    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg sampling failed: ${stderr.slice(-500)}`));
      const buffer = Buffer.concat(chunks);
      const frames: Uint8Array[] = [];
      for (let offset = 0; offset + frameSize <= buffer.length; offset += frameSize) {
        frames.push(new Uint8Array(buffer.subarray(offset, offset + frameSize)));
      }
      resolve(frames);
    });
  });
}

/**
 * Locates the subject in each frame.
 *
 * Score per pixel = |frame − running mean| (motion) + a mild centre-and-contrast
 * prior. The horizontal centroid of that score is the subject's x; the vertical
 * centroid, biased upward, approximates the head rather than the torso.
 */
export function trackSubject(frames: Uint8Array[]): SubjectSample[] {
  if (!frames.length) return [];

  const pixelCount = SAMPLE_WIDTH * SAMPLE_HEIGHT;
  const mean = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) mean[i] = frames[0][i];

  const samples: SubjectSample[] = [];
  const weights = new Float32Array(pixelCount);
  const alpha = 0.08; // running-mean adaptation rate

  frames.forEach((frame, frameIndex) => {
    let motionTotal = 0;
    let motionPeak = 0;

    // Pass 1: motion energy against the running background, plus local contrast.
    for (let y = 0; y < SAMPLE_HEIGHT; y++) {
      for (let x = 0; x < SAMPLE_WIDTH; x++) {
        const i = y * SAMPLE_WIDTH + x;
        const motion = Math.abs(frame[i] - mean[i]);

        const right = x < SAMPLE_WIDTH - 1 ? frame[i + 1] : frame[i];
        const down = y < SAMPLE_HEIGHT - 1 ? frame[i + SAMPLE_WIDTH] : frame[i];
        const contrast = (Math.abs(frame[i] - right) + Math.abs(frame[i] - down)) * 0.5;

        const energy = motion + contrast * 0.4;
        weights[i] = energy;
        motionTotal += motion;
        if (energy > motionPeak) motionPeak = energy;
      }
    }

    // Pass 2: keep only what stands clearly above the background.
    //
    // This threshold is the whole trick. Without it, a weak signal spread over
    // 2,304 pixels averages out to dead centre no matter where the subject is —
    // which looks like tracking (it is stable!) but is really a centre crop.
    const floor = motionPeak * 0.35;
    let weightSum = 0;
    let xSum = 0;
    let ySum = 0;

    for (let y = 0; y < SAMPLE_HEIGHT; y++) {
      for (let x = 0; x < SAMPLE_WIDTH; x++) {
        const i = y * SAMPLE_WIDTH + x;
        if (weights[i] < floor) continue;
        // Squaring sharpens the peak so a bright subject outweighs a wide,
        // low-level wash of noise.
        const w = (weights[i] - floor) ** 2;
        weightSum += w;
        xSum += w * (x / (SAMPLE_WIDTH - 1));
        ySum += w * (y / (SAMPLE_HEIGHT - 1));
      }
    }

    const measuredX = weightSum > 0 ? xSum / weightSum : 0.5;
    const measuredY = weightSum > 0 ? ySum / weightSum : 0.42;

    // Pass 3: how CONCENTRATED is the evidence?
    //
    // Motion alone is the wrong confidence signal for this product. The normal
    // shot is a person on a tripod who barely moves — background subtraction
    // says "nothing is happening" and we would fall back to a centre crop on
    // exactly the footage we most need to reframe. But a person against a wall
    // is a tight, high-contrast blob, and a tight blob is strong evidence
    // wherever it sits. So we also measure the spread of the weight around its
    // own centroid: concentrated means confident.
    let spread = 0;
    if (weightSum > 0) {
      for (let y = 0; y < SAMPLE_HEIGHT; y++) {
        for (let x = 0; x < SAMPLE_WIDTH; x++) {
          const i = y * SAMPLE_WIDTH + x;
          if (weights[i] < floor) continue;
          const w = (weights[i] - floor) ** 2;
          const dx = x / (SAMPLE_WIDTH - 1) - measuredX;
          spread += w * dx * dx;
        }
      }
      spread = Math.sqrt(spread / weightSum);
    }

    for (let i = 0; i < pixelCount; i++) mean[i] += (frame[i] - mean[i]) * alpha;

    const motionConfidence = Math.min(1, motionTotal / pixelCount / 10);
    // A standard deviation of 0.1 frame widths or less is a person; 0.35 is
    // noise smeared across the whole frame.
    const shapeConfidence = weightSum > 0 ? Math.max(0, Math.min(1, (0.35 - spread) / 0.25)) : 0;
    const confidence = Math.max(motionConfidence, shapeConfidence);

    // Blend toward the framing prior — centre, upper third — in proportion to
    // how little we trust the measurement. This is where the prior belongs:
    // as a fallback, not as a term competing with the evidence.
    const trust = weightSum > 0 ? Math.max(0.35, confidence) : 0;

    samples.push({
      timeSec: frameIndex / SAMPLE_FPS,
      cx: measuredX * trust + 0.5 * (1 - trust),
      cy: measuredY * trust + 0.42 * (1 - trust),
      confidence: Math.max(0.15, confidence),
    });
  });

  return samples;
}

/* ------------------------------------------------------------- smoothing */

/**
 * Turns noisy per-frame positions into a crop path a human would accept.
 *
 * Three passes, each fixing a distinct failure:
 *  1. **Confidence-weighted exponential smoothing** — kills per-frame jitter.
 *  2. **Dead zone** — the crop does not move at all until the subject drifts
 *     past a threshold. Without this the frame breathes constantly and looks
 *     like a drunk camera operator.
 *  3. **Rate limit** — when it does move, it moves no faster than a real
 *     operator would pan.
 */
export function smoothTrack(samples: SubjectSample[], options: ReframeOptions): ReframeTrack {
  if (!samples.length) {
    return { keyframes: [{ outSec: 0, cx: 0.5, cy: 0.5, w: cropWidthFraction(options) }], method: 'center' };
  }

  const w = cropWidthFraction(options);
  const halfW = w / 2;
  const cropHeightFraction = (options.sourceWidth * w) / options.targetAspect / options.sourceHeight;
  const halfH = Math.min(0.5, cropHeightFraction / 2);

  // Tuned together: the dead zone decides when we move, the speed limit decides
  // how fast. Too tight and the frame breathes constantly; too loose and the
  // subject walks out of shot before the crop reacts.
  const DEAD_ZONE = 0.025;      // ~2.5 % of frame width before we react
  const MAX_SPEED = 0.16;       // normalised units per second — a slow human pan
  const SMOOTHING = 0.3;

  let smoothedX = samples[0].cx;
  let smoothedY = samples[0].cy;
  let heldX = smoothedX;
  let heldY = smoothedY;

  const keyframes: ReframeKeyframe[] = [];
  let previousTime = samples[0].timeSec;

  for (const sample of samples) {
    const dt = Math.max(1 / SAMPLE_FPS, sample.timeSec - previousTime);
    previousTime = sample.timeSec;

    const rate = SMOOTHING * Math.max(0.3, sample.confidence);
    smoothedX += (sample.cx - smoothedX) * rate;
    smoothedY += (sample.cy - smoothedY) * rate;

    if (Math.abs(smoothedX - heldX) > DEAD_ZONE) {
      const step = Math.sign(smoothedX - heldX) * Math.min(Math.abs(smoothedX - heldX), MAX_SPEED * dt);
      heldX += step;
    }
    if (Math.abs(smoothedY - heldY) > DEAD_ZONE * 1.6) {
      const step = Math.sign(smoothedY - heldY) * Math.min(Math.abs(smoothedY - heldY), MAX_SPEED * 0.6 * dt);
      heldY += step;
    }

    // Headroom: place the subject on the upper third, the way a human frames a face.
    const framedY = heldY - options.headroom * cropHeightFraction;

    keyframes.push({
      outSec: sample.timeSec,
      cx: clamp(heldX, halfW, 1 - halfW),
      cy: clamp(framedY, halfH, 1 - halfH),
      w,
    });
  }

  return { keyframes: decimate(keyframes), method: 'saliency' };
}

/** How wide the crop window is, as a fraction of source width. */
function cropWidthFraction(options: ReframeOptions): number {
  const sourceAspect = options.sourceWidth / options.sourceHeight;
  if (options.targetAspect >= sourceAspect) return 1; // target is wider — no horizontal crop
  // Crop width such that the full source height fills the target height.
  return (options.targetAspect / sourceAspect);
}

/**
 * Drops keyframes that sit on a straight line between their neighbours. A
 * 10-minute track goes from 2,400 keyframes to a few dozen with no visible
 * difference, which keeps the EDL small enough to ship to the browser.
 */
function decimate(keyframes: ReframeKeyframe[], toleranceX = 0.0025): ReframeKeyframe[] {
  if (keyframes.length <= 2) return keyframes;
  const kept: ReframeKeyframe[] = [keyframes[0]];

  for (let i = 1; i < keyframes.length - 1; i++) {
    const previous = kept[kept.length - 1];
    const next = keyframes[i + 1];
    const span = next.outSec - previous.outSec || 1;
    const t = (keyframes[i].outSec - previous.outSec) / span;
    const predictedX = previous.cx + (next.cx - previous.cx) * t;
    const predictedY = previous.cy + (next.cy - previous.cy) * t;

    if (
      Math.abs(keyframes[i].cx - predictedX) > toleranceX ||
      Math.abs(keyframes[i].cy - predictedY) > toleranceX * 1.5
    ) {
      kept.push(keyframes[i]);
    }
  }
  kept.push(keyframes[keyframes.length - 1]);
  return kept;
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2;
  return Math.max(min, Math.min(max, value));
}

/* ------------------------------------------------------------ entrypoint */

export async function computeReframeTrack(
  videoPath: string,
  options: ReframeOptions,
): Promise<ReframeTrack> {
  // No horizontal crop needed (target is the same shape or wider) — skip the work.
  if (cropWidthFraction(options) >= 0.999) {
    return { keyframes: [{ outSec: 0, cx: 0.5, cy: 0.5, w: 1 }], method: 'center' };
  }

  try {
    const frames = await sampleLumaFrames(videoPath);
    const samples = trackSubject(frames);
    return smoothTrack(samples, options);
  } catch {
    // Reframing is an enhancement; failing it must not fail the video.
    return {
      keyframes: [{ outSec: 0, cx: 0.5, cy: 0.42, w: cropWidthFraction(options) }],
      method: 'center',
    };
  }
}

/**
 * Re-times a track from SOURCE time onto OUTPUT time.
 *
 * `computeReframeTrack` samples the uploaded file, so its keyframes are stamped
 * in source time. The renderer consumes the track in output time. After cuts
 * those two clocks diverge, so without this the crop path drifts further out of
 * step with the picture the longer the video runs — the subject slides out of
 * frame near the end while the start looks fine.
 */
export function retimeTrack(track: ReframeTrack, mapper: SourceToOutput): ReframeTrack {
  const keyframes: ReframeKeyframe[] = [];

  for (const kf of track.keyframes) {
    const outSec = mapper.toOutput(kf.outSec);
    // Keyframes inside a removed region have no output time — drop them; the
    // neighbours on either side interpolate across the splice.
    if (outSec === null) continue;
    keyframes.push({ ...kf, outSec });
  }

  keyframes.sort((a, b) => a.outSec - b.outSec);

  // A track with nothing left still has to frame the shot.
  if (!keyframes.length) {
    const first = track.keyframes[0];
    return {
      method: 'center',
      keyframes: [{ outSec: 0, cx: first?.cx ?? 0.5, cy: first?.cy ?? 0.42, w: first?.w ?? 1 }],
    };
  }

  return { ...track, keyframes };
}

/** The slice of TimeMapper this module needs, kept narrow to avoid a cycle. */
export interface SourceToOutput {
  toOutput(sourceSec: number): number | null;
}

/**
 * Samples the track at an arbitrary output time. Used by the renderer, which
 * needs a value every frame, not just at keyframes.
 */
export function sampleReframe(track: ReframeTrack, outSec: number): ReframeKeyframe {
  const kf = track.keyframes;
  if (!kf.length) return { outSec, cx: 0.5, cy: 0.5, w: 1 };
  if (outSec <= kf[0].outSec) return kf[0];
  if (outSec >= kf[kf.length - 1].outSec) return kf[kf.length - 1];

  for (let i = 1; i < kf.length; i++) {
    if (outSec <= kf[i].outSec) {
      const a = kf[i - 1];
      const b = kf[i];
      const span = b.outSec - a.outSec || 1;
      const t = (outSec - a.outSec) / span;
      // Smoothstep rather than linear — a linear ramp has a visible corner at
      // each keyframe when the crop changes direction.
      const e = t * t * (3 - 2 * t);
      return {
        outSec,
        cx: a.cx + (b.cx - a.cx) * e,
        cy: a.cy + (b.cy - a.cy) * e,
        w: a.w + (b.w - a.w) * e,
      };
    }
  }
  return kf[kf.length - 1];
}
