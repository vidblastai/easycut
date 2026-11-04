import { env } from '@/lib/config/env';

/**
 * One heavy render at a time, per process.
 *
 * A render drives a headless Chrome — several tabs of it for a video — and two
 * of them side by side, plus scene clips, is enough to run a container out of
 * memory. When that container also serves the website, the site goes down
 * with it. The queue can still work on two videos at once: transcription,
 * model calls and downloads overlap freely, and only the part that opens a
 * browser waits its turn here.
 */
const capacity = Math.max(1, env.render.slots);
let active = 0;
const waiting: Array<() => void> = [];

export async function withRenderSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= capacity) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}
