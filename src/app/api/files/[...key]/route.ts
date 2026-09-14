import { createReadStream, statSync } from 'node:fs';
import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { localPathFor } from '@/lib/storage';

export const runtime = 'nodejs';

/**
 * Serves files from the local storage driver.
 *
 * Range support matters more than it looks: without it, `<video>` cannot seek,
 * and the editor's scrubbing — the thing that makes the preview feel live —
 * simply doesn't work.
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const storageKey = key.map(decodeURIComponent).join('/');

  // Defence in depth; the driver also strips traversal.
  if (storageKey.includes('..')) {
    return NextResponse.json({ error: 'Bad path' }, { status: 400 });
  }

  const path = localPathFor(storageKey);
  if (!path) return NextResponse.json({ error: 'Local storage is not in use' }, { status: 404 });

  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const contentType = guessContentType(storageKey);
  const range = request.headers.get('range');

  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : Math.min(start + 4 * 1024 * 1024 - 1, size - 1);

    if (start >= size) {
      return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }

    const stream = createReadStream(path, { start, end });
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  const stream = createReadStream(path);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

function guessContentType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
    m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml',
    json: 'application/json',
  };
  return types[ext ?? ''] ?? 'application/octet-stream';
}
