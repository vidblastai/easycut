import { deriveTerms, fetchIconMarkup, resolveIcon } from './icons';

/**
 * The coloured icon that sits on a card.
 *
 * ── Why a different resolver from `icons.ts` ────────────────────────────
 *
 * The graphics layer wants a monochrome glyph it can tint to the video's
 * accent, because there it is a bullet beside a line of type. This layer wants
 * the opposite: the icon IS the graphic, alone on a plain card, and a flat
 * single-colour pictogram blown up to a third of the frame reads as a missing
 * asset. What the reference edit uses — and what makes it read as a designed
 * object rather than a UI glyph — is a full-colour illustrated icon with its
 * own shading and a dark outline.
 *
 * Iconify carries several such sets, free and keyless, which is the whole
 * reason this does not need an image model: a generated icon costs money per
 * card, takes seconds we do not have, and comes back with a background to key
 * out. Where nothing matches we fall back to the tinted glyph rather than
 * inventing something, and a card with no icon is dropped rather than shown
 * empty.
 *
 * ── The family rule ─────────────────────────────────────────────────────
 *
 * Icons in one video have to look like they came from one hand. Resolving each
 * query independently gives you a Noto banana beside an OpenMoji apple — two
 * different illustrators on screen at once, which is exactly the tell that
 * something was assembled rather than designed.
 *
 * So the whole video's queries are resolved together: every set is asked about
 * every word, and the set that can answer the MOST of them wins the video. The
 * rest is per-query fallback for the words that set happens not to have.
 */

/**
 * Colour sets, in the order they win ties.
 *
 * `noto` first because it is the most completely drawn — real shading, a
 * consistent light source, and coverage of essentially every emoji concept.
 * `openmoji` is the closest to the reference's outlined look and is second
 * for that reason. `flat-color-icons` is last because it is a UI set rather
 * than an illustrated one, and only shines for office and finance nouns.
 */
const COLOUR_SETS = ['noto', 'openmoji', 'fluent-emoji', 'twemoji', 'emojione', 'flat-color-icons'] as const;

/** How many candidates to ask for per term. Enough to see which sets have it. */
const SEARCH_LIMIT = 48;
const REQUEST_TIMEOUT_MS = 5000;

export interface CardIcon {
  /** `prefix:name`, e.g. `noto:banana`. */
  id: string;
  set: string;
  /** Inline SVG, already sanitised and with its ids namespaced. */
  markup: string;
  /** True when this fell back to a tinted monochrome glyph. */
  monochrome: boolean;
}

/**
 * Resolves a video's worth of card icons in one go.
 *
 * Takes every query at once rather than one at a time BECAUSE of the family
 * rule above — the choice of set is a property of the set of queries, not of
 * any one of them, so it cannot be made one call at a time.
 *
 * Returns one entry per query, in order, with `null` where nothing was found.
 */
export async function resolveCardIcons(queries: string[], accent: string): Promise<Array<CardIcon | null>> {
  if (!queries.length) return [];

  const candidates = await Promise.all(queries.map((query) => candidatesFor(query)));
  const family = chooseFamily(candidates);

  return Promise.all(
    queries.map(async (query, index) => {
      const options = candidates[index];
      /*
       * The family first — and if it has nothing, ask it again on its own
       * before settling for another set.
       *
       * The first pass stops at whichever term matched ANY set, which can be
       * the wrong set: "smartphone" found a flat-color-icons tablet and
       * stopped, so the row's third card came from a different illustrator
       * while `noto:mobile-phone` sat one term further down the ladder. This
       * second look is restricted to the family and only runs for the handful
       * of queries it missed.
       */
      const id =
        (family && options.get(family)) ||
        (family ? await inFamily(queries[index], family) : null) ||
        firstColour(options);
      if (id) {
        const markup = await fetchIconMarkup(colourUrl(id));
        if (markup) return { id, set: id.split(':')[0], markup: prefixIds(markup, `card${index}`), monochrome: false };
      }

      const glyph = await resolveIcon(query, accent).catch(() => null);
      if (!glyph) return null;
      const markup = await fetchIconMarkup(glyph.url);
      return markup
        ? { id: glyph.id, set: glyph.set, markup: prefixIds(markup, `card${index}`), monochrome: true }
        : null;
    }),
  );
}

/**
 * Every colour set that has something for this query, best match per set.
 *
 * Searched term by term the same way the glyph resolver does it — "the best
 * two fruits" will not match anything and "banana" will — so an abstract query
 * degrades to its most concrete noun instead of failing.
 */
