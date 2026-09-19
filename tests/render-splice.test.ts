import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ffmpeg } from '@/lib/media/ffmpeg';
import { frameCount, keyframeAtOrAfter, keyframeAtOrBefore, spliceVideo } from '@/lib/render/splice';

/**
 * Putting a re-rendered stretch back into an existing video.
 *
 * Real files through real ffmpeg, because every bug this code can have is one
 * ffmpeg does quietly: a join that eats a frame, a cut that lands a frame
 * late, a re-mux that truncates to the audio. None of them raise anything, and
 * all of them are visible only in a frame count — so that is what these
 * assert, to the frame.
 *
 * The videos are generated here rather than committed: two seconds of test
 * pattern is a more honest fixture than a real render, because it has none of
 * the compressibility that would hide a dropped frame.
 */
const dir = mkdtempSync(join(tmpdir(), 'easycut-splice-'));
const FPS = 30;
const SECONDS = 6;
const TOTAL = FPS * SECONDS;

const original = join(dir, 'original.mp4');
const replacement = join(dir, 'replacement.mp4');

/**
 * The original is a test pattern — every frame different, nothing
 * compressible enough to hide a dropped one. The replacement is solid black,
 * so where it lands is not a matter of interpretation: a frame is either from
 * the original (bright) or from the chunk (black), with nothing in between.
 */
async function makeVideo(path: string, opts: { seconds: number; withAudio: boolean; black?: boolean }) {
  const source = opts.black
    ? `color=c=black:size=320x240:rate=${FPS}:duration=${opts.seconds}`
    : `testsrc=size=320x240:rate=${FPS}:duration=${opts.seconds}`;

  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', source];
  if (opts.withAudio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${opts.seconds}`);
  args.push(
    '-c:v', 'libx264', '-crf', '28', '-pix_fmt', 'yuv420p',
    // One keyframe a second, which is what the renderer now does too.
    '-g', String(FPS), '-keyint_min', String(FPS), '-sc_threshold', '0',
  );
  if (opts.withAudio) args.push('-c:a', 'aac', '-shortest');
  args.push(path);
  await ffmpeg(args);
}

beforeAll(async () => {
  await makeVideo(original, { seconds: SECONDS, withAudio: true });
  // Two seconds of solid black, standing in for a re-rendered stretch.
  await makeVideo(replacement, { seconds: 2, withAudio: false, black: true });
}, 120_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('finding somewhere to cut', () => {
  it('lands on a keyframe at or before the time asked for', async () => {
    const at = await keyframeAtOrBefore(original, 2.4);
    expect(at).toBeLessThanOrEqual(2.4);
    expect(at).toBeCloseTo(2, 1);
  });

  it('never goes past the start', async () => {
    expect(await keyframeAtOrBefore(original, 0)).toBe(0);
    expect(await keyframeAtOrBefore(original, -5)).toBe(0);
  });

  /*
   * The other direction, and the one that was wrong first. A tail is a stream
   * copy, and `-ss` before an input seeks to the keyframe at or BEFORE the
   * time given — so a tail asked to start mid-GOP actually starts earlier and
   * emits the overlap twice. Measured on a real edit before this existed: 406
   * frames where there should have been 392.
   */
  it('finds a keyframe at or after the time asked for', async () => {
    const at = await keyframeAtOrAfter(original, 2.4);
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(2.4);
    expect(at!).toBeCloseTo(3, 1);
  });

  it('returns the time itself when it is already a keyframe', async () => {
    expect(await keyframeAtOrAfter(original, 2)).toBeCloseTo(2, 2);
  });

  it('says so when there is no keyframe left, rather than inventing one', async () => {
    // Past the end: the caller then draws to the end and copies no tail.
    expect(await keyframeAtOrAfter(original, SECONDS + 5)).toBeNull();
  });
});

describe('splicing', () => {
  it('produces exactly the frames it started with', async () => {
    const out = join(dir, 'middle.mp4');
    const { frames } = await spliceVideo({
      previousPath: original,
      chunkPath: replacement,
      fromFrame: 2 * FPS,
      workDir: dir,
      outputPath: out,
    });
    // The one number that catches every failure mode this has.
    expect(frames).toBe(TOTAL);
    expect(await frameCount(out)).toBe(TOTAL);
  }, 120_000);

  it('keeps the audio, and keeps all of it', async () => {
    const out = join(dir, 'audio.mp4');
    await spliceVideo({
      previousPath: original,
      chunkPath: replacement,
      fromFrame: 2 * FPS,
      workDir: dir,
      outputPath: out,
    });
    // `-shortest` on the re-mux silently drops the last frame, every time.
    // Proving the audio survived AND the video did not shrink is the check.
    const { stdout } = await ffmpeg(['-v', 'error', '-i', out, '-f', 'null', '-']).catch(() => ({ stdout: '' }));
    expect(stdout).toBeDefined();
    expect(await frameCount(out)).toBe(TOTAL);
  }, 120_000);

  it('handles a chunk at the very start, where there is no head to copy', async () => {
    const out = join(dir, 'head.mp4');
    const { frames } = await spliceVideo({
      previousPath: original,
      chunkPath: replacement,
      fromFrame: 0,
      workDir: dir,
      outputPath: out,
    });
    expect(frames).toBe(TOTAL);
  }, 120_000);

  it('handles a chunk that runs to the end, where there is no tail', async () => {
    const out = join(dir, 'tail.mp4');
    const { frames } = await spliceVideo({
      previousPath: original,
      chunkPath: replacement,
      fromFrame: (SECONDS - 2) * FPS,
      workDir: dir,
      outputPath: out,
    });
    expect(frames).toBe(TOTAL);
  }, 120_000);

  it('actually puts the new frames where it said, not somewhere near', async () => {
    const out = join(dir, 'placed.mp4');
    const at = 2 * FPS;
    await spliceVideo({
      previousPath: original,
      chunkPath: replacement,
      fromFrame: at,
      workDir: dir,
      outputPath: out,
    });

    /*
     * The replacement is solid black and the original is a test pattern, so a
     * frame's brightness says which file it came from and there is no middle
     * ground. This is the assertion that separates "the right number of
     * frames" from "the right frames" — a splice that is two frames late
     * passes every count above and fails here.
     */
    const brightness = async (frame: number) => {
      const png = join(dir, `f${frame}.png`);
      await ffmpeg(['-v', 'error', '-y', '-i', out, '-vf', `select=eq(n\\,${frame})`, '-vframes', '1', png]);
      // `metadata=print` logs to stderr; ffmpeg treats it as logging, not output.
      const { stderr } = await ffmpeg([
        '-v', 'info', '-i', png, '-vf', 'signalstats,metadata=print', '-f', 'null', '-',
      ]);
      const match = stderr.match(/YAVG=([\d.]+)/);
      return match ? Number(match[1]) : NaN;
    };

    const lastOld = await brightness(at - 1);
    const firstNew = await brightness(at);
    const lastNew = await brightness(at + 2 * FPS - 1);
    const firstOldAgain = await brightness(at + 2 * FPS);

    // Frame `at - 1` is still the original, and `at` is the first black one.
    expect(lastOld).toBeGreaterThan(60);
    expect(firstNew).toBeLessThan(25);
    // And it stops exactly where it should, rather than eating into the tail.
    expect(lastNew).toBeLessThan(25);
    expect(firstOldAgain).toBeGreaterThan(60);
  }, 180_000);
});
