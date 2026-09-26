import '@/lib/config/load-env';
import { entitlementsFor } from '@/lib/billing/entitlements';
import { readQuality } from '@/lib/render/quality';
import { env } from '@/lib/config/env';
import { db } from '@/lib/db';
import { sweepExpired } from './sweep';
import { queue } from '@/lib/queue';
import { makeProjectProxy, processProject, rerenderProject, type ProcessJobPayload } from './process-project';
import { selectedProvider } from '@/lib/director';
import { reportError } from '@/lib/errors/report';

/**
 * The worker loop.
 *
 * Deliberately boring: reserve a job, run it, mark it done, repeat. Concurrency
 * is N independent copies of the same loop rather than a scheduler, because
 * video jobs are long and CPU-bound — there is nothing clever to gain and a lot
 * of complexity to lose.
 *
 *   npm run worker
 */

let shuttingDown = false;

async function loop(workerId: number): Promise<void> {
  const q = queue();

  while (!shuttingDown) {
    const job = await q.reserve(5000);
    if (!job) continue;

    const startedAt = Date.now();
    console.log(`[worker ${workerId}] ${job.type} ${job.id} started`);

    try {
      switch (job.type) {
        case 'pipeline':
          await processProject(job.payload as ProcessJobPayload);
          break;
        case 'rerender': {
          const { projectId, edlId, quality } = job.payload as {
            projectId: string;
            edlId: string;
            quality?: string;
          };
          // `readQuality` never guesses upwards, so an old job enqueued before
          // 4K existed renders HD rather than quadrupling somebody's wait.
          await rerenderProject(projectId, edlId, readQuality(quality));
          break;
        }
        case 'proxy': {
          const { projectId } = job.payload as { projectId: string };
          await makeProjectProxy(projectId);
          break;
        }
        default:
          console.warn(`[worker ${workerId}] unknown job type: ${job.type}`);
      }

      await q.complete(job);
      console.log(`[worker ${workerId}] ${job.id} finished in ${Math.round((Date.now() - startedAt) / 1000)}s`);
    } catch (error) {
      /*
       * The 2am failure. This is the single most important call site in the
       * error module: everything downstream of an upload that goes wrong goes
       * wrong HERE, and until this line existed the customer's "something went
       * wrong" was the only notice anybody got.
       *
       * Reported before the job is failed, so an alert goes out even if the
       * queue write is itself the thing that is broken.
       */
      await reportError(error, {
        where: `worker.${job.type}`,
        jobId: job.id,
        attempt: job.attempts,
        projectId: (job.payload as { projectId?: string })?.projectId,
        ranForSec: Math.round((Date.now() - startedAt) / 1000),
      });
      await q.fail(job, error as Error);
    }
  }
}

