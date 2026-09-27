import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { localPathFor, storage, type StoredObject } from '@/lib/storage';

/**
 * An upload that survives the connection dropping.
 *
 * The whole file in one POST is the obvious way to do this and it is the wrong
 * way for the files this product exists for. A phone export is two or three
 * gigabytes; a home connection will drop at least once in the ten minutes that
 * takes; and every drop cost the user the entire transfer and told them to
 * check their wifi. The edge logged twelve client-aborted requests and not one
 * server error — the bytes were arriving fine right up to the moment the
 * browser lost the connection.
 *
 * So the file arrives in pieces, appended in order to one part file, and the
 * server always knows how many bytes it already has. A drop then costs the
 * piece that was in flight, not the hours before it.
 *
 * The invariant that keeps this honest: **a chunk is only ever appended at the
 * exact end of what is already there.** No seeking, no sparse writes, no
 * out-of-order assembly. A part file is therefore always a valid prefix of the
 * finished file, and its length on disk is the one source of truth for where
 * to resume — there is no separate manifest to disagree with it.
 */

/** Parts older than this are abandoned uploads; nothing will ever resume them. */
const STALE_MS = 24 * 60 * 60 * 1000;

/** An upload id is used to build a path, so it may only be these characters. */
export function safeUploadId(raw: string | null): string | null {
  if (!raw) return null;
  const id = raw.trim().toLowerCase();
  return /^[a-z0-9-]{8,64}$/.test(id) ? id : null;
}

/**
 * Where parts live.
 *
 * Beside the finished files when storage is local, so finalising is a rename
 * on the same filesystem rather than a copy of two gigabytes. In the temp
 * directory otherwise, because there is nowhere better and the S3 path does
 * not normally come through here at all.
 */
function partPath(projectId: string, uploadId: string): string {
  const local = localPathFor('.uploads');
  const root = local ?? join(tmpdir(), 'easycut-uploads');
  return join(root, projectId, `${uploadId}.part`);
}

/** How many bytes are already held for this upload. Zero if none. */
export async function receivedBytes(projectId: string, uploadId: string): Promise<number> {
  try {
    return (await stat(partPath(projectId, uploadId))).size;
  } catch {
    return 0;
  }
}

export type AppendResult =
  | { ok: true; received: number }
  /**
   * The client and the server disagree about where the file is up to. Always
   * answered with the server's number rather than an error, because the client
   * can simply seek to it and carry on — and because the common cause is a
   * chunk that arrived in full and whose *response* was lost, which is a
   * success the client has no other way to learn about.
   */
  | { ok: false; received: number; reason: 'gap' | 'overflow' };

/**
 * Appends one chunk at `offset`, which must be exactly where the file ends.
 *
 * An offset behind the end means the client is re-sending something already
 * held: that is reported as a success at the server's position, so a lost
 * response costs nothing. An offset past the end would leave a hole, so it is
 * refused — a file with a hole in it is worse than a failed upload, because it
 * looks finished.
 */
export async function appendChunk(
  projectId: string,
  uploadId: string,
  offset: number,
  total: number,
  body: ReadableStream<Uint8Array>,
): Promise<AppendResult> {
  const target = partPath(projectId, uploadId);
  await mkdir(dirname(target), { recursive: true });

  const held = await receivedBytes(projectId, uploadId);
  if (offset !== held) {
    await body.cancel().catch(() => {});
    return { ok: false, received: held, reason: 'gap' };
  }

  const out = createWriteStream(target, { flags: 'a' });
  const reader = body.getReader();
  let written = 0;
  let failure: Error | null = null;
  out.on('error', (error: Error) => {
    failure = error;
  });

  /** Waits for room, and gives up if the stream has died under us. */
  const drained = () =>
    new Promise<void>((resolve) => {
      const settle = () => {
        out.off('drain', settle);
        out.off('error', settle);
        resolve();
      };
      out.once('drain', settle);
      out.once('error', settle);
    });

  try {
    for (;;) {
      if (failure) throw failure;
      const { done, value } = await reader.read();
      if (done) break;
      /*
       * Refuse the byte that would take the part past the declared total
       * before it is written, not after. Truncating back afterwards would work
       * on a good day and leave a corrupt part on a bad one.
       */
      if (held + written + value.byteLength > total) {
        throw Object.assign(new Error('overflow'), { overflow: true });
      }
      written += value.byteLength;
      if (!out.write(value)) await drained();
    }
    await new Promise<void>((resolve) => out.end(resolve));
    if (failure) throw failure;
  } catch (error) {
    /*
     * Closed, not destroyed.
     *
     * `destroy()` throws away whatever is still in the write buffer, and that
     * is the opposite of what this path is for: those bytes arrived, they are a
     * valid prefix, and discarding them means the client re-sends them. Ending
     * the stream flushes them first, so the part file is as long as the
     * connection actually managed.
     */
    await new Promise<void>((resolve) => out.end(resolve));
    await reader.cancel().catch(() => {});
    /*
     * A half-written chunk is not a disaster and is not discarded: whatever
     * landed is still a valid prefix, so the client is told the new length and
     * resumes from there. That is the entire point of doing it this way — a
     * dropped connection costs the bytes that were in flight, nothing more.
     */
    if ((error as { overflow?: boolean }).overflow) {
      return { ok: false, received: await receivedBytes(projectId, uploadId), reason: 'overflow' };
    }
    return { ok: false, received: await receivedBytes(projectId, uploadId), reason: 'gap' };
  }

  return { ok: true, received: held + written };
}

/**
 * Hands the finished part file to storage under its real key.
 *
 * A rename when storage is on this disk — moving a two-gigabyte file must not
 * mean copying it, which would need twice the free space at the one moment the
 * upload has already proved the disk is nearly full enough to matter.
 */
export async function finalise(
  projectId: string,
  uploadId: string,
  key: string,
  contentType: string,
): Promise<StoredObject> {
  const part = partPath(projectId, uploadId);
  const destination = localPathFor(key);

  if (destination) {
    await mkdir(dirname(destination), { recursive: true });
    await rename(part, destination);
    const info = await stat(destination);
    void sweepStale(projectId);
    return { key, url: storage().publicUrl(key), sizeBytes: info.size, contentType };
  }

  const object = await storage().putFile(key, part, contentType);
  await rm(part, { force: true });
  void sweepStale(projectId);
  return object;
}

export async function discard(projectId: string, uploadId: string): Promise<void> {
  await rm(partPath(projectId, uploadId), { force: true });
}

/**
 * Removes parts nobody is coming back for.
 *
 * Without this, every abandoned upload is a permanent hole in the disk — and
 * on a container whose disk is the same one the finished videos live on, that
 * is the failure this whole file exists to stop happening.
 */
async function sweepStale(projectId: string): Promise<void> {
  const dir = dirname(partPath(projectId, 'x'));
  const names = await readdir(dir).catch(() => [] as string[]);
  const cutoff = Date.now() - STALE_MS;
  await Promise.all(
    names
      .filter((name) => name.endsWith('.part'))
      .map(async (name) => {
        const path = join(dir, name);
        const info = await stat(path).catch(() => null);
        if (info && info.mtimeMs < cutoff) await rm(path, { force: true });
      }),
  );
}
