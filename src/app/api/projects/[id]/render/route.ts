import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, parseJson, stringifyJson } from '@/lib/db';
import { ASPECT_DIMENSIONS, ASPECTS, EdlSchema, type Edl } from '@/lib/edl/types';
import { queue } from '@/lib/queue';
import { rebuildEdl } from '@/lib/pipeline/rebuild';
import type { DirectorPlan } from '@/lib/director/schema';
import type { MediaInfo } from '@/lib/media/ffmpeg';
import type { Transcript } from '@/lib/transcribe/types';
import type { Interval } from '@/lib/timeline/silence';
import { guardProject } from '@/lib/auth';

export const runtime = 'nodejs';

const RenderSchema = z.object({
  /** Export the same edit at another aspect ratio (e.g. a 1:1 for LinkedIn). */
  aspect: z.enum(ASPECTS).optional(),
  edlId: z.string().optional(),
});

/**
 * Queues a render.
 *
 * Re-exporting the same edit at a different aspect ratio is the common case,
 * and it is cheap: the crop path and the layout are recomputed from the cached
 * analysis, then rendered. One upload, one analysis, every platform.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const input = RenderSchema.parse((await request.json().catch(() => ({}))) ?? {});

  const denied = await guardProject(id);
  if (denied) return denied;

  const project = await db.project.findUnique({
    where: { id },
    include: {
      edls: { orderBy: { version: 'desc' }, take: 1 },
      assets: { where: { kind: 'source' }, take: 1 },
    },
  });
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  let edlId = input.edlId ?? project.edls[0]?.id;
  if (!edlId) return NextResponse.json({ error: 'Nothing to render yet.' }, { status: 409 });

  // A different aspect means a genuinely different layout, so build a version.
  if (input.aspect) {
    const current = await db.edl.findUnique({ where: { id: edlId } });
    const currentEdl = current ? EdlSchema.parse(parseJson<Edl>(current.document, {} as Edl)) : null;

    if (currentEdl && currentEdl.format.aspect !== input.aspect) {
      const transcript = parseJson<Transcript | null>(project.transcriptJson, null);
      const plan = parseJson<DirectorPlan | null>(project.directorPlanJson, null);
      const media = parseJson<MediaInfo | null>(project.mediaJson, null);
      const source = project.assets[0];

      if (!transcript || !plan || !media || !source) {
        return NextResponse.json(
          { error: 'Cached analysis is missing — re-run the edit before changing aspect ratio.' },
          { status: 409 },
        );
      }

      const rebuilt = await rebuildEdl({
        projectId: id,
        transcript,
        plan,
        media,
        mechanicalCuts: parseJson<Interval[]>(project.cutsJson, []),
        sourceUrl: source.url,
        sourceKey: source.storageKey,
        reframe: currentEdl.reframe,
        styleId: project.styleId,
        mode: project.mode as 'short' | 'long',
        aspect: input.aspect,
        degraded: currentEdl.degraded,
      });

      const latest = await db.edl.findFirst({
        where: { projectId: id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const row = await db.edl.create({
        data: {
          projectId: id,
          version: (latest?.version ?? 0) + 1,
          document: stringifyJson(EdlSchema.parse(rebuilt)),
          origin: 'regenerate',
        },
      });
      edlId = row.id;
    }
  }

  await db.project.update({ where: { id }, data: { status: 'processing' } });
  await queue().enqueue('rerender', { projectId: id, edlId });

  return NextResponse.json({
    ok: true,
    edlId,
    aspect: input.aspect ?? project.edls[0]?.id,
    dimensions: input.aspect ? ASPECT_DIMENSIONS[input.aspect] : null,
  });
}
