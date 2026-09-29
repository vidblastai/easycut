import { mkdir, access, readFile, rename, unlink } from 'node:fs/promises';
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
 *
 * ── Why there are two passes ────────────────────────────────────────────
 *
 * `defaultGainDb` in the library is a MIX level: −16 for a swipe and −12 for an
 * impact says the impact sits four decibels above it. That is only true if the
 * two files are the same loudness to begin with, and synthesis recipes are
 * nothing of the kind — a square wave runs to full scale on its own while a
 * filtered noise sweep comes out twenty decibels down. Before this, `swipe`
 * peaked at −13.5 dBFS and `glitch` at 0.0, so the two sounds the transitions
 * lean on hardest landed fourteen decibels under the one that needed it least,
 * and the swipe under an icon card was inaudible against the voice.
 *
 * `alimiter` does not fix that: it caps a loud peak and leaves a quiet one
 * exactly where it was. So the file is rendered, its real loudness is read back,
 * and a second pass applies the gain that brings it to `TARGET_RMS_DBFS`.
 * After that the library's numbers mean what they say.
 *
 * ── Why RMS and not peak ────────────────────────────────────────────────
 *
 * Matching PEAKS does not match loudness, and the difference is not small. A
 * noise swish and a square wave normalised to the same peak differ by fifteen
 * decibels of crest factor, so the swish still sounds far quieter — which is
 * exactly the trap: peak-normalising every file left `swipe` audibly under
 * `glitch` while both measured −1 dBFS and looked correct. Energy is what the
 * ear integrates over a 300ms one-shot, so energy is what gets matched, with a
 * ceiling to stop a transient clipping.
 */

/**
 * Every one-shot is normalised to this RMS before its mix gain is applied.
 *
 * Low enough that the sharpest one-shot here — a swipe, with 15 dB of crest —
 * still has headroom under the ceiling rather than being flattened into it.
 */
const TARGET_RMS_DBFS = -20;

/** And no transient may exceed this, so nothing clips on the way into the mix. */
const CEILING_DBFS = -1;
async function main() {
  const force = process.argv.includes('--force');
  const outputDir = join(process.cwd(), 'public', 'audio', 'sfx');
  await mkdir(outputDir, { recursive: true });

  for (const name of SFX_NAMES) {
    const definition = SFX_LIBRARY[name];
    const outputPath = join(outputDir, `${name}.wav`);

    /*
     * An existing file is kept only if it is at the CURRENT target.
     *
     * `exists` alone is not enough, and the way that bites is nasty: the mix
     * gains in the library are tuned against a known file loudness, so a clone
     * carrying files from before the normalisation pass would have the new gains
     * applied to the old levels — louder and more uneven than either version
     * intended. Checking the level makes `npm run setup` self-healing, and makes
     * a change to `TARGET_RMS_DBFS` take effect without anybody remembering
     * `--force`.
     */
    if (!force && (await exists(outputPath))) {
      const { rmsDb } = await levels(outputPath);
      if (Math.abs(rmsDb - TARGET_RMS_DBFS) < 0.6) {
        console.log(`  ${name.padEnd(10)} exists`);
        continue;
      }
      console.log(`  ${name.padEnd(10)} stale (${rmsDb.toFixed(1)} dBFS rms) — regenerating`);
    }

    // The recipe is a source graph; fade the tail so nothing ends on a click,
    // and cap the peak so a recipe that overshoots does not clip.
    const graph = `${definition.recipe},afade=t=out:st=${Math.max(0, definition.durationSec - 0.03).toFixed(3)}:d=0.03,alimiter=limit=0.9[out]`;

    const rawPath = `${outputPath}.raw.wav`;
    await ffmpeg([
      '-y',
      '-filter_complex', graph,
      '-map', '[out]',
      '-t', String(definition.durationSec),
      '-ar', '48000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      rawPath,
    ]);

    const { peakDb, rmsDb } = await levels(rawPath);
    // Lift to the energy target, but never push a transient over the ceiling.
    const lift = Math.min(TARGET_RMS_DBFS - rmsDb, CEILING_DBFS - peakDb);
    if (!Number.isFinite(lift) || Math.abs(lift) < 0.05) {
      await rename(rawPath, outputPath);
    } else {
      await ffmpeg([
        '-y',
        '-i', rawPath,
        '-af', `volume=${lift.toFixed(2)}dB`,
        '-ar', '48000',
        '-ac', '1',
        '-c:a', 'pcm_s16le',
        outputPath,
      ]);
      await unlink(rawPath);
    }

    console.log(
      `  ${name.padEnd(10)} ${rmsDb.toFixed(1)} rms / ${peakDb.toFixed(1)} peak  ` +
        `${lift >= 0 ? '+' : ''}${lift.toFixed(1)} dB — ${definition.use}`,
    );
  }

  console.log(`\nSound effects written to public/audio/sfx/`);
}

/**
 * The file's peak and RMS, read from the samples.
 *
 * Read here rather than asked of ffmpeg because `astats` and `volumedetect`
 * report on stderr, which means parsing a log to get numbers that are sitting
 * right there in the file. These are mono 16-bit PCM and a few hundred
 * kilobytes at most.
 */
async function levels(path: string): Promise<{ peakDb: number; rmsDb: number }> {
  const buffer = await readFile(path);
  // Walk the RIFF chunks rather than assuming a 44-byte header: ffmpeg writes
  // a LIST/INFO chunk ahead of the data, and a fixed offset reads that as audio.
  let offset = 12;
  let start = -1;
  let length = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'data') {
      start = offset + 8;
      length = Math.min(size, buffer.length - start);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (start < 0) throw new Error(`${path}: no data chunk`);

  let peak = 0;
  let sum = 0;
  let count = 0;
  for (let i = start; i + 1 < start + length; i += 2) {
    const sample = buffer.readInt16LE(i);
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
    sum += sample * sample;
    count++;
  }
  if (!peak || !count) return { peakDb: -Infinity, rmsDb: -Infinity };
  const rms = Math.sqrt(sum / count) / 32768;
  return {
    peakDb: 20 * Math.log10(peak / 32768),
    rmsDb: rms ? 20 * Math.log10(rms) : -Infinity,
  };
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
