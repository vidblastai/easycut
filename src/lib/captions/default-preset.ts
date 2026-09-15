/**
 * The caption look new uploads start from, remembered in this browser.
 *
 * Every access is wrapped: localStorage throws in a private window, comes back
 * empty when site data is cleared, and is simply absent on the server. None of
 * those are worth an error — the caller falls back to the edit style's own
 * caption preset, which is a perfectly good video.
 */

const KEY = 'easycut.captionPreset';

export function readDefaultCaptionPreset(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeDefaultCaptionPreset(presetId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, presetId);
  } catch {
    /* A browser that will not store it still renders the video correctly. */
  }
}
