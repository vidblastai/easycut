import { mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import '../src/lib/config/load-env';
import { ffmpeg } from '../src/lib/media/ffmpeg';
import { SFX_LIBRARY, SFX_NAMES } from '../src/lib/assets/sfx';

/**
 * Renders the sound-effect library from the ffmpeg recipes in `sfx.ts`.
 *
 * Synthesising these rather than shipping samples means the library is
 * royalty-free by construction, weighs a few hundred kilobytes, and can be
 * regenerated or retuned by editing one expression.
 *
 *   npx tsx scripts/generate-sfx.ts [--force]
 */
async function main() {
  const force = process.argv.includes('--force');
  const outputDir = join(process.cwd(), 'public', 'audio', 'sfx');
  await mkdir(outputDir, { recursive: true });

  for (const name of SFX_NAMES) {
    const definition = SFX_LIBRARY[name];
    const outputPath = join(outputDir, `${name}.wav`);

    if (!force && (await exists(outputPath))) {
      console.log(`  ${name.padEnd(10)} exists`);
      continue;
    }

    // The recipe is a source graph; normalise and fade out so nothing clips or
    // ends on a click.
    const graph = `${definition.recipe},afade=t=out:st=${Math.max(0, definition.durationSec - 0.03).toFixed(3)}:d=0.03,alimiter=limit=0.9[out]`;

    await ffmpeg([
      '-y',
      '-filter_complex', graph,
      '-map', '[out]',
      '-t', String(definition.durationSec),
      '-ar', '48000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      outputPath,
    ]);

    console.log(`  ${name.padEnd(10)} generated — ${definition.use}`);
  }

  console.log(`\nSound effects written to public/audio/sfx/`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error('Failed to generate sound effects:', error.message);
  process.exit(1);
});
