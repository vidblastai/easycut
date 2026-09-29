import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { SFX_LIBRARY, SFX_NAMES, sfxDefaultGain, type SfxName } from '@/lib/assets/sfx';

/**
 * The shipped sound files, as files.
 *
 * `defaultGainDb` is a RELATIVE level — −16 for a swipe against −12 for an
 * impact is a claim that the impact sits four decibels above it. That claim is
 * only true while every file is the same loudness to begin with, and nothing in
 * the type system enforces it: the generator's `alimiter` caps a loud peak and
 * leaves a quiet one alone, so for a while `swipe` shipped 13 dB below `glitch`
 * and the swipe under an icon card could not be heard at all.
 *
 * So this reads the actual bytes. It is the only place that can catch a recipe
 * change quietly moving a sound's loudness.
 */

/** Peak and RMS, in dBFS, from the samples of a mono 16-bit PCM wav. */
async function levels(name: string): Promise<{ peakDb: number; rmsDb: number }> {
  const buffer = await readFile(`public/audio/sfx/${name}.wav`);
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
  expect(start, `${name}.wav has no data chunk`).toBeGreaterThan(0);

  let peak = 0;
  let sum = 0;
  let count = 0;
  for (let i = start; i + 1 < start + length; i += 2) {
    const sample = buffer.readInt16LE(i);
    if (Math.abs(sample) > peak) peak = Math.abs(sample);
    sum += sample * sample;
    count++;
  }
  if (!peak || !count) return { peakDb: -Infinity, rmsDb: -Infinity };
  const rms = Math.sqrt(sum / count) / 32768;
  return { peakDb: 20 * Math.log10(peak / 32768), rmsDb: 20 * Math.log10(rms) };
}

describe('the sound library on disk', () => {
  it('ships a file for every name', async () => {
    for (const name of SFX_NAMES) {
      await expect(readFile(`public/audio/sfx/${name}.wav`)).resolves.toBeTruthy();
    }
  });

  it('matches every one on ENERGY, which is what makes the gains comparable', async () => {
    // Matching peaks is the trap: a noise swish and a square wave at the same
    // peak differ by 15 dB of crest, and the swish is the one nobody hears.
    for (const name of SFX_NAMES) {
      const { rmsDb } = await levels(name);
      // −20 dBFS from the generator, with room for 16-bit rounding.
      expect(rmsDb, `${name} is ${rmsDb.toFixed(1)} dBFS RMS`).toBeGreaterThan(-20.6);
      expect(rmsDb, `${name} is ${rmsDb.toFixed(1)} dBFS RMS`).toBeLessThan(-19.4);
    }
  });

  it('leaves headroom, so no transient clips on the way into the mix', async () => {
    for (const name of SFX_NAMES) {
      const { peakDb } = await levels(name);
      expect(peakDb, `${name} peaks at ${peakDb.toFixed(1)} dBFS`).toBeLessThan(-0.5);
    }
  });

  it('places every sound under the voice, and none of them out of earshot', async () => {
    // Files sit at −20 dBFS RMS and speech at −14 LUFS, so a sound plays
    // `gain − 6` dB relative to the dialogue.
    for (const name of SFX_NAMES) {
      const belowVoice = sfxDefaultGain(name) - 6;
      expect(belowVoice, `${name} plays ${belowVoice} dB vs the voice`).toBeLessThan(-8);
      // A rendered clip measured the old gains 20–28 dB down and they could not
      // be heard at all. That is the failure this bound exists to catch.
      expect(belowVoice, `${name} plays ${belowVoice} dB vs the voice`).toBeGreaterThan(-24);
    }
  });

  it('keeps the transition sounds nearest the dialogue, since they carry the cut', async () => {
    const transition = Math.max(...(['whoosh', 'swipe', 'glitch'] as SfxName[]).map(sfxDefaultGain));
    const punctuation = Math.max(...(['pop', 'click'] as SfxName[]).map(sfxDefaultGain));
    expect(transition).toBeGreaterThan(punctuation);
  });

  it('keeps the transition sounds short enough to be a transition', async () => {
    for (const name of ['swipe', 'whoosh', 'glitch'] as SfxName[]) {
      expect(SFX_LIBRARY[name].durationSec, name).toBeLessThan(0.7);
    }
  });
});
