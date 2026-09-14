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
export async function makeProxy(videoPath: string, outputPath: string, height = 540): Promise<void> {
  await ffmpeg([
    '-y', '-i', videoPath,
    '-vf', `scale=-2:${height}:flags=fast_bilinear`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '28',
    '-g', '48',
    '-c:a', 'aac', '-b:a', '96k',
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

/** Integrated loudness, so we know how hard to push the normaliser. */
export async function measureLoudness(audioPath: string): Promise<{ lufs: number; peakDb: number }> {
  const { stderr } = await ffmpeg(['-i', audioPath, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const lufs = Number(stderr.match(/I:\s*(-?[\d.]+)\s*LUFS/)?.[1] ?? -23);
  const peakDb = Number(stderr.match(/Peak:\s*(-?[\d.]+)\s*dBFS/)?.[1] ?? -1);
  return { lufs, peakDb };
}
