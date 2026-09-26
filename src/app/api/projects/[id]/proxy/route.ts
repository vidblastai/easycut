import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { queue } from '@/lib/queue';
import { guardProject } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * Asks for the editor's preview copy of the footage.
 *
 * Every project made since the proxy shipped has one already. This is for the
 * ones made before it, whose editor would otherwise go on playing the original
 * 4K file — the thing that made the editor feel broken. The editor calls this
 * once when it finds no proxy, the work happens on a worker, and the answer
 * arrives through the polling the page already does.
 *
 * Idempotent, and cheap to call: a project that has one says so and stops.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const denied = await guardProject(id);
  if (denied) return denied;

  const [proxy, source] = await Promise.all([
    db.asset.findFirst({ where: { projectId: id, kind: 'proxy' }, select: { url: true } }),
    db.asset.findFirst({ where: { projectId: id, kind: 'source' }, select: { id: true } }),
  ]);

  if (proxy) return NextResponse.json({ ok: true, ready: true, url: proxy.url });
  // The footage has been swept. Nothing to make a preview from, and saying so
  // beats queueing work that can only fail.
  if (!source) return NextResponse.json({ ok: true, ready: false, reason: 'no-source' });

  await queue().enqueue('proxy', { projectId: id });
  return NextResponse.json({ ok: true, ready: false, queued: true });
}
