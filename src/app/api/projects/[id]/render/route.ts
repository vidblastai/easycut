import { NextResponse } from 'next/server';
import { entitlementsFor } from '@/lib/billing/entitlements';
import { allowsQuality, DEFAULT_QUALITY, dimensionsFor, RENDER_QUALITIES } from '@/lib/render/quality';
import { z } from 'zod';
import { db, parseJson, stringifyJson } from '@/lib/db';
import { ASPECTS, EdlSchema, type Edl } from '@/lib/edl/types';
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
  /** `4k` doubles the output resolution. Opt-in, and only on plans that have it. */
  quality: z.enum(RENDER_QUALITIES).optional(),
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

  /*
   * The 4K check lives here and nowhere else that matters.
   *
   * It is the only point a browser cannot go around: the editor hides the
   * control on a plan without it, but a hidden button is a suggestion, and
   * rendering four times the pixels for somebody who did not pay for them is
   * the expensive kind of mistake. Read from `planAtUpload`, same as the
   * watermark, so a downgrade does not retroactively change what an existing
   * project may export.
   */
  const entitlements = await entitlementsFor(id);
  const quality = input.quality ?? DEFAULT_QUALITY;
  if (!allowsQuality(entitlements.maxHeight, quality)) {
    return NextResponse.json(
      {
        error:
          '4K export is on Creator and Studio. This project was made on a plan without it — ' +
          'upgrade and re-render, and it will export in 4K.',
      },
      { status: 403 },
    );
  }

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

  // Read once: the aspect block needs the document, and so does the answer at
  // the bottom — which used to report the EDL's ID in the `aspect` field.
  const current = await db.edl.findUnique({ where: { id: edlId } });
  const currentEdl = current ? EdlSchema.parse(parseJson<Edl>(current.document, {} as Edl)) : null;
  const currentAspect = currentEdl?.format.aspect ?? null;

  // A different aspect means a genuinely different layout, so build a version.
  if (input.aspect) {
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
  await queue().enqueue(
    'rerender',
    { projectId: id, edlId, quality },
    { priority: entitlements.priority },
  );

  // The aspect actually being rendered, which is the one asked for or the one
  // the document already had — the dimensions below have to describe the file
  // that is coming, not the change that was requested.
  const renderedAspect = input.aspect ?? currentAspect ?? null;

  return NextResponse.json({
    ok: true,
    edlId,
    quality,
    aspect: renderedAspect,
    dimensions: renderedAspect ? dimensionsFor(renderedAspect, quality) : null,
  });
}