async function candidatesFor(query: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();

  for (const term of cardTerms(query)) {
    const params = new URLSearchParams({
      query: term,
      limit: String(SEARCH_LIMIT),
      prefixes: COLOUR_SETS.join(','),
    });
    const icons = await searchIds(`https://api.iconify.design/search?${params}`);

    for (const set of COLOUR_SETS) {
      if (found.has(set)) continue;
      const best = bestInSet(icons, set, term);
      if (best) found.set(set, best);
    }
    // A term that answered for every set will not be improved on by a vaguer one.
    if (found.size === COLOUR_SETS.length) break;
    // Otherwise keep going only while we have nothing: a specific term that
    // found two sets beats a generic one that finds six of the wrong icon.
    if (found.size > 0) break;
  }

  return found;
}

/**
 * The best match for a term inside one set.
 *
 * Ranked rather than "first result", because the search returns by relevance
 * to the whole index and not to the word we asked for: "video" came back as
 * `noto:video-game`, which is a games console, when `noto:video-camera` was
 * sitting in the same response. An exact name beats a compound, a compound
 * that STARTS with the word beats one that merely contains it, and the
 * shortest name breaks the tie — the shorter name is the more general object,
 * which is what a single icon on a card should be.
 */
export function bestInSet(icons: string[], set: string, term: string): string | null {
  const wanted = term.replace(/\s+/g, '-');
  let best: { id: string; rank: number; length: number } | null = null;

  for (const id of icons) {
    if (!id.startsWith(`${set}:`)) continue;
    const name = id.slice(set.length + 1);
    const rank =
      name === wanted ? 0
      : name.startsWith(`${wanted}-`) ? 1
      : name.endsWith(`-${wanted}`) ? 2
      : name.includes(wanted) ? 3
      : 4;
    if (!best || rank < best.rank || (rank === best.rank && name.length < best.length)) {
      best = { id, rank, length: name.length };
    }
  }

  return best?.id ?? null;
}

/** A second look for one query, inside the family the video already chose. */
async function inFamily(query: string, family: string): Promise<string | null> {
  for (const term of cardTerms(query)) {
    const params = new URLSearchParams({ query: term, limit: String(SEARCH_LIMIT), prefixes: family });
    const best = bestInSet(await searchIds(`https://api.iconify.design/search?${params}`), family, term);
    if (best) return best;
  }
  return null;
}

/** The set that covers the most queries; ties go to the preference order. */
export function chooseFamily(candidates: Array<Map<string, string>>): string | null {
  let best: { set: string; covered: number } | null = null;

  for (const set of COLOUR_SETS) {
    const covered = candidates.filter((options) => options.has(set)).length;
    if (covered && (!best || covered > best.covered)) best = { set, covered };
  }

  return best?.set ?? null;
}

function firstColour(options: Map<string, string>): string | null {
  for (const set of COLOUR_SETS) {
    const id = options.get(set);
    if (id) return id;
  }
  return null;
}

/**
 * No `color=` on the URL, deliberately.
 *
 * Tinting is what the monochrome path wants and it is destructive here: the
 * parameter repaints every shape in the icon, so a tinted colour icon comes
 * back as a violet silhouette of a house.
 */
function colourUrl(id: string): string {
  const [set, name] = id.split(':');
  return `https://api.iconify.design/${set}/${name}.svg?height=512`;
}

/**
 * Namespaces the ids inside one icon.
 *
 * Several cards are in the document at once and some sets (fluent-emoji in
 * particular) define gradients with ids like `a` and `b`. Two cards on screen
 * together means two `id="a"`, and every `url(#a)` in the document then
 * resolves to whichever one the browser saw first — one icon silently wearing
 * another's colours.
 */
