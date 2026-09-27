/**
 * Icons come from Iconify: ~200,000 open-source icons behind a free, keyless
 * HTTP API. No account, no rate limit worth worrying about, no per-image cost,
 * and the response is an SVG we can recolour and animate.
 *
 * This is the single biggest cost saving in the product. The obvious
 * implementation — "generate an icon with an image model" — costs money per
 * graphic and returns a raster with a background you then have to key out.
 * Nine times out of ten the speaker says a word that already has an icon.
 */

const SEARCH_ENDPOINT = 'https://api.iconify.design/search';
const REQUEST_TIMEOUT_MS = 4000;

/** Icon sets that share a consistent visual language, in preference order. */
const PREFERRED_SETS = ['lucide', 'ph', 'tabler', 'solar', 'mingcute', 'material-symbols'];

export interface ResolvedIcon {
  /** `prefix:name`, e.g. `lucide:rocket`. */
  id: string;
  /** Fully-resolved SVG URL, already tinted. */
  url: string;
  set: string;
}

const cache = new Map<string, ResolvedIcon | null>();

export async function resolveIcon(query: string, color = '#9B7BFF'): Promise<ResolvedIcon | null> {
  const key = `${query}::${color}`;
  if (cache.has(key)) return cache.get(key)!;

  const result = await search(query, color).catch(() => null);
  cache.set(key, result);
  return result;
}

async function search(query: string, color: string): Promise<ResolvedIcon | null> {
  const terms = deriveTerms(query);

  for (const term of terms) {
    const params = new URLSearchParams({ query: term, limit: '32' });
    const response = await fetchWithTimeout(`${SEARCH_ENDPOINT}?${params}`);
    if (!response.ok) continue;

    const json = (await response.json()) as { icons?: string[] };
    const icons = json.icons ?? [];
    if (!icons.length) continue;

    // Prefer a set with a coherent style so a video's icons look like a family.
    for (const set of PREFERRED_SETS) {
      const match = icons.find((id) => id.startsWith(`${set}:`));
      if (match) return toResolved(match, color);
    }
    return toResolved(icons[0], color);
  }
  return null;
}

function toResolved(id: string, color: string): ResolvedIcon {
  const [set, name] = id.split(':');
  const tint = encodeURIComponent(color);
  return {
    id,
    set,
    // `height=512` gives us enough resolution to scale the icon up on a 1080p frame.
    url: `https://api.iconify.design/${set}/${name}.svg?color=${tint}&height=512`,
  };
}

/**
 * "customer retention rate" will not match an icon. "retention" might not
 * either. "chart" will. So we try progressively more generic terms rather than
 * failing on the first miss.
 */
export function deriveTerms(query: string): string[] {
  const cleaned = query.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);

  const terms = new Set<string>();
  if (cleaned) terms.add(cleaned);
  // Individual words, longest first — the most specific one is usually the noun.
  for (const word of [...words].sort((a, b) => b.length - a.length)) {
    if (word.length > 2) terms.add(word);
  }
  for (const [pattern, fallback] of CONCEPT_FALLBACKS) {
    if (pattern.test(cleaned)) terms.add(fallback);
  }
  return [...terms].slice(0, 5);
}

/** Maps abstract language onto icons that reliably exist. */
const CONCEPT_FALLBACKS: Array<[RegExp, string]> = [
  [/money|revenue|price|cost|profit|sales|paid/, 'dollar-sign'],
  [/grow|increase|scale|up|improve/, 'trending-up'],
  [/drop|decrease|fall|lose|down/, 'trending-down'],
  [/time|fast|quick|hour|minute|speed/, 'clock'],
  [/secure|safe|protect|privacy|trust/, 'shield-check'],
  [/team|people|customer|user|audience|client/, 'users'],
  [/idea|think|learn|understand|insight/, 'lightbulb'],
  [/warn|mistake|wrong|problem|risk|fail/, 'alert-triangle'],
  [/goal|target|focus|aim/, 'target'],
  [/build|make|create|tool|fix/, 'wrench'],
  [/data|number|metric|analytic|measure|report/, 'bar-chart'],
  [/launch|start|ship|begin/, 'rocket'],
  [/check|done|complete|success|win/, 'check-circle'],
  [/search|find|discover|research/, 'search'],
  [/video|camera|film|record|content/, 'video'],
  [/write|note|document|content|post/, 'file-text'],
  [/email|message|contact|reach/, 'mail'],
  [/global|world|market|country/, 'globe'],
];

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The icon as markup, not as a URL.
 *
 * Remotion's `<Img>` runs `decode()` on what it loads, and headless Chromium
 * refuses to decode these SVGs — the render dies with "The source image cannot
 * be decoded" and takes the frame with it. Fetching the markup once, here, and
 * inlining it into the composition sidesteps the image pipeline entirely: the
 * renderer draws vector markup that is already in the document, with no network
 * call, no decode, and nothing to fail halfway through a cloud render.
 *
 * ── On inlining third-party markup ──────────────────────────────────────
 *
 * This goes into a page as HTML, so it is stripped to the parts an icon needs.
 * Anything that could execute — a script, an event handler, an external
 * reference, a foreignObject — is removed rather than trusted, because the
 * only thing standing between this and the editor's DOM is this function.
 */
export async function fetchIconMarkup(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const body = await response.text();
    return sanitiseSvg(body);
  } catch {
    return null;
  }
}

/** Keep the drawing, drop everything that could do something. */
export function sanitiseSvg(markup: string): string | null {
  const match = markup.match(/<svg[\s\S]*<\/svg>/i);
  if (!match) return null;

  const cleaned = match[0]
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Event handlers, in any spelling of the quotes or none.
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Anything that could fetch or navigate: javascript:, data:, external refs.
    .replace(/\s(?:href|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // A drawing with no drawing in it is not worth inlining.
  return /<(path|circle|rect|line|polyline|polygon|ellipse|g)\b/i.test(cleaned) ? cleaned : null;
}
