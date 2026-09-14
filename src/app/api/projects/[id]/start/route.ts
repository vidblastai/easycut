import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { queue } from '@/lib/queue';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';

const StartSchema = z.object({
  /** Set when the browser uploaded straight to object storage. */
  storageKey: z.string().optional(),
  filename: z.string().optional(),
  contentType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

/**
 * Kicks off the pipeline. Registers the source asset if the upload bypassed us
 * (presigned PUT), then enqueues the job and returns immediately — the browser
 * follows progress by polling the project route.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = StartSchema.parse((await request.json().catch(() => ({}))) ?? {});

  const project = await db.project.findUnique({
    where: { id },
    include: { assets: { where: { kind: 'source' } } },
  });
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  let source = project.assets[0];

  if (!source && body.storageKey) {
    const key = body.storageKey;
    if (!(await storage().exists(key))) {
      return NextResponse.json({ error: 'Upload not found in storage' }, { status: 400 });
    }
    source = await db.asset.create({
      data: {
        projectId: id,
        kind: 'source',
        storageKey: key,
        url: storage().publicUrl(key),
        contentType: body.contentType ?? 'video/mp4',
        sizeBytes: body.sizeBytes ?? 0,
      },
    });
  }

  if (!source) {
    return NextResponse.json({ error: 'No footage uploaded yet.' }, { status: 400 });
  }

  // Don't stack jobs — a second "start" on a running project is a no-op.
  const running = await db.job.findFirst({
    where: { projectId: id, status: { in: ['queued', 'running'] } },
  });
  if (running) {
    return NextResponse.json({ ok: true, jobId: running.id, alreadyRunning: true });
  }

  const job = await db.job.create({ data: { projectId: id, type: 'pipeline', status: 'queued' } });
  await db.project.update({ where: { id }, data: { status: 'processing', errorMessage: null } });

  await queue().enqueue('pipeline', { projectId: id, jobId: job.id });

  return NextResponse.json({ ok: true, jobId: job.id });
}
