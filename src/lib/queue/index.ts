import { randomUUID } from 'node:crypto';
import { env } from '@/lib/config/env';
import { db } from '@/lib/db';

/**
 * A minimal job queue with two drivers.
 *
 * The memory driver exists so the app works on `npm run dev` with nothing
 * installed. It is honest about its limitation — jobs die with the process —
 * and the capabilities screen says so.
 *
 * The Redis driver is a small, deliberate implementation rather than a BullMQ
 * dependency: we need exactly one queue, one visibility timeout and one retry
 * policy, and owning ~80 lines is cheaper than owning a framework.
 */

export interface QueuedJob<T = unknown> {
  id: string;
  type: string;
  payload: T;
  attempts: number;
  maxAttempts: number;
  enqueuedAt: number;
  /**
   * Higher goes first. 0 is everybody; 1 is a plan that paid to jump the queue.
   *
   * Deliberately a small integer rather than a plan id: the queue should not
   * have to know what a plan is, and a number keeps "first in the queue" a
   * property of the job rather than a lookup at the moment of reserving.
   */
  priority: number;
}

export type JobHandler<T = any> = (job: QueuedJob<T>) => Promise<void>;

export interface EnqueueOptions {
  maxAttempts?: number;
  /** Higher goes first. See `QueuedJob.priority`. */
  priority?: number;
}

export interface QueueDriver {
  readonly name: string;
  enqueue<T>(type: string, payload: T, options?: EnqueueOptions): Promise<string>;
  /** Blocks until a job is available or the timeout elapses. */
  reserve(timeoutMs: number): Promise<QueuedJob | null>;
  complete(job: QueuedJob): Promise<void>;
  fail(job: QueuedJob, error: Error): Promise<void>;
  size(): Promise<number>;
}

/* ------------------------------------------------------------------ memory */

class MemoryQueueDriver implements QueueDriver {
  readonly name = 'memory';
  private readonly pending: QueuedJob[] = [];
  private readonly waiters: Array<(job: QueuedJob | null) => void> = [];

  async enqueue<T>(type: string, payload: T, options: EnqueueOptions = {}): Promise<string> {
    const job: QueuedJob<T> = {
      id: randomUUID(),
      type,
      payload,
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 3,
      enqueuedAt: Date.now(),
      priority: options.priority ?? 0,
    };

    const waiter = this.waiters.shift();
    if (waiter) {
      // Somebody is already blocked waiting. Priority cannot help here —
      // there is nothing queued to go in front of.
      waiter(job as QueuedJob);
    } else {
      // Insert before the first job of lower priority, which keeps jobs of
      // EQUAL priority in arrival order. A plain sort would not: it is only
      // stable if the comparator never claims two jobs are equal, and the
      // whole point of the fallback is that many of them are.
      const at = this.pending.findIndex((p) => p.priority < job.priority);
      if (at === -1) this.pending.push(job as QueuedJob);
      else this.pending.splice(at, 0, job as QueuedJob);
    }

    return job.id;
  }

  async reserve(timeoutMs: number): Promise<QueuedJob | null> {
    const next = this.pending.shift();
    if (next) return next;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(resolve);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(null);
      }, timeoutMs);

      this.waiters.push((job) => {
        clearTimeout(timer);
        resolve(job);
      });
    });
  }

  async complete(): Promise<void> {}

  async fail(job: QueuedJob): Promise<void> {
    if (job.attempts + 1 < job.maxAttempts) {
      this.pending.push({ ...job, attempts: job.attempts + 1 });
    }
  }

  async size(): Promise<number> {
    return this.pending.length;
  }
}

/* ------------------------------------------------------------------- redis */

class RedisQueueDriver implements QueueDriver {
  readonly name = 'redis';
  /*
   * Two lists rather than a sorted set.
   *
   * A Redis list is what gives `blMove` its atomic reserve — a worker that dies
   * holding a job leaves it recoverable in the processing list rather than
   * losing it — and that is worth far more than arbitrary priorities. Two
   * levels is all the product sells, so two lists is all it needs.
   */
  private readonly key = 'easycut:jobs';
  private readonly fastKey = 'easycut:jobs:fast';
  private readonly processingKey = 'easycut:jobs:processing';
  private client: any = null;

  private async connect() {
    if (this.client) return this.client;

    // `redis` is an OPTIONAL dependency: install it only if you use this driver
    // (`npm install redis`).
    //
    // The specifier is assembled at runtime so that neither TypeScript nor the
    // bundler tries to resolve it. With a literal here, every build of the web
    // app fails on a module the default in-memory driver never touches — and
    // the app is the half of the system that never needs the queue client at all.
    const specifier = ['re', 'dis'].join('');
    const { createClient } = (await import(/* webpackIgnore: true */ specifier)) as {
      createClient: (options: { url?: string }) => any;
    };
    this.client = createClient({ url: env.queue.redisUrl });
    this.client.on('error', (e: Error) => console.error('[queue] redis error', e.message));
    await this.client.connect();
    return this.client;
  }

  async enqueue<T>(type: string, payload: T, options: EnqueueOptions = {}): Promise<string> {
    const client = await this.connect();
    const job: QueuedJob<T> = {
      id: randomUUID(),
      type,
      payload,
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 3,
      enqueuedAt: Date.now(),
      priority: options.priority ?? 0,
    };
    await client.lPush(this.listFor(job), JSON.stringify(job));
    return job.id;
  }

