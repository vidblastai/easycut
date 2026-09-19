import '@/lib/config/load-env';
import { entitlementsFor } from '@/lib/billing/entitlements';
import { env } from '@/lib/config/env';
import { db } from '@/lib/db';
import { sweepExpired } from './sweep';
import { queue } from '@/lib/queue';
import { processProject, rerenderProject, type ProcessJobPayload } from './process-project';
import { selectedProvider } from '@/lib/director';

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
          const { projectId, edlId } = job.payload as { projectId: string; edlId: string };
          await rerenderProject(projectId, edlId);
          break;
        }
        default:
          console.warn(`[worker ${workerId}] unknown job type: ${job.type}`);
      }

      await q.complete(job);
      console.log(`[worker ${workerId}] ${job.id} finished in ${Math.round((Date.now() - startedAt) / 1000)}s`);
    } catch (error) {
      const message = (error as Error).message;
      console.error(`[worker ${workerId}] ${job.id} failed: ${message}`);
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
    : 'rule-based (no DEEPGRAM/GEMINI/ANTHROPIC key)'}`);
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

  // Jobs left "running" by a crashed worker are re-queued once on boot.
  const stale = await db.job.findMany({
    where: { status: 'running', attempts: { lt: 3 } },
    select: { id: true, projectId: true, stage: true },
  });
  for (const job of stale) {
    console.log(`  requeueing stale job ${job.id} from stage ${job.stage}`);
    await queue().enqueue(
      'pipeline',
      { projectId: job.projectId, jobId: job.id, resumeFrom: job.stage as never },
      // A job the last worker dropped keeps the priority it was accepted with:
      // it has already waited once, and it should not now wait behind
      // everything that arrived while the worker was down.
      { priority: (await entitlementsFor(job.projectId)).priority },
    );
  }

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, finishing current job...`);
    shuttingDown = true;
    setTimeout(() => process.exit(0), 30_000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  startSweeper();

  await Promise.all(
    Array.from({ length: Math.max(1, env.queue.concurrency) }, (_, i) => loop(i + 1)),
  );
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
      console.warn(`  sweep failed: ${(error as Error).message}`);
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
    console.error('[easycut] in-process worker stopped:', error);
  }
}

// Only self-start when run directly (`npm run worker`), not when imported by
// the web server's instrumentation hook.
if (process.env.RUN_WORKER_IN_WEB !== 'true') {
  main().catch((error) => {
    console.error('Worker crashed:', error);
    process.exit(1);
  });
}
