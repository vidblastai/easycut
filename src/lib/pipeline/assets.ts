import { env } from '@/lib/config/env';
import { fetchIconMarkup, resolveIcon } from '@/lib/assets/icons';
import { resolveCardIcons, type CardIcon } from '@/lib/assets/icon-cards';
import { getStyle } from '@/lib/styles/presets';
import { generateImage, isImageGenConfigured } from '@/lib/assets/images';
import { selectMusic } from '@/lib/assets/music';
import { searchStock, isStockConfigured, type StockClip } from '@/lib/assets/broll';
import { sfxDefaultGain, sfxUrl, type SfxName } from '@/lib/assets/sfx';
import type { CostLedger } from '@/lib/pricing/cost';
import { iconRowPlacement, type Edl } from '@/lib/edl/types';

/**
 * Resolves every placeholder in an EDL into a real URL.
 *
 * All of it runs concurrently — a B-roll search, an icon lookup and an image
 * generation have nothing to do with each other, and doing them in sequence
 * would add twenty seconds to every job for no reason. The only serialisation
 * is the generated-image budget, which has to be counted centrally.
 *
 * Nothing in here is allowed to throw. A cue that can't be resolved is dropped
 * or downgraded, and the layer is recorded as degraded.
 */

export interface ResolveAssetsResult {
  edl: Edl;
  degraded: string[];
}

