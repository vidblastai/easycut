import { sanitiseSvg } from './icons';

/**
 * Turning an SVG the model drew into something the renderer can animate.
 *
 * An illustration arrives from Opus as one `<svg>` whose top-level children
 * are groups — `<g id="part-1">`, `<g id="part-2">` and so on. That structure
 * is the whole point of asking for it: a flat drawing can only fade up, but a
 * drawing in parts can ASSEMBLE, one piece every few frames, which is the
 * difference between an illustration on screen and a motion graphic.
 *
 * So this splits the parts apart here, once, at build time. The alternative —
 * handing the renderer a string and doing the surgery per frame — would run a
 * regex over a few kilobytes of markup thirty times a second, in a component
 * that already sits on the most expensive layer in the composition.
 */

export interface Illustration {
  /** The coordinate space the parts are drawn in, e.g. "0 0 1000 1000". */
  viewBox: string;
  /** Inner markup, one entry per part, in the order they should arrive. */
  parts: string[];
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
 * Read one `<svg>` into its animatable parts.
 *
 * Returns null rather than a half-usable drawing: a scene falls back to its
 * icons cleanly, and a broken illustration on a full-frame layer is much worse
 * than none.
 */
export function parseIllustration(markup: string): Illustration | null {
  const safe = sanitiseSvg(markup);
  if (!safe) return null;

  const open = safe.match(/<svg\b[^>]*>/i);
  if (!open) return null;

  const viewBox = open[0].match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1] ?? '0 0 1000 1000';
  const inner = stripExpensive(safe.slice(open[0].length, safe.lastIndexOf('</svg>')));

  const parts = splitTopLevelGroups(inner)
    .map((part) => part.trim())
    .filter((part) => part.length >= MIN_MARKUP);

  if (!parts.length) {
    // A drawing with no groups is still a drawing. It arrives in one piece
    // instead of assembling, which is a worse animation but a fine picture,
    // and refusing it would throw away most of what a model returns on a
    // first attempt.
    const whole = inner.trim();
    return whole.length >= MIN_MARKUP ? { viewBox, parts: [whole] } : null;
  }

  return { viewBox, parts: parts.slice(0, MAX_PARTS) };
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
  const total = illustration.parts.join('').length;
  const shapes = (illustration.parts.join('').match(/<(path|circle|rect|line|polyline|polygon|ellipse)\b/gi) ?? []).length;
  return total > 120 && shapes >= 3;
}
