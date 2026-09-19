import { join } from 'node:path';
import { ffmpeg, ffprobe } from '@/lib/media/ffmpeg';

/**
 * Putting a freshly-rendered stretch back into a video that already exists.
 *
 * The saving is the whole point of incremental rendering, but the risk is that
 * a video comes out one frame short, or a frame out of sync with its own
 * audio, and nobody notices until a customer does. So every step here is
 * counted in FRAMES rather than seconds, and there are three specific traps it
 * is built to avoid — each one found by measuring, not by reading:
 *
 *  1. **`-t`/`-to` cut by time and land where they like.** Asking for "four
 *     seconds" of a 30 fps video gave 119 frames one side of a join and 121
 *     the other. `-frames:v` asks for a count and gives that count.
 *
 *  2. **The concat demuxer drops a frame at every join.** The pieces'
 *     timestamps collide where they meet and one of the two is discarded —
 *     392 frames in, 391 out, silently. `-fflags +genpts` makes the muxer
 *     number the frames itself and the count comes out exact.
 *
 *  3. **`-shortest` truncates the video to the audio.** The audio track is a
 *     few milliseconds shorter than the video it was muxed with, so re-muxing
 *     with `-shortest` quietly removes the last frame — every time, so ten
 *     edits cost ten frames off the end.
 *
 * The audio is never re-encoded or re-cut: an incremental render only happens
 * when nothing audible changed (see `renderDelta`), so the previous render's
 * audio track is carried over whole. That is a saving in its own right — no
 * re-extraction, no re-mix — and it removes drift as a category, because there
 * is only ever one audio track and it is the original one.
 */

/**
 * The keyframe timestamps in a window of the file.
 *
 * Reading every frame's metadata on a ten-minute video costs seconds, so this
 * only ever reads the stretch it is asked about.
 */
async function keyframesBetween(videoPath: string, fromSec: number, toSec: number): Promise<number[]> {
  const start = Math.max(0, fromSec);
  const { stdout } = await ffprobe([
    '-v', 'error',
    '-select_streams', 'v:0',
    '-read_intervals', `${start.toFixed(3)}%${Math.max(start, toSec).toFixed(3)}`,
    '-show_frames',
    '-show_entries', 'frame=key_frame,best_effort_timestamp_time',
    '-of', 'csv=p=0',
    videoPath,
  ]);

  const times: number[] = [];
  for (const line of stdout.split('\n')) {
    const [isKey, at] = line.trim().split(',');
    if (isKey !== '1') continue;
    const t = Number(at);
    if (Number.isFinite(t)) times.push(t);
  }
  return times.sort((a, b) => a - b);
}

/**
 * A keyframe at or before this time — where a copied HEAD can end.
 *
 * Snapping backwards only ever redraws more than was asked for, which is safe.
 */
export async function keyframeAtOrBefore(videoPath: string, sec: number): Promise<number> {
  if (sec <= 0) return 0;
  const times = await keyframesBetween(videoPath, 0, sec + 0.5);
  let best = 0;
  for (const t of times) if (t <= sec + 1e-6 && t > best) best = t;
  return best;
}

/**
 * A keyframe at or after this time — where a copied TAIL must begin.
 *
 * This is the one that is easy to get wrong, and getting it wrong is silent.
 * `-ss` before an input seeks to the keyframe at or BEFORE the time given, and
 * with `-c copy` there is nothing to discard afterwards — so a tail asked to
 * start mid-GOP actually starts at the keyframe before it and the frames in
 * between are emitted twice. Measured on a real edit: 406 frames where there
 * should have been 392.
 *
 * So the chunk is extended forwards to the next keyframe instead, which costs
 * at most one GOP of extra rendering — a second, at the keyframe interval the
 * renderer now uses. Returns null when there is no keyframe left, meaning the
 * chunk should simply run to the end.
 */
