import { NextResponse } from 'next/server';
import { statfs } from 'node:fs/promises';
import { resolve } from 'node:path';
import { db } from '@/lib/db';
import { env } from '@/lib/config/env';
import { selectedProvider } from '@/lib/director';
import { isScenePassConfigured } from '@/lib/director/scenes';
import { isAuthEnabled } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * What a load balancer asks before it routes traffic here.
 *
 * It checks the database, because that is the dependency whose absence makes
 * every request fail rather than degrade. Everything else — a missing ASR key,
 * no B-roll provider, no image generation — is a worse video, not a broken
 * service, so it is reported but never fails the check. A health endpoint that
 * goes red because Pexels is down would take the whole site offline over a
 * layer the product is designed to run without.
 */
export async function GET() {
  const checks: Record<string, string> = {};
  const warnings: string[] = [];
  let healthy = true;

  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch (error) {
    checks.database = `failed: ${(error as Error).message}`;
    healthy = false;
  }

  checks.storage = env.storage.driver;
  /*
   * Free disk, when the uploads land on this container's own disk.
   *
   * A full disk does not look like a full disk from the browser. The upload
   * streams fine until the write fails, the connection drops mid-body, and the
   * only thing the user ever sees is `xhr.onerror` — "Upload failed, check your
   * connection", which sends them to reset a router that was never the
   * problem. This is the one place an operator can tell the difference.
   */
  const disk = await freeSpace(env.storage.driver === 'local' ? env.storage.localDir : '.');
  if (disk) {
    checks.disk = `${gb(disk.free)} free of ${gb(disk.total)}`;
    if (env.storage.driver === 'local' && disk.free < LOW_DISK_BYTES) {
      warnings.push(
        `Only ${gb(disk.free)} of disk left — uploads will fail mid-transfer, and the browser reports that as a dropped connection.`,
      );
      healthy = false;
    }
  }
  checks.queue = env.queue.driver;
  checks.renderer = env.render.driver;
  checks.director = selectedProvider();
  // Reported because "did the animated scenes run?" was, for two rounds of
  // testing, a question nobody could answer without reading the source.
  checks.scenes = isScenePassConfigured() ? env.llm.motionModel : 'off (no MOTION_MODEL)';
  checks.auth = isAuthEnabled() ? 'clerk' : 'OPEN — anyone can see any project';
  checks.transcription = env.transcription.deepgramKey || env.transcription.groqKey || env.transcription.assemblyaiKey
    ? 'configured'
    : 'none — silence-only edits, no captions';

  // Two settings that work locally and quietly lose data once there is more
  // than one container. Worth surfacing on the endpoint an operator actually
  // looks at rather than only in a doc they read once.
  if (!isAuthEnabled()) {
    warnings.push('No CLERK_SECRET_KEY — every project is reachable by anyone who guesses its id.');
  }
  if (env.storage.driver === 'local') {
    warnings.push('STORAGE_DRIVER=local — uploads and renders live on this container and vanish when it restarts.');
  }
  if (env.queue.driver === 'memory') {
    warnings.push('QUEUE_DRIVER=memory — queued jobs are lost on restart and a second worker cannot see them.');
  }

  return NextResponse.json(
    { status: healthy ? 'ok' : 'degraded', checks, ...(warnings.length ? { warnings } : {}) },
    { status: healthy ? 200 : 503 },
  );
}

/** Below this, an upload of any real size is going to hit the end of the disk. */
const LOW_DISK_BYTES = 3 * 1024 * 1024 * 1024;

async function freeSpace(dir: string): Promise<{ free: number; total: number } | null> {
  try {
    const fs = await statfs(resolve(dir));
    return { free: Number(fs.bsize) * Number(fs.bavail), total: Number(fs.bsize) * Number(fs.blocks) };
  } catch {
    // An unmounted path or a platform without statfs is not a health problem;
    // it just means this line cannot be reported.
    return null;
  }
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
