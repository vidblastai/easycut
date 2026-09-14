import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, parseJson, stringifyJson } from '@/lib/db';
import { ASPECTS, EdlSchema, type Edl } from '@/lib/edl/types';
import { applyOperations, EdlOperationsSchema } from '@/lib/edl/operations';
import { rebuildEdl } from '@/lib/pipeline/rebuild';
import { queue } from '@/lib/queue';
import { selectMusic } from '@/lib/assets/music';
import type { DirectorPlan } from '@/lib/director/schema';
import type { MediaInfo } from '@/lib/media/ffmpeg';
import type { Transcript } from '@/lib/transcribe/types';
import type { Interval } from '@/lib/timeline/silence';

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

const PatchSchema = z.object({
  styleId: z.string().optional(),
  mode: z.enum(['short', 'long']).optional(),
  aspect: z.enum(ASPECTS).optional(),
  maxDurationSec: z.number().positive().optional(),

  /** Ids to drop from the finished video. */
  remove: z
    .object({
      broll: z.array(z.string()).default([]),
      graphics: z.array(z.string()).default([]),
      sfx: z.array(z.string()).default([]),
      overlays: z.array(z.string()).default([]),
      segments: z.array(z.string()).default([]),
    })
    .partial()
    .optional(),

  /** Whole-layer switches. */
  layers: z
    .object({
      captions: z.boolean(),
      broll: z.boolean(),
      graphics: z.boolean(),
      music: z.boolean(),
      sfx: z.boolean(),
      punchIns: z.boolean(),
      transitions: z.boolean(),
    })
    .partial()
    .optional(),

  captionStyle: z
    .object({
      fontSizeRatio: z.number().min(0.02).max(0.12),
      positionY: z.number().min(0.1).max(0.95),
      uppercase: z.boolean(),
      emphasisColor: z.string(),
      animation: z.enum(['karaoke', 'word-pop', 'line-fade', 'typewriter', 'bounce']),
      maxWordsPerCue: z.number().int().min(1).max(12),
    })
    .partial()
    .optional(),

  /** Retype the words on one caption card — ASR is good, not perfect. */
  captionEdits: z.array(z.object({ cueId: z.string(), text: z.string().max(200) })).optional(),

  music: z.object({ shuffle: z.boolean().optional(), gainDb: z.number().optional() }).optional(),

  /**
   * Manual timeline edits, applied in order after everything above.
   *
   * The timeline editor previews locally and sends the whole accumulated stack
   * on commit, so one round trip covers a whole fine-tuning session and the
   * user's undo history stays theirs rather than becoming version churn.
   */
  operations: EdlOperationsSchema.optional(),

  /** Queue a render of the resulting version. */
  render: z.boolean().default(true),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await db.edl.findMany({
    where: { projectId: id },
    orderBy: { version: 'desc' },
    take: 20,
  });

  return NextResponse.json({
    versions: rows.map((r) => ({ id: r.id, version: r.version, origin: r.origin, createdAt: r.createdAt })),
    current: rows[0] ? { id: rows[0].id, version: rows[0].version, document: parseJson(rows[0].document, null) } : null,
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = PatchSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: 'Invalid patch', details: body.error.flatten() }, { status: 400 });
  }
  const patch = body.data;

  const project = await db.project.findUnique({
    where: { id },
    include: {
      edls: { orderBy: { version: 'desc' }, take: 1 },
      assets: { where: { kind: 'source' }, take: 1 },
    },
  });
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const currentRow = project.edls[0];
  if (!currentRow) return NextResponse.json({ error: 'This project has not been edited yet.' }, { status: 409 });

  let edl = EdlSchema.parse(parseJson<Edl>(currentRow.document, {} as Edl));

  /* ------------------------ structural: full rebuild ----------------------- */

  const structural =
    patch.styleId !== undefined ||
    patch.mode !== undefined ||
    patch.aspect !== undefined ||
    patch.maxDurationSec !== undefined ||
    (patch.remove?.segments?.length ?? 0) > 0;

  if (structural) {
    const transcript = parseJson<Transcript | null>(project.transcriptJson, null);
    const plan = parseJson<DirectorPlan | null>(project.directorPlanJson, null);
    const media = parseJson<MediaInfo | null>(project.mediaJson, null);
    const source = project.assets[0];

    if (!transcript || !plan || !media || !source) {
      return NextResponse.json(
        { error: 'The cached analysis for this project is missing — re-run the edit to change its structure.' },
        { status: 409 },
      );
    }

    edl = await rebuildEdl({
      projectId: id,
      transcript,
      plan,
      media,
      mechanicalCuts: parseJson<Interval[]>(project.cutsJson, []),
      sourceUrl: source.url,
      sourceKey: source.storageKey,
      reframe: edl.reframe,
      styleId: patch.styleId ?? project.styleId,
      mode: (patch.mode ?? project.mode) as 'short' | 'long',
      aspect: patch.aspect,
      maxDurationSec: patch.maxDurationSec,
      removedSegmentIds: patch.remove?.segments ?? [],
      degraded: edl.degraded,
    });
  }

  /* ------------------------- surgical: in-place edits ---------------------- */

  if (patch.remove) {
    const { broll = [], graphics = [], sfx = [], overlays = [] } = patch.remove;
    edl = {
      ...edl,
      broll: edl.broll.filter((b) => !broll.includes(b.id)),
      graphics: edl.graphics.filter((g) => !graphics.includes(g.id)),
      sfx: edl.sfx.filter((s) => !sfx.includes(s.id)),
      overlays: edl.overlays.filter((o) => !overlays.includes(o.id)),
    };
  }

  if (patch.layers) {
    const l = patch.layers;
    edl = {
      ...edl,
      captions: l.captions === false ? [] : edl.captions,
      broll: l.broll === false ? [] : edl.broll,
      graphics: l.graphics === false ? [] : edl.graphics,
      sfx: l.sfx === false ? [] : edl.sfx,
      punchIns: l.punchIns === false ? [] : edl.punchIns,
      transitions: l.transitions === false ? [] : edl.transitions,
      music: l.music === false ? null : edl.music,
    };
  }

  if (patch.captionStyle) {
    edl = { ...edl, captionStyle: { ...edl.captionStyle, ...patch.captionStyle } };
    if (patch.captionStyle.uppercase !== undefined) {
      const upper = patch.captionStyle.uppercase;
      edl.captions = edl.captions.map((cue) => ({
        ...cue,
        words: cue.words.map((w) => ({ ...w, text: upper ? w.text.toUpperCase() : w.text })),
      }));
    }
  }

  if (patch.captionEdits?.length) {
    edl = { ...edl, captions: applyCaptionEdits(edl.captions, patch.captionEdits) };
  }

  if (patch.music?.shuffle) {
    const next = await selectMusic({
      mood: edl.music?.mood ?? '',
      mode: project.mode as 'short' | 'long',
      durationSec: edl.format.durationSec,
      excludeId: edl.music?.id,
    });
    edl = next
      ? {
          ...edl,
          music: {
            id: next.track.id,
            url: next.track.url,
            title: next.track.title,
            mood: next.track.moods.join(', '),
            bpm: next.track.bpm,
            gainDb: edl.music?.gainDb ?? -18,
            duckDb: edl.music?.duckDb ?? -12,
            startAtSec: 0,
            fadeInSec: 0.8,
            fadeOutSec: edl.music?.fadeOutSec ?? 1.5,
            attribution: next.track.attribution,
          },
        }
      : edl;
  }

  if (patch.music?.gainDb !== undefined && edl.music) {
    edl = { ...edl, music: { ...edl.music, gainDb: patch.music.gainDb } };
  }

  /* --------------------------- manual timeline edits ----------------------- */

  let rejected: Array<{ reason: string }> = [];
  if (patch.operations?.length) {
    const result = applyOperations(edl, patch.operations);
    edl = result.edl;
    rejected = result.rejected.map((r) => ({ reason: r.reason }));
  }

  /* ------------------------------ persist + render ------------------------- */

  const validated = EdlSchema.parse(edl);
  const row = await db.edl.create({
    data: {
      projectId: id,
      version: currentRow ? (await nextVersion(id)) : 1,
      document: stringifyJson(validated),
      origin: 'user-edit',
    },
  });

  if (patch.styleId) {
    await db.project.update({ where: { id }, data: { styleId: patch.styleId } });
  }
  if (patch.mode) {
    await db.project.update({ where: { id }, data: { mode: patch.mode } });
  }

  if (patch.render) {
    await db.project.update({ where: { id }, data: { status: 'processing' } });
    await queue().enqueue('rerender', { projectId: id, edlId: row.id });
  }

  return NextResponse.json({
    ok: true,
    edl: { id: row.id, version: row.version, document: validated },
    rendering: patch.render,
    // Edits the server declined (a trim past the end of the footage, a clip
    // that no longer exists). The rest still applied.
    rejected,
  });
}

