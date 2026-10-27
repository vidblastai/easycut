import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { env } from '@/lib/config/env';
import { FFMPEG, FFPROBE, ffmpeg } from '@/lib/media/ffmpeg';

/**
 * HyperFrames, driven as a CLI.
 *
 * It is a CLI rather than a library on purpose: a render opens a browser and
 * a pool of capture workers, and a child process is the one boundary that
 * guarantees all of that is gone when the clip is written — or when it hangs
 * and is killed. Every scene renders in its own directory, so two scenes in
 * flight cannot read each other's `index.html`.
 */

const require_ = createRequire(import.meta.url);

/** The CLI entry, run with this Node rather than through npx. */
function cliPath(): string {
  return join(dirname(require_.resolve('hyperframes/package.json')), 'bin', 'hyperframes.mjs');
}

/**
 * The headless Chrome to capture with.
 *
 * Remotion has already downloaded one into `node_modules/.remotion` — the
 * Dockerfile does it at build time — and a second 150MB browser in the image
 * for the same job would be waste. Unset and absent, HyperFrames installs its
 * own on first use.
 */
export function browserPath(): string | undefined {
  if (env.scenes.hyperframesBrowserPath) return env.scenes.hyperframesBrowserPath;
  if (env.render.browserExecutable) return env.render.browserExecutable;
  const remotion = join(
    process.cwd(),
    'node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell',
  );
  return existsSync(remotion) ? remotion : undefined;
}

function childEnv(): NodeJS.ProcessEnv {
  const browser = browserPath();
  return {
    ...process.env,
    // A worker has no business phoning home or prompting for upgrades.
    HYPERFRAMES_NO_TELEMETRY: '1',
    HF_CLI_TELEMETRY_DISABLED: '1',
    DO_NOT_TRACK: '1',
    HYPERFRAMES_NO_UPDATE_CHECK: '1',
    HYPERFRAMES_NO_CAPTURE_DOTENV: '1',
    // The image has no system ffmpeg; the npm-shipped binaries are the ones.
    HYPERFRAMES_FFMPEG_PATH: process.env.HYPERFRAMES_FFMPEG_PATH ?? FFMPEG,
    HYPERFRAMES_FFPROBE_PATH: process.env.HYPERFRAMES_FFPROBE_PATH ?? FFPROBE,
    ...(browser ? { HYPERFRAMES_BROWSER_PATH: browser } : {}),
  };
}

