import { randomUUID } from 'node:crypto';
import { env } from '@/lib/config/env';

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
}

export type JobHandler<T = any> = (job: QueuedJob<T>) => Promise<void>;

export interface QueueDriver {
  readonly name: string;
  enqueue<T>(type: string, payload: T, options?: { maxAttempts?: number }): Promise<string>;
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

  async enqueue<T>(type: string, payload: T, options: { maxAttempts?: number } = {}): Promise<string> {
    const job: QueuedJob<T> = {
      id: randomUUID(),
      type,
      payload,
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 3,
      enqueuedAt: Date.now(),
    };

    const waiter = this.waiters.shift();
    if (waiter) waiter(job as QueuedJob);
    else this.pending.push(job as QueuedJob);

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
  private readonly key = 'easycut:jobs';
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

  async enqueue<T>(type: string, payload: T, options: { maxAttempts?: number } = {}): Promise<string> {
    const client = await this.connect();
    const job: QueuedJob<T> = {
      id: randomUUID(),
      type,
      payload,
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 3,
      enqueuedAt: Date.now(),
    };
    await client.lPush(this.key, JSON.stringify(job));
    return job.id;
  }

  async reserve(timeoutMs: number): Promise<QueuedJob | null> {
    const client = await this.connect();
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
      await client.lPush(this.key, JSON.stringify({ ...job, attempts: job.attempts + 1 }));
    } else {
      await client.lPush('easycut:jobs:dead', JSON.stringify(job));
    }
  }

  async size(): Promise<number> {
    const client = await this.connect();
    return client.lLen(this.key);
  }
}

/* ---------------------------------------------------------------- factory */

let instance: QueueDriver | null = null;

export function queue(): QueueDriver {
  if (instance) return instance;
  instance =
    env.queue.driver === 'redis' && env.queue.redisUrl ? new RedisQueueDriver() : new MemoryQueueDriver();
  return instance;
}
