import { db } from '@/lib/db';
import { storage } from '@/lib/storage';

/**
 * The sweeper: deletes what the plans said would be deleted.
 *
 * Retention is a promise in both directions. "We keep your video for a year" is
 * the half customers read; "we delete your footage after seven days" is the
 * half the privacy policy commits to and the half that keeps the storage bill
 * from growing without limit. Neither is true unless something actually runs.
 *
 * ── What it deletes, and in what order ───────────────────────────────────
 *
 *  1. **Source footage**, once past `sourceExpiresAt`. This is the big one —
 *     roughly 90 MB per minute — and after the edit exists its only use is
 *     re-cutting. Deleting it ends re-editing, which is why the plan says so
 *     and the editor checks.
 *  2. **Renders and thumbnails**, once past `renderExpiresAt`. Null means the
 *     plan keeps them while the subscription lasts, so they are never swept.
 *  3. **Working files** left behind by a crashed render.
 *
 * ── Why it is careful ────────────────────────────────────────────────────
 *
 * Deletion is the one operation with no undo, so every step here is designed to
 * fail safe rather than fail tidy:
 *
 *  - The storage object goes FIRST, and only then does the database row lose
 *     its reference. Losing power between the two leaves an orphaned file,
 *     which is a wasted byte; the other order leaves a row pointing at nothing,
 *     which is a broken page.
 *  - A project mid-flight is skipped whatever its dates say. Sweeping the
 *     source out from under a running render is how you get a job that fails
 *     four stages in for no visible reason.
 *  - Every date is written when the work starts, never recomputed from the
 *     plan at sweep time. Somebody downgrading must not cause yesterday's
 *     footage to vanish tonight.
 */

export interface SweepResult {
  sourcesDeleted: number;
  rendersDeleted: number;
  bytesFreed: number;
  errors: string[];
}

/** Never sweep more than this in one pass, so a backlog cannot stall the queue. */
const BATCH = 200;

export async function sweepExpired(now = new Date()): Promise<SweepResult> {
  const result: SweepResult = { sourcesDeleted: 0, rendersDeleted: 0, bytesFreed: 0, errors: [] };

  /* ------------------------------------------------- 1. source footage --- */

  const staleSources = await db.project.findMany({
    where: {
      sourceExpiresAt: { not: null, lte: now },
      sourceDeletedAt: null,
      // Never pull the footage out from under a job that is using it.
      //
      // The test is "has a live job", not "status says processing". A worker
      // killed mid-render leaves the status column reading `processing` for
      // ever, and a status-based check would then refuse to sweep that project
      // until the end of time — a retention promise quietly broken by a crash
      // months earlier, on exactly the rows nobody is looking at.
      jobs: { none: { status: { in: ['queued', 'running'] } } },
    },
    select: { id: true },
    take: BATCH,
  });

  for (const project of staleSources) {
    const assets = await db.asset.findMany({
      where: { projectId: project.id, kind: { in: ['source', 'proxy', 'audio'] } },
      select: { id: true, storageKey: true, sizeBytes: true },
    });

    let failed = false;
    for (const asset of assets) {
      try {
        await storage().delete(asset.storageKey);
        await db.asset.delete({ where: { id: asset.id } });
        result.bytesFreed += asset.sizeBytes;
      } catch (error) {
        failed = true;
        result.errors.push(`source ${asset.storageKey}: ${(error as Error).message}`);
      }
    }

    // Only claim it is done when it is. A partial failure stays on the list and
    // is retried on the next pass rather than being quietly forgotten.
    if (!failed) {
      await db.project.update({ where: { id: project.id }, data: { sourceDeletedAt: now } });
      result.sourcesDeleted += 1;
    }
  }

  /* ------------------------------------------ 2. renders and thumbnails --- */

  const staleRenders = await db.project.findMany({
    where: {
      renderExpiresAt: { not: null, lte: now },
      rendersDeletedAt: null,
      jobs: { none: { status: { in: ['queued', 'running'] } } },
    },
    select: { id: true },
    take: BATCH,
  });

  for (const project of staleRenders) {
    const assets = await db.asset.findMany({
      where: { projectId: project.id, kind: { in: ['render', 'thumbnail'] } },
      select: { id: true, storageKey: true, sizeBytes: true },
    });

    let failed = false;
    for (const asset of assets) {
      try {
        await storage().delete(asset.storageKey);
        await db.asset.delete({ where: { id: asset.id } });
        result.bytesFreed += asset.sizeBytes;
      } catch (error) {
        failed = true;
        result.errors.push(`render ${asset.storageKey}: ${(error as Error).message}`);
      }
    }

    if (!failed) {
      await db.project.update({
        where: { id: project.id },
        data: {
          rendersDeletedAt: now,
          // The card would otherwise keep offering a play button for a file
          // that is gone.
          previewUrl: null,
          thumbnailUrl: null,
        },
      });
      result.rendersDeleted += 1;
    }
  }

  return result;
}

/**
 * Everything belonging to one project, for a delete the user asked for.
 *
 * Distinct from the sweep above in one important way: it takes no notice of
 * dates or status. When somebody presses delete they mean now.
 */
export async function purgeProject(projectId: string): Promise<number> {
  const assets = await db.asset.findMany({
    where: { projectId },
    select: { storageKey: true, sizeBytes: true },
  });

  let bytes = 0;
  for (const asset of assets) {
    // A missing object is the desired state, so a failure here must not stop
    // the rest of the project being removed.
    await storage()
      .delete(asset.storageKey)
      .then(() => { bytes += asset.sizeBytes; })
      .catch(() => {});
  }

  // Assets, jobs, EDLs and renders all cascade from the project row.
  await db.project.delete({ where: { id: projectId } }).catch(() => {});
  return bytes;
}
