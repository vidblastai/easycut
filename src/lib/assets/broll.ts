import { env } from '@/lib/config/env';

/**
 * Stock B-roll. Pexels and Pixabay are both free, both require nothing but an
 * API key, and both licence their content for commercial use with no
 * attribution required — which is what makes "B-roll included" possible at this
 * price point at all.
 */

export interface StockClip {
  id: string;
  /**
   * Where the clip came from. `generated` is B-roll made to order rather than
   * found — see generated-broll.ts. It shares this shape on purpose, so the
   * timeline builder never has to know which kind it is holding.
   */
  provider: 'pexels' | 'pixabay' | 'generated';
  url: string;
  previewUrl: string;
  width: number;
  height: number;
  durationSec: number;
  kind: 'stock-video' | 'stock-photo';
  attribution: string;
  /** How well this matched the query, 0..1 — used to reject weak results. */
  score: number;
}

export interface StockSearchOptions {
  orientation: 'portrait' | 'landscape' | 'square';
  /** Clips shorter than the insert are useless; longer is fine, we trim. */
  minDurationSec: number;
  limit: number;
}

const REQUEST_TIMEOUT_MS = 6000;

/**
 * A provider failing must never fail the job — the other one may still have a
 * clip, and a video with fewer inserts beats no video. But it must not be
 * SILENT either: a bad key, a blocked host and "nothing matches this query" all
 * used to come back as an empty array, so the only symptom was a finished video
 * with no B-roll in it and nothing anywhere saying why.
 */
export async function searchStock(query: string, options: StockSearchOptions): Promise<StockClip[]> {
  const attempt = async (provider: string, run: () => Promise<StockClip[]>) => {
    try {
      return await run();
    } catch (error) {
      console.warn(`[easycut] ${provider} search failed for "${query}": ${(error as Error).message}`);
      return [];
    }
  };

  const results = await Promise.all([
    env.stock.pexelsKey ? attempt('pexels', () => searchPexels(query, options)) : Promise.resolve([]),
    env.stock.pixabayKey ? attempt('pixabay', () => searchPixabay(query, options)) : Promise.resolve([]),
  ]);

  return rank(results.flat(), query, options).slice(0, options.limit);
}

/* --------------------------------- Pexels --------------------------------- */

async function searchPexels(query: string, options: StockSearchOptions): Promise<StockClip[]> {
  const params = new URLSearchParams({
    query,
    per_page: String(Math.max(options.limit * 3, 10)),
    orientation: options.orientation,
  });

  const response = await fetchWithTimeout(`https://api.pexels.com/videos/search?${params}`, {
    headers: { Authorization: env.stock.pexelsKey! },
  });
  if (response.status === 401) throw new Error('Pexels rejected the key — check PEXELS_API_KEY');
  if (response.status === 429) throw new Error('Pexels rate limit reached (200/hour, 20,000/month)');
  if (!response.ok) throw new Error(`Pexels ${response.status} ${response.statusText}`);

  const json = (await response.json()) as any;
  return (json.videos ?? []).flatMap((video: any): StockClip[] => {
    // Pick the smallest file that still covers our output height — downloading a
    // 4K master to show for 1.8 seconds is pure latency.
    const files = (video.video_files ?? [])
      .filter((f: any) => f.link && f.height)
      .sort((a: any, b: any) => a.height - b.height);
    const file = files.find((f: any) => f.height >= 1080) ?? files[files.length - 1];
    if (!file) return [];

    return [
      {
        id: `pexels-${video.id}`,
        provider: 'pexels',
        url: file.link,
        previewUrl: video.image,
        width: file.width,
        height: file.height,
        durationSec: video.duration ?? 0,
        kind: 'stock-video',
        attribution: `${video.user?.name ?? 'Pexels'} / Pexels`,
        score: 0,
      },
    ];
  });
}

/* -------------------------------- Pixabay --------------------------------- */

async function searchPixabay(query: string, options: StockSearchOptions): Promise<StockClip[]> {
  const params = new URLSearchParams({
    key: env.stock.pixabayKey!,
    q: query,
    per_page: String(Math.max(options.limit * 3, 10)),
    safesearch: 'true',
  });

  const response = await fetchWithTimeout(`https://pixabay.com/api/videos/?${params}`);
  if (response.status === 400) throw new Error('Pixabay rejected the request — check PIXABAY_API_KEY');
  if (response.status === 429) throw new Error('Pixabay rate limit reached');
  if (!response.ok) throw new Error(`Pixabay ${response.status} ${response.statusText}`);

  const json = (await response.json()) as any;
  return (json.hits ?? []).flatMap((hit: any): StockClip[] => {
    const variant = hit.videos?.large ?? hit.videos?.medium ?? hit.videos?.small;
    if (!variant?.url) return [];
    return [
      {
        id: `pixabay-${hit.id}`,
        provider: 'pixabay',
        url: variant.url,
        previewUrl: variant.thumbnail ?? '',
        width: variant.width ?? 1920,
        height: variant.height ?? 1080,
        durationSec: hit.duration ?? 0,
        kind: 'stock-video',
        attribution: `${hit.user ?? 'Pixabay'} / Pixabay`,
        score: 0,
      },
    ];
  });
}

/* --------------------------------- ranking -------------------------------- */

/**
 * Stock APIs rank by popularity, which is not the same as "matches this shot".
 * We re-rank on the three things that actually matter for an insert.
 */
function rank(clips: StockClip[], query: string, options: StockSearchOptions): StockClip[] {
  const wantPortrait = options.orientation === 'portrait';

  return clips
    .map((clip) => {
      let score = 0.5;

      // 1. Usable length. A 2-second clip cut to 2 seconds has no room to breathe.
      if (clip.durationSec >= options.minDurationSec + 1.5) score += 0.25;
      else if (clip.durationSec < options.minDurationSec) score -= 0.5;

      // 2. Orientation. Cropping landscape into 9:16 loses two thirds of the frame.
      const isPortrait = clip.height > clip.width;
      if (isPortrait === wantPortrait) score += 0.2;
      else score -= 0.15;

      // 3. Resolution headroom for the reframe crop.
      if (clip.height >= 1080) score += 0.1;

      return { ...clip, score: Math.max(0, Math.min(1, score)) };
    })
    .filter((clip) => clip.score > 0.35)
    .sort((a, b) => b.score - a.score)
    .filter(dedupeByProviderId(query));
}

function dedupeByProviderId(_query: string) {
  const seen = new Set<string>();
  return (clip: StockClip) => {
    if (seen.has(clip.id)) return false;
    seen.add(clip.id);
    return true;
  };
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function isStockConfigured(): boolean {
  return Boolean(env.stock.pexelsKey || env.stock.pixabayKey);
}
