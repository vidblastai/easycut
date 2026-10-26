import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { env } from '@/lib/config/env';
import { FFMPEG, FFPROBE } from '@/lib/media/ffmpeg';

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