async function nextVersion(projectId: string): Promise<number> {
  const latest = await db.edl.findFirst({
    where: { projectId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return (latest?.version ?? 0) + 1;
}

/**
 * Rewrites the words on a caption card while keeping its timing.
 *
 * Word timings are re-distributed across the card in proportion to word length,
 * which is a much better approximation than an even split — "extraordinarily"
 * genuinely takes longer to say than "a".
 */
function applyCaptionEdits(
  captions: Edl['captions'],
  edits: Array<{ cueId: string; text: string }>,
): Edl['captions'] {
  const byId = new Map(edits.map((e) => [e.cueId, e.text]));

  return captions.map((cue) => {
    const text = byId.get(cue.id);
    if (text === undefined) return cue;

    const words = text.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return cue;

    const totalChars = words.reduce((sum, w) => sum + w.length, 0) || 1;
    const span = cue.endSec - cue.startSec;
    let cursor = cue.startSec;

    return {
      ...cue,
      words: words.map((word, index) => {
        const share = (word.length / totalChars) * span;
        const startSec = cursor;
        cursor += share;
        return {
          text: word,
          startSec,
          endSec: index === words.length - 1 ? cue.endSec : cursor,
          emphasis: cue.words[index]?.emphasis ?? false,
        };
      }),
    };
  });
}
