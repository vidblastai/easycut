import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { DirectorWireSchema, directorJsonSchema } from '../src/lib/director/wire';
import { DirectorPlanSchema } from '../src/lib/director/schema';
import { GRAPHIC_TYPES } from '../src/lib/edl/types';

/**
 * The two schemas that must never drift.
 *
 * `DirectorWireSchema` is what the model is CONSTRAINED to emit —
 * `strict: true` structured output, so a field missing from it cannot be
 * produced at all. `DirectorPlanSchema` is what the pipeline reads. When they
 * disagree, nothing errors: the prompt asks for something, the model is
 * silently forbidden from answering, and the feature is simply absent from
 * every video.
 *
 * That is not hypothetical. The icon-card cue was written, prompted, built,
 * rendered and shipped while this schema had no `icons` key, so the director
 * returned none — and the six motion-graphic types the system prompt explains
 * at length had been unreachable the same way for far longer.
 */
describe('the wire schema and the plan schema', () => {
  it('agree on every field, so nothing the prompt asks for is forbidden', () => {
    const wire = Object.keys((DirectorWireSchema as unknown as { shape: object }).shape).sort();
    const plan = Object.keys((DirectorPlanSchema as unknown as { shape: object }).shape).sort();
    expect(wire).toEqual(plan);
  });

  it('lets the model name every graphic the renderer can draw', () => {
    const schema = directorJsonSchema() as {
      properties: { graphics: { items: { properties: { type: { enum: string[] } } } } };
    };
    expect(schema.properties.graphics.items.properties.type.enum.sort())
      .toEqual([...GRAPHIC_TYPES].sort());
  });

  it('carries the icon cards, with the three fields a card needs', () => {
    const schema = directorJsonSchema() as {
      properties: { icons: { items: { properties: Record<string, unknown> } } };
    };
    expect(Object.keys(schema.properties.icons.items.properties).sort())
      .toEqual(['atSec', 'query', 'word']);
  });

  it('produces a plan the pipeline can read', () => {
    // A wire plan must survive the lenient schema untouched, because that is
    // exactly the handoff every real director response makes.
    const wire = {
      hook: null, removals: [], emphasis: [], broll: [], graphics: [],
      icons: [{ atSec: 4, word: 'bananas', query: 'banana' }],
      sfx: [], punchIns: [], chapters: [], titleCard: null, lowerThird: null,
      musicMood: '', deliverable: { title: '', socialCaption: '', hashtags: [] }, reasoning: '',
    };
    expect(() => DirectorWireSchema.parse(wire)).not.toThrow();
    const plan = DirectorPlanSchema.parse(wire);
    expect(plan.icons).toEqual([{ atSec: 4, word: 'bananas', query: 'banana' }]);
  });

  it('accepts a null animation as "you pick"', () => {
    // Strict output requires every property, so "leave it out" is spelled null.
    const plan = DirectorPlanSchema.parse({
      graphics: [{ atSec: 1, durationSec: 2, type: 'icon', animation: null }],
    });
    expect(plan.graphics[0].animation ?? 'pop').toBe('pop');
  });

  it('emits a schema with no dialect marker, which one provider rejects', () => {
    expect(directorJsonSchema().$schema).toBeUndefined();
    expect(z).toBeDefined();
  });
});
