/**
 * A file handed from one screen to the next.
 *
 * Dropping footage on the dashboard has to land you in the wizard with that
 * file already chosen. A File cannot travel in a URL and is far too large for
 * sessionStorage, so it waits here in module memory while the client-side
 * navigation happens — the JS context survives a `router.push`, which is the
 * whole reason this works.
 *
 * It does NOT survive a full page load, and that is fine: `take()` returns null
 * and the wizard shows its own drop zone, which is exactly what someone who
 * just reloaded expects to see.
 */

let pending: File | null = null;

export function setPendingUpload(file: File): void {
  pending = file;
}

/** Reads and clears — a file must never be adopted twice. */
export function takePendingUpload(): File | null {
  const file = pending;
  pending = null;
  return file;
}

/** The same check the wizard makes, so the two screens agree on what a video is. */
export function looksLikeVideo(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name);
}
