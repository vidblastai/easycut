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

/** Whether a stored proxy was built by the current settings. */
export function isCurrentProxy(storageKey: string | null | undefined): boolean {
  return Boolean(storageKey?.endsWith(PREVIEW_PROXY_FILE));
}
