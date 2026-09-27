import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import '../src/lib/config/load-env';
import { drawScene } from '../src/lib/director/illustrate';
import { SCENE_LOOKS, type SceneLook } from '../src/lib/edl/types';

/** Matches the grounds in `director/illustrate.ts`, so a dark drawing on a dark
 *  world is judged the way it will actually be seen rather than on white. */
const GROUND: Record<SceneLook, string> = {
  studio: '#FCFCFD',
  neon: '#05060F',
  gallery: '#EFF0F4',
  archive: '#0B0710',
  editorial: '#030105',
};

/**
 * Ask the motion model to draw one scene, and write the result out.
 *
 *   npx tsx scripts/draw-scene.ts "the line being said" [look]
 *
 * This exists for the same reason the still sheet does: the drawing pass is a
 * thing that can only be judged by looking at it. It writes the raw SVG and a
 * standalone HTML page beside it, so a failed drawing can be opened and read
 * rather than guessed at from a parser returning null.
 */

const OUT = 'out/drawings';

const LINES: Array<{ line: string; kind: string }> = [
  { line: 'You do not need a team to make this. One person, one camera, one afternoon.', kind: 'kinetic-text' },
  { line: 'Ninety five percent of your ideas never get posted. They die in the drafts folder.', kind: 'big-number' },
  { line: 'Six hours editing every single video, versus four minutes now.', kind: 'compare' },
  { line: 'Record it once, upload it, and it goes everywhere you post.', kind: 'journey' },
];

async function main() {
  await mkdir(OUT, { recursive: true });

  const line = process.argv[2];
  const look = (process.argv[3] as SceneLook) ?? 'studio';
  if (process.argv[3] && !SCENE_LOOKS.includes(look)) throw new Error(`Unknown look ${look}`);

  const jobs = line
    ? [{ line, kind: 'kinetic-text', look }]
    : LINES.map((l, i) => ({ ...l, look: SCENE_LOOKS[i % SCENE_LOOKS.length] }));

  await Promise.all(
    jobs.map(async (job, i) => {
      const started = Date.now();
      const result = await drawScene({
        line: job.line,
        headline: '',
        items: [],
        kind: job.kind,
        look: job.look,
        accent: '#9B7BFF',
      });
      const name = `${i}-${job.look}`;
      const seconds = ((Date.now() - started) / 1000).toFixed(1);

      if (!result.illustration) {
        console.log(`  ${name.padEnd(12)} FAILED in ${seconds}s — ${result.error}`);
        return;
      }

      const { viewBox, defs, parts, motion } = result.illustration;
      const markup = defs + parts.map((part) => part.markup).join('\n');
      console.log(
        `  ${name.padEnd(12)} ${parts.length} parts, ${markup.length} chars, ` +
          `${seconds}s, $${result.costUsd.toFixed(4)}\n` +
          `  ${' '.repeat(12)} ${result.illustration.stages} beats · ` +
          parts.map((p) => `[${p.stage}]${p.enter}/${p.idle}${p.hasPivot ? '\u2713' : ''}`).join(' ') +
          // The lines that get handed to the video model. Printed because a
          // missing one is invisible until an animation comes back generic.
          motion.map((line, i) => `\n  ${' '.repeat(12)} motion[${i}] ${line || '(none)'}`).join(''),
      );

      // Each part gets a visible outline in the debug page so a "drawing" that
      // is really one group pretending to be five is obvious at a glance.
      await writeFile(
        join(OUT, `${name}.html`),
        `<!doctype html><meta charset="utf-8"><title>${name}</title>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:${GROUND[job.look]}">
<svg viewBox="${viewBox}" width="${Math.round(720 / (result.illustration.stages || 1))}" height="720">${markup}</svg>`,
      );
      await writeFile(
        join(OUT, `${name}.svg`),
        `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
      );
    }),
  );

  console.log(`\nDrawings in ${OUT}/`);
}

void main();
