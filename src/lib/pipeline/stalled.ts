import { env } from '@/lib/config/env';

/**
 * Whether anything is actually working on this job.
 *
 * The worst failure this product can have is not a video that fails — a
 * failure says so and offers a button. It is a video that never finishes and
 * never says anything: the progress screen sits on "Reading your footage" with
 * a spinner, forever, and the person watching it has no way to tell the
 * difference between "this takes a few minutes" and "nobody is ever going to
 * pick this up".
 *
 * Two shapes of stuck, and they have different causes and different advice:
 *
 *  - **Queued and never started.** Nothing is consuming the queue. On a self
 *    hosted clone that is almost always the worker not running, or running
 *    against `QUEUE_DRIVER=memory`, which gives it a private queue the web app
 *    never writes to.
 *  - **Started and stopped moving.** The worker died mid-job. The work is not
 *    lost — the pipeline is resumable and the worker re-queues stale jobs —
 *    but the row will not move again until one comes back.
 *
 * The thresholds are deliberately generous. A render legitimately takes half
 * an hour, and a screen that cries wolf at four minutes is worse than one that
 * says nothing, because people learn to ignore it.
 */

/** Nothing has taken this job off the queue. */
const NEVER_STARTED_MS = 3 * 60_000;
/**
 * A running job whose row has not moved.
 *
 * Longer than the longest stage that reports no intermediate progress. The
 * render reports continuously, but transcription is one network call that can
 * legitimately sit silent for minutes on a long upload.
 */
const NO_PROGRESS_MS = 12 * 60_000;

export interface Stalled {
  /** Machine-readable, so the UI can phrase it rather than echo it. */
  reason: 'never-started' | 'no-progress';
  /** How long it has been like this, in seconds. */
  forSec: number;
  /** Whether the operator can fix this themselves, which changes the advice. */
  selfHosted: boolean;
}

/**
 * A project that says it is processing with no job behind it at all.
 *
 * Rarer than a dead worker and worse: there is nothing to resume, nothing to
 * retry and nothing in any queue, so it will sit at "Reading your footage"
 * until somebody looks in the database. It happens when a job fails to enqueue
 * after the project row was already flipped, and it used to be completely
 * silent.
 */
export function stalledProject(
  project: { status: string; updatedAt: Date },
  hasJob: boolean,
  now = new Date(),
): Stalled | null {
  if (hasJob || project.status !== 'processing') return null;
  const waited = now.getTime() - project.updatedAt.getTime();
  if (waited < NEVER_STARTED_MS) return null;
  return {
    reason: 'never-started',
    forSec: Math.round(waited / 1000),
    selfHosted: env.queue.driver === 'memory' || env.storage.driver === 'local',
  };
}

export function stalledJob(
  job: { status: string; queuedAt: Date; startedAt: Date | null; updatedAt: Date },
  now = new Date(),
): Stalled | null {
  // Only a job that is supposed to be moving can be stuck.
  if (job.status !== 'queued' && job.status !== 'running') return null;

  // A clone with no queue worker of its own is the commonest cause by far, and
  // the one where naming the fix actually helps.
  const selfHosted = env.queue.driver === 'memory' || env.storage.driver === 'local';

  if (job.status === 'queued' || !job.startedAt) {
    const waited = now.getTime() - job.queuedAt.getTime();
    if (waited < NEVER_STARTED_MS) return null;
    return { reason: 'never-started', forSec: Math.round(waited / 1000), selfHosted };
  }

  const since = now.getTime() - job.updatedAt.getTime();
  if (since < NO_PROGRESS_MS) return null;
  return { reason: 'no-progress', forSec: Math.round(since / 1000), selfHosted };
}
