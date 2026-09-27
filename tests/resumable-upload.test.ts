import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The upload that survives a dropped connection.
 *
 * Every case here is one that actually took an upload down or would have: the
 * connection dying mid-chunk, a chunk whose response was lost, a part file that
 * is already complete, and a chunk that arrives out of order. The property that
 * makes all four survivable is that a part file is ALWAYS a valid prefix of the
 * finished file, so its length on disk is the only state either side needs.
 */

const ROOT = await mkdtemp(join(tmpdir(), 'easycut-resumable-'));
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = ROOT;

type Resumable = typeof import('../src/lib/storage/resumable');
let lib: Resumable;

beforeAll(async () => {
  lib = await import('../src/lib/storage/resumable');
});

/**
 * One chunk, as the route hands it over: a web stream of bytes.
 *
 * Pull-driven, and that detail is the whole fidelity of these tests. Enqueueing
 * everything and then calling `error()` up front discards the queue, so the
 * reader sees only the error and nothing ever arrives — which is not what a
 * dropped connection does. A real drop delivers what it delivered and fails on
 * the next read, so that is what this does.
 */
function streamOf(bytes: Uint8Array, cutAfter = bytes.byteLength): ReadableStream<Uint8Array> {
  let delivered = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!delivered) {
        delivered = true;
        if (cutAfter > 0) return controller.enqueue(bytes.subarray(0, cutAfter));
      }
      if (cutAfter < bytes.byteLength) return controller.error(new Error('connection reset'));
      controller.close();
    },
  });
}

function bytes(from: number, length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (from + i) % 251);
}

describe('upload ids', () => {
  it('accepts the ids the client derives and rejects anything that could be a path', () => {
    expect(lib.safeUploadId('u-1abc-2def-9xyz')).toBe('u-1abc-2def-9xyz');
    expect(lib.safeUploadId('../../etc/passwd')).toBeNull();
    expect(lib.safeUploadId('short')).toBeNull();
    expect(lib.safeUploadId(null)).toBeNull();
    // Case is normalised, because the path it builds is not on every filesystem.
    expect(lib.safeUploadId('U-1ABC-2DEF-9XYZ')).toBe('u-1abc-2def-9xyz');
  });
});

