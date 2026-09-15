import { z } from 'zod/v4';

/**
 * The wire schema is deliberately separate from `DirectorPlanSchema`.
 *
 * Structured outputs need a schema where every field is required and nothing is
 * optional-with-a-default — the model has to be told exactly what to emit. Our
 * internal schema, by contrast, is full of `.default()` so that a hand-written
 * or repaired plan stays valid. So the model fills in the strict shape, and we
 * run it through the lenient one to get defaults and coercion for free.
 */
export const WireHook = z.object({
  startSec: z.number(),
  endSec: z.number(),
  note: z.string(),
});

export const DirectorWireSchema = z.object({
  hook: WireHook.nullable(),
  removals: z.array(
    z.object({
      startSec: z.number(),
      endSec: z.number(),
      reason: z.enum(['off-topic', 'rambling', 'repeat', 'weak-ending', 'dead-weight']),
      confidence: z.number(),
      note: z.string(),
    }),
  ),
  emphasis: z.array(z.object({ startSec: z.number(), endSec: z.number() })),
  broll: z.array(
    z.object({
      atSec: z.number(),
      durationSec: z.number(),
      query: z.string(),
      intent: z.string(),
      kind: z.enum(['stock-video', 'stock-photo', 'generated-image']),
    }),
  ),
  graphics: z.array(
    z.object({
      atSec: z.number(),
      durationSec: z.number(),
      type: z.enum(['icon', 'stat', 'list', 'title-card', 'quote', 'arrow', 'image']),
      text: z.string(),
      subtext: z.string(),
      items: z.array(z.string()),
      iconQuery: z.string(),
      imagePrompt: z.string(),
    }),
  ),
  sfx: z.array(
    z.object({
      atSec: z.number(),
      sound: z.enum(['whoosh', 'pop', 'riser', 'impact', 'click', 'swipe', 'ding', 'sub-drop']),
    }),
  ),
  punchIns: z.array(
    z.object({
      atSec: z.number(),
      durationSec: z.number(),
      intensity: z.enum(['subtle', 'medium', 'strong']),
    }),
  ),
  chapters: z.array(z.object({ atSec: z.number(), title: z.string() })),
  titleCard: z.object({ text: z.string(), subtext: z.string() }).nullable(),
  lowerThird: z.object({ text: z.string(), subtext: z.string() }).nullable(),
  musicMood: z.string(),
  deliverable: z.object({
    title: z.string(),
    socialCaption: z.string(),
    hashtags: z.array(z.string()),
  }),
  reasoning: z.string(),
});


/**
 * Gemini wants JSON Schema rather than a Zod object, and Zod 4 can emit it — so
 * both providers are handed the same shape from the same definition. Two
 * hand-maintained copies of a schema this size would diverge within a month,
 * and the failure would be silent: one provider quietly omitting a field the
 * other fills.
 */
export function directorJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(DirectorWireSchema) as Record<string, unknown>;
  // Gemini rejects the dialect marker.
  delete schema.$schema;
  return schema;
}
