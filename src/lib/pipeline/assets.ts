import { env } from '@/lib/config/env';
import { fetchIconMarkup, resolveIcon } from '@/lib/assets/icons';
import { resolveCardIcons, type CardIcon } from '@/lib/assets/icon-cards';
import { getStyle } from '@/lib/styles/presets';
import { generateImage, isImageGenConfigured } from '@/lib/assets/images';
import { selectMusic } from '@/lib/assets/music';
import { searchStock, isStockConfigured, type StockClip } from '@/lib/assets/broll';
import { isAiBrollConfigured, makeBrollAsset, type AiClip, type BrollSource } from '@/lib/assets/ai-broll';
import { sfxDefaultGain, sfxUrl, type SfxName } from '@/lib/assets/sfx';
import type { CostLedger } from '@/lib/pricing/cost';
import { iconRowPlacement, type Edl } from '@/lib/edl/types';
import { alignToBeat } from '@/lib/edl/beat-sync';

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
  options: {
    mode: 'short' | 'long';
    musicMood: string;
    ledger: CostLedger;
    /** Where the inserts come from. Defaults to stock — see ai-broll.ts. */
    brollSource?: BrollSource;
  },
): Promise<ResolveAssetsResult> {
  const degraded: string[] = [];
  const orientation = edl.format.height > edl.format.width ? 'portrait' : edl.format.width === edl.format.height ? 'square' : 'landscape';

  // Hard cap, independent of what the director asked for: a prompt-level limit
  // is a suggestion, a code-level limit is a budget.
  const imageBudget = options.mode === 'short' ? 1 : 2;
  let imagesGenerated = 0;

  const brollSource: BrollSource = options.brollSource ?? 'stock';
  /** Inserts that asked to be made and had to fall back to stock. */
  let aiMisses = 0;

  const [brollResults, graphicResults, sceneIcons, cardIcons, music] = await Promise.all([
    /* -------------------------------- b-roll ------------------------------- */
    Promise.all(
      edl.broll.map(async (clip, index) => {
        if (!env.features.broll) return { clip, resolved: null as StockClip | AiClip | null };
        const insertLength = clip.outEndSec - clip.outStartSec;

        /*
         * Made first when somebody asked for made.
         *
         * The fallback direction is deliberate and it is one way only: a
         * generation that fails or times out falls back to stock search,
         * because stock is free and instant and a video with a found clip
         * beats a video with a hole. Stock never escalates to generation on
         * its own — spending money and two minutes is a decision somebody
         * makes, not one a search miss makes for them.
         */
        if (brollSource !== 'stock' && isAiBrollConfigured(brollSource)) {
          const made = await makeBrollAsset(brollSource, clip.query, {
            orientation,
            durationSec: insertLength,
            index,
          }).catch(() => null);
          if (made) return { clip, resolved: made as StockClip | AiClip };
          aiMisses++;
        }

        if (!isStockConfigured()) return { clip, resolved: null as StockClip | AiClip | null };
        const results = await searchStock(clip.query, {
          orientation,
          minDurationSec: insertLength,
          limit: 1,
        }).catch(() => []);
        return { clip, resolved: (results[0] ?? null) as StockClip | AiClip | null };
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
      const made = 'costUsd' in resolved ? (resolved as AiClip) : null;
      if (made?.costUsd) options.ledger.add('broll-generation', made.costUsd, made.prompt.slice(0, 60));
      return {
        ...clip,
        url: resolved.url,
        kind: resolved.kind,
        // Skip the first beat of a stock clip: the interesting part is rarely
        // frame one, and the head often contains a slate or a slow start.
        // Never for a generated one — it was made to this exact length, and
        // trimming a second off the front is a second of missing insert.
        clipStartSec: !made && resolved.durationSec > insertLength + 1.5 ? 1 : 0,
        attribution: resolved.attribution,
        /*
         * A generated still is not a static insert.
         *
         * It lands as a `stock-photo`, which the renderer animates — a slow
         * push or a drift across the frame for as long as it is up. Cycled
         * per insert rather than fixed, because four stills all pushing in at
         * the same rate read as a slideshow with a zoom effect on it.
         */
        kenBurns: made?.kenBurns ?? clip.kenBurns,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (edl.broll.length && broll.length === 0) {
    degraded.push(isStockConfigured() ? 'broll (no matching stock found)' : 'broll (no stock API key)');
  } else if (aiMisses) {
    // Said out loud rather than silently absorbed: somebody who paid for
    // generated inserts and got stock ones is owed the sentence.
    degraded.push(`broll (${aiMisses} generated insert${aiMisses === 1 ? '' : 's'} fell back to stock)`);
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
      y: iconRowPlacement(cue.cards.length, edl.format.width, edl.format.height).y,
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

  /*
   * And now the bed's tempo is known, the inserts can land on it.
   *
   * This has to happen HERE and not in the builder, because the builder runs
   * before a track has been chosen — `music` is null at that point and the BPM
   * does not exist yet. Only what sits on top of the speech moves, and only by
   * a few frames; see `alignToBeat`.
   */
  const withAssets: Edl = {
    ...edl, broll, graphics, icons, scenes, sfx, music: musicTrack,
    degraded: [...edl.degraded, ...degraded],
  };
  const aligned = alignToBeat(withAssets);

  return { edl: aligned, degraded };
}
