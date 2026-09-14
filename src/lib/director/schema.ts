import { z } from 'zod';

/**
 * The director's output. Everything here is expressed in **source time** — the
 * clock of the file the user uploaded — because the director reasons about the
 * transcript, and the transcript is in source time. The EDL builder maps it all
 * onto output time afterwards through the TimeMapper.
 *
 * Keeping that boundary crisp is what stops caption drift.
 */

export const DirectorRemovalSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  reason: z.enum(['off-topic', 'rambling', 'repeat', 'weak-ending', 'dead-weight']),
  confidence: z.number().min(0).max(1).default(0.7),
  note: z.string().default(''),
});

export const DirectorHookSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  /** Why this line stops the scroll — shown to the user in the editor. */
  note: z.string().default(''),
});

export const DirectorBrollSchema = z.object({
  atSec: z.number().nonnegative(),
  durationSec: z.number().positive().default(2),
  /** Stock search query. Concrete nouns only — "server rack", not "technology". */
  query: z.string(),
  /** What the viewer should understand from it. */
  intent: z.string().default(''),
  kind: z.enum(['stock-video', 'stock-photo', 'generated-image']).default('stock-video'),
});

export const DirectorGraphicSchema = z.object({
  atSec: z.number().nonnegative(),
  durationSec: z.number().positive().default(2.5),
  type: z.enum(['icon', 'stat', 'list', 'title-card', 'quote', 'arrow', 'image']),
  text: z.string().default(''),
  subtext: z.string().default(''),
  items: z.array(z.string()).default([]),
  /** Iconify-style concept name: "rocket", "shield-check", "trending-up". */
  iconQuery: z.string().default(''),
  /** Only for `image` — a bespoke illustration prompt. Costs money, use sparingly. */
  imagePrompt: z.string().default(''),
});

export const DirectorEmphasisSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
});

export const DirectorSfxSchema = z.object({
  atSec: z.number().nonnegative(),
  sound: z.enum(['whoosh', 'pop', 'riser', 'impact', 'click', 'swipe', 'ding', 'sub-drop']),
});

export const DirectorPunchInSchema = z.object({
  atSec: z.number().nonnegative(),
  durationSec: z.number().positive().default(3),
  intensity: z.enum(['subtle', 'medium', 'strong']).default('medium'),
});

export const DirectorPlanSchema = z.object({
  /** The single best opening line. Null means "the footage already opens well". */
  hook: DirectorHookSchema.nullable().default(null),
  removals: z.array(DirectorRemovalSchema).default([]),
  emphasis: z.array(DirectorEmphasisSchema).default([]),
  broll: z.array(DirectorBrollSchema).default([]),
  graphics: z.array(DirectorGraphicSchema).default([]),
  sfx: z.array(DirectorSfxSchema).default([]),
  punchIns: z.array(DirectorPunchInSchema).default([]),
  chapters: z.array(z.object({ atSec: z.number().nonnegative(), title: z.string() })).default([]),
  titleCard: z.object({ text: z.string(), subtext: z.string().default('') }).nullable().default(null),
  lowerThird: z.object({ text: z.string(), subtext: z.string().default('') }).nullable().default(null),
  musicMood: z.string().default(''),
  deliverable: z
    .object({
      title: z.string().default(''),
      socialCaption: z.string().default(''),
      hashtags: z.array(z.string()).default([]),
    })
    .default({ title: '', socialCaption: '', hashtags: [] }),
  /** The director's own one-line read on the footage, shown in the editor. */
  reasoning: z.string().default(''),
});

export type DirectorPlan = z.infer<typeof DirectorPlanSchema>;
export type DirectorRemoval = z.infer<typeof DirectorRemovalSchema>;
export type DirectorBroll = z.infer<typeof DirectorBrollSchema>;
export type DirectorGraphic = z.infer<typeof DirectorGraphicSchema>;
export type DirectorSfx = z.infer<typeof DirectorSfxSchema>;
export type DirectorPunchIn = z.infer<typeof DirectorPunchInSchema>;

export const EMPTY_PLAN: DirectorPlan = DirectorPlanSchema.parse({});

/** Merges plans from chunked long-form analysis into one. */
export function mergePlans(plans: DirectorPlan[]): DirectorPlan {
  if (plans.length === 1) return plans[0];

  const merged: DirectorPlan = {
    ...EMPTY_PLAN,
    // The hook can only come from the first chunk — an opening line 8 minutes in
    // is a highlight, not a hook.
    hook: plans[0]?.hook ?? null,
    titleCard: plans.find((p) => p.titleCard)?.titleCard ?? null,
    lowerThird: plans.find((p) => p.lowerThird)?.lowerThird ?? null,
    musicMood: plans.find((p) => p.musicMood)?.musicMood ?? '',
    deliverable: plans[0]?.deliverable ?? EMPTY_PLAN.deliverable,
    reasoning: plans.map((p) => p.reasoning).filter(Boolean).join(' '),
    removals: plans.flatMap((p) => p.removals),
    emphasis: plans.flatMap((p) => p.emphasis),
    broll: plans.flatMap((p) => p.broll),
    graphics: plans.flatMap((p) => p.graphics),
    sfx: plans.flatMap((p) => p.sfx),
    punchIns: plans.flatMap((p) => p.punchIns),
    chapters: plans.flatMap((p) => p.chapters),
  };

  const byTime = <T extends { atSec: number }>(list: T[]) => [...list].sort((a, b) => a.atSec - b.atSec);
  merged.broll = byTime(merged.broll);
  merged.graphics = byTime(merged.graphics);
  merged.sfx = byTime(merged.sfx);
  merged.punchIns = byTime(merged.punchIns);
  merged.chapters = byTime(merged.chapters);
  merged.removals.sort((a, b) => a.startSec - b.startSec);
  merged.emphasis.sort((a, b) => a.startSec - b.startSec);

  return merged;
}
