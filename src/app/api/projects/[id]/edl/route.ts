import { NextResponse } from 'next/server';
import { db, parseJson } from '@/lib/db';
import { healEdl } from '@/lib/edl/operations';
import { guardProject } from '@/lib/auth';
import { PatchSchema, patchProjectEdl } from '@/lib/projects/edl-patch';

export const runtime = 'nodejs';

/**
 * The tweak endpoint.
 *
 * Two kinds of change, handled differently:
 *
 *  - **Structural** (style, format, aspect, deleted clips) → rebuild the EDL
 *    from the cached transcript and director plan. No ASR, no LLM, no cost.
 *  - **Surgical** (hide one B-roll clip, shuffle the music, retype a caption)
 *    → patch the existing document in place, which is instant.
 *
 * Either way the result is a NEW EDL version, so nothing is ever destroyed and
 * the editor can offer a version history.
 */


export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The edit document carries the transcript and every asset URL: someone
  // else's is as private as their footage.
  const denied = await guardProject(id);
  if (denied) return denied;
  const rows = await db.edl.findMany({
    where: { projectId: id },
    orderBy: { version: 'desc' },
    take: 20,
  });

  return NextResponse.json({
    versions: rows.map((r) => ({ id: r.id, version: r.version, origin: r.origin, createdAt: r.createdAt })),
    current: rows[0]
      ? { id: rows[0].id, version: rows[0].version, document: healEdl(parseJson(rows[0].document, null)) }
      : null,
  });
}


export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = PatchSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: 'Invalid patch', details: body.error.flatten() }, { status: 400 });
  }
  const denied = await guardProject(id);
  if (denied) return denied;
  const outcome = await patchProjectEdl(id, body.data);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
