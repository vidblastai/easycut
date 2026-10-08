import { NextResponse } from 'next/server';
import { db, parseJson } from '@/lib/db';
import { env } from '@/lib/config/env';
import { assetKey, storage } from '@/lib/storage';
import { FORMAT_PRESETS, getStyle, sanitiseTransitions } from '@/lib/styles/presets';
import { findCaptionPreset } from '@/lib/captions/presets';
import { currentUserId, ensureUser, isAuthEnabled } from '@/lib/auth';
import { LAYER_NAMES, type LayerName } from '@/lib/edl/layers';
import { SCENE_LOOKS } from '@/lib/edl/types';
import { CreateProjectSchema } from './schema';

export const runtime = 'nodejs';


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
    /*
     * Say which field, in the error the person actually sees.
     *
     * "Invalid request" with the detail buried in a `details` object the UI
     * never renders is the worst kind of error message: the customer cannot
     * act on it and cannot report it usefully either — "it said invalid
     * request" is the whole of what they can tell you. The field name costs
     * nothing and turns a dead end into a bug report.
     */
    const fields = parsed.error.flatten().fieldErrors;
    const said = Object.entries(fields)
      .map(([field, errors]) => `${field} (${(errors ?? []).join(', ')})`)
      .slice(0, 3)
      .join(', ');
    return NextResponse.json(
      {
        error: said ? `That upload is missing or malformed: ${said}` : 'Invalid request',
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const maxBytes = env.limits.maxUploadMb * 1024 * 1024;
  if (input.sizeBytes > maxBytes) {
    return NextResponse.json(
      { error: `That file is larger than the ${env.limits.maxUploadMb} MB limit.` },
      { status: 413 },
    );
  }

  // Unknown names are dropped rather than rejected, and an all-unknown pick
  // reads as no pick: a client built against a newer list should cost you the
  // transitions this build has never heard of, not the upload.
  const transitions = sanitiseTransitions(input.clipTransitions);

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
      layersOff: JSON.stringify(
        Object.entries(input.layers ?? {})
          .filter(([name, on]) => !on && LAYER_NAMES.includes(name as LayerName))
          .map(([name]) => name),
      ),
      captionPreset: input.captionPreset && findCaptionPreset(input.captionPreset)
        ? input.captionPreset
        : null,
      sceneLook: input.sceneLook && (SCENE_LOOKS as readonly string[]).includes(input.sceneLook)
        ? input.sceneLook
        : null,
      clipTransitions: transitions ? JSON.stringify(transitions) : null,
      brollSource: input.brollSource ?? null,
      brollOverlay: input.brollOverlay ?? null,
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