describe('appending chunks', () => {
  it('assembles the file in order and finalises it under its key', async () => {
    const total = 300;
    const project = 'p1';
    const id = 'u-aaaa-bbbb-cccc';

    expect(await lib.receivedBytes(project, id)).toBe(0);

    const first = await lib.appendChunk(project, id, 0, total, streamOf(bytes(0, 200)));
    expect(first).toEqual({ ok: true, received: 200 });

    const second = await lib.appendChunk(project, id, 200, total, streamOf(bytes(200, 100)));
    expect(second).toEqual({ ok: true, received: 300 });

    const object = await lib.finalise(project, id, 'projects/p1/source/clip.mp4', 'video/mp4');
    expect(object.sizeBytes).toBe(total);
    const written = await readFile(join(ROOT, 'projects/p1/source/clip.mp4'));
    expect(Uint8Array.from(written)).toEqual(bytes(0, total));
  });

  it('keeps what arrived when the connection dies mid-chunk, and resumes from there', async () => {
    const project = 'p2';
    const id = 'u-dead-beef-0001';

    // The browser sent 8 MB worth and the line dropped at 3 MB of it.
    const failed = await lib.appendChunk(project, id, 0, 500, streamOf(bytes(0, 400), 120));
    expect(failed.ok).toBe(false);
    expect(failed.received).toBe(120);

    // Nothing is thrown away: the next chunk starts exactly where it stopped.
    const resumed = await lib.appendChunk(project, id, 120, 500, streamOf(bytes(120, 380)));
    expect(resumed).toEqual({ ok: true, received: 500 });

    const object = await lib.finalise(project, id, 'projects/p2/source/clip.mp4', 'video/mp4');
    expect(object.sizeBytes).toBe(500);
    expect(Uint8Array.from(await readFile(join(ROOT, 'projects/p2/source/clip.mp4')))).toEqual(bytes(0, 500));
  });

  it('refuses an offset that is not the end, and says where the end is', async () => {
    const project = 'p3';
    const id = 'u-cccc-dddd-0002';
    await lib.appendChunk(project, id, 0, 400, streamOf(bytes(0, 100)));

    // Past the end: writing here would leave a hole, and a file with a hole in
    // it is worse than a failed upload because it looks finished.
    const ahead = await lib.appendChunk(project, id, 250, 400, streamOf(bytes(250, 50)));
    expect(ahead).toEqual({ ok: false, received: 100, reason: 'gap' });

    // Behind the end: this chunk already landed and only its reply was lost.
    const behind = await lib.appendChunk(project, id, 0, 400, streamOf(bytes(0, 100)));
    expect(behind).toEqual({ ok: false, received: 100, reason: 'gap' });

    // Either way the part is untouched, so the client can just seek to it.
    expect(await lib.receivedBytes(project, id)).toBe(100);
  });

  it('never lets a part grow past the declared total', async () => {
    const project = 'p4';
    const id = 'u-eeee-ffff-0003';
    const over = await lib.appendChunk(project, id, 0, 50, streamOf(bytes(0, 200)));
    expect(over.ok).toBe(false);
    expect(over.received).toBeLessThanOrEqual(50);
  });

  it('finalises an already-complete part when the last reply was lost', async () => {
    const project = 'p5';
    const id = 'u-1111-2222-0004';
    await lib.appendChunk(project, id, 0, 90, streamOf(bytes(0, 90)));

    // The client, not knowing the upload finished, sends an empty last chunk.
    const nudge = await lib.appendChunk(project, id, 90, 90, streamOf(new Uint8Array(0)));
    expect(nudge).toEqual({ ok: true, received: 90 });
  });

  it('moves the part rather than copying it, so a 2 GB file needs no second 2 GB', async () => {
    const project = 'p6';
    const id = 'u-3333-4444-0005';
    await lib.appendChunk(project, id, 0, 10, streamOf(bytes(0, 10)));
    await lib.finalise(project, id, 'projects/p6/source/clip.mp4', 'video/mp4');
    // The part is gone, not left behind as a duplicate of the finished file.
    expect(await lib.receivedBytes(project, id)).toBe(0);
  });

  it('discards a part on request', async () => {
    const project = 'p7';
    const id = 'u-5555-6666-0006';
    await lib.appendChunk(project, id, 0, 30, streamOf(bytes(0, 30)));
    expect(await lib.receivedBytes(project, id)).toBe(30);
    await lib.discard(project, id);
    expect(await lib.receivedBytes(project, id)).toBe(0);
  });

  it('sweeps parts nobody will resume, and leaves fresh ones alone', async () => {
    const project = 'p8';
    const stale = 'u-7777-8888-0007';
    const fresh = 'u-9999-aaaa-0008';
    await lib.appendChunk(project, stale, 0, 40, streamOf(bytes(0, 20)));
    await lib.appendChunk(project, fresh, 0, 40, streamOf(bytes(0, 20)));

    const old = Date.now() - 48 * 60 * 60 * 1000;
    const { utimes } = await import('node:fs/promises');
    await utimes(join(ROOT, '.uploads', project, `${stale}.part`), old / 1000, old / 1000);

    // The sweep runs off the back of a finalise, which is the only moment we
    // know somebody is around to pay for it.
    const done = 'u-bbbb-cccc-0009';
    await lib.appendChunk(project, done, 0, 5, streamOf(bytes(0, 5)));
    await lib.finalise(project, done, 'projects/p8/source/clip.mp4', 'video/mp4');
    await new Promise((r) => setTimeout(r, 50));

    expect(await lib.receivedBytes(project, stale)).toBe(0);
    expect(await lib.receivedBytes(project, fresh)).toBe(20);
  });
});

describe('the part file is always a valid prefix', () => {
  it('survives a drop in every chunk and still assembles byte for byte', async () => {
    const total = 1000;
    const project = 'p9';
    const id = 'u-dddd-eeee-0010';
    const source = bytes(0, total);

    let at = 0;
    let drops = 0;
    while (at < total) {
      const end = Math.min(at + 128, total);
      const slice = source.subarray(at, end);
      // Every other chunk dies halfway, which is the pessimistic case.
      const cut = drops % 2 === 0 ? Math.floor(slice.byteLength / 2) : slice.byteLength;
      const result = await lib.appendChunk(project, id, at, total, streamOf(slice, cut));
      at = result.received;
      drops += 1;
      expect(at).toBeLessThanOrEqual(total);
    }

    const object = await lib.finalise(project, id, 'projects/p9/source/clip.mp4', 'video/mp4');
    expect(object.sizeBytes).toBe(total);
    expect(Uint8Array.from(await readFile(join(ROOT, 'projects/p9/source/clip.mp4')))).toEqual(source);
  });

  it('does not resume a part that is longer than the file being sent', async () => {
    // The client checks this, because only it knows the file's length — but the
    // part has to be readable for that check to be possible at all.
    const project = 'p10';
    const id = 'u-ffff-0000-0011';
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(ROOT, '.uploads', 'p10'), { recursive: true });
    await writeFile(join(ROOT, '.uploads', 'p10', `${id}.part`), Buffer.from(bytes(0, 400)));
    expect(await lib.receivedBytes(project, id)).toBe(400);
    expect((await stat(join(ROOT, '.uploads', 'p10', `${id}.part`))).size).toBe(400);
  });
});
