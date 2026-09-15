import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, parseJson } from '@/lib/db';
import { env } from '@/lib/config/env';
import { assetKey, storage } from '@/lib/storage';
import { FORMAT_PRESETS, getStyle } from '@/lib/styles/presets';
import { findCaptionPreset } from '@/lib/captions/presets';
import { currentUserId, ensureUser, isAuthEnabled } from '@/lib/auth';

export const runtime = 'nodejs';

const CreateProjectSchema = z.object({
  title: z.string().max(200).optional(),
  mode: z.enum(['short', 'long']),
  styleId: z.string().default('clean'),
  /** The caption look, when the picker set a default. Omitted takes the style's. */
  captionPreset: z.string().optional(),
  inputMode: z.enum(['raw', 'roughcut']).default('raw'),
  userNote: z.string().max(500).optional(),
  filename: z.string().min(1).max(300),
  contentType: z.string().default('video/mp4'),
  sizeBytes: z.number().int().nonnegative().default(0),
});

/**
 * Creates a project and hands back somewhere to put the file.
 *
 * With S3/R2 configured the browser gets a presigned URL and uploads directly,
 * so a 2 GB file never passes through the app server. Without it, the response
 * points at our own upload route and the bytes come to us.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = CreateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  const maxBytes = env.limits.maxUploadMb * 1024 * 1024;
  if (input.sizeBytes > maxBytes) {
    return NextResponse.json(
      { error: `That file is larger than the ${env.limits.maxUploadMb} MB limit.` },
      { status: 413 },
    );
  }

  // Stamped at creation. A project with no owner is one nobody can ever open
  // again once auth is on, so this is not a field to backfill later.
  const userId = await ensureUser();

  const project = await db.project.create({
    data: {
      userId,
      title: input.title?.trim() || stripExtension(input.filename),
      mode: input.mode,
      styleId: getStyle(input.styleId).id,
      // Validated rather than trusted: an id that no longer exists would make
      // every render of this project silently fall back, forever.
      captionPreset: input.captionPreset && findCaptionPreset(input.captionPreset)
        ? input.captionPreset
        : null,
      inputMode: input.inputMode,
      userNote: input.userNote,
      status: 'draft',
    },
  });

  const key = assetKey(project.id, 'source', sanitize(input.filename));
  const uploadUrl = await storage().presignUpload(key, input.contentType).catch(() => null);

  return NextResponse.json({
    project: { id: project.id, title: project.title, mode: project.mode, styleId: project.styleId },
    upload: uploadUrl
      ? { method: 'PUT' as const, url: uploadUrl, key, headers: { 'Content-Type': input.contentType } }
      : { method: 'POST' as const, url: `/api/projects/${project.id}/upload`, key, headers: {} },
    format: FORMAT_PRESETS[input.mode],
  });
}

/** Project list for the dashboard. */
export async function GET() {
  const userId = await currentUserId();
  const projects = await db.project.findMany({
    // With auth off this is every project, which is the point of that mode.
    where: isAuthEnabled() ? { userId: userId ?? '__signed-out__' } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 60,
    include: {
      jobs: { orderBy: { queuedAt: 'desc' }, take: 1 },
    },
  });

  return NextResponse.json({
    projects: projects.map((project) => ({
      id: project.id,
      title: project.title,
      mode: project.mode,
      styleId: project.styleId,
      status: project.status,
      durationSec: project.durationSec,
      thumbnailUrl: project.thumbnailUrl,
      previewUrl: project.previewUrl,
      costUsd: project.costUsd,
      hashtags: parseJson<string[]>(project.hashtags, []),
      createdAt: project.createdAt,
      errorMessage: project.errorMessage,
      job: project.jobs[0]
        ? {
            id: project.jobs[0].id,
            status: project.jobs[0].status,
            stage: project.jobs[0].stage,
            progress: project.jobs[0].progress,
            progressLabel: project.jobs[0].progressLabel,
          }
        : null,
    })),
  });
}

function sanitize(filename: string): string {
  return filename.replace(/[^\w.\-]+/g, '-').slice(-120);
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 80) || 'Untitled';
}
