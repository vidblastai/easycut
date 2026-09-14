import '@/lib/config/load-env';
import { env } from '@/lib/config/env';
import { db } from '@/lib/db';
import { queue } from '@/lib/queue';
import { processProject, rerenderProject, type ProcessJobPayload } from './process-project';

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

async function main(): Promise<void> {
  console.log(`EasyCut worker starting`);
  console.log(`  queue    : ${queue().name}`);
  console.log(`  storage  : ${env.storage.driver}`);
  console.log(`  renderer : ${env.render.driver}`);
  console.log(`  director : ${env.llm.anthropicKey ? env.llm.model : 'rule-based (no ANTHROPIC_API_KEY)'}`);
  console.log(`  workers  : ${env.queue.concurrency}`);

  // Jobs left "running" by a crashed worker are re-queued once on boot.
  const stale = await db.job.findMany({
    where: { status: 'running', attempts: { lt: 3 } },
    select: { id: true, projectId: true, stage: true },
  });
  for (const job of stale) {
    console.log(`  requeueing stale job ${job.id} from stage ${job.stage}`);
    await queue().enqueue('pipeline', {
      projectId: job.projectId,
      jobId: job.id,
      resumeFrom: job.stage as never,
    });
  }

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, finishing current job...`);
    shuttingDown = true;
    setTimeout(() => process.exit(0), 30_000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await Promise.all(
    Array.from({ length: Math.max(1, env.queue.concurrency) }, (_, i) => loop(i + 1)),
  );
}

main().catch((error) => {
  console.error('Worker crashed:', error);
  process.exit(1);
});
