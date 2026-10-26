import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import {
  auditComposition,
  buildCompositionHtml,
  composeScene,
  isComposerConfigured,
  parseComposition,
  type CompositionParts,
  type WordCue,
} from '../src/lib/director/hyperframe';
import { SCENE_LOOKS, type SceneLook } from '../src/lib/edl/types';
import { run, FFMPEG } from '../src/lib/media/ffmpeg';
import { lintProject, renderProject, writeProject } from '../src/lib/render/hyperframes';
import { styleGuideFor } from '../src/lib/scenes/style-guides';

/**
 * Compose one scene with HyperFrames and render it, to look at.
 *
 *   npx tsx scripts/hyperframe-scene.ts "the line being said" [look] [secs]
 *   npx tsx scripts/hyperframe-scene.ts --fixture[=drafts|everywhere|hours]
 *
 * With a WAVESPEED_API_KEY it asks the motion model for the composition; with
 * `--fixture`, or with no key, it renders the hand-written compositions in
 * tests/fixtures/hyperframes — the bar a model-written scene is measured
 * against, and a way to prove the wrapper and the renderer with no model in
 * the loop. Either way it writes the page, the clip and a contact
 * sheet of six frames to out/hyperframes/ — a scene is judged by watching it,
 * and the sheet is the fallback when you cannot.
 */

const OUT = 'out/hyperframes';
/** The hand-written scenes, with the line each one is written to. */
const FIXTURES: Record<string, { look: SceneLook; line: string; seconds: number }> = {
  drafts: {
    look: 'editorial',
    line: 'Ninety five percent of your ideas never get posted. They die in the drafts folder.',
    seconds: 4.5,
  },
  everywhere: {
    look: 'neon',
    line: 'Record it once, upload it, and it goes everywhere you post.',
    seconds: 4.5,
  },
  hours: {
    look: 'archive',
    line: 'Six hours editing every single video, versus four minutes now.',
    seconds: 5,
  },
};

/** Spreads the words evenly when there is no transcript to time them from. */
function evenWords(line: string, seconds: number): WordCue[] {
  const words = line.split(/\s+/).filter(Boolean);
  return words.map((text, i) => ({ text: text.replace(/[^\p{L}\p{N}'-]/gu, ''), atSec: (i / words.length) * seconds * 0.9 }));
}

async function main() {
  const args = process.argv.slice(2);
  const fixtureFlag = args.find((arg) => arg.startsWith('--fixture'));
  const positional = args.filter((arg) => !arg.startsWith('--'));
  if (!fixtureFlag && !isComposerConfigured()) console.log('No WAVESPEED_API_KEY — rendering the hand-written fixtures instead.');

  if (fixtureFlag || !isComposerConfigured()) {
    const only = fixtureFlag?.split('=')[1];
    const names = only ? [only] : Object.keys(FIXTURES);
    for (const name of names) {
      const fixture = FIXTURES[name];
      if (!fixture) throw new Error(`Unknown fixture ${name}: ${Object.keys(FIXTURES).join(', ')}`);
      const parts = parseComposition(await readFile(`tests/fixtures/hyperframes/${name}.txt`, 'utf8'));
      if (!parts) throw new Error(`fixture ${name} did not parse`);
      await renderScene(name, parts, fixture.look, fixture.line, fixture.seconds);
    }
    return;
  }

  const line = positional[0];
  if (!line) throw new Error('Give the line being said, or --fixture');
  const look = (positional[1] ?? 'studio') as SceneLook;
  if (!SCENE_LOOKS.includes(look)) throw new Error(`Unknown look ${look}`);
  const seconds = Number(positional[2] ?? 4.5);

  const started = Date.now();
  const result = await composeScene({
    line, words: evenWords(line, seconds), headline: '', items: [], kind: 'kinetic-text', look,
    width: WIDTH, height: HEIGHT, durationSec: seconds,
  });
  console.log(`composed in ${((Date.now() - started) / 1000).toFixed(1)}s, $${result.costUsd.toFixed(3)}${result.error ? ` — ${result.error}` : ''}`);
  if (!result.parts) throw new Error('no composition to render');
  await renderScene(`${look}-${Date.now()}`, result.parts, look, line, seconds);
}

const WIDTH = 1080;
const HEIGHT = 1920;

async function renderScene(name: string, parts: CompositionParts, look: SceneLook, line: string, seconds: number) {
  console.log(`\n${name} (${look}, ${seconds}s)`);
  const width = WIDTH;
  const height = HEIGHT;
  const words = evenWords(line, seconds);
  const audit = auditComposition(parts);
  if (audit.length) console.log('audit:\n  ' + audit.join('\n  '));

  const dir = resolve(OUT, name);
  await mkdir(OUT, { recursive: true });
  await writeProject(dir, buildCompositionHtml(parts, { width, height, durationSec: seconds, ground: styleGuideFor(look).ground, words }));

  const lint = await lintProject(dir);
  console.log(lint.length ? 'lint:\n  ' + lint.join('\n  ') : 'lint: clean');

  const started = Date.now();
  const clip = join(dir, 'scene.mp4');
  await renderProject(dir, clip, { fps: 30 });
  console.log(`rendered in ${((Date.now() - started) / 1000).toFixed(1)}s → ${clip}`);

  const sheet = join(dir, 'sheet.png');
  await run(FFMPEG, [
    '-y', '-i', clip,
    '-vf', `fps=${(6 / seconds).toFixed(4)},scale=360:-1,tile=6x1`,
    '-frames:v', '1', sheet,
  ]);
  console.log(`contact sheet → ${sheet}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
