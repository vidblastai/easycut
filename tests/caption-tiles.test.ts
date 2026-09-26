import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPTION_PRESETS } from '@/lib/captions/presets';

/**
 * The picker's tiles are pictures, rendered once by the real renderer.
 *
 * A preset added without re-running `npm run caption-thumbs` would fall back
 * to drawing itself live — which works, and is exactly the slowness the
 * pictures exist to remove. So the two lists have to match, and this is the
 * thing that says so.
 */
describe('caption tiles', () => {
  const dir = join(process.cwd(), 'public', 'captions');
  const files = new Set(readdirSync(dir));

  it('has a picture for every preset, in every shape it is offered in', () => {
    const missing: string[] = [];
    for (const preset of CAPTION_PRESETS) {
      const shapes = preset.bestFor === 'both' ? ['short', 'long'] : [preset.bestFor];
      for (const shape of shapes) {
        const name = `${preset.id}-${shape}.png`;
        if (!files.has(name)) missing.push(name);
      }
    }
    expect(missing, `run: npx tsx scripts/caption-thumbs.ts`).toEqual([]);
  });

  it('ships no picture for a preset that no longer exists', () => {
    const ids = new Set(CAPTION_PRESETS.map((p) => p.id));
    const orphans = [...files]
      .filter((f) => f.endsWith('.png'))
      .filter((f) => !ids.has(f.replace(/-(short|long)\.png$/, '')));
    expect(orphans).toEqual([]);
  });
});
