import { mkdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import '../src/lib/config/load-env';

/**
 * A finished video, with no API keys and no network.
 *
 * `npm run dev` on a fresh clone lands you on an empty dashboard, which is the
 * one screen that teaches nothing. This seeds one real project — synthetic
 * footage, a written transcript, the real pipeline, a real render — so the
 * editor, the timeline and the caption picker all have something in them the
 * first time anyone opens the app.
 *
 * Nothing here is faked at the boundary: the EDL comes out of the same builder
 * a paying job uses, and the MP4 is drawn by the same renderer. The only
 * substitution is the transcript, which comes from
 * content/fixtures/demo.transcript.json via ASR_PROVIDER=fixture — the one
 * provider you have to name explicitly.
 *
 *   npm run db:seed
 */

const FIXTURE_VIDEO = 'out/fixture.mp4';
const FIXTURE_TRANSCRIPT = 'content/fixtures/demo.transcript.json';

async function main() {
  // Set before anything imports env — the config module reads process.env once.
  process.env.ASR_PROVIDER = 'fixture';
  process.env.ASR_FIXTURE = resolve(FIXTURE_TRANSCRIPT);

  const { db, stringifyJson } = await import('../src/lib/db');
  const { runPipeline } = await import('../src/lib/pipeline/run');
  const { renderVideo } = await import('../src/lib/render');
  const { assetKey, storage } = await import('../src/lib/storage');
  const { probe } = await import('../src/lib/media/ffmpeg');
  const { localMusicPath } = await import('../src/lib/assets/music');

  if (!existsSync(FIXTURE_VIDEO)) {
    console.log('Building the sample footage first...');
    const { execFileSync } = await import('node:child_process');
    execFileSync('npx', ['tsx', 'scripts/make-fixture.ts', FIXTURE_VIDEO, '20'], { stdio: 'inherit' });
  }

  const existing = await db.project.findFirst({ where: { title: SAMPLE_TITLE } });
  if (existing) {
    console.log(`"${SAMPLE_TITLE}" already exists (${existing.id}). Delete it to re-seed.`);
    return;
  }

  const project = await db.project.create({
    data: {
      title: SAMPLE_TITLE,
      mode: 'short',
      styleId: 'punchy',
      inputMode: 'raw',
      captionPreset: 'bold-pop',
      status: 'processing',
    },
  });
  console.log(`project ${project.id}`);

  const key = assetKey(project.id, 'source', basename(FIXTURE_VIDEO));
  await storage().put(key, await readFile(FIXTURE_VIDEO), 'video/mp4');
  await db.asset.create({
    data: {
      projectId: project.id,
      kind: 'source',
      storageKey: key,
      url: storage().publicUrl(key),
      contentType: 'video/mp4',
    },
  });

  const result = await runPipeline(
    {
      projectId: project.id,
      mode: 'short',
      styleId: 'punchy',
      captionPreset: 'bold-pop',
      inputMode: 'raw',
      sourceKey: key,
    },
    (stage, fraction, label) => {
      process.stdout.write(`  ${String(Math.round(fraction * 100)).padStart(3)}%  ${stage.padEnd(11)} ${label ?? ''}\n`);
    },
  );

  const { edl, context } = result;
  console.log(`\n  ${edl.segments.length} segments, ${edl.captions.length} caption cards, ${edl.broll.length} b-roll`);

  const outputDir = join('out', 'seed');
  await mkdir(outputDir, { recursive: true });
  console.log('  rendering...');
  const rendered = await renderVideo({
    edl,
    sourceVideoPath: context.sourcePath,
    sourceAudioPath: context.mixAudioPath!,
    musicPath: edl.music ? localMusicPath(edl.music.url) : null,
    outputDir,
  });

  // Put the render where the app serves files from, so the player can reach it.
  const renderKey = assetKey(project.id, 'render', 'preview.mp4');
  await storage().put(renderKey, await readFile(rendered.videoPath), 'video/mp4');
  const thumbKey = rendered.thumbnailPath
    ? assetKey(project.id, 'thumbnail', 'poster.jpg')
    : null;
  if (thumbKey && rendered.thumbnailPath) {
    await storage().put(thumbKey, await readFile(rendered.thumbnailPath), 'image/jpeg');
  }

  const info = await probe(rendered.videoPath);
  const edlRow = await db.edl.create({
    data: { projectId: project.id, version: 1, document: stringifyJson(edl), origin: 'pipeline' },
  });
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
      sizeBytes: (await stat(rendered.videoPath)).size,
      durationSec: info.durationSec,
    },
  });

  await db.project.update({
    where: { id: project.id },
    data: {
      status: 'ready',
      durationSec: info.durationSec,
      previewUrl: storage().publicUrl(renderKey),
      thumbnailUrl: thumbKey ? storage().publicUrl(thumbKey) : null,
      costUsd: result.costUsd,
      socialCaption: 'Everyone thinks editing is the hard part. It is not.',
      hashtags: stringifyJson(['#creators', '#videoediting', '#shorts']),
      transcriptJson: stringifyJson(context.transcript ?? {}),
      directorPlanJson: stringifyJson(context.plan ?? {}),
      mediaJson: stringifyJson(context.media ?? {}),
      cutsJson: stringifyJson([
        ...(context.silenceRemovals ?? []),
        ...(context.cleanupRemovals ?? []),
      ]),
    },
  });

  console.log(`\nDone. Open http://localhost:3000/projects/${project.id}`);
}

const SAMPLE_TITLE = 'Sample — why editing is not the hard part';

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    const { db } = await import('../src/lib/db');
    await db.$disconnect();
  });
