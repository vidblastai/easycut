import { describe, expect, it } from 'vitest';
import { localMusicPath, scoreTrack, type MusicEntry } from '@/lib/assets/music';
import { BEDS, LOOP_SEC, graphFor, hz } from '@/lib/assets/music-beds';

function track(over: Partial<MusicEntry> = {}): MusicEntry {
  return {
    id: 'x',
    title: 'X',
    artist: 'EasyCut',
    url: '/audio/music/x.m4a',
    moods: ['calm', 'ambient'],
    bpm: null,
    durationSec: 48,
    licence: 'CC0',
    energy: 0.2,
    ...over,
  };
}

describe('choosing a bed', () => {
  it('prefers a track whose moods the director asked for', () => {
    const asked = { mood: 'punchy energetic', mode: 'short' as const, durationSec: 30 };
    const punchy = scoreTrack(track({ moods: ['punchy', 'energetic'], energy: 0.8 }), asked);
    const calm = scoreTrack(track({ moods: ['calm', 'gentle'], energy: 0.8 }), asked);
    expect(punchy).toBeGreaterThan(calm);
  });

  it('wants energy for a short and restraint for a long one', () => {
    const hot = track({ energy: 0.85, moods: [] });
    const cool = track({ energy: 0.25, moods: [] });
    const short = { mood: '', mode: 'short' as const, durationSec: 30 };
    const long = { mood: '', mode: 'long' as const, durationSec: 30 };

    expect(scoreTrack(hot, short)).toBeGreaterThan(scoreTrack(cool, short));
    expect(scoreTrack(cool, long)).toBeGreaterThan(scoreTrack(hot, long));
  });

  it('penalises a track that would have to loop', () => {
    const asked = { mood: '', mode: 'long' as const, durationSec: 600 };
    expect(scoreTrack(track({ durationSec: 900 }), asked)).toBeGreaterThan(
      scoreTrack(track({ durationSec: 48 }), asked),
    );
  });
});

describe('finding the file', () => {
  it('maps a library URL onto public/', () => {
    expect(localMusicPath('/audio/music/hard-cut.m4a')).toMatch(/public[/\\]audio[/\\]music[/\\]hard-cut\.m4a$/);
  });

  it('has no local path for a remote track', () => {
    expect(localMusicPath('https://cdn.example.com/bed.mp3')).toBeNull();
    expect(localMusicPath('/uploads/not-music.mp3')).toBeNull();
  });
});

/**
 * The beds are looped by the mixer rather than faded out, so every sustained
 * voice has to complete a whole number of cycles in the loop and every rhythm
 * has to divide it. Get either wrong and the bed clicks once every 48 seconds —
 * which is the kind of thing nobody notices until a customer does.
 */
describe('the synthesised beds loop seamlessly', () => {
  it('snaps every pitch to a whole number of cycles per loop', () => {
    for (const note of ['A0', 'C1', 'Bb1', 'E3', 'A3', 'Eb3', 'C4', 'E4']) {
      const cycles = hz(note) * LOOP_SEC;
      expect(Math.abs(cycles - Math.round(cycles))).toBeLessThan(1e-9);
    }
  });

  it('snaps close enough to be in tune', () => {
    // A0 is the worst case: the lowest note, so the snap is the largest share
    // of its frequency. Still under a cent.
    const cents = 1200 * Math.log2(hz('A0') / 27.5);
    expect(Math.abs(cents)).toBeLessThan(1);
  });

  it('gives every bed a rhythm that divides the loop', () => {
    for (const bed of BEDS) {
      for (const voice of bed.voices) {
        for (const match of voice.matchAll(/mod\(t,([\d.]+)\)/g)) {
          const period = Number(match[1]);
          const repeats = LOOP_SEC / period;
          expect(Math.abs(repeats - Math.round(repeats))).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('builds a graph that ffmpeg would accept', () => {
    for (const bed of BEDS) {
      const graph = graphFor(bed);
      expect(graph).toContain('aevalsrc=');
      expect(graph).toContain('alimiter=');
      // Unbalanced parentheses in an expression is the failure mode here, and
      // ffmpeg reports it as a generic filter error a long way from the cause.
      const open = (graph.match(/\(/g) ?? []).length;
      const close = (graph.match(/\)/g) ?? []).length;
      expect(open).toBe(close);
    }
  });

  it('gives every bed distinct moods so the picker has something to go on', () => {
    const ids = new Set(BEDS.map((b) => b.id));
    expect(ids.size).toBe(BEDS.length);
    for (const bed of BEDS) expect(bed.moods.length).toBeGreaterThanOrEqual(4);
  });
});
