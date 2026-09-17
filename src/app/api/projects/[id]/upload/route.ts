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

  const maxBytes = env.limits.maxUploadMb * 1024 * 1024;
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    return NextResponse.json({ error: `File exceeds the ${env.limits.maxUploadMb} MB limit.` }, { status: 413 });
  }
  if (!request.body) {
    return NextResponse.json({ error: 'Empty upload.' }, { status: 400 });
  }

  const key = assetKey(id, 'source', filename.replace(/[^\w.\-]+/g, '-').slice(-120));

  // Streamed, not buffered. `await request.arrayBuffer()` held the entire
  // source file in memory — a gigabyte of RSS per concurrent upload on an app
  // whose every job begins with exactly that file.
  const object = await storage().putStream(key, request.body, contentType);

  /*
   * And then check what actually landed.
   *
   * This route used to answer `{ ok: true }` to an upload the runtime had
   * silently truncated: 30 MB in, 10 MB on disk, HTTP 200. The job then died
   * four stages later with "moov atom not found", which is ffprobe's way of
   * saying the file stops in the middle — and the person was told their
   * FOOTAGE was broken when what was broken was our upload. Bytes in must
   * equal bytes out, or this is a failed upload and says so.
   */
  if (Number.isFinite(declared) && declared > 0 && object.sizeBytes !== declared) {
    await storage().delete(key).catch(() => {});
    return NextResponse.json(
      {
        error:
          `The upload was cut short — ${object.sizeBytes.toLocaleString()} of ` +
          `${declared.toLocaleString()} bytes arrived. Please try again.`,
      },
      { status: 502 },
    );
  }
  if (object.sizeBytes === 0) {
    return NextResponse.json({ error: 'Empty upload.' }, { status: 400 });
  }

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
