import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { env } from '@/lib/config/env';
import { assetKey, storage } from '@/lib/storage';
import { appendChunk, discard, finalise, receivedBytes, safeUploadId } from '@/lib/storage/resumable';
import { guardProject } from '@/lib/auth';

export const runtime = 'nodejs';
// Uploads are large and slow; Next's default body limit does not apply to the
// streaming Request body, but the route still needs room to run.
export const maxDuration = 300;

/**
 * Fallback upload path, used when object storage isn't configured (local
 * development). With S3/R2 the browser PUTs straight to a presigned URL and
 * this route is never called.
 *
 * Two shapes, one route:
 *
 *  - **Whole file.** No `x-upload-id`. The body is the file. Fine for anything
 *    small enough that losing it costs seconds.
 *  - **One chunk.** `x-upload-id` names the transfer, `x-chunk-offset` says
 *    where this piece goes and `x-upload-total` how long the file is. The
 *    pieces are appended in order and the last one finishes the upload.
 *
 * The second exists because the first cannot be made reliable. A three-gigabyte
 * phone export over a home connection will lose the connection at least once,
 * and whole-file POST answers that by throwing away everything that already
 * arrived — the edge logged twelve client-aborted uploads and not a single
 * server error. Chunked, a drop costs the piece in flight.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const denied = await guardProject(id);
  if (denied) return denied;

  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const contentType = request.headers.get('content-type') ?? 'video/mp4';
  const filename = request.headers.get('x-filename') ?? 'source.mp4';
  const uploadId = safeUploadId(request.headers.get('x-upload-id'));

  const maxBytes = env.limits.maxUploadMb * 1024 * 1024;
  const total = Number(request.headers.get('x-upload-total') ?? request.headers.get('content-length') ?? '');
  if (Number.isFinite(total) && total > maxBytes) {
    return NextResponse.json({ error: `File exceeds the ${env.limits.maxUploadMb} MB limit.` }, { status: 413 });
  }
  if (!request.body) {
    return NextResponse.json({ error: 'Empty upload.' }, { status: 400 });
  }

  const key = assetKey(id, 'source', filename.replace(/[^\w.\-]+/g, '-').slice(-120));

  return uploadId
    ? chunk(request, id, uploadId, key, contentType, total)
    : whole(request, id, key, contentType);
}

/**
 * Where the transfer is up to, so the browser can pick up where it left off.
 *
 * Asked before the first chunk as well as after a failure: a reload, a new tab
 * or a phone that went to sleep all lose the client's own count, and the length
 * of the part file on disk is the only number that was never guessing.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await guardProject(id);
  if (denied) return denied;

  const uploadId = safeUploadId(new URL(request.url).searchParams.get('uploadId'));
  if (!uploadId) return NextResponse.json({ error: 'Missing uploadId.' }, { status: 400 });

  return NextResponse.json({ received: await receivedBytes(id, uploadId) });
}

/**
 * Throws away a part file.
 *
 * Asked for when the client finds a part LONGER than the file it is sending:
 * that cannot be a prefix of it, so resuming would assemble something the right
 * length out of the wrong bytes, which is worse than starting again.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await guardProject(id);
  if (denied) return denied;

  const uploadId = safeUploadId(new URL(request.url).searchParams.get('uploadId'));
  if (!uploadId) return NextResponse.json({ error: 'Missing uploadId.' }, { status: 400 });

  await discard(id, uploadId);
  return NextResponse.json({ ok: true });
}

/* -------------------------------------------------------------- one chunk */

async function chunk(
  request: Request,
  id: string,
  uploadId: string,
  key: string,
  contentType: string,
  total: number,
) {
  const offset = Number(request.headers.get('x-chunk-offset') ?? '');
  if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(total) || total <= 0) {
    return NextResponse.json({ error: 'Bad chunk offset or total.' }, { status: 400 });
  }

  const result = await appendChunk(id, uploadId, offset, total, request.body!);

  /*
   * A disagreement is answered with the server's position and HTTP 409, not
   * with a failure. The client seeks there and carries on, which also silently
   * handles the case that looks like a failure and is not: a chunk that
   * arrived whole and whose response was lost on the way back.
   */
  if (!result.ok) {
    return NextResponse.json({ received: result.received, reason: result.reason }, { status: 409 });
  }
  if (result.received < total) {
    return NextResponse.json({ ok: true, received: result.received, done: false });
  }

  const object = await finalise(id, uploadId, key, contentType);
  if (object.sizeBytes !== total) {
    // Belt and braces: the append path cannot produce this, and a source file
    // of the wrong length is the one failure that survives four more stages
    // before surfacing as "moov atom not found" and blaming their footage.
    await storage().delete(key).catch(() => {});
    return NextResponse.json(
      { error: `The upload was cut short — ${object.sizeBytes.toLocaleString()} of ${total.toLocaleString()} bytes.` },
      { status: 502 },
    );
  }

  await record(id, key, object.url, contentType, object.sizeBytes);
  return NextResponse.json({ ok: true, done: true, key, url: object.url, sizeBytes: object.sizeBytes });
}

/* ------------------------------------------------------------- whole file */

async function whole(request: Request, id: string, key: string, contentType: string) {
  const declared = Number(request.headers.get('content-length') ?? '');

  // Streamed, not buffered. `await request.arrayBuffer()` held the entire
  // source file in memory — a gigabyte of RSS per concurrent upload on an app
  // whose every job begins with exactly that file.
  const object = await storage().putStream(key, request.body!, contentType);

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

  await record(id, key, object.url, contentType, object.sizeBytes);
  return NextResponse.json({ ok: true, key, url: object.url, sizeBytes: object.sizeBytes });
}

/**
 * The asset row, written once however the bytes arrived.
 *
 * Upserted on the key rather than created: a resumed upload can legitimately
 * finish twice — the finishing chunk's response is exactly the one most likely
 * to be lost — and a second row for the same file would give the pipeline two
 * sources to choose from.
 */
async function record(id: string, key: string, url: string, contentType: string, sizeBytes: number) {
  const existing = await db.asset.findFirst({ where: { projectId: id, kind: 'source', storageKey: key } });
  if (existing) {
    await db.asset.update({ where: { id: existing.id }, data: { url, contentType, sizeBytes } });
    return;
  }
  await db.asset.create({ data: { projectId: id, kind: 'source', storageKey: key, url, contentType, sizeBytes } });
}
