import { env } from '@/lib/config/env';
import { resolveIcon } from '@/lib/assets/icons';
import { generateImage, isImageGenConfigured } from '@/lib/assets/images';
import { selectMusic } from '@/lib/assets/music';
import { searchStock, isStockConfigured, type StockClip } from '@/lib/assets/broll';
import { sfxDefaultGain, sfxUrl, type SfxName } from '@/lib/assets/sfx';
import type { CostLedger } from '@/lib/pricing/cost';
import type { Edl } from '@/lib/edl/types';

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

  const [brollResults, graphicResults, music] = await Promise.all([
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

  return {
    edl: { ...edl, broll, graphics, sfx, music: musicTrack, degraded: [...edl.degraded, ...degraded] },
    degraded,
  };
}