function runCli(args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath(), ...args], { cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`hyperframes ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d.toString();
      if (stdout.length > 400_000) stdout = stdout.slice(-200_000);
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Writes the composition into a fresh project directory. */
export async function writeProject(dir: string, html: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), html);
}

interface Finding {
  severity?: string;
  message?: string;
  code?: string;
  fix?: string;
}

/**
 * HyperFrames' own lint, as a list of faults worth a repair round.
 *
 * Errors only: a warning is advice about editability in their Studio, which
 * nobody will open for a scene that exists for four seconds.
 */
export async function lintProject(dir: string): Promise<string[]> {
  const { stdout } = await runCli(['lint', dir, '--json'], dir, 60_000);
  const json = stdout.slice(stdout.indexOf('{'));
  try {
    const report = JSON.parse(json) as { findings?: Finding[] };
    return (report.findings ?? [])
      .filter((finding) => finding.severity === 'error')
      .map((finding) => `${finding.message ?? finding.code ?? 'lint error'}${finding.fix ? ` (fix: ${finding.fix})` : ''}`);
  } catch {
    return [];
  }
}

export interface HyperframesRenderOptions {
  fps: number;
  /** `draft` for previews, `looks` otherwise. */
  quality?: 'draft' | 'looks' | 'delivery';
  timeoutMs?: number;
}

/**
 * Renders `dir/index.html` to `outPath`.
 *
 * Silent by construction — the composition has no audio — so the clip can sit
 * under the edit's own mix without a mute.
 */
export async function renderProject(dir: string, outPath: string, options: HyperframesRenderOptions): Promise<void> {
  const args = [
    'render',
    dir,
    '-o',
    outPath,
    '-f',
    String(options.fps),
    '-q',
    options.quality ?? 'looks',
    '-w',
    String(Math.max(1, Math.min(4, env.render.concurrency))),
    '--quiet',
  ];
  const result = await runCli(args, dir, options.timeoutMs ?? 5 * 60_000);
  if (result.code !== 0 || !existsSync(outPath)) {
    const tail = (result.stderr || result.stdout).trim().split('\n').slice(-6).join(' | ');
    throw new Error(`hyperframes render failed (${result.code}): ${tail.slice(0, 400)}`);
  }
}

/**
 * Errors the page throws when it actually runs in a browser.
 *
 * The lint reads the source; this loads it. A typo in the model's script —
 * one undefined variable — stops the timeline being built at all, and the
 * render is then the bare ground for the whole scene. That reads as a clean
 * lint and a silent failure unless something runs the page.
 */
export async function validateProject(dir: string): Promise<string[]> {
  const { stdout } = await runCli(['validate', dir, '--json', '--no-contrast'], dir, 90_000);
  try {
    const report = JSON.parse(stdout.slice(stdout.indexOf('{'))) as { errors?: Array<{ text?: string } | string> };
    return (report.errors ?? [])
      .map((error) => (typeof error === 'string' ? error : error.text ?? ''))
      .filter(Boolean)
      .map((text) => `The page throws when it runs: ${text.slice(0, 300)}`);
  } catch {
    return [];
  }
}

export interface Snapshot {
  /** One labelled contact sheet — what the reviewing model is shown. */
  sheet: string;
  /** The full-size stills behind it, for the blank check. */
  frames: string[];
}

/**
 * Stills of the scene at the given times, as one labelled contact sheet.
 *
 * The sheet rather than the frames because it is what the reviewing model is
 * shown: one image of a couple of hundred kilobytes with the times printed on
 * it, against four full-size PNGs of most of a megabyte each.
 */
export async function snapshotProject(dir: string, times: number[], outDir: string): Promise<Snapshot> {
  const args = ['snapshot', dir, '--at', times.join(','), '--no-end', '-o', outDir, '--json'];
  const result = await runCli(args, dir, 90_000);
  const json = result.stdout.slice(result.stdout.indexOf('{'));
  try {
    const report = JSON.parse(json) as { ok?: boolean; contactSheets?: string[]; frames?: Array<string | { path?: string }> };
    const sheet = report.contactSheets?.[0];
    const frames = (report.frames ?? [])
      .map((frame) => (typeof frame === 'string' ? frame : frame.path ?? ''))
      .filter((path) => path && existsSync(path));
    if (report.ok && sheet && existsSync(sheet)) return { sheet, frames };
  } catch {
    /* fall through to the error below */
  }
  throw new Error(`hyperframes snapshot failed (${result.code})`);
}

/** Below this luma spread a picture is one flat colour — the bare ground. */
const FLAT_SPREAD = 12;

/**
 * True when every picture sampled from `path` is one flat colour.
 *
 * `path` is a still or a clip; a clip is sampled twice a second. The test is
 * the spread between the darkest and brightest pixel, so it does not care
 * what colour the ground is — only that nothing is drawn on it.
 */
export async function isBlank(path: string): Promise<boolean> {
  // A still through `fps` comes out as no frames at all, so only clips are thinned.
  const filter = /\.(png|jpe?g|webp)$/i.test(path) ? 'signalstats,metadata=mode=print' : 'fps=2,signalstats,metadata=mode=print';
  const { stderr } = await ffmpeg(
    ['-hide_banner', '-i', path, '-vf', filter, '-an', '-f', 'null', '-'],
    { timeoutMs: 60_000 },
  );
  const mins = [...stderr.matchAll(/lavfi\.signalstats\.YMIN=(\d+)/g)].map((m) => Number(m[1]));
  const maxs = [...stderr.matchAll(/lavfi\.signalstats\.YMAX=(\d+)/g)].map((m) => Number(m[1]));
  if (!mins.length || mins.length !== maxs.length) return false;
  return mins.every((min, i) => maxs[i] - min < FLAT_SPREAD);
}

/** True when every one of the stills is blank. */
export async function allBlank(paths: string[]): Promise<boolean> {
  if (!paths.length) return false;
  for (const path of paths) if (!(await isBlank(path))) return false;
  return true;
}
