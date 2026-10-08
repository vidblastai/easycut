import { fetchIconMarkup } from './icons';
import { generateImage, isImageGenConfigured } from './images';
import type { PanelScene } from '@/lib/edl/types';

/**
 * What the explainer panel needs fetched before it can draw.
 *
 * Two things, and they come from different places for a reason. The icons
 * are REAL BRAND MARKS — Instagram's gradient tile, LinkedIn's blue — because
 * the panel's whole claim is that you are looking at the actual product, and
 * a generic monochrome "camera" glyph standing in for Instagram breaks that
 * in the one place it matters. The hero is generated, because the things a
 * panel needs a picture of (a brain, a crowd, a machine) have no interface to
 * mock and no brand mark to borrow.
 */

/** Where a brand mark lives, in the order worth trying. */
const BRAND_SETS = ['logos', 'skill-icons', 'simple-icons'];

/**
 * The hero's look, which is one look on purpose.
 *
 * Every generated picture in the reference edits is the same material — a
 * soft clay render on a pale ground with one contact shadow. Four pictures in
 * four styles is four videos; this is the sentence that keeps them one.
 */
const HERO_LOOK =
  'soft 3D clay render, matte plastic materials, centred single subject, ' +
  'pale neutral grey studio background, soft overhead studio light, ' +
  'gentle contact shadow, muted palette with one warm terracotta accent, ' +
  'no text, no letters, no logos, no watermark, product-render look';

export interface PanelAssets {
  scenes: PanelScene[];
  costUsd: number;
  /** What could not be fetched, for the job's degraded list. */
  missing: string[];
}

export async function dressPanel(
  scenes: PanelScene[],
  options: { maxImages?: number } = {},
): Promise<PanelAssets> {
  if (!scenes.length) return { scenes, costUsd: 0, missing: [] };

  const maxImages = options.maxImages ?? 4;
  const missing: string[] = [];
  let costUsd = 0;
  let drawn = 0;

  const out = await Promise.all(
    scenes.map(async (scene, index) => {
      const iconSvgs = (
        await Promise.all(
          scene.icons.map(async (name, i) => {
            const markup = await brandMarkup(name, `p${index}i${i}`);
            if (!markup) missing.push(name);
            return markup;
          }),
        )
      ).filter((m): m is string => Boolean(m));

      let imageUrl = scene.imageUrl;
      if (
        !imageUrl &&
        scene.kind === 'hero-image' &&
        scene.imagePrompt &&
        isImageGenConfigured() &&
        drawn < maxImages
      ) {
        drawn++;
        const image = await generateImage(`${scene.imagePrompt}. ${HERO_LOOK}`, '1:1', {
          styled: false,
        }).catch(() => null);
        if (image) {
          imageUrl = image.url;
          costUsd += image.costUsd;
        }
      }

      return { ...scene, iconSvgs, imageUrl };
    }),
  );

  return { scenes: out, costUsd, missing };
}

/**
 * A brand mark, as markup, with its ids namespaced.
 *
 * The namespacing is not optional: brand logos are gradient-heavy and two of
 * them in one panel will both define `#a`, so the second one silently fills
 * with the first one's gradient. The same trap the scene drawings have.
 */
async function brandMarkup(name: string, scope: string): Promise<string | null> {
  const bare = name.replace(/[^a-z0-9: -]/gi, '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!bare) return null;

  const candidates = bare.includes(':')
    ? [bare]
    : BRAND_SETS.flatMap((set) => [`${set}:${bare}`, `${set}:${bare}-icon`, `${set}:${bare}-logo`]);

  for (const id of candidates) {
    const [set, icon] = id.split(':');
    const markup = await fetchIconMarkup(`https://api.iconify.design/${set}/${icon}.svg`).catch(
      () => null,
    );
    if (markup && markup.includes('<svg')) return namespaceIds(markup, scope);
  }
  return null;
}

function namespaceIds(markup: string, scope: string): string {
  return markup
    .replace(/id="([^"]+)"/g, (_, id) => `id="${scope}-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${scope}-${id})`)
    .replace(/(xlink:href|href)="#([^"]+)"/g, (_, attr, id) => `${attr}="#${scope}-${id}"`);
}
