import { mkdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import '../src/lib/config/load-env';
import { db, stringifyJson } from '../src/lib/db';
import { runPipeline } from '../src/lib/pipeline/run';
import { renderVideo } from '../src/lib/render';
import { probe } from '../src/lib/media/ffmpeg';
import { assetKey, storage } from '../src/lib/storage';

/**
 * End-to-end smoke test: a real file goes in, a finished MP4 comes out.
 *
 * This runs the entire pipeline in-process (no queue, no worker) so a failure
 * points straight at the stage that broke.
 *
 *   npx tsx scripts/smoke.ts out/fixture.mp4 short punchy
 */
async function main() {
  const [input = 'out/fixture.mp4', mode = 'short', styleId = 'punchy'] = process.argv.slice(2);

  const project = await db.project.create({
    data: { title: 'Smoke test', mode, styleId, inputMode: 'raw', status: 'processing' },
  });
  console.log(`project ${project.id}  mode=${mode}  style=${styleId}\n`);

  const key = assetKey(project.id, 'source', basename(input));
  await storage().put(key, await readFile(input), 'video/mp4');
  await db.asset.create({
    data: {
      projectId: project.id,
      kind: 'source',
      storageKey: key,
      url: storage().publicUrl(key),
      contentType: 'video/mp4',
    },
  });

  const source = await probe(input);
  console.log(`source: ${source.width}×${source.height} @ ${source.fps.toFixed(2)}fps, ${source.durationSec.toFixed(1)}s\n`);

  const started = Date.now();
  const result = await runPipeline(
    {
      projectId: project.id,
      mode: mode as 'short' | 'long',
      styleId,
      inputMode: 'raw',
      sourceKey: key,
    },
    (stage, fraction, label) => {
      process.stdout.write(`  ${String(Math.round(fraction * 100)).padStart(3)}%  ${stage.padEnd(11)} ${label ?? ''}\n`);
    },
  );

  const { edl } = result;
  console.log(`\nanalysis done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`  output      ${edl.format.width}×${edl.format.height} @ ${edl.format.fps}fps, ${edl.format.durationSec.toFixed(2)}s`);
  console.log(`  segments    ${edl.segments.length} (removed ${(source.durationSec - edl.format.durationSec).toFixed(1)}s)`);
  console.log(`  captions    ${edl.captions.length}`);
  console.log(`  b-roll      ${edl.broll.length}`);
  console.log(`  graphics    ${edl.graphics.length}`);
  console.log(`  sfx         ${edl.sfx.length}`);
  console.log(`  punch-ins   ${edl.punchIns.length}`);
  console.log(`  transitions ${edl.transitions.length}`);
  console.log(`  reframe     ${edl.reframe ? `${edl.reframe.method}, ${edl.reframe.keyframes.length} keyframes` : 'none'}`);
  console.log(`  cost        $${result.costUsd.toFixed(4)}`);
  if (edl.degraded.length) {
    console.log(`  degraded:`);
    for (const item of edl.degraded) console.log(`    - ${item}`);
  }

  console.log(`\nsegments:`);
  for (const segment of edl.segments) {
    console.log(
      `  ${segment.reason.padEnd(6)} source ${segment.sourceStartSec.toFixed(2)}–${segment.sourceEndSec.toFixed(2)}` +
        `  →  out ${segment.outStartSec.toFixed(2)}–${segment.outEndSec.toFixed(2)}`,
    );
  }

  const outputDir = join('out', 'smoke');
  await mkdir(outputDir, { recursive: true });

  console.log(`\nrendering...`);
  const renderStart = Date.now();
  let lastDecile = -1;
  const rendered = await renderVideo({
    edl,
    sourceVideoPath: result.context.sourcePath,
    sourceAudioPath: result.context.mixAudioPath!,
    outputDir,
    onProgress: (fraction, label) => {
      // Only report on each 10 % so the log stays readable when piped.
      const decile = Math.floor(fraction * 10);
      if (decile > lastDecile) {
        lastDecile = decile;
        console.log(`  ${String(decile * 10).padStart(3)}%  ${label}`);
      }
    },
  });

  const info = await probe(rendered.videoPath);
  const size = (await stat(rendered.videoPath)).size;

  console.log(`\n\nrendered in ${((Date.now() - renderStart) / 1000).toFixed(1)}s`);
  console.log(`  ${rendered.videoPath}`);
  console.log(`  ${info.width}×${info.height} @ ${info.fps.toFixed(2)}fps, ${info.durationSec.toFixed(2)}s, ${(size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  audio: ${info.audioCodec ?? 'NONE'}`);

  // Assertions — a smoke test that only prints is a smoke test that passes broken code.
  const problems: string[] = [];
  if (info.width !== edl.format.width || info.height !== edl.format.height) {
    problems.push(`dimensions ${info.width}×${info.height} != EDL ${edl.format.width}×${edl.format.height}`);
  }
  if (Math.abs(info.durationSec - edl.format.durationSec) > 0.5) {
    problems.push(`duration ${info.durationSec.toFixed(2)}s != EDL ${edl.format.durationSec.toFixed(2)}s`);
  }
  if (!info.hasAudio) problems.push('no audio track in the output');
  if (edl.format.durationSec >= source.durationSec) problems.push('nothing was cut');

  if (problems.length) {
    console.error(`\nFAILED:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`\nOK`);
  process.exit(0);
}

main().catch((error) => {
  console.error('\n\nsmoke test failed:', error);
  process.exit(1);
});
