import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import '../src/lib/config/load-env';
import { EdlSchema } from '../src/lib/edl/types';
import { renderVideo } from '../src/lib/render';
import type { RenderQuality } from '../src/lib/render/quality';
import { extractAudio } from '../src/lib/media/ffmpeg';

/**
 * Renders an EDL from a JSON file, without the database or the queue. This is
 * the fastest loop for working on the renderer itself.
 *
 *   npx tsx scripts/render-local.ts path/to/edl.json path/to/source.mp4 out/
 */
async function main() {
  // `--4k` anywhere in the arguments, so the resolution is testable by hand
  // without a database, a plan or a signed-in account.
  const argv = process.argv.slice(2);
  const quality: RenderQuality = argv.includes('--4k') ? '4k' : 'hd';
  const [edlPath, sourcePath, outputDir = 'out'] = argv.filter((a) => a !== '--4k');
  if (!edlPath || !sourcePath) {
    console.error('Usage: tsx scripts/render-local.ts <edl.json> <source.mp4> [outputDir] [--4k]');
    process.exit(1);
  }

  const edl = EdlSchema.parse(JSON.parse(await readFile(edlPath, 'utf8')));
  const audioPath = join(outputDir, 'source-audio.wav');

  const { mkdir } = await import('node:fs/promises');
  await mkdir(outputDir, { recursive: true });
  await extractAudio(sourcePath, audioPath);

  const result = await renderVideo({
    edl,
    quality,
    sourceVideoPath: sourcePath,
    sourceAudioPath: audioPath,
    outputDir,
    onProgress: (fraction, label) => {
      process.stdout.write(`\r${label.padEnd(24)} ${(fraction * 100).toFixed(0)}%   `);
    },
  });

  console.log(`\n\nRendered ${result.videoPath} in ${(result.renderMs / 1000).toFixed(1)}s (${result.driver})`);
}

main().catch((error) => {
  console.error('\n', error);
  process.exit(1);
});
