import { sanitiseSvg } from './icons';

/**
 * Turning an SVG the model drew into something the renderer can animate.
 *
 * An illustration arrives from Opus as one `<svg>` whose top-level children
 * are groups — `<g id="part-1">`, `<g id="part-2">` and so on. That structure
 * is the whole point of asking for it: a flat drawing can only fade up, but a
 * drawing in parts can ASSEMBLE, one piece every few frames.
 *
 * Each group also carries three hints about how it should behave, because
 * assembling on its own is not enough. The reference edits never hold still:
 * the camera keeps travelling, near things slide past far things, a clock's
 * hands turn the whole time it is on screen. A drawing that lands and then
 * sits there is a still image with a wipe on the front of it, which is exactly
 * the note this pass was rebuilt to answer.
 *
 *   data-depth  0 = far background, 1 = right in front of the lens. Drives
 *               parallax against the camera move.
 *   data-enter  how the piece arrives.
 *   data-idle   what it does for the rest of the scene, once it has arrived.
 *
 * All of it is parsed here, once, at build time. The alternative — handing the
 * renderer a string and doing the surgery per frame — would run regexes over a
 * few kilobytes of markup thirty times a second, on the most expensive layer
 * in the composition.
 */

export const ART_ENTERS = ['pop', 'rise', 'slide-left', 'slide-right', 'grow', 'draw'] as const;
export type ArtEnter = (typeof ART_ENTERS)[number];

export const ART_IDLES = ['none', 'bob', 'sway', 'spin', 'tick', 'pulse', 'drift'] as const;
export type ArtIdle = (typeof ART_IDLES)[number];

export interface ArtPart {
  markup: string;
  /**
   * Which beat of the scene this piece belongs to.
   *
   * A scene is a sequence, not a picture. The drawing is one tall canvas with
   * the beats stacked down it — beat 0 in the top 1000 units, beat 1 in the
   * next 1000 — and the camera travels down it as the voice moves on. So the
   * previous beat does not fade out, it leaves upward, which is what makes it
   * read as something happening rather than as a slide changing.
   */
  stage: number;
  /** 0 = far background, 1 = foreground. Half means "on the picture plane". */
  depth: number;
  enter: ArtEnter;
  idle: ArtIdle;
  /**
   * Whether the pivot was stated or measured.
   *
   * Only the audit cares: a measured pivot is fine for a piece that bobs, and
   * a guess for a clock hand is the difference between it turning on its pin
   * and swinging around the frame, so a rotating piece must state one.
   */
  hasPivot: boolean;
  /**
   * The point this piece turns and scales about, in viewBox units.
   *
   * Without it everything pivots on the middle of the canvas, and the effect
   * is unmistakable once you have seen it: a `spin` on a small object in the
   * corner does not turn the object, it swings the object around the drawing
   * in a wide circle. A clock's hands need their pin; a badge popping in needs
   * its own centre or it slides in from the middle of the picture.
   *
   * Defaults to the centre of the viewBox, which is right for the main subject
   * and harmless for a full-width background.
   */
  pivot: { x: number; y: number };
}

export interface Illustration {
  /** The coordinate space the parts are drawn in, e.g. "0 0 1000 3000". */
  viewBox: string;
  /** How many beats the camera travels through. At least one. */
  stages: number;
  /**
   * The drawing's gradients, kept whole.
   *
   * `<defs>` is a top-level child of the `<svg>` but it is not a `<g>`, so the
   * part splitter walked straight past it — and every `fill="url(#wall)"` in
   * the drawing then referred to nothing. It is the sort of failure that does
   * not error: the shape renders, in black or not at all, and the illustration
   * merely looks wrong.
   */
  defs: string;
  parts: ArtPart[];
}

/**
 * Parts beyond this are past the point where a viewer reads them arriving.
 *
 * Counted across the whole strip, so it has to cover every beat: three beats
 * of five pieces plus two connectors is seventeen, and a cap of fourteen
 * silently ate the last beat — which then failed the audit as "nearly empty",
 * triggered a repair, and got truncated again in exactly the same place.
 */
const MAX_PARTS = 22;

/** Beats beyond this cannot each get long enough on screen to be read. */
const MAX_STAGES = 4;

/** Below this there is no drawing, only a stray tag or two. */
const MIN_MARKUP = 24;

