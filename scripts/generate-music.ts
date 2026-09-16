/**
 * Renders the music library from the recipes in `music-beds.ts`.
 *
 *   npm run music            only what is missing
 *   npm run music -- --force rebuild everything
 *
 * Writes the audio to public/audio/music and a manifest to
 * content/music/generated.json. Both are gitignored: they are output, like the
 * sound effects, and regenerating them is one command.
 *
 * The generated manifest is kept SEPARATE from content/music/manifest.json.
 * That file is the operator's — hand-written entries for real licensed tracks —
 * and a generator that rewrote it would eventually eat somebody's work. The
 * library is the two merged.
 */
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../src/lib/config/load-env';
import { ffmpeg } from '../src/lib/media/ffmpeg';
import { BEDS, LOOP_SEC, graphFor, type Bed } from '../src/lib/assets/music-beds';
import type { MusicEntry } from '../src/lib/assets/music';

const AUDIO_DIR = join(process.cwd(), 'public', 'audio', 'music');
const MANIFEST = join(process.cwd(), 'content', 'music', 'generated.json');

async function main() {
  const force = process.argv.includes('--force');
  await mkdir(AUDIO_DIR, { recursive: true });

  const tracks: MusicEntry[] = [];

  for (const bed of BEDS) {
    const file = `${bed.id}.m4a`;
    const outputPath = join(AUDIO_DIR, file);

    if (force || !(await exists(outputPath))) {
      await render(bed, outputPath);
      console.log(`  ${bed.id.padEnd(14)} generated — ${bed.use}`);
    } else {
      console.log(`  ${bed.id.padEnd(14)} exists`);
    }

    tracks.push({
      id: bed.id,
      title: bed.title,
      artist: 'EasyCut',
      url: `/audio/music/${file}`,
      moods: bed.moods,
      bpm: bed.bpm,
      durationSec: LOOP_SEC,
      licence: 'CC0 — synthesised by scripts/generate-music.ts, no rights reserved',
      energy: bed.energy,
    });
  }

  await mkdir(join(process.cwd(), 'content', 'music'), { recursive: true });
  await writeFile(
    MANIFEST,
    `${JSON.stringify({ version: 1, tracks }, null, 2)}\n`,
  );

  console.log(`\n${tracks.length} beds in public/audio/music, listed in content/music/generated.json`);
}

/** Where every bed lands, so swapping tracks does not change the music level. */
const TARGET_LUFS = -23;

/**
 * Renders one bed.
 *
 * Two passes, both for reasons that only show up on listening:
 *
 * 1. TWO loops are rendered and the SECOND is kept. Everything in the recipe is
 *    periodic in LOOP_SEC, so the two are identical — except for the reverb,
 *    which at t=0 has no tail behind it to carry over. Keeping the first loop
 *    means that every time the mixer wraps the bed, the reverb momentarily
 *    empties out. Keeping the second means it never does.
 *
 * 2. The gain is measured rather than assumed. The beds came out spread over
 *    5 LU — quiet enough that shuffling the music audibly changed the level
 *    while the EDL's gainDb stayed the same number. One ebur128 pass and one
 *    constant gain fixes that, and a constant gain is right here where
 *    loudnorm's dynamic mode would breathe under a steady pad.
 */
async function render(bed: Bed, outputPath: string): Promise<void> {
  const raw = join(tmpdir(), `easycut-bed-${bed.id}.wav`);

  await ffmpeg([
    '-y',
    '-filter_complex', `${graphFor(bed, LOOP_SEC * 2)},atrim=start=${LOOP_SEC},asetpts=PTS-STARTPTS[out]`,
    '-map', '[out]',
    '-t', String(LOOP_SEC),
    '-c:a', 'pcm_s16le',
    '-ar', '48000',
    '-ac', '1',
    raw,
  ]);

  const gainDb = TARGET_LUFS - (await integratedLufs(raw));

  await ffmpeg([
    '-y',
    '-i', raw,
    '-af', `volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.85:attack=4:release=90`,
    '-c:a', 'aac',
    '-b:a', '96k',
    '-ar', '48000',
    '-ac', '1',
    outputPath,
  ]);

  await rm(raw, { force: true });
}

/** Integrated loudness of a file, from ffmpeg's own EBU R128 meter. */
async function integratedLufs(path: string): Promise<number> {
  // `-f null -` exits 0 and writes the meter's summary to stderr.
  const { stderr } = await ffmpeg([
    '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128', '-f', 'null', '-',
  ]);
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const match = /\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/.exec(summary);
  if (!match) throw new Error(`could not measure the loudness of ${path}`);
  return Number(match[1]);
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
  console.error(error);
  process.exit(1);
});
