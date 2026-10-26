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
 *   npx tsx scripts/hyperframe-scene.ts --fixture
 *
 * With a WAVESPEED_API_KEY it asks the motion model for the composition; with
 * `--fixture`, or with no key, it renders the hand-written composition in
 * tests/fixtures, which proves the page wrapper and the renderer without a
 * model in the loop. Either way it writes the page, the clip and a contact
 * sheet of six frames to out/hyperframes/ — a scene is judged by watching it,
 * and the sheet is the fallback when you cannot.
 */

const OUT = 'out/hyperframes';
const FIXTURE_LINE = 'Your phone buzzes all day, every ping breaks your focus, and the whole morning is gone.';

/** Spreads the words evenly when there is no transcript to time them from. */
function evenWords(line: string, seconds: number): WordCue[] {
  const words = line.split(/\s+/).filter(Boolean);
  return words.map((text, i) => ({ text: text.replace(/[^\p{L}\p{N}'-]/gu, ''), atSec: (i / words.length) * seconds * 0.9 }));
}

async function main() {
  const args = process.argv.slice(2);
  const fixture = args.includes('--fixture') || !isComposerConfigured();
  const positional = args.filter((arg) => !arg.startsWith('--'));
  const line = fixture ? FIXTURE_LINE : (positional[0] ?? FIXTURE_LINE);
  const look = ((fixture ? 'studio' : positional[1]) ?? 'studio') as SceneLook;
  if (!SCENE_LOOKS.includes(look)) throw new Error(`Unknown look ${look}`);
  const seconds = Number(positional[2] ?? 4.5);
  const width = 1080;
  const height = 1920;
  const words = evenWords(line, seconds);

  let parts: CompositionParts | null;
  if (fixture) {
    if (!args.includes('--fixture')) console.log('No WAVESPEED_API_KEY — rendering the hand-written fixture instead.');
    parts = parseComposition(await readFile('tests/fixtures/hyperframe-scene.txt', 'utf8'));
  } else {
    const started = Date.now();
    const result = await composeScene({
      line, words, headline: '', items: [], kind: 'kinetic-text', look, width, height, durationSec: seconds,
    });
    console.log(`composed in ${((Date.now() - started) / 1000).toFixed(1)}s, $${result.costUsd.toFixed(3)}${result.error ? ` — ${result.error}` : ''}`);
    parts = result.parts;
  }
  if (!parts) throw new Error('no composition to render');

  const audit = auditComposition(parts);
  if (audit.length) console.log('audit:\n  ' + audit.join('\n  '));

  const name = fixture ? 'fixture' : `${look}-${Date.now()}`;
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
