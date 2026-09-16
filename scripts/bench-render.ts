/**
 * Why a render takes as long as it does, measured rather than guessed.
 *
 * Renders the same slice of a real EDL under several Chromium settings and
 * reports frames per second for each, then projects the full render from the
 * winner. Run it on an otherwise idle machine, or the numbers are noise.
 *
 *   npx tsx scripts/smoke.ts out/long.mp4 long documentary --analyse-only
 *   npx tsx scripts/bench-render.ts out/smoke/<id>.edl.json out/long.mp4
 */
import { mkdir, readFile, rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import '../src/lib/config/load-env';
import { env } from '../src/lib/config/env';
import { EdlSchema } from '../src/lib/edl/types';
import { startAssetServer } from '../src/lib/render/asset-server';

interface Variant {
  name: string;
  gl: 'swangle' | 'angle' | 'swiftshader' | null;
  concurrency: number;
}

async function main() {
  const [edlPath, sourcePath, startArg = '3000', framesArg = '240'] = process.argv.slice(2);
  if (!edlPath || !sourcePath) {
    throw new Error('usage: bench-render.ts <edl.json> <source.mp4> [startFrame] [frames]');
  }

  const parsed = EdlSchema.parse(JSON.parse(await readFile(edlPath, 'utf8')));
  const start = Number(startArg);
  const count = Number(framesArg);
  const total = Math.round(parsed.format.durationSec * parsed.format.fps);

  console.log(`edl      ${parsed.format.width}×${parsed.format.height} @ ${parsed.format.fps}fps, ${total} frames`);
  console.log(`slice    frames ${start}–${start + count - 1} (${count})`);
  console.log(`cores    ${cpus().length}\n`);

  // The renderer reads the source through a local HTTP server, exactly as a
  // real render does — benchmarking a different I/O path would measure the
  // wrong thing.
  const assetServer = await startAssetServer(dirname(sourcePath));
  const url = assetServer.urlFor(sourcePath);
  const edl = url ? { ...parsed, source: { ...parsed.source, url } } : parsed;

  try {
    const { bundle } = await import('@remotion/bundler');
    const { renderMedia, selectComposition } = await import('@remotion/renderer');

    const t0 = Date.now();
    const serveUrl = await bundle({ entryPoint: join(process.cwd(), 'remotion', 'index.ts') });
    console.log(`bundled in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

    const inputProps = { edl, previewAudio: false };
    const composition = await selectComposition({
      serveUrl,
      id: 'EasyCutVideo',
      inputProps,
      browserExecutable: env.render.browserExecutable,
    });

    const cores = cpus().length;
    const variants: Variant[] = [
      { name: 'swangle', gl: 'swangle', concurrency: Math.max(1, cores - 1) },
      { name: 'no GL flags', gl: null, concurrency: Math.max(1, cores - 1) },
      { name: 'no GL, all cores', gl: null, concurrency: cores },
      { name: 'no GL, half cores', gl: null, concurrency: Math.max(1, Math.round(cores / 2)) },
    ];

    await mkdir('out/bench', { recursive: true });
    const results: { name: string; concurrency: number; seconds: number; fps: number }[] = [];

    for (const variant of variants) {
      const out = join('out', 'bench', `${variant.name.replace(/\W+/g, '-')}.mp4`);
      await rm(out, { force: true });
      const began = Date.now();
      await renderMedia({
        composition,
        serveUrl,
        codec: 'h264',
        outputLocation: out,
        inputProps,
        muted: true,
        crf: 21,
        frameRange: [start, start + count - 1],
        concurrency: variant.concurrency,
        offthreadVideoCacheSizeInBytes: 512 * 1024 * 1024,
        browserExecutable: env.render.browserExecutable,
        chromiumOptions: { gl: variant.gl },
        logLevel: 'error',
      });
      const seconds = (Date.now() - began) / 1000;
      results.push({ name: variant.name, concurrency: variant.concurrency, seconds, fps: count / seconds });
      const last = results[results.length - 1];
      console.log(`  ${variant.name.padEnd(18)} conc=${variant.concurrency}  ${seconds.toFixed(1)}s  ${last.fps.toFixed(2)} fps`);
    }

    console.log('\nprojected over the whole video:');
    for (const r of [...results].sort((a, b) => b.fps - a.fps)) {
      console.log(
        `  ${r.name.padEnd(18)} conc=${r.concurrency}  ${r.fps.toFixed(2)} fps  →  ${(total / r.fps / 60).toFixed(1)} min`,
      );
    }
  } finally {
    await assetServer.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