export async function main(): Promise<void> {
  console.log(`EasyCut worker starting`);
  console.log(`  queue    : ${queue().name}`);
  console.log(`  storage  : ${env.storage.driver}`);
  console.log(`  renderer : ${env.render.driver}`);
  // Named the provider that is actually selected. The old line said
  // "no ANTHROPIC_API_KEY" even with a Gemini key set, which reads as broken.
  const director = selectedProvider();
  console.log(`  director : ${
    director === 'anthropic' ? env.llm.model
    : director === 'gemini' ? env.llm.geminiModel
    : director === 'wavespeed' ? `${env.llm.wavespeedModel} (via WaveSpeed)`
    : 'rule-based (no director key configured)'}`);
  console.log(`  workers  : ${env.queue.concurrency}`);

  // A worker in its own terminal with an in-process queue is a worker that will
  // never be given anything to do, and it looks exactly like a worker that is
  // simply idle.
  if (env.queue.driver === 'memory') {
    console.warn(
      '\n  ! QUEUE_DRIVER=memory — this worker has its own queue and will never\n' +
      '    see jobs from the web app. Unset it, or set QUEUE_DRIVER=db.\n',
    );
  }

  // Jobs left "running" by a crashed worker are re-queued on boot, and then
  // on a timer — see `startRescuer`.
  await rescueStaleJobs({ boot: true });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, finishing current job...`);
    shuttingDown = true;
    setTimeout(() => process.exit(0), 30_000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  startSweeper();
  startRescuer();

  await Promise.all(
    Array.from({ length: Math.max(1, env.queue.concurrency) }, (_, i) => loop(i + 1)),
  );
}

/**
 * How long a `running` job may go without its row moving before this worker
 * assumes nobody is working on it.
 *
 * Longer than the longest stage that reports no intermediate progress:
 * transcription is one network call and can legitimately sit silent for
 * minutes on a long upload. Re-queueing a job that is merely slow is not
 * harmful — the pipeline resumes from the last finished stage — but it is
 * wasted work, so the bar is set where a real stall is the likelier
 * explanation.
 */
const STALE_AFTER_MS = 15 * 60_000;

/**
 * Picks up jobs whose worker died.
 *
 * On boot this catches everything left behind by the process that crashed.
 * On a timer it catches the harder case: a worker in a POOL that died while
 * its siblings kept running, where nothing ever restarts and the job simply
 * sits at 40% until somebody notices. Without this, the only cure was a
 * deploy.
 *
 * `attempts < 3` is what stops a job that crashes the worker every time from
 * being resurrected forever — it fails honestly instead, which the progress
 * screen can show and the customer can retry.
 */
async function rescueStaleJobs({ boot = false } = {}): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await db.job
    .findMany({
      where: {
        status: 'running',
        attempts: { lt: 3 },
        // On boot, everything still marked running belongs to the process that
        // is no longer here, however recently it was touched.
        ...(boot ? {} : { updatedAt: { lt: cutoff } }),
      },
      select: { id: true, projectId: true, stage: true, updatedAt: true },
    })
    .catch(() => []);

  for (const job of stale) {
    const idleMin = Math.round((Date.now() - job.updatedAt.getTime()) / 60_000);
    console.log(
      `  requeueing stale job ${job.id} from stage ${job.stage}${boot ? '' : ` (idle ${idleMin}m)`}`,
    );
    await queue().enqueue(
      'pipeline',
      { projectId: job.projectId, jobId: job.id, resumeFrom: job.stage as never },
      // A job the last worker dropped keeps the priority it was accepted with:
      // it has already waited once, and it should not now wait behind
      // everything that arrived while the worker was down.
      { priority: (await entitlementsFor(job.projectId)).priority },
    );
  }
}

function startRescuer(): void {
  const every = Math.max(1, env.retention.sweepIntervalMinutes) * 60_000;
  const tick = () => {
    void rescueStaleJobs().catch((error) =>
      reportError(error, { where: 'worker.rescue', severity: 'warning' }),
    );
  };
  setInterval(tick, Math.min(every, 5 * 60_000)).unref();
}

/**
 * Deletes expired footage and renders on a timer.
 *
 * In the worker rather than a separate cron container, because it is the
 * process that already holds storage credentials and already has to be running
 * for the product to work at all. An hour is far more often than retention
 * needs — the shortest window is two days — but frequent small passes keep any
 * single one short, and a sweeper that runs while somebody is watching is a
 * sweeper whose bugs are found.
 *
 * Failures are logged and swallowed on purpose: a storage hiccup must not take
 * down the process that renders videos.
 */
function startSweeper(): void {
  const run = async () => {
    if (shuttingDown) return;
    try {
      const result = await sweepExpired();
      const did = result.sourcesDeleted + result.rendersDeleted;
      if (did > 0) {
        console.log(
          `  swept ${result.sourcesDeleted} source${result.sourcesDeleted === 1 ? '' : 's'}, ` +
          `${result.rendersDeleted} render set${result.rendersDeleted === 1 ? '' : 's'}, ` +
          `${(result.bytesFreed / 1e9).toFixed(2)} GB freed`,
        );
      }
      for (const error of result.errors.slice(0, 5)) console.warn(`  sweep: ${error}`);
    } catch (error) {
      // A warning, not an error: retention slipping by an hour is a problem
      // worth knowing about and not one worth waking anybody for. The alert
      // matters if it keeps happening, which the repeat count says.
      await reportError(error, { where: 'worker.sweep', severity: 'warning' });
    }
  };

  // Not on boot: a worker restarting in a crash loop would sweep on every
  // start, and the first pass is the one most likely to find a large backlog.
  const timer = setInterval(() => void run(), env.retention.sweepIntervalMinutes * 60_000);
  timer.unref();
}

/**
 * The same loop, started from inside another process.
 *
 * A crash here must not take the web server down with it, so unlike the
 * standalone entry point below it logs and returns rather than exiting.
 */
export async function startWorker(): Promise<void> {
  try {
    await main();
  } catch (error) {
    // Fatal for the worker even though the web server survives: from the
    // customer's side nothing will ever be rendered again until this is seen.
    await reportError(error, { where: 'worker.in-process', severity: 'fatal' });
  }
}

// Only self-start when run directly (`npm run worker`), not when imported by
// the web server's instrumentation hook.
if (process.env.RUN_WORKER_IN_WEB !== 'true') {
  main().catch(async (error) => {
    await reportError(error, { where: 'worker.boot', severity: 'fatal' });
    process.exit(1);
  });
}
