import { mkdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
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
 *
 * The EDL is written beside the output and saved to the database, so the
 * project opens in the app afterwards and `--analyse-only` gives you a real
 * EDL to render again without paying for the analysis twice.
 */
async function main() {
  const argv = process.argv.slice(2);
  const analyseOnly = argv.includes('--analyse-only');
  const [input = 'out/fixture.mp4', mode = 'short', styleId = 'punchy'] = argv.filter((a) => !a.startsWith('--'));

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

  // Saved rather than thrown away: the project then opens in the app like any
  // other, and a render that needs debugging can be repeated from this EDL
  // instead of paying for the analysis again.
  const edlRow = await db.edl.create({
    data: { projectId: project.id, version: 1, document: stringifyJson(edl) },
  });
  const edlPath = join(outputDir, `${project.id}.edl.json`);
  await writeFile(edlPath, JSON.stringify(edl, null, 2));
  console.log(`\nedl  ${edlPath}  (db id ${edlRow.id})`);

  if (analyseOnly) {
    await db.project.update({ where: { id: project.id }, data: { status: 'draft' } });
    console.log('\n--analyse-only: stopping before the render.');
    process.exit(0);
  }

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
  // Publish it like the worker does, so the run leaves a project you can
  // actually open rather than a card stuck on "processing" for ever. This is
  // the quickest way to get a real ten-minute edit in front of the editor.
  const renderKey = assetKey(project.id, 'render', 'preview.mp4');
  await storage().put(renderKey, await readFile(rendered.videoPath), 'video/mp4');
  const thumbKey = assetKey(project.id, 'thumbnail', 'poster.jpg');
  await storage()
    .put(thumbKey, await readFile(rendered.thumbnailPath), 'image/jpeg')
    .catch(() => {});

  await db.render.create({
    data: {
      projectId: project.id,
      edlId: edlRow.id,
      aspect: edl.format.aspect,
      width: info.width,
      height: info.height,
      fps: info.fps,
      status: 'succeeded',
      progress: 1,
      url: storage().publicUrl(renderKey),
      sizeBytes: size,
      durationSec: info.durationSec,
      renderMs: rendered.renderMs,
      finishedAt: new Date(),
    },
  });

  await db.project.update({
    where: { id: project.id },
    data: {
      status: 'ready',
      durationSec: info.durationSec,
      previewUrl: storage().publicUrl(renderKey),
      thumbnailUrl: storage().publicUrl(thumbKey),
      costUsd: result.costUsd,
      title: edl.deliverable.title || project.title,
      transcriptJson: stringifyJson(result.context.transcript ?? {}),
    },
  });

  console.log(`\nOK  —  open it at ${process.env.APP_URL ?? 'http://localhost:3000'}/projects/${project.id}`);
  process.exit(0);
}

main().catch((error) => {
  console.error('\n\nsmoke test failed:', error);
  process.exit(1);
});