/**
 * Anything the browser would have to re-rasterise per frame, or fetch.
 *
 * `filter` is the one worth naming: a drop-shadow or blur filter inside a
 * moving group is exactly the per-frame readback this renderer has already
 * paid for once, in the editor, at the cost of ten frames a second. The model
 * reaches for them unprompted, so they come out here rather than in the prompt
 * where compliance is a coin flip.
 */
function stripExpensive(markup: string): string {
  return markup
    .replace(/<filter[\s\S]*?<\/filter>/gi, '')
    .replace(/\sfilter\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\sstyle\s*=\s*"[^"]*(?:filter|backdrop-filter|mix-blend-mode)[^"]*"/gi, '')
    .replace(/<image[\s\S]*?(?:\/>|<\/image>)/gi, '')
    .replace(/<text[\s\S]*?<\/text>/gi, '');
}

/**
 * Normalise every stroke in a part to a length of 1.
 *
 * `pathLength="1"` is the trick that makes a self-drawing line possible without
 * a DOM: it redefines the element's own length as 1 unit, so `stroke-dasharray="1"`
 * is exactly one full stroke and a dash offset from 1 to 0 draws it end to end.
 * Measuring the real length would mean `getTotalLength()`, which means a laid-out
 * document, which a frame-by-frame renderer does not have when it needs it.
 */
function normaliseStrokeLengths(markup: string): string {
  return markup.replace(/<(path|line|polyline|polygon|circle|ellipse|rect)\b/gi, '<$1 pathLength="1"');
}

/**
 * @param idPrefix  Namespaces every id and `url(#…)` in the drawing.
 *
 * Two scenes in one video will both call their gradient `#wall`, and the
 * renderer mounts them in one document — so without this, whichever scene
 * mounted first wins and the second one's shapes fill with the first one's
 * gradient. It is a cross-scene bug that never shows up testing one scene.
 */
export function parseIllustration(markup: string, idPrefix = ''): Illustration | null {
  const safe = sanitiseSvg(markup);
  if (!safe) return null;

  const open = safe.match(/<svg\b[^>]*>/i);
  if (!open) return null;

  const viewBox = open[0].match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1] ?? '0 0 1000 1000';
  const body = namespaceIds(
    stripExpensive(safe.slice(open[0].length, safe.lastIndexOf('</svg>'))),
    idPrefix,
  );

  // Pulled out before the split, and kept: gradients are referenced from
  // inside the parts and have to survive as a unit.
  const defs = (body.match(/<defs\b[\s\S]*?<\/defs>/gi) ?? []).join('');
  const inner = body.replace(/<defs\b[\s\S]*?<\/defs>/gi, '');

  const [vbX, vbY, vbW, vbH] = readViewBox(viewBox);
  const centre = { x: vbX + vbW / 2, y: vbY + vbH / 2 };

  const parts = splitTopLevelGroups(inner)
    .map((group) => toPart(group, centre))
    .filter((part): part is ArtPart => part !== null)
    .filter((part) => part.stage < MAX_STAGES)
    // In beat order, so the renderer can walk them without sorting per frame,
    // and so a model that lists its connectors last still animates in order.
    .sort((a, b) => a.stage - b.stage);

  if (!parts.length) {
    // A drawing with no groups is still a drawing. It arrives in one piece
    // instead of assembling, which is a worse animation but a fine picture,
    // and refusing it would throw away most of what a model returns on a
    // first attempt.
    const whole = inner.trim();
    return whole.length >= MIN_MARKUP
      ? {
          viewBox,
          defs,
          stages: 1,
          parts: [
            { markup: whole, stage: 0, depth: 0.5, enter: 'pop', idle: 'bob', hasPivot: false, pivot: centre },
          ],
        }
      : null;
  }

  const kept = trimToCap(parts);
  return { viewBox, defs, stages: kept.reduce((most, p) => Math.max(most, p.stage + 1), 1), parts: kept };
}