export async function resolveAssets(
  edl: Edl,
  options: { mode: 'short' | 'long'; musicMood: string; ledger: CostLedger },
): Promise<ResolveAssetsResult> {
  const degraded: string[] = [];
  const orientation = edl.format.height > edl.format.width ? 'portrait' : edl.format.width === edl.format.height ? 'square' : 'landscape';

  // Hard cap, independent of what the director asked for: a prompt-level limit
  // is a suggestion, a code-level limit is a budget.
  const imageBudget = options.mode === 'short' ? 1 : 2;
  let imagesGenerated = 0;

  const [brollResults, graphicResults, sceneIcons, cardIcons, music] = await Promise.all([
    /* -------------------------------- b-roll ------------------------------- */
    Promise.all(
      edl.broll.map(async (clip) => {
        if (!env.features.broll || !isStockConfigured()) return { clip, resolved: null as StockClip | null };
        const results = await searchStock(clip.query, {
          orientation,
          minDurationSec: clip.outEndSec - clip.outStartSec,
          limit: 1,
        }).catch(() => []);
        return { clip, resolved: results[0] ?? null };
      }),
    ),

    /* ------------------------------- graphics ------------------------------ */
    Promise.all(
      edl.graphics.map(async (graphic) => {
        // Icons first: free, instant, and right most of the time.
        if (graphic.iconQuery || graphic.type === 'icon') {
          const icon = await resolveIcon(graphic.iconQuery || graphic.text, graphic.color);
          if (icon) return { graphic, url: icon.url, costUsd: 0, source: 'icon' as const };
        }

        // Generated illustration only when explicitly asked for and in budget.
        const wantsImage = graphic.type === 'image' && graphic.imagePrompt.length > 0;
        if (wantsImage && isImageGenConfigured() && imagesGenerated < imageBudget) {
          imagesGenerated++;
          const image = await generateImage(graphic.imagePrompt, edl.format.aspect === '9:16' ? '9:16' : edl.format.aspect === '1:1' ? '1:1' : '16:9');
          if (image) return { graphic, url: image.url, costUsd: image.costUsd, source: 'generated' as const };
        }

        // Text-only graphics (stats, lists, quotes) need no asset at all.
        return { graphic, url: null, costUsd: 0, source: 'text' as const };
      }),
    ),

    /* -------------------------------- scenes ------------------------------- */
    /*
     * A scene's icons are a nice-to-have, not a requirement.
     *
     * Every scene kind draws without them — a chip falls back to a dot — so a
     * lookup that finds nothing costs the scene nothing, which is the right
     * trade when the alternative is an icon that means something else. Icons
     * are free and keyless, so this is one round trip per label.
     */
    Promise.all(
      edl.scenes.map((scene) =>
        Promise.all(
          scene.iconQueries.map(async (query) => {
            if (!query.trim()) return null;
            const icon = await resolveIcon(query, scene.accent).catch(() => null);
            return icon ? await fetchIconMarkup(icon.url) : null;
          }),
        ),
      ),
    ),

    /* ------------------------------ icon cards ----------------------------- */
    /*
     * Every card in the video, resolved in ONE call.
     *
     * Not a loop, on purpose: the resolver picks a single illustrated icon set
     * for the whole video by seeing which one can answer the most of its
     * words, and that decision cannot be made one card at a time. Resolving
     * them independently is how you get a Noto banana next to an OpenMoji
     * apple — two illustrators on screen in the same second.
     */
    resolveCardIcons(
      edl.icons.flatMap((cue) => cue.cards.map((card) => card.query)),
      // Only ever used to tint the monochrome fallback, so the video's accent
      // is the right colour for it — the illustrated icons keep their own.
      getStyle(edl.styleId).accent,
    ).catch(() => [] as Array<CardIcon | null>),

    /* -------------------------------- music -------------------------------- */
    env.features.music
      ? selectMusic({
          mood: options.musicMood,
          mode: options.mode,
          durationSec: edl.format.durationSec,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);

  /* ----------------------------- apply results ---------------------------- */

  const broll = brollResults
    .map(({ clip, resolved }) => {
      if (!resolved) return null;
      const insertLength = clip.outEndSec - clip.outStartSec;
      return {
        ...clip,
        url: resolved.url,
        kind: resolved.kind,
        // Skip the first beat of a stock clip: the interesting part is rarely
        // frame one, and the head often contains a slate or a slow start.
        clipStartSec: resolved.durationSec > insertLength + 1.5 ? 1 : 0,
        attribution: resolved.attribution,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (edl.broll.length && broll.length === 0) {
    degraded.push(isStockConfigured() ? 'broll (no matching stock found)' : 'broll (no stock API key)');
  }

  const graphics = graphicResults
    .map(({ graphic, url, costUsd }) => {
      if (costUsd) options.ledger.add('image-generation', costUsd, graphic.imagePrompt.slice(0, 60));
      // An icon graphic with no icon has nothing to show. Text graphics survive.
      if (!url && (graphic.type === 'icon' || graphic.type === 'image')) return null;
      return { ...graphic, assetUrl: url };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);

  if (edl.graphics.length > graphics.length) {
    degraded.push(`graphics (${edl.graphics.length - graphics.length} cue(s) had no matching visual)`);
  }
  if (!isImageGenConfigured() && edl.graphics.some((g) => g.type === 'image')) {
    degraded.push('generated images (no image API key)');
  }

  /* --------------------------------- sfx ---------------------------------- */

  const sfx = edl.sfx.map((cue) => ({
    ...cue,
    url: sfxUrl(cue.sound as SfxName),
    gainDb: cue.gainDb || sfxDefaultGain(cue.sound as SfxName),
  }));

  /* -------------------------------- music --------------------------------- */

  let musicTrack: Edl['music'] = null;
  if (music) {
    const style = options.mode === 'short' ? { gainDb: -16, duckDb: -12 } : { gainDb: -21, duckDb: -14 };
    musicTrack = {
      id: music.track.id,
      url: music.track.url,
      title: music.track.title,
      mood: music.track.moods.join(', '),
      bpm: music.track.bpm,
      gainDb: style.gainDb,
      duckDb: style.duckDb,
      startAtSec: 0,
      fadeInSec: 0.8,
      fadeOutSec: Math.min(2.5, edl.format.durationSec * 0.1),
      attribution: music.track.attribution,
    };
  } else if (env.features.music) {
    degraded.push('music (library is empty — add tracks to content/music/manifest.json)');
  }

  /* ------------------------------ icon cards ------------------------------ */

  /*
   * Flat results back onto rows, in the order they were flattened.
   *
   * A card whose icon did not resolve is DROPPED rather than drawn empty — an
   * empty tile rising on a word is worse than no tile — and a row that loses
   * all its cards goes with it.
   */
  let cardCursor = 0;
  const icons = edl.icons
    .map((cue) => ({
      ...cue,
      cards: cue.cards
        .map((card) => {
          const resolved = cardIcons[cardCursor++] ?? null;
          return resolved ? { ...card, markup: resolved.markup, iconId: resolved.id } : null;
        })
        .filter((card): card is NonNullable<typeof card> => card !== null),
    }))
    .filter((cue) => cue.cards.length > 0)
    // Re-placed for the cards that SURVIVED. A card's size depends on how many
    // share its row, and the row's height is what keeps it clear of the
    // captions — so a three-card row that lost one to a failed lookup would
    // otherwise sit at the height a smaller card needed, with the words
    // running through the two that are left.
    .map((cue) => ({
      ...cue,
      y: iconRowPlacement(edl.captionStyle, cue.cards.length, edl.format.width, edl.format.height).y,
    }));

  const droppedCards =
    edl.icons.reduce((n, cue) => n + cue.cards.length, 0) - icons.reduce((n, cue) => n + cue.cards.length, 0);
  if (droppedCards > 0) degraded.push(`icon cards (${droppedCards} word(s) had no icon)`);

  const scenes = edl.scenes.map((scene, i) => ({
    ...scene,
    // Padded to the item count, so a scene with four labels and two icons
    // draws the two it has rather than reading past the end of the array.
    iconSvgs: scene.items.map((_, k) => sceneIcons[i]?.[k] ?? null),
  }));

  return {
    edl: {
      ...edl, broll, graphics, icons, scenes, sfx, music: musicTrack,
      degraded: [...edl.degraded, ...degraded],
    },
    degraded,
  };
}
