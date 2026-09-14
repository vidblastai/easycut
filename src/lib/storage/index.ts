import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { env } from '@/lib/config/env';

/**
 * Storage is behind an interface with two drivers because the two deployments
 * have genuinely different needs, not because abstraction is nice:
 *
 *  - `local` — one machine, one worker, files on disk. What you get on `git clone`.
 *  - `s3`    — any S3-compatible bucket (Cloudflare R2 is the cheap default:
 *              zero egress fees, which matters a lot when every finished video
 *              gets downloaded).
 */

export interface StoredObject {
  key: string;
  url: string;
  sizeBytes: number;
  contentType: string;
}

export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<StoredObject>;
  putFile(key: string, filePath: string, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  /** A URL a browser can load directly. */
  publicUrl(key: string): string;
  /** A URL the browser can PUT to, so uploads never touch our server. */
  presignUpload(key: string, contentType: string, expiresSec?: number): Promise<string | null>;
  exists(key: string): Promise<boolean>;
}

/* ------------------------------------------------------------ local driver */

class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  private readonly root: string;

  constructor(root: string) {
    this.root = join(process.cwd(), root);
  }

  private path(key: string): string {
    // Key traversal would let an upload write anywhere on the box.
    const safe = key.replace(/\.\./g, '').replace(/^\/+/, '');
    return join(this.root, safe);
  }

  async put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<StoredObject> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    return { key, url: this.publicUrl(key), sizeBytes: body.byteLength, contentType };
  }

  async putFile(key: string, filePath: string, contentType: string): Promise<StoredObject> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    const { pipeline } = await import('node:stream/promises');
    const { createWriteStream } = await import('node:fs');
    await pipeline(createReadStream(filePath), createWriteStream(target));
    const info = await stat(target);
    return { key, url: this.publicUrl(key), sizeBytes: info.size, contentType };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  publicUrl(key: string): string {
    // Served by the /api/files route, which streams from the storage root.
    return `${env.appUrl}/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async presignUpload(): Promise<string | null> {
    // No presigning on disk — the upload route accepts the bytes directly.
    return null;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }

  localPath(key: string): string {
    return this.path(key);
  }
}

/* --------------------------------------------------------------- s3 driver */

class S3StorageDriver implements StorageDriver {
  readonly name = 's3';

  private async client() {
    const { S3Client } = await import('@aws-sdk/client-s3');
    return new S3Client({
      region: env.storage.region,
      endpoint: env.storage.endpoint,
      forcePathStyle: Boolean(env.storage.endpoint),
      credentials: {
        accessKeyId: env.storage.accessKeyId!,
        secretAccessKey: env.storage.secretAccessKey!,
      },
    });
  }

  async put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<StoredObject> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    await client.send(
      new PutObjectCommand({ Bucket: env.storage.bucket!, Key: key, Body: body, ContentType: contentType }),
    );
    return { key, url: this.publicUrl(key), sizeBytes: body.byteLength, contentType };
  }

  async putFile(key: string, filePath: string, contentType: string): Promise<StoredObject> {
    // Multipart upload keeps memory flat for multi-gigabyte source files.
    const { Upload } = await import('@aws-sdk/lib-storage').catch(() => ({ Upload: null as any }));
    const client = await this.client();
    const info = await stat(filePath);

    if (Upload) {
      const upload = new Upload({
        client,
        params: {
          Bucket: env.storage.bucket!,
          Key: key,
          Body: createReadStream(filePath),
          ContentType: contentType,
        },
        queueSize: 4,
        partSize: 16 * 1024 * 1024,
      });
      await upload.done();
    } else {
      await this.put(key, await readFile(filePath), contentType);
    }
    return { key, url: this.publicUrl(key), sizeBytes: info.size, contentType };
  }

  async get(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    const result = await client.send(new GetObjectCommand({ Bucket: env.storage.bucket!, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of result.Body as any) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  publicUrl(key: string): string {
    if (env.storage.publicBaseUrl) return `${env.storage.publicBaseUrl.replace(/\/$/, '')}/${key}`;
    if (env.storage.endpoint) return `${env.storage.endpoint.replace(/\/$/, '')}/${env.storage.bucket}/${key}`;
    return `https://${env.storage.bucket}.s3.${env.storage.region}.amazonaws.com/${key}`;
  }

  async presignUpload(key: string, contentType: string, expiresSec = 3600): Promise<string | null> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const client = await this.client();
    return getSignedUrl(
      client as any,
      new PutObjectCommand({ Bucket: env.storage.bucket!, Key: key, ContentType: contentType }) as any,
      { expiresIn: expiresSec },
    );
  }

  async exists(key: string): Promise<boolean> {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    try {
      await client.send(new HeadObjectCommand({ Bucket: env.storage.bucket!, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}

/* ---------------------------------------------------------------- factory */

let instance: StorageDriver | null = null;

export function storage(): StorageDriver {
  if (instance) return instance;
  instance =
    env.storage.driver === 's3' && env.storage.bucket && env.storage.accessKeyId
      ? new S3StorageDriver()
      : new LocalStorageDriver(env.storage.localDir);
  return instance;
}

/** Local filesystem path for a key, when the local driver is active. */
export function localPathFor(key: string): string | null {
  const driver = storage();
  return driver instanceof LocalStorageDriver ? driver.localPath(key) : null;
}

export function assetKey(projectId: string, kind: string, filename: string): string {
  return `projects/${projectId}/${kind}/${filename}`;
}
