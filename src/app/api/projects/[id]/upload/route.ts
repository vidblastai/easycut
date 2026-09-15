import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { env } from '@/lib/config/env';
import { assetKey, storage } from '@/lib/storage';
import { guardProject } from '@/lib/auth';

export const runtime = 'nodejs';
// Uploads are large and slow; Next's default body limit does not apply to the
// streaming Request body, but the route still needs room to run.
export const maxDuration = 300;

/**
 * Fallback upload path, used when object storage isn't configured (local
 * development). With S3/R2 the browser PUTs straight to a presigned URL and
 * this route is never called.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const denied = await guardProject(id);
  if (denied) return denied;

  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const contentType = request.headers.get('content-type') ?? 'video/mp4';
  const filename = request.headers.get('x-filename') ?? 'source.mp4';

  const buffer = Buffer.from(await request.arrayBuffer());
  const maxBytes = env.limits.maxUploadMb * 1024 * 1024;
  if (buffer.byteLength > maxBytes) {
    return NextResponse.json({ error: `File exceeds the ${env.limits.maxUploadMb} MB limit.` }, { status: 413 });
  }
  if (buffer.byteLength === 0) {
    return NextResponse.json({ error: 'Empty upload.' }, { status: 400 });
  }

  const key = assetKey(id, 'source', filename.replace(/[^\w.\-]+/g, '-').slice(-120));
  const object = await storage().put(key, buffer, contentType);

  await db.asset.create({
    data: {
      projectId: id,
      kind: 'source',
      storageKey: key,
      url: object.url,
      contentType,
      sizeBytes: object.sizeBytes,
    },
  });

  return NextResponse.json({ ok: true, key, url: object.url, sizeBytes: object.sizeBytes });
}