/** Prefix every id the drawing declares, and every reference to one. */
function namespaceIds(markup: string, prefix: string): string {
  if (!prefix) return markup;
  const safePrefix = prefix.replace(/[^A-Za-z0-9_-]/g, '');
  return markup
    .replace(/\bid\s*=\s*["']([^"']+)["']/gi, (_all, id: string) => `id="${safePrefix}-${id}"`)
    .replace(/url\(\s*#([^)\s]+)\s*\)/gi, (_all, id: string) => `url(#${safePrefix}-${id})`);
}

function toPart(group: string, centre: { x: number; y: number }): ArtPart | null {
  const body = group.trim();
  if (body.length < MIN_MARKUP) return null;

  const depth = clamp01(Number(attr(body, 'data-depth') ?? '0.5'), 0.5);
  const enter = pick(attr(body, 'data-enter'), ART_ENTERS, 'pop');
  // A stroke-only piece that says nothing about how it arrives is almost
  // always a connector — an arrow, an underline, a leader line — and drawing
  // itself is what those are for. Guessing here is worth it: the hint is the
  // attribute the model forgets most often, and a connector that pops reads as
  // a mistake where one that draws reads as intent.
  const fallbackEnter: ArtEnter = enter === 'pop' && looksLikeStroke(body) ? 'draw' : enter;
  const idle = pick(attr(body, 'data-idle'), ART_IDLES, fallbackEnter === 'draw' ? 'none' : 'bob');

  return {
    markup: fallbackEnter === 'draw' ? normaliseStrokeLengths(body) : body,
    stage: Math.max(0, Math.floor(Number(attr(body, 'data-stage') ?? '0')) || 0),
    depth,
    enter: fallbackEnter,
    idle,
    // The hint if it was given, otherwise measured off the shapes. Measuring
    // matters more than it looks: `data-pivot` is the attribute the model
    // forgets most often, and a forgotten one used to send a spinning piece
    // orbiting the whole picture.
    hasPivot: readPivot(attr(body, 'data-pivot')) !== null,
    pivot: readPivot(attr(body, 'data-pivot')) ?? estimatePivot(body) ?? centre,
  };
}

function attr(markup: string, name: string): string | null {
  // Only the group's OWN opening tag: a nested child's data-depth is not this
  // part's, and matching anywhere in the body would pick up the wrong one.
  const open = markup.match(/^<g\b[^>]*>/i)?.[0] ?? '';
  return open.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? null;
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  const found = allowed.find((option) => option === value?.trim().toLowerCase());
  return found ?? fallback;
}

function clamp01(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

/** Strokes with nothing filled: a connector rather than an object. */
function looksLikeStroke(markup: string): boolean {
  const filled = /fill\s*=\s*["'](?!none)[^"']+["']/i.test(markup);
  const stroked = /stroke\s*=\s*["'](?!none)[^"']+["']/i.test(markup);
  return stroked && !filled;
}

/** `data-pivot="640 320"`, or null when it was not given or makes no sense. */
function readPivot(value: string | null): { x: number; y: number } | null {
  const pair = (value ?? '').trim().split(/[\s,]+/).map(Number);
  if (pair.length !== 2 || pair.some((n) => !Number.isFinite(n))) return null;
  return { x: pair[0], y: pair[1] };
}

/**
 * The centre of a part, measured from its own coordinates.
 *
 * A real bounding box would need a laid-out document, which a frame-by-frame
 * renderer does not have when it needs one. This is the cheap approximation:
 * gather the coordinates the shapes are written with and take the middle of
 * their extent. Path data is read as a flat run of x,y pairs — wrong for
 * relative commands and for the radii inside an arc, but the answer only has
 * to be near the middle of the piece, and being near is the entire difference
 * between a clock hand turning on its pin and swinging around the frame.
 */
function estimatePivot(markup: string): { x: number; y: number } | null {
  const points = coordinatesOf(markup);
  if (points.length < 2) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

/**
 * Every coordinate a fragment mentions.
 *
 * A real bounding box would need a laid-out document, which a frame-by-frame
 * renderer does not have when it needs one. This is the cheap approximation:
 * gather the coordinates the shapes are written with. Path data is read as a
 * flat run of x,y pairs — wrong for relative commands and for the radii inside
 * an arc, but every caller only needs to know roughly where the piece is, and
 * roughly is the difference between a clock hand turning on its pin and
 * swinging around the frame.
 */
function coordinatesOf(markup: string): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  const push = (x: number, y: number) => {
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  };

  for (const [, cx, cy] of markup.matchAll(/<(?:circle|ellipse)\b[^>]*?\bcx="(-?[\d.]+)"[^>]*?\bcy="(-?[\d.]+)"/gi)) {
    push(Number(cx), Number(cy));
  }

  for (const tag of markup.match(/<rect\b[^>]*>/gi) ?? []) {
    const x = Number(tag.match(/\bx="(-?[\d.]+)"/)?.[1]);
    const y = Number(tag.match(/\by="(-?[\d.]+)"/)?.[1]);
    const w = Number(tag.match(/\bwidth="(-?[\d.]+)"/)?.[1] ?? 0);
    const h = Number(tag.match(/\bheight="(-?[\d.]+)"/)?.[1] ?? 0);
    push(x, y);
    push(x + w, y + h);
  }

  for (const tag of markup.match(/<line\b[^>]*>/gi) ?? []) {
    push(Number(tag.match(/\bx1="(-?[\d.]+)"/)?.[1]), Number(tag.match(/\by1="(-?[\d.]+)"/)?.[1]));
    push(Number(tag.match(/\bx2="(-?[\d.]+)"/)?.[1]), Number(tag.match(/\by2="(-?[\d.]+)"/)?.[1]));
  }

  for (const [, data] of markup.matchAll(/\b(?:d|points)="([^"]+)"/gi)) {
    const numbers = (data.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    for (let i = 0; i + 1 < numbers.length; i += 2) push(numbers[i], numbers[i + 1]);
  }

  return points;
}

function readViewBox(viewBox: string): [number, number, number, number] {
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return [0, 0, 1000, 1000];
  return parts as [number, number, number, number];
}

/**
 * The top-level `<g>` children of a fragment, with their own tags kept.
 *
 * Depth-counted rather than regex-matched because groups nest: a drawing whose
 * first part contains an inner `<g>` would otherwise be cut at that inner
 * group's closing tag, and every part after it would be off by one.
 */
function splitTopLevelGroups(inner: string): string[] {
  const groups: string[] = [];
  const tag = /<(\/?)g\b[^>]*?(\/?)>/gi;

  let depth = 0;
  let startedAt = -1;
  let match: RegExpExecArray | null;

  while ((match = tag.exec(inner))) {
    const closing = match[1] === '/';
    const selfClosing = match[2] === '/';
    if (selfClosing) continue;

    if (!closing) {
      if (depth === 0) startedAt = match.index;
      depth++;
    } else {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && startedAt >= 0) {
        groups.push(inner.slice(startedAt, match.index + match[0].length));
        startedAt = -1;
      }
    }
  }

  return groups;
}

/**
 * Is there enough here to be worth showing instead of the icons?
 *
 * One tiny rect is a failed drawing, not a minimal one, and it would take the
 * frame away from a fallback that works.
 */
export function isDrawn(illustration: Illustration | null): boolean {
  if (!illustration) return false;
  const markup = illustration.parts.map((part) => part.markup).join('');
  const shapes = (markup.match(/<(path|circle|rect|line|polyline|polygon|ellipse)\b/gi) ?? []).length;
  return markup.length > 120 && shapes >= 3;
}

/**
 * What is wrong with a drawing, in the words the model needs to fix it.
 *
 * "Render the icons before, so they actually make sense" — the note that
 * prompted this. We cannot look at the picture, but most of what goes wrong is
 * structural and IS visible from the markup: a hand that spins without a
 * pivot, a beat drawn in the wrong band, a composition that occupies a corner.
 * Each of these has a matching symptom on screen, and every one of them has
 * shipped at least once.
 *
 * Returns an empty list when the drawing is sound. Anything it does return is
 * fed straight back to the model as a repair brief, so the wording is aimed at
 * the model rather than at a log reader.
 */
export function auditIllustration(art: Illustration, expectedStages: number): string[] {
  const problems: string[] = [];
  const [, , width, height] = readViewBox(art.viewBox);
  const band = height / Math.max(1, art.stages);

  if (art.stages < 2 && expectedStages >= 2) {
    problems.push(
      `The drawing has only one beat. It needs ${expectedStages}: a tall canvas with each beat in its own ${width}-unit square, and data-stage set on every group.`,
    );
  }

  if (art.stages > 1 && band < width * 0.55) {
    problems.push(
      `The canvas is ${width}x${height} but claims ${art.stages} beats, which leaves each beat a letterbox slot. Height must be ${width} per beat.`,
    );
  }

  for (const [stage, parts] of groupByStage(art.parts)) {
    const box = extentOf(parts);
    if (!box) continue;

    const top = stage * band;
    if (box.minY < top - band * 0.15 || box.maxY > top + band * 1.15) {
      problems.push(
        `Beat ${stage} is drawn at y ${Math.round(box.minY)}–${Math.round(box.maxY)}, outside its own band (${Math.round(top)}–${Math.round(top + band)}). Every shape of a beat belongs inside its square.`,
      );
    }

    /*
     * An empty beat.
     *
     * The one that got through: a three-beat strip whose last beat held only
     * the backdrop and a plinth, so the camera panned down to an empty room
     * and sat there. It passes every other check — the backdrop spans the full
     * width, the coordinates are in the right band — which is why the count has
     * to be of the beat's OWN shapes.
     */
    const drawn = parts
      .filter((part) => part.depth > 0.15)
      .map((part) => part.markup)
      .join('');
    const shapesHere = (drawn.match(/<(path|circle|rect|line|polyline|polygon|ellipse)\b/gi) ?? []).length;
    // Counted in shapes rather than in groups: a beat can legitimately be two
    // well-drawn pieces, and it can just as easily be six empty ones.
    if (shapesHere < 10) {
      problems.push(
        `Beat ${stage} is nearly empty — only ${shapesHere} shapes in front of the backdrop. The camera pans down to it and finds an empty room. Every beat needs its own subject, drawn properly.`,
      );
      continue;
    }

    if (box.maxX - box.minX < width * 0.55) {
      problems.push(
        `Beat ${stage} only spans ${Math.round(box.maxX - box.minX)} of ${width} units across. It is shown full-screen, so it has to fill the square — at least 800 wide.`,
      );
    }
  }

  const unpinned = art.parts.filter(
    (part) => (part.idle === 'spin' || part.idle === 'tick' || part.idle === 'sway') && !part.hasPivot,
  );
  if (unpinned.length) {
    problems.push(
      `${unpinned.length} group${unpinned.length === 1 ? '' : 's'} rotate (spin/tick/sway) without a data-pivot. A hand or gear with no pivot swings around the frame instead of turning on the spot — give each one the exact point it turns about.`,
    );
  }

  if (!art.parts.some((part) => part.enter === 'draw') && art.stages > 1) {
    problems.push('There is no connector. Each beat needs a dashed arrow leading down into the next, with data-enter="draw" and fill="none".');
  }

  const shapes = (art.parts.map((p) => p.markup).join('').match(/<(path|circle|rect|line|polyline|polygon|ellipse)\b/gi) ?? []).length;
  if (shapes < 34) {
    problems.push(`Only ${shapes} shapes in the whole strip. It reads as clipart — build the objects properly, 50 or more.`);
  }

  return problems;
}

/**
 * Drop parts down to the cap, taking them from the busiest beat.
 *
 * `slice(0, cap)` takes them all off the END of the strip, which is the worst
 * possible place: the last beat loses its subject and the camera pans down to
 * an empty room. Trimming the fullest beat instead keeps every beat drawn.
 */
function trimToCap(parts: ArtPart[]): ArtPart[] {
  if (parts.length <= MAX_PARTS) return parts;

  const kept = [...parts];
  while (kept.length > MAX_PARTS) {
    const counts = new Map<number, number>();
    for (const part of kept) counts.set(part.stage, (counts.get(part.stage) ?? 0) + 1);
    const fullest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // The last piece of that beat: the earlier ones establish it, and a
    // connector is never the last piece of a beat it leads from.
    const index = kept.map((part) => part.stage).lastIndexOf(fullest);
    kept.splice(index, 1);
  }
  return kept;
}

function groupByStage(parts: ArtPart[]): Array<[number, ArtPart[]]> {
  const byStage = new Map<number, ArtPart[]>();
  for (const part of parts) {
    const list = byStage.get(part.stage) ?? [];
    list.push(part);
    byStage.set(part.stage, list);
  }
  return [...byStage.entries()].sort((a, b) => a[0] - b[0]);
}

/** The bounding box of some parts, from the same coordinate scan as the pivot. */
function extentOf(parts: ArtPart[]): { minX: number; maxX: number; minY: number; maxY: number } | null {
  const points = parts.flatMap((part) => coordinatesOf(part.markup));
  if (points.length < 2) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
