import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { auditComposition, buildCompositionHtml, parseComposition, safeZone, type WordCue } from '../src/lib/director/hyperframe';
import type { SceneLook } from '../src/lib/edl/types';
import { FFMPEG, FFPROBE } from '../src/lib/media/ffmpeg';
import { isBlank, lintProject, renderProject, validateProject, writeProject } from '../src/lib/render/hyperframes';
import { styleGuideFor } from '../src/lib/scenes/style-guides';

/**
 * Render a hand-written scene the way it will ship, and lay it out for judging.
 *
 *   npx tsx scripts/scene-preview.ts <scene.txt> <look> [--voice clip.mp4] [--words words.json:key] [--seconds N] [--out dir]
 *
 * This is the loop the reference scenes in `src/lib/director/references` were
 * made in (see `.claude/skills/scene-design/SKILL.md`): write the three blocks,
 * render, look at the sheet, fix, render again. It runs every check the
 * pipeline runs — the audit, HyperFrames' lint, a real page load for script
 * errors, the blank test — and writes, next to the clip:
 *
 *   - `<name>.mp4`        the scene with the voice laid under it, to watch;
 *   - `<name>.sheet.png`  eight frames across the shot, with everything outside
 *                         the platforms' safe area tinted red — a frame where
 *                         something that matters is in the red is a fault.
 *
 * Word timings come from `--words file.json:key` (the shape of
 * `references/words.json`), so a beat lands where it will land live; without
 * them the words are spread evenly. The voice and the timings are made by
 * `scripts/voice-lines.py`.
 */

const WIDTH = 1080;
const HEIGHT = 1920;

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
}

function duration(file: string): number {
  return Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
}

/** The safe area as an ffmpeg filter: red over everything a platform covers. */
function unsafeTint(scale: number): string {
  const z = safeZone(WIDTH, HEIGHT);
  const s = (v: number) => Math.round(v * scale);
  const boxes = [
    [0, 0, WIDTH, z.top],
    [0, z.bottom, WIDTH, HEIGHT - z.bottom],
    [0, z.top, z.left, z.bottom - z.top],
    [z.right, z.top, WIDTH - z.right, z.notchTop - z.top],
    [z.notchRight, z.notchTop, WIDTH - z.notchRight, z.bottom - z.notchTop],
  ];
  return boxes.map(([x, y, w, h]) => `drawbox=x=${s(x)}:y=${s(y)}:w=${s(w)}:h=${s(h)}:color=red@0.28:t=fill`).join(',');
}

async function main() {
  const [scenePath, look] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
  if (!scenePath || !look) throw new Error('usage: scene-preview.ts <scene.txt> <look> [--voice clip.mp4] [--words file.json:key] [--seconds N] [--out dir]');

  const voice = arg('voice');
  const seconds = Number(arg('seconds') ?? (voice ? duration(voice) : 5));
  const name = basename(scenePath).replace(/\.txt$/, '');
  const out = resolve(arg('out') ?? join('out', 'scene-preview'));
  mkdirSync(out, { recursive: true });

  let words: WordCue[] = [];
  const wordsArg = arg('words');
  if (wordsArg) {
    const [file, key] = wordsArg.split(':');
    words = (JSON.parse(readFileSync(file, 'utf8'))[key] as WordCue[]).map((w) => ({
      text: w.text.replace(/[^\p{L}\p{N}'-]/gu, ''),
      atSec: w.atSec,
    }));
  }

  const parts = parseComposition(readFileSync(scenePath, 'utf8'));
  if (!parts) throw new Error(`${scenePath} has no #scene and <script> to render`);
  const audit = auditComposition(parts);
  console.log(audit.length ? `audit:\n  ${audit.join('\n  ')}` : 'audit: clean');

  const dir = join(out, name);
  await writeProject(dir, buildCompositionHtml(parts, { width: WIDTH, height: HEIGHT, durationSec: seconds, ground: styleGuideFor(look as SceneLook).ground, words }));
  const lint = await lintProject(dir);
  console.log(lint.length ? `lint:\n  ${lint.join('\n  ')}` : 'lint: clean');
  const thrown = await validateProject(dir);
  console.log(thrown.length ? thrown.join('\n') : 'page runs clean');

  const clip = join(dir, 'scene.mp4');
  await renderProject(dir, clip, { fps: 30 });
  console.log(`blank: ${await isBlank(clip)}`);

  const watch = join(out, `${name}.mp4`);
  execFileSync(FFMPEG, voice
    ? ['-nostdin', '-y', '-v', 'error', '-i', clip, '-i', voice, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', watch]
    : ['-nostdin', '-y', '-v', 'error', '-i', clip, '-c', 'copy', watch]);
  const sheet = join(out, `${name}.sheet.png`);
  execFileSync(FFMPEG, ['-nostdin', '-y', '-v', 'error', '-i', clip, '-vf', `fps=8/${seconds},scale=216:-1,${unsafeTint(216 / WIDTH)},tile=8x1`, '-frames:v', '1', sheet]);
  console.log(`${seconds.toFixed(2)}s → ${watch}\nsheet → ${sheet}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
