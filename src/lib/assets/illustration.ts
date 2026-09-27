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

export const ART_IDLES = ['none', 'bob', 'sway', 'spin', 'pulse', 'drift'] as const;
export type ArtIdle = (typeof ART_IDLES)[number];

export interface ArtPart {
  markup: string;
  /** 0 = far background, 1 = foreground. Half means "on the picture plane". */
  depth: number;
  enter: ArtEnter;
  idle: ArtIdle;
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
  /** The coordinate space the parts are drawn in, e.g. "0 0 1000 1000". */
  viewBox: string;
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

/** Parts beyond this are past the point where a viewer reads them arriving. */
const MAX_PARTS = 8;

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
    .filter((part): part is ArtPart => part !== null);

  if (!parts.length) {
    // A drawing with no groups is still a drawing. It arrives in one piece
    // instead of assembling, which is a worse animation but a fine picture,
    // and refusing it would throw away most of what a model returns on a
    // first attempt.
    const whole = inner.trim();
    return whole.length >= MIN_MARKUP
      ? { viewBox, defs, parts: [{ markup: whole, depth: 0.5, enter: 'pop', idle: 'bob', pivot: centre }] }
      : null;
  }

  return { viewBox, defs, parts: parts.slice(0, MAX_PARTS) };
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
    depth,
    enter: fallbackEnter,
    idle,
    // The hint if it was given, otherwise measured off the shapes. Measuring
    // matters more than it looks: `data-pivot` is the attribute the model
    // forgets most often, and a forgotten one used to send a spinning piece
    // orbiting the whole picture.
    pivot: readPivot(attr(body, 'data-pivot')) ?? estimatePivot(body) ?? centre,
  };
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
  const xs: number[] = [];
  const ys: number[] = [];

  const push = (x: number, y: number) => {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x);
      ys.push(y);
    }
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

  if (xs.length < 2) return null;
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

function readViewBox(viewBox: string): [number, number, number, number] {
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return [0, 0, 1000, 1000];
  return parts as [number, number, number, number];
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
