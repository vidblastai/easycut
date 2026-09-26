/**
 * The editor's preview copy of the footage.
 *
 * Versioned by FILENAME, deliberately. The encoder settings behind this file
 * are the difference between an editor that plays smoothly and one that
 * freezes on every cut, and a project made before a settings change would
 * otherwise keep its old file forever — the fix would work for new uploads and
 * not for the video somebody is looking at. A new name means the worker can
 * see at a glance that a proxy is out of date and rebuild it.
 *
 * k12: a keyframe every twelve frames, so a seek at a cut lands almost at
 * once. See `makeProxy`.
 */
export const PREVIEW_PROXY_FILE = 'preview-k12.mp4';

/**
 * Whether a stored proxy was built by the current settings.
 *
 * Matched on the NAME rather than the whole filename, so the same file in
 * another container — a VP9 copy, which is the only codec a browser without
 * proprietary codecs can play, and therefore the only way to test playback in
 * CI — still counts as current.
 */
export function isCurrentProxy(storageKey: string | null | undefined): boolean {
  if (!storageKey) return false;
  const stem = PREVIEW_PROXY_FILE.replace(/\.[^.]+$/, '');
  return new RegExp(`/${stem}\\.[a-z0-9]+$`).test(storageKey) || storageKey.endsWith(PREVIEW_PROXY_FILE);
}
