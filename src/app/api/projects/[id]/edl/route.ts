import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, parseJson, stringifyJson } from '@/lib/db';
import { ASPECTS, CaptionStyleSchema, EdlSchema, type Edl } from '@/lib/edl/types';
import { applyOperations, EdlOperationsSchema, healEdl } from '@/lib/edl/operations';
import { stripLayers, type LayerName } from '@/lib/edl/layers';
import { rebuildEdl } from '@/lib/pipeline/rebuild';
import { queue } from '@/lib/queue';
import { selectMusic } from '@/lib/assets/music';
import { findCaptionPreset } from '@/lib/captions/presets';
import type { DirectorPlan } from '@/lib/director/schema';
import type { MediaInfo } from '@/lib/media/ffmpeg';
import type { Transcript } from '@/lib/transcribe/types';
import type { Interval } from '@/lib/timeline/silence';
import { guardProject } from '@/lib/auth';

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

  /**
   * A whole caption look, by id. The picker sends this for the sixteen
   * presets; `captionStyle` below carries the hand-tuned deltas on top.
   */
  captionPreset: z.string().optional(),

  /**
   * Any field of the caption style.
   *
   * This used to be a hand-written whitelist of six fields, which meant the
   * schema grew a font, a stroke, a gradient and a word plate that the API
   * silently refused to save. A partial of the real schema cannot drift from
   * it, and zod still rejects anything malformed.
   */
  captionStyle: CaptionStyleSchema.partial().optional(),

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
  const patch = body.data;

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

  const currentRow = project.edls[0];
  if (!currentRow) return NextResponse.json({ error: 'This project has not been edited yet.' }, { status: 409 });

  let edl = EdlSchema.parse(parseJson<Edl>(currentRow.document, {} as Edl));

  // Edits the server declined, collected as they happen. Declared up here
  // because both the caption branch and the timeline operations report into it
  // and they sit either side of the rebuild.
  const rejected: Array<{ reason: string }> = [];

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
      // Without this, changing the edit style would silently revert a caption
      // look the user picked — the two lists are independent by design.
      captionPreset: patch.captionPreset ?? project.captionPreset,
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
    // The same strip the pipeline applies to a refusal made at upload. One
    // implementation, because two of them is how "transitions" came to be
    // switchable in one place and not the other.
    edl = stripLayers(
      edl,
      Object.entries(patch.layers)
        .filter(([, on]) => on === false)
        .map(([name]) => name as LayerName),
    );
  }

  // A preset is the base; hand-tuned fields land on top of it, so sending both
  // in one request means "this look, with these changes".
  if (patch.captionPreset) {
    const preset = findCaptionPreset(patch.captionPreset);
    if (preset) edl = { ...edl, captionStyle: { ...preset.style } };
    else rejected.push({ reason: `Unknown caption look "${patch.captionPreset}".` });
  }

  if (patch.captionStyle) {
    // Deliberately NOT rewriting the stored word text when `uppercase` flips.
    // The renderer applies the flag at paint time, so uppercasing the words
    // here would be a destructive duplicate — and switching the flag back off
    // could never restore the original case.
    edl = { ...edl, captionStyle: { ...edl.captionStyle, ...patch.captionStyle } };
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

  if (patch.operations?.length) {
    const result = applyOperations(edl, patch.operations);
    edl = result.edl;
    rejected.push(...result.rejected.map((r) => ({ reason: r.reason })));
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
  if (patch.captionPreset) {
    await db.project.update({ where: { id }, data: { captionPreset: patch.captionPreset } });
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
