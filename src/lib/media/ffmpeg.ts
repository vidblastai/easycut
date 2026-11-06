import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

/**
 * Thin, typed wrappers over ffmpeg/ffprobe.
 *
 * Binaries come from `ffmpeg-static` / `ffprobe-static` so a clone works with no
 * system install, but a system ffmpeg on PATH wins when present — it is usually
 * built with more codecs and hardware acceleration.
 */

const require_ = createRequire(import.meta.url);

/**
 * `load` is passed as a thunk with a LITERAL require inside rather than a
 * package-name string, so bundlers can see the dependency. A variable specifier
 * here compiles to "the request of a dependency is an expression" and the
 * bundled binary path resolves to nothing at runtime.
 */
function resolveBinary(load: () => unknown, envVar: string, fallback: string): string {
  const override = process.env[envVar];
  if (override) return override;
  try {
    const resolved = load() as string | { path?: string; default?: string };
    const path = typeof resolved === 'string' ? resolved : resolved?.path ?? resolved?.default;
    if (typeof path === 'string' && path.length) return path;
  } catch {
    /* not installed — fall through to whatever is on PATH */
  }
  return fallback;
}

export const FFMPEG = resolveBinary(() => require_('ffmpeg-static'), 'FFMPEG_PATH', 'ffmpeg');
export const FFPROBE = resolveBinary(() => require_('ffprobe-static'), 'FFPROBE_PATH', 'ffprobe');

export interface RunResult {
  stdout: string;
  stderr: string;
}

