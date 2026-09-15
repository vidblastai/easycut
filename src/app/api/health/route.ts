import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { env } from '@/lib/config/env';
import { selectedProvider } from '@/lib/director';

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
  let healthy = true;

  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch (error) {
    checks.database = `failed: ${(error as Error).message}`;
    healthy = false;
  }

  checks.storage = env.storage.driver;
  checks.queue = env.queue.driver;
  checks.renderer = env.render.driver;
  checks.director = selectedProvider();
  checks.transcription = env.transcription.deepgramKey || env.transcription.groqKey || env.transcription.assemblyaiKey
    ? 'configured'
    : 'none — silence-only edits, no captions';

  // Two settings that work locally and quietly lose data once there is more
  // than one container. Worth surfacing on the endpoint an operator actually
  // looks at rather than only in a doc they read once.
  const warnings: string[] = [];
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
