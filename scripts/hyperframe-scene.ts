import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { designScene } from '../src/lib/assets/scene-clips';
import {
  auditComposition,
  buildCompositionHtml,
  isComposerConfigured,
  reviewTimes,
  parseComposition,
  type CompositionParts,
  type WordCue,
} from '../src/lib/director/hyperframe';
import { REFERENCE_LINES, referencePath } from '../src/lib/director/reference-scene';
import { SCENE_LOOKS, type SceneLook } from '../src/lib/edl/types';
import { run, FFMPEG } from '../src/lib/media/ffmpeg';
import { allBlank, isBlank, lintProject, renderProject, snapshotProject, validateProject, writeProject } from '../src/lib/render/hyperframes';
import { styleGuideFor } from '../src/lib/scenes/style-guides';

/**
 * Compose one scene with HyperFrames and render it, to look at.
 *
 *   npx tsx scripts/hyperframe-scene.ts "the line being said" [look] [secs]
 *   npx tsx scripts/hyperframe-scene.ts --fixture[=drafts|everywhere|hours|neurons]
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
interface Fixture {
  look: SceneLook;
  line: string;
  seconds: number;
  /** Where the composition lives, when it is not in tests/fixtures. */
  path?: string;
  /** Real word timings, when the line was recorded rather than spread evenly. */
  words?: WordCue[];
}

const FIXTURES: Record<string, Fixture> = {
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
  neurons: {
    look: 'science',
    line: 'Your brain has eighty six billion neurons, and every single thought is a storm of electricity.',
    seconds: 5.5,
  },
  hours: {
    look: 'archive',
    line: 'Six hours editing every single video, versus four minutes now.',
    seconds: 5,
  },
};

/**
 * The per-look references the composer is shown (`director/references`), each
 * written to a voiced line whose real word timings sit beside them — so they
 * render here exactly as they were checked.
 */
const REFERENCE_WORDS: Record<string, WordCue[]> = JSON.parse(
  readFileSync('src/lib/director/references/words.json', 'utf8'),
);
for (const [look, line] of Object.entries(REFERENCE_LINES) as Array<[SceneLook, string]>) {
  const words = REFERENCE_WORDS[look];
  if (!words) continue;
  FIXTURES[`ref-${look}`] = {
    look,
    line,
    seconds: Math.ceil((words[words.length - 1].atSec + 1) * 10) / 10,
    path: referencePath(look),
    words,
  };
}

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
      const parts = parseComposition(await readFile(fixture.path ?? `tests/fixtures/hyperframes/${name}.txt`, 'utf8'));
      if (!parts) throw new Error(`fixture ${name} did not parse`);
      await renderScene(name, parts, fixture.look, fixture.line, fixture.seconds, fixture.words);
    }
    return;
  }

  const line = positional[0];
  if (!line) throw new Error('Give the line being said, or --fixture');
  const look = (positional[1] ?? 'studio') as SceneLook;
  if (!SCENE_LOOKS.includes(look)) throw new Error(`Unknown look ${look}`);
  const seconds = Number(positional[2] ?? 4.5);

  const started = Date.now();
  const words = evenWords(line, seconds);
  const name = `${look}-${Date.now()}`;
  const result = await designScene(
    { line, words, headline: '', items: [], kind: 'kinetic-text', look, width: WIDTH, height: HEIGHT, durationSec: seconds },
    { width: WIDTH, height: HEIGHT, durationSec: seconds, ground: styleGuideFor(look).ground, words },
    resolve(OUT, name),
  );
  console.log(
    `composed in ${((Date.now() - started) / 1000).toFixed(1)}s, $${result.costUsd.toFixed(3)}, review: ${result.review}` +
      (result.parts?.concept ? `\nconcept: ${result.parts.concept}` : '') +
      (result.error ? ` — ${result.error}` : ''),
  );
  if (!result.parts) throw new Error('no composition to render');
  await renderScene(name, result.parts, look, line, seconds);
}

const WIDTH = 1080;
const HEIGHT = 1920;

async function renderScene(
  name: string,
  parts: CompositionParts,
  look: SceneLook,
  line: string,
  seconds: number,
  timed?: WordCue[],
) {
  console.log(`\n${name} (${look}, ${seconds}s)`);
  const width = WIDTH;
  const height = HEIGHT;
  const words = timed ?? evenWords(line, seconds);
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

  // The same stills the reviewing model is shown, so a fixture run proves the
  // review's half of the loop too.
  const review = await snapshotProject(dir, reviewTimes(seconds), join(dir, 'review'));
  console.log(`review sheet → ${review.sheet}${(await allBlank(review.frames)) ? ' (BLANK)' : ''}`);
  console.log(`clip blank: ${await isBlank(clip)}`);
  const thrown = await validateProject(dir);
  console.log(thrown.length ? thrown.join('\n') : 'page runs clean');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