function prefixIds(markup: string, prefix: string): string {
  const safe = prefix.replace(/[^A-Za-z0-9_-]/g, '');
  return markup
    .replace(/\bid\s*=\s*["']([^"']+)["']/gi, (_all, id: string) => `id="${safe}-${id}"`)
    .replace(/url\(\s*#([^)\s]+)\s*\)/gi, (_all, id: string) => `url(#${safe}-${id})`);
}

/**
 * Search terms for a card, most specific first.
 *
 * The glyph resolver's own ladder, plus one step it cannot have: a map from
 * abstract language onto the name of a physical object that an emoji set
 * actually draws. Its map ends at lucide names — "video", "dollar-sign" —
 * which are UI glyphs and exist in none of these sets. "Money" has to become a
 * money BAG here, because that is the thing somebody drew.
 */
export function cardTerms(query: string): string[] {
  const base = deriveTerms(query);
  const cleaned = query.toLowerCase();
  const objects = CARD_OBJECTS.filter(([pattern]) => pattern.test(cleaned)).map(([, object]) => object);

  /*
   * The mapped object goes SECOND, right after the phrase itself.
   *
   * It used to go last, and last is never reached: the ladder stops at the
   * first term that matches anything, and a single word out of the query
   * almost always matches something. "video editing" reached "video" and
   * stopped on a games console while "clapper board" waited at the bottom of
   * the list; "my audience" stopped on a lecture podium. The phrase still goes
   * first, because a query that names an object outright should get that
   * object.
   */
  return [...new Set([base[0], ...objects, ...base.slice(1)].filter(Boolean))].slice(0, 6);
}

/** Abstractions, mapped onto objects somebody has actually illustrated. */
const CARD_OBJECTS: Array<[RegExp, string]> = [
  [/\b(video|edit|editing|footage|clip|movie|film)\b/, 'clapper board'],
  [/\b(camera|record|filming|shoot|shooting)\b/, 'movie camera'],
  [/\b(money|revenue|price|pricing|profit|cash|paid|income|salary|earn)\b/, 'money bag'],
  [/\b(time|hour|hours|minute|minutes|deadline|fast|quick|slow)\b/, 'hourglass'],
  [/\b(grow|growth|increase|scale|scaling|rise|rising)\b/, 'chart increasing'],
  [/\b(drop|decrease|decline|falling|lose|losing)\b/, 'chart decreasing'],
  [/\b(team|people|audience|customer|customers|client|clients|user|users|follower|followers)\b/, 'busts in silhouette'],
  [/\b(idea|ideas|think|thinking|insight|learn|learning|realise|realize)\b/, 'light bulb'],
  [/\b(warning|warn|risk|mistake|mistakes|problem|wrong|fail|failure)\b/, 'warning'],
  [/\b(goal|goals|target|focus|aim)\b/, 'direct hit'],
  [/\b(build|building|make|create|creating|tool|tools|fix)\b/, 'hammer and wrench'],
  [/\b(data|metric|metrics|analytics|numbers|report|stats)\b/, 'bar chart'],
  [/\b(launch|launching|ship|shipping|start|starting|begin)\b/, 'rocket'],
  [/\b(win|winning|won|success|champion|best)\b/, 'trophy'],
  [/\b(search|find|finding|discover|research)\b/, 'magnifying glass tilted left'],
  [/\b(write|writing|note|notes|document|post|blog|copy|script)\b/, 'memo'],
  [/\b(email|emails|message|inbox|newsletter)\b/, 'envelope'],
  [/\b(phone|smartphone|mobile|iphone|android|call|calling)\b/, 'mobile phone'],
  [/\b(laptop|computer|software|app|apps|code|coding|program)\b/, 'laptop'],
  [/\b(global|world|worldwide|market|country|international)\b/, 'globe showing europe-africa'],
  [/\b(sleep|sleeping|tired|rest|burnout)\b/, 'sleeping face'],
  [/\b(food|eat|eating|meal|diet|nutrition)\b/, 'fork and knife with plate'],
  [/\b(home|house|rent|property|apartment)\b/, 'house'],
  [/\b(car|cars|drive|driving|travel|commute)\b/, 'automobile'],
  [/\b(book|books|read|reading|study|course|school)\b/, 'books'],
  [/\b(music|song|audio|sound|podcast)\b/, 'musical notes'],
  [/\b(brain|mind|mindset|psychology|mental)\b/, 'brain'],
  [/\b(fire|hot|trending|viral|blow up)\b/, 'fire'],
  [/\b(secure|security|safe|privacy|protect|protection)\b/, 'locked'],
  [/\b(access|unlock|key|keys)\b/, 'key'],
  [/\b(gym|fitness|workout|training|muscle|strong)\b/, 'flexed biceps'],
  [/\b(ai|robot|automation|bot|automated)\b/, 'robot'],
  [/\b(calendar|schedule|week|month|daily|routine)\b/, 'calendar'],
  [/\b(chart|graph|dashboard)\b/, 'bar chart'],
  [/\b(coffee|espresso|latte|caffeine)\b/, 'hot beverage'],
  [/\b(sale|sales|shop|shopping|buy|buying|store|ecommerce)\b/, 'shopping cart'],
  [/\b(idea|light)\b/, 'light bulb'],
];

async function searchIds(url: string): Promise<string[]> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) return [];
    const json = (await response.json()) as { icons?: string[] };
    return json.icons ?? [];
  } catch {
    return [];
  }
}