export async function keyframeAtOrAfter(
  videoPath: string,
  sec: number,
  searchSec = 12,
): Promise<number | null> {
  const times = await keyframesBetween(videoPath, sec - 0.001, sec + searchSec);
  for (const t of times) if (t >= sec - 1e-6) return t;
  return null;
}

/** How many frames a file has, counted rather than derived from its duration. */
export async function frameCount(videoPath: string): Promise<number> {
  const { stdout } = await ffprobe([
    '-v', 'error',
    '-select_streams', 'v:0',
    '-count_frames',
    '-show_entries', 'stream=nb_read_frames',
    '-of', 'csv=p=0',
    videoPath,
  ]);
  const n = Number(stdout.trim().split('\n')[0]);
  return Number.isFinite(n) ? n : 0;
}

export interface SpliceInput {
  /** The render we are amending. Its video stream and its audio are reused. */
  previousPath: string;
  /** The freshly rendered stretch, silent, already the right size and fps. */
  chunkPath: string;
  /** Where the chunk begins, in frames from the start of the video. */
  fromFrame: number;
  workDir: string;
  outputPath: string;
}

/**
 * Old head + new middle + old tail, then the old audio back on top.
 *
 * Returns the frame count of the result so the caller can check it against the
 * original. That check is not paranoia: every failure this function can have
 * is a silent one.
 */
export async function spliceVideo(input: SpliceInput): Promise<{ frames: number }> {
  const { previousPath, chunkPath, fromFrame, workDir, outputPath } = input;

  const oldVideo = join(workDir, 'splice-old.mp4');
  const head = join(workDir, 'splice-head.mp4');
  const tail = join(workDir, 'splice-tail.mp4');
  const joined = join(workDir, 'splice-joined.mp4');
  const list = join(workDir, 'splice-list.txt');

  // Strip the audio once, up front. Every cut below then deals with one stream,
  // which is the only way the frame counts stay honest.
  await ffmpeg(['-v', 'error', '-y', '-i', previousPath, '-an', '-c', 'copy', oldVideo]);

  const chunkFrames = await frameCount(chunkPath);
  const toFrame = fromFrame + chunkFrames;

  const pieces: string[] = [];

  if (fromFrame > 0) {
    await ffmpeg(['-v', 'error', '-y', '-i', oldVideo, '-frames:v', String(fromFrame), '-c', 'copy', head]);
    pieces.push(head);
  }

  pieces.push(chunkPath);

  const oldFrames = await frameCount(oldVideo);
  if (toFrame < oldFrames) {
    // `-ss` before `-i` seeks by keyframe, which is what makes the tail a copy
    // rather than a re-encode — so the caller must have ended the chunk ON a
    // keyframe. `spliceAt` below is how that is arranged; the frame count
    // returned at the end is what catches it if it was not.
    const fps = await frameRate(oldVideo);
    await ffmpeg([
      '-v', 'error', '-y',
      '-ss', (toFrame / fps).toFixed(6),
      '-i', oldVideo,
      '-c', 'copy',
      tail,
    ]);
    pieces.push(tail);
  }

  const { writeFile } = await import('node:fs/promises');
  await writeFile(list, pieces.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');

  await ffmpeg([
    '-v', 'error', '-y',
    // See trap (2). Without this the join silently eats a frame.
    '-fflags', '+genpts',
    '-f', 'concat', '-safe', '0', '-i', list,
    '-c', 'copy',
    joined,
  ]);

  // The previous render's audio, untouched, and no `-shortest` — see trap (3).
  await ffmpeg([
    '-v', 'error', '-y',
    '-i', joined,
    '-i', previousPath,
    '-map', '0:v:0', '-map', '1:a:0?',
    '-c', 'copy',
    outputPath,
  ]);

  return { frames: await frameCount(outputPath) };
}

async function frameRate(videoPath: string): Promise<number> {
  const { stdout } = await ffprobe([
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', videoPath,
  ]);
  const [num, den] = stdout.trim().split('/').map(Number);
  const fps = den ? num / den : num;
  return Number.isFinite(fps) && fps > 0 ? fps : 30;
}
