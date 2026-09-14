import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Music is the one layer we deliberately do NOT fetch from an API at render
 * time. Every music API worth using is either paid per track, licence-restricted
 * in a way that makes "the creator posts this to TikTok" legally murky, or slow.
 *
 * Instead the app serves a local, curated library described by a manifest. The
 * operator drops royalty-free tracks into `public/audio/music/` and lists them
 * with their mood tags. Selection is then instant, free, and — crucially —
 * licence-auditable: every track in a shipped video traces back to a manifest
 * entry with a stated licence.
 *
 * An empty library is a supported state: the video renders without music and
 * the job reports `music` as a degraded layer.
 */

export interface MusicEntry {
  id: string;
  title: string;
  artist: string;
  /** Path under `public/`, e.g. `/audio/music/steady-focus.mp3`. */
  url: string;
  /** Free-text mood tags matched against the director's `musicMood`. */
  moods: string[];
  bpm: number | null;
  durationSec: number;
  /** e.g. "CC0", "Pixabay Content License", "Licensed — Epidemic Sound". */
  licence: string;
  attribution?: string;
  /** Energy 0..1, used to match short-form (high) vs long-form (low). */
  energy: number;
}

export interface MusicManifest {
  version: 1;
  tracks: MusicEntry[];
}

const MANIFEST_PATH = join(process.cwd(), 'content', 'music', 'manifest.json');

let cached: MusicManifest | null = null;

export async function loadMusicLibrary(): Promise<MusicManifest> {
  if (cached) return cached;
  try {
    const raw = await readFile(MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(raw) as MusicManifest;
    cached = { version: 1, tracks: Array.isArray(parsed.tracks) ? parsed.tracks : [] };
  } catch {
    cached = { version: 1, tracks: [] };
  }
  return cached;
}

export interface MusicSelection {
  track: MusicEntry;
  /** Why this track won — surfaced in the editor's "swap music" panel. */
  score: number;
}

/**
 * Picks a bed for the finished video.
 *
 * Matching is intentionally simple and explainable: mood-tag overlap first,
 * then energy fit for the format, then a length that covers the video without
 * looping. A cleverer recommender would be harder to debug and no better —
 * the human-written mood tags are already the signal.
 */
export async function selectMusic(options: {
  mood: string;
  mode: 'short' | 'long';
  durationSec: number;
  /** Track id the user rejected, so "shuffle" gives them something new. */
  excludeId?: string;
}): Promise<MusicSelection | null> {
  const library = await loadMusicLibrary();
  const candidates = library.tracks.filter((t) => t.id !== options.excludeId);
  if (!candidates.length) return null;

  const wanted = tokenize(options.mood);
  const targetEnergy = options.mode === 'short' ? 0.75 : 0.4;

  const scored = candidates.map((track) => {
    const tags = new Set(track.moods.flatMap(tokenize));
    const overlap = wanted.filter((w) => tags.has(w)).length;

    let score = overlap * 0.4;
    score += (1 - Math.abs(track.energy - targetEnergy)) * 0.4;
    // A track shorter than the video has to loop, which is audible.
    if (track.durationSec >= options.durationSec) score += 0.2;
    else score -= 0.15;

    return { track, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

/** True when there is at least one usable track. */
export async function isMusicAvailable(): Promise<boolean> {
  const library = await loadMusicLibrary();
  return library.tracks.length > 0;
}