  private listFor(job: { priority: number }): string {
    return job.priority > 0 ? this.fastKey : this.key;
  }

  async reserve(timeoutMs: number): Promise<QueuedJob | null> {
    const client = await this.connect();

    // Priority first, without blocking: `blMove` takes one source, so the fast
    // list is drained with a non-blocking move and only then does the worker
    // park on the ordinary one. The cost is that a priority job arriving while
    // a worker is parked waits out the remaining reserve timeout — seconds, on
    // a queue whose jobs take minutes.
    const fast = await client.lMove(this.fastKey, this.processingKey, 'RIGHT', 'LEFT');
    if (fast) return JSON.parse(fast) as QueuedJob;

    // Atomic move to the processing list: a worker that dies mid-job leaves the
    // job recoverable instead of losing it.
    const raw = await client.blMove(this.key, this.processingKey, 'RIGHT', 'LEFT', timeoutMs / 1000);
    return raw ? (JSON.parse(raw) as QueuedJob) : null;
  }

  async complete(job: QueuedJob): Promise<void> {
    const client = await this.connect();
    await client.lRem(this.processingKey, 1, JSON.stringify(job));
  }

  async fail(job: QueuedJob, _error: Error): Promise<void> {
    const client = await this.connect();
    await client.lRem(this.processingKey, 1, JSON.stringify(job));
    if (job.attempts + 1 < job.maxAttempts) {
      const retry = { ...job, attempts: job.attempts + 1 };
      await client.lPush(this.listFor(retry), JSON.stringify(retry));
    } else {
      await client.lPush('easycut:jobs:dead', JSON.stringify(job));
    }
  }

  async size(): Promise<number> {
    const client = await this.connect();
    const [fast, normal] = await Promise.all([client.lLen(this.fastKey), client.lLen(this.key)]);
    return fast + normal;
  }
}

/* ---------------------------------------------------------------------- db */

/**
 * The database as the queue.
 *
 * Redis is the right answer at scale and the wrong first dependency: splitting
 * the worker into its own container is what forces a broker, and that is a
 * second service and a third account before the product has a single user.
 * Postgres is already here, and a table is a perfectly good queue at the volume
 * one machine can render.
 *
 * Reserving is an optimistic claim rather than a lock: read the oldest queued
 * row, then update it only if it is still queued. Two workers racing for the
 * same job means one of them updates zero rows and loops. No SKIP LOCKED, no
 * advisory locks, and it behaves the same on SQLite.
 */
class DbQueueDriver implements QueueDriver {
  readonly name = 'db';

  async enqueue<T>(type: string, payload: T, options: EnqueueOptions = {}): Promise<string> {
    const row = await db.queueMessage.create({
      data: {
        type,
        payload: JSON.stringify(payload),
        maxAttempts: options.maxAttempts ?? 3,
        priority: options.priority ?? 0,
      },
    });
    return row.id;
  }

  async reserve(timeoutMs: number): Promise<QueuedJob | null> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const candidate = await db.queueMessage.findFirst({
        where: { status: 'queued' },
        // Priority first, then arrival. Both, always: ordering by priority
        // alone would shuffle everything inside a priority band on every poll.
        orderBy: [{ priority: 'desc' }, { enqueuedAt: 'asc' }],
      });

      if (candidate) {
        const claimed = await db.queueMessage.updateMany({
          where: { id: candidate.id, status: 'queued' },
          data: { status: 'running', reservedAt: new Date() },
        });
        // Zero rows means another worker won the race. Try again immediately.
        if (claimed.count === 1) {
          return {
            id: candidate.id,
            type: candidate.type,
            payload: JSON.parse(candidate.payload),
            attempts: candidate.attempts,
            maxAttempts: candidate.maxAttempts,
            enqueuedAt: candidate.enqueuedAt.getTime(),
            priority: candidate.priority,
          };
        }
        continue;
      }

      // Polling, not listening. At one job every few minutes the difference
      // between a 400ms poll and a push is not worth LISTEN/NOTIFY plumbing.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return null;
  }

  async complete(job: QueuedJob): Promise<void> {
    await db.queueMessage.delete({ where: { id: job.id } }).catch(() => undefined);
  }

  async fail(job: QueuedJob, error: Error): Promise<void> {
    const attempts = job.attempts + 1;
    await db.queueMessage.update({
      where: { id: job.id },
      data: attempts < job.maxAttempts
        ? { status: 'queued', attempts, lastError: error.message, reservedAt: null }
        : { status: 'dead', attempts, lastError: error.message },
    }).catch(() => undefined);
  }

  async size(): Promise<number> {
    return db.queueMessage.count({ where: { status: 'queued' } });
  }
}

/* ---------------------------------------------------------------- factory */

let instance: QueueDriver | null = null;

export function queue(): QueueDriver {
  if (instance) return instance;
  instance =
    env.queue.driver === 'redis' && env.queue.redisUrl ? new RedisQueueDriver()
    : env.queue.driver === 'db' ? new DbQueueDriver()
    : new MemoryQueueDriver();
  return instance;
}
