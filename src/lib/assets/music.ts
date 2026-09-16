import { access, readFile } from 'node:fs/promises';
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
 * The library is two files merged:
 *
 *  - `content/music/manifest.json` — the operator's. Hand-written entries for
 *    real licensed tracks. Tracked in git, never written to by a script.
 *  - `content/music/generated.json` — written by `npm run music`, which
 *    synthesises a set of beds from the recipes in `music-beds.ts`. Gitignored,
 *    like the sound effects, because it is output.
 *
 * The operator's entries come first, so a track somebody chose outranks a
 * generated one on an otherwise equal score.
 *
 * An empty library is still a supported state: the video renders without music
 * and the job reports `music` as a degraded layer.
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

const CURATED_PATH = join(process.cwd(), 'content', 'music', 'manifest.json');
const GENERATED_PATH = join(process.cwd(), 'content', 'music', 'generated.json');

let cached: MusicManifest | null = null;

async function readManifest(path: string): Promise<MusicEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as MusicManifest;
    return Array.isArray(parsed.tracks) ? parsed.tracks : [];
  } catch {
    return [];
  }
}

export async function loadMusicLibrary(): Promise<MusicManifest> {
  if (cached) return cached;

  const [curated, generated] = await Promise.all([
    readManifest(CURATED_PATH),
    readManifest(GENERATED_PATH),
  ]);

  const seen = new Set<string>();
  const merged: MusicEntry[] = [];
  for (const track of [...curated, ...generated]) {
    if (!track?.id || seen.has(track.id)) continue;
    seen.add(track.id);
    merged.push(track);
  }

  // A manifest entry whose file is missing used to take the whole audio mix
  // down with it: ffmpeg fails on the missing input, renderAudio throws, and
  // the caller falls back to a video with NO audio track at all. One typo in a
  // hand-written manifest should not cost somebody their voice.
  const present = await Promise.all(merged.map((track) => hasFile(track)));
  cached = { version: 1, tracks: merged.filter((_, i) => present[i]) };

  const missing = merged.length - cached.tracks.length;
  if (missing > 0) {
    console.warn(
      `[music] ${missing} track(s) listed in a manifest have no file on disk and were skipped.` +
        ` Run \`npm run music\` to build the synthesised beds.`,
    );
  }
  return cached;
}

/** Local library files live under public/. A remote URL is taken on trust. */
async function hasFile(track: MusicEntry): Promise<boolean> {
  if (!track.url?.startsWith('/')) return true;
  try {
    await access(join(process.cwd(), 'public', track.url.replace(/^\//, '')));
    return true;
  } catch {
    return false;
  }
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

  const scored = candidates.map((track) => ({ track, score: scoreTrack(track, options) }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}

/**
 * How well one track fits one video. Exported because it is the whole of the
 * decision and the only part worth a test.
 */
export function scoreTrack(
  track: MusicEntry,
  options: { mood: string; mode: 'short' | 'long'; durationSec: number },
): number {
  const wanted = tokenize(options.mood);
  const targetEnergy = options.mode === 'short' ? 0.75 : 0.4;
  const tags = new Set(track.moods.flatMap(tokenize));
  const overlap = wanted.filter((w) => tags.has(w)).length;

  let score = overlap * 0.4;
  score += (1 - Math.abs(track.energy - targetEnergy)) * 0.4;
  // A track shorter than the video has to loop, which is audible.
  if (track.durationSec >= options.durationSec) score += 0.2;
  else score -= 0.15;

  return score;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

/**
 * The file on disk for a track the EDL names.
 *
 * Library tracks are served out of public/, so the URL maps straight back. A
 * remote URL (an operator pointing at object storage) has no local path and
 * returns null, which the mixer reads as "no music" rather than failing.
 *
 * This lives here rather than in the worker because three different things
 * render an EDL — the worker, the re-render path, and scripts/smoke.ts — and
 * when it was private to the worker, two of them quietly rendered without the
 * music the EDL had already chosen. A smoke test that cannot see a missing
 * layer is not testing the thing it is for.
 */
export function localMusicPath(url: string): string | null {
  if (!url.startsWith('/audio/')) return null;
  return join(process.cwd(), 'public', url.replace(/^\//, ''));
}

/** True when there is at least one usable track. */
export async function isMusicAvailable(): Promise<boolean> {
  const library = await loadMusicLibrary();
  return library.tracks.length > 0;
}