export async function run(binary: string, args: string[], options: { timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`${binary} timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs)
      : null;

    child.stdout.on('data', (d) => (stdout += d.toString()));
    // ffmpeg is chatty on stderr; cap it so a long encode can't eat memory.
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${binary} exited ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

export const ffmpeg = (args: string[], options?: { timeoutMs?: number }) => run(FFMPEG, args, options);
export const ffprobe = (args: string[], options?: { timeoutMs?: number }) => run(FFPROBE, args, options);

/* ---------------------------------------------------------------- probing */

export interface MediaInfo {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string;
  audioCodec: string | null;
  bitrate: number;
  /** Rotation metadata — phone footage is routinely 1920×1080 tagged 90°. */
  rotation: number;
  sizeBytes: number;
}

export async function probe(filePath: string): Promise<MediaInfo> {
  const { stdout } = await ffprobe([
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);

  const json = JSON.parse(stdout);
  const streams: any[] = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  if (!video) throw new Error('No video stream found — is this an audio file?');

  const rotation = readRotation(video);
  const rawWidth = Number(video.width) || 0;
  const rawHeight = Number(video.height) || 0;
  // A 90°/270° rotation means the displayed frame is the transpose of the stored one.
  const swapped = Math.abs(rotation) === 90 || Math.abs(rotation) === 270;

  return {
    durationSec: Number(json.format?.duration) || Number(video.duration) || 0,
    width: swapped ? rawHeight : rawWidth,
    height: swapped ? rawWidth : rawHeight,
    fps: parseFps(video.avg_frame_rate ?? video.r_frame_rate),
    hasAudio: Boolean(audio),
    videoCodec: video.codec_name ?? 'unknown',
    audioCodec: audio?.codec_name ?? null,
    bitrate: Number(json.format?.bit_rate) || 0,
    rotation,
    sizeBytes: Number(json.format?.size) || 0,
  };
}

function readRotation(stream: any): number {
  const tagged = Number(stream?.tags?.rotate);
  if (Number.isFinite(tagged)) return tagged;
  const matrix = (stream.side_data_list ?? []).find((s: any) => s.rotation !== undefined);
  return matrix ? Number(matrix.rotation) || 0 : 0;
}

function parseFps(value: string | undefined): number {
  if (!value) return 30;
  const [num, den] = value.split('/').map(Number);
  if (!den) return num || 30;
  const fps = num / den;
  return Number.isFinite(fps) && fps > 0 ? fps : 30;
}

/* ------------------------------------------------------------- extraction */

/**
 * Extracts speech-optimised audio for ASR: 16 kHz mono PCM.
 *
 * Every ASR provider resamples to roughly this internally, so sending anything
 * richer just means uploading a bigger file. For a 10-minute video this is the
 * difference between a 19 MB upload and a 1 GB one.
 */
export async function extractAudioForAsr(videoPath: string, outputPath: string): Promise<void> {
  await ffmpeg([
    '-y', '-i', videoPath,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'pcm_s16le',
    outputPath,
  ]);
}

/** Full-quality audio for the final mix. */
export async function extractAudio(videoPath: string, outputPath: string): Promise<void> {
  await ffmpeg(['-y', '-i', videoPath, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', outputPath]);
}

/**
 * A small proxy for browser scrubbing and for the face tracker.
 *
 * Seeking around a 4K H.265 file in a `<video>` element is painful; seeking a
 * 540p H.264 proxy is instant. The editor preview is entirely proxy-driven,
 * which is what makes tweaking feel free.
 */
export async function makeProxy(videoPath: string, outputPath: string, shortSide = 540): Promise<void> {
  await ffmpeg([
    '-y', '-i', videoPath,
    /*
     * The SHORT side, not the height.
     *
     * Scaling the height of a vertical video to 540 leaves 304 pixels across,
     * which is a thumbnail rather than a preview — and vertical is what most
     * of this product's footage is. Measured on the short side, a portrait
     * clip comes out 540×960 and a landscape one 960×540: the same half a
     * megapixel either way, which is what makes the decode cheap.
     */
    '-vf', `scale='if(gt(iw,ih),-2,${shortSide})':'if(gt(iw,ih),${shortSide},-2)':flags=fast_bilinear`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '28',
    /*
     * A keyframe every twelve frames, and this is the whole point of the file.
     *
     * A cut in the edit is a SEEK in this file, and a seek can only start at a
     * keyframe: the decoder jumps to the one before the target and decodes
     * forward to it. At a keyframe every 48 frames that is up to a second and
     * a half of frames to chew through before a single one can be shown —
     * which is the freeze at every cut, paid again for every cut, while the
     * captions carry on regardless.
     *
     * Twelve frames is under half a second of decode in the worst case, and
     * `-keyint_min` with the scene-cut detector off makes it exact rather
     * than a suggestion x264 is free to ignore. It costs perhaps a third more
     * bytes on a file that is under two megabytes.
     */
    '-g', '12',
    '-keyint_min', '12',
    '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    outputPath,
  ]);
}

/**
 * A copy of the source at the resolution the render actually needs.
 *
 * The renderer pulls one frame at a time out of the source file. From 4K
 * HEVC — which is what a phone hands you — that decode is the single most
 * expensive thing in an export, and it is paid per frame for footage that is
 * then scaled down to 1080 anyway. On a small container it does not merely go
 * slowly: parallel 4K decodes exhaust the renderer's memory and the browser
 * tab dies mid-frame, which surfaces as a frame that never rendered.
 *
 * So the source is transcoded once, to H.264 at the size the output can use,
 * and the render reads from that. `longEdge` is deliberately above the output's
 * own long edge: a punch-in crops into the picture and zooms, and it should
 * find real pixels there rather than an upscale.
 *
 * CRF 18 at that size is visually transparent, and it is an intermediate — it
 * is never what anybody downloads.
 */
export async function makeRenderSource(
  videoPath: string,
  outputPath: string,
  longEdge: number,
): Promise<void> {
  await ffmpeg([
    '-y', '-i', videoPath,
    // Scale the LONG edge, whichever way round the footage is, and keep the
    // other side even (H.264 requires it).
    '-vf', `scale='if(gt(iw,ih),${longEdge},-2)':'if(gt(iw,ih),-2,${longEdge})':flags=bicubic`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    // The final mix is built from the original audio, so this carries none.
    '-an',
    '-movflags', '+faststart',
    outputPath,
  ]);
}

export async function extractFrame(videoPath: string, atSec: number, outputPath: string, width = 640): Promise<void> {
  await ffmpeg([
    '-y',
    // -ss before -i is the fast (keyframe) seek; exact enough for a thumbnail.
    '-ss', atSec.toFixed(3),
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', `scale=${width}:-2`,
    outputPath,
  ]);
}

/* ------------------------------------------------------ silence detection */

export interface SilenceInterval {
  startSec: number;
  endSec: number;
}

/**
 * Runs ffmpeg's `silencedetect` and parses its log output.
 *
 * `-50 dB` with a 150 ms floor is tuned for a room-recorded talking head: quiet
 * enough not to trip on room tone or breathing, short enough to catch the gaps
 * between sentences.
 */
export async function detectSilence(
  audioPath: string,
  noiseDb = -50,
  minDurationSec = 0.15,
): Promise<SilenceInterval[]> {
  const { stderr } = await ffmpeg([
    '-i', audioPath,
    '-af', `silencedetect=noise=${noiseDb}dB:d=${minDurationSec}`,
    '-f', 'null', '-',
  ]);

  const intervals: SilenceInterval[] = [];
  let pendingStart: number | null = null;

  for (const line of stderr.split('\n')) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) {
      pendingStart = Math.max(0, Number(start[1]));
      continue;
    }
    const end = line.match(/silence_end:\s*([\d.]+)/);
    if (end && pendingStart !== null) {
      intervals.push({ startSec: pendingStart, endSec: Number(end[1]) });
      pendingStart = null;
    }
  }
  return intervals;
}

/**
 * The silence threshold for this recording, from its own loudness.
 *
 * A fixed -50 dB was tuned on a quiet room, and on a real upload it heard the
 * speaker's breaths as sound: none of the eleven breath pauses between
 * sentences (4.3 s in a minute) was ever a candidate, and all of them stayed
 * in the cut. Seven decibels under the recording's mean level puts the line
 * between breath and voice for that microphone and that room; it is held
 * between -50 and -38 dB so a very quiet or very hot recording cannot push it
 * somewhere silly. Words are protected downstream either way — a silence the
 * transcript puts a word's centre inside is never cut.
 */
export async function silenceThresholdFor(audioPath: string): Promise<number> {
  const { stderr } = await ffmpeg(['-i', audioPath, '-af', 'volumedetect', '-f', 'null', '-']);
  const mean = Number(stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/)?.[1]);
  if (!Number.isFinite(mean)) return -50;
  return Math.max(-50, Math.min(-38, Math.round(mean - 7)));
}

/**
 * How loud the recording is, every `stepSec`, as RMS in dBFS.
 *
 * The cut uses it to check that no edge lands inside a sound. The audio is
 * streamed and folded into frames as it arrives, so a long upload costs a
 * float per 10 ms, not its whole PCM in memory.
 */
export async function loudnessEnvelope(
  audioPath: string,
  stepSec = 0.01,
): Promise<{ stepSec: number; db: Float32Array }> {
  const rate = 16000;
  const per = Math.max(1, Math.round(rate * stepSec));
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-v', 'error', '-i', audioPath, '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const values: number[] = [];
    let sum = 0;
    let count = 0;
    let carry: Buffer | null = null;
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('loudness scan timed out'));
    }, 10 * 60_000);
    child.stdout.on('data', (chunk: Buffer) => {
      const buf: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk;
      const samples = buf.length >> 1;
      for (let i = 0; i < samples; i++) {
        const v = buf.readInt16LE(i * 2);
        sum += v * v;
        if (++count === per) {
          values.push(10 * Math.log10(Math.max(1, sum / per) / (32768 * 32768)));
          sum = 0;
          count = 0;
        }
      }
      carry = buf.length & 1 ? buf.subarray(buf.length - 1) : null;
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < 4000) stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stepSec: per / rate, db: Float32Array.from(values) });
      else reject(new Error(`loudness scan failed: ${stderr.slice(-500)}`));
    });
  });
}

/** Integrated loudness, so we know how hard to push the normaliser. */
export async function measureLoudness(audioPath: string): Promise<{ lufs: number; peakDb: number }> {
  const { stderr } = await ffmpeg(['-i', audioPath, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const lufs = Number(stderr.match(/I:\s*(-?[\d.]+)\s*LUFS/)?.[1] ?? -23);
  const peakDb = Number(stderr.match(/Peak:\s*(-?[\d.]+)\s*dBFS/)?.[1] ?? -1);
  return { lufs, peakDb };
}
