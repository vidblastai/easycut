import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * The sweeper.
 *
 * This is the only code in the project that permanently destroys a customer's
 * work, so it gets the most sceptical tests in the suite. Every case below is
 * one of two questions: does it delete what it promised, and — far more
 * important — does it leave alone everything it did not promise?
 *
 * It runs against a throwaway database and a throwaway storage root, so a bug
 * that deletes too much destroys a temp directory rather than dev.db.
 */
const dir = mkdtempSync(join(tmpdir(), 'easycut-sweep-'));
const url = `file:${join(dir, 'sweep-test.db')}`;
const storageRoot = join(dir, 'storage');

process.env.DATABASE_URL = url;
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = storageRoot;

execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
  env: { ...process.env, DATABASE_URL: url },
  stdio: 'ignore',
});

const db = new PrismaClient({ datasources: { db: { url } } });
const { purgeProject, sweepExpired } = await import('../src/worker/sweep');
const { storage } = await import('../src/lib/storage');

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date('2026-06-01T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const ahead = (days: number) => new Date(NOW.getTime() + days * DAY);

/** A project with real bytes on disk for each of its assets. */
async function project(opts: {
  status?: string;
  sourceExpiresAt?: Date | null;
  renderExpiresAt?: Date | null;
  sourceDeletedAt?: Date | null;
  rendersDeletedAt?: Date | null;
}) {
  const row = await db.project.create({
    data: {
      mode: 'short',
      status: opts.status ?? 'ready',
      sourceExpiresAt: opts.sourceExpiresAt ?? null,
      renderExpiresAt: opts.renderExpiresAt ?? null,
      sourceDeletedAt: opts.sourceDeletedAt ?? null,
      rendersDeletedAt: opts.rendersDeletedAt ?? null,
      previewUrl: 'https://example.test/render.mp4',
      thumbnailUrl: 'https://example.test/thumb.jpg',
    },
  });

  const keys: Record<string, string> = {};
  for (const kind of ['source', 'proxy', 'audio', 'render', 'thumbnail'] as const) {
    const key = `projects/${row.id}/${kind}/file.bin`;
    await storage().put(key, Buffer.from('x'.repeat(1024)), 'application/octet-stream');
    await db.asset.create({
      data: {
        projectId: row.id,
        kind,
        storageKey: key,
        url: `https://example.test/${key}`,
        contentType: 'application/octet-stream',
        sizeBytes: 1024,
      },
    });
    keys[kind] = key;
  }
  return { id: row.id, keys };
}

const onDisk = (key: string) => existsSync(join(storageRoot, key));
const kinds = async (projectId: string) =>
  (await db.asset.findMany({ where: { projectId }, select: { kind: true } })).map((a) => a.kind).sort();

beforeEach(async () => {
  await db.job.deleteMany({});
  await db.asset.deleteMany({});
  await db.project.deleteMany({});
  rmSync(storageRoot, { recursive: true, force: true });
});

describe('sweeping expired footage', () => {
  it('deletes the source, proxy and audio once past their date', async () => {
    const p = await project({ sourceExpiresAt: ago(1) });
    const result = await sweepExpired(NOW);

    expect(result.sourcesDeleted).toBe(1);
    expect(onDisk(p.keys.source)).toBe(false);
    expect(onDisk(p.keys.proxy)).toBe(false);
    expect(onDisk(p.keys.audio)).toBe(false);
    expect(await kinds(p.id)).toEqual(['render', 'thumbnail']);
  });

  it('leaves the finished video completely alone', async () => {
    // The whole point of two clocks: the footage goes, the video stays.
    const p = await project({ sourceExpiresAt: ago(1), renderExpiresAt: ahead(300) });
    await sweepExpired(NOW);

    expect(onDisk(p.keys.render)).toBe(true);
    expect(onDisk(p.keys.thumbnail)).toBe(true);
    const row = await db.project.findUnique({ where: { id: p.id } });
    expect(row?.previewUrl).not.toBeNull();
  });

  it('does not touch footage that has not expired yet', async () => {
    const p = await project({ sourceExpiresAt: ahead(1) });
    const result = await sweepExpired(NOW);
    expect(result.sourcesDeleted).toBe(0);
    expect(onDisk(p.keys.source)).toBe(true);
  });

  it('never sweeps a project with no expiry set at all', async () => {
    // A row written before retention existed must not be read as "expired".
    const p = await project({ sourceExpiresAt: null, renderExpiresAt: null });
    const result = await sweepExpired(NOW);
    expect(result.sourcesDeleted + result.rendersDeleted).toBe(0);
    expect(onDisk(p.keys.source)).toBe(true);
    expect(onDisk(p.keys.render)).toBe(true);
  });

  it('refuses to pull the footage out from under a running job', async () => {
    // Sweeping mid-render is a job that dies four stages in for no visible reason.
    const p = await project({ status: 'processing', sourceExpiresAt: ago(10) });
    await db.job.create({ data: { projectId: p.id, type: 'pipeline', status: 'running' } });

    const result = await sweepExpired(NOW);
    expect(result.sourcesDeleted).toBe(0);
    expect(onDisk(p.keys.source)).toBe(true);
  });

  it('still sweeps a project left "processing" by a worker that died', async () => {
    // A killed worker leaves the status column reading `processing` for ever.
    // Trusting that column would mean the retention promise is silently broken
    // on exactly the rows nobody is looking at.
    const p = await project({ status: 'processing', sourceExpiresAt: ago(10) });
    await db.job.create({ data: { projectId: p.id, type: 'pipeline', status: 'failed' } });

    const result = await sweepExpired(NOW);
    expect(result.sourcesDeleted).toBe(1);
    expect(onDisk(p.keys.source)).toBe(false);
  });

  it('is idempotent — a second pass finds nothing to do', async () => {
    await project({ sourceExpiresAt: ago(1) });
    expect((await sweepExpired(NOW)).sourcesDeleted).toBe(1);
    expect((await sweepExpired(NOW)).sourcesDeleted).toBe(0);
  });

  it('counts the bytes it freed', async () => {
    await project({ sourceExpiresAt: ago(1) });
    expect((await sweepExpired(NOW)).bytesFreed).toBe(3 * 1024);
  });
});

describe('sweeping expired renders', () => {
  it('deletes the render and thumbnail, and stops the card offering them', async () => {
    const p = await project({ renderExpiresAt: ago(1) });
    const result = await sweepExpired(NOW);

    expect(result.rendersDeleted).toBe(1);
    expect(onDisk(p.keys.render)).toBe(false);
    expect(onDisk(p.keys.thumbnail)).toBe(false);

    const row = await db.project.findUnique({ where: { id: p.id } });
    expect(row?.previewUrl).toBeNull();
    expect(row?.thumbnailUrl).toBeNull();
  });

  it('keeps a Studio render for ever — a null date is not an expired one', async () => {
    const p = await project({ renderExpiresAt: null, sourceExpiresAt: ago(400) });
    await sweepExpired(NOW);
    expect(onDisk(p.keys.render)).toBe(true);
    expect(await kinds(p.id)).toEqual(['render', 'thumbnail']);
  });

  it('can sweep both clocks on the same project in one pass', async () => {
    const p = await project({ sourceExpiresAt: ago(30), renderExpiresAt: ago(1) });
    const result = await sweepExpired(NOW);

    expect(result.sourcesDeleted).toBe(1);
    expect(result.rendersDeleted).toBe(1);
    expect(await kinds(p.id)).toEqual([]);
  });
});

describe('purging a project the user deleted', () => {
  it('takes everything, ignoring dates entirely', async () => {
    // Pressing delete means now, not "in seven days".
    const p = await project({ sourceExpiresAt: ahead(999), renderExpiresAt: ahead(999) });
    const bytes = await purgeProject(p.id);

    expect(bytes).toBe(5 * 1024);
    for (const key of Object.values(p.keys)) expect(onDisk(key)).toBe(false);
    expect(await db.project.findUnique({ where: { id: p.id } })).toBeNull();
  });

  it('takes the database row even when the files have already gone', async () => {
    // A storage failure must not leave an undeletable project on the dashboard.
    const p = await project({});
    rmSync(storageRoot, { recursive: true, force: true });
    await purgeProject(p.id);
    expect(await db.project.findUnique({ where: { id: p.id } })).toBeNull();
  });

  it('does not touch anybody else', async () => {
    const mine = await project({});
    const theirs = await project({});
    await purgeProject(mine.id);

    expect(await db.project.findUnique({ where: { id: theirs.id } })).not.toBeNull();
    expect(onDisk(theirs.keys.source)).toBe(true);
  });
});
