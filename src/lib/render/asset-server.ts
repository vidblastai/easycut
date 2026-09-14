import { createReadStream, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, normalize, resolve, sep } from 'node:path';

/**
 * A loopback-only static file server that lives for the duration of one render.
 *
 * The renderer needs HTTP URLs — Remotion will not read `file://` — but routing
 * the source video through the web app is wrong in two ways: the worker would
 * depend on the app being up, and every frame would take an HTTP round trip
 * through Next's middleware stack.
 *
 * So the renderer serves the storage directory itself, on an ephemeral port
 * bound to 127.0.0.1, for as long as the render takes. With object storage
 * configured this is never used at all — those URLs are already public HTTPS.
 */
export interface AssetServer {
  /** e.g. `http://127.0.0.1:53124` */
  origin: string;
  /** Maps an absolute local path under the root to a URL this server will serve. */
  urlFor(absolutePath: string): string | null;
  close(): Promise<void>;
}

export async function startAssetServer(rootDir: string): Promise<AssetServer> {
  const root = resolve(rootDir);

  const server: Server = createServer((request, response) => {
    const requestPath = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const target = resolve(join(root, normalize(requestPath)));

    // Path traversal would let a crafted EDL read anything the worker can.
    if (target !== root && !target.startsWith(root + sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    let size: number;
    try {
      size = statSync(target).size;
    } catch {
      response.writeHead(404).end('Not found');
      return;
    }

    const range = request.headers.range?.match(/bytes=(\d*)-(\d*)/);
    const start = range?.[1] ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : size - 1;

    if (start >= size) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': contentTypeFor(target),
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;

    response.writeHead(range ? 206 : 200, headers);
    createReadStream(target, { start, end }).pipe(response);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    // Port 0 asks the OS for a free port; 127.0.0.1 keeps it off the network.
    server.listen(0, '127.0.0.1', () => resolveListen());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Asset server failed to bind');
  }
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    urlFor(absolutePath: string): string | null {
      const full = resolve(absolutePath);
      if (full !== root && !full.startsWith(root + sep)) return null;
      const relative = full.slice(root.length).split(sep).filter(Boolean).map(encodeURIComponent).join('/');
      return `${origin}/${relative}`;
    },
    close() {
      return new Promise<void>((done) => {
        server.closeAllConnections?.();
        server.close(() => done());
      });
    },
  };
}

function contentTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
    wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml',
  };
  return types[ext ?? ''] ?? 'application/octet-stream';
}
