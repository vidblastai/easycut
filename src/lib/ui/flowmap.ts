import type { Aspect } from '@/lib/edl/types';

/**
 * The hero's flow map: raw footage in on one side, finished videos out on the
 * other, and us in the middle.
 *
 * ── Why the geometry is a module and not JSX ─────────────────────────────
 *
 * Every wire and every card is placed from the table below, in the same
 * 1200×790 space the SVG's viewBox declares, and the container is pinned to
 * that aspect ratio. That is the only reason a card positioned with CSS
 * percentages and a curve drawn in SVG user units meet at all — there is one
 * set of numbers, and both read it. Two copies of these coordinates would
 * drift the first time a card changed size.
 *
 * Positions are computed rather than typed for the same reason: the column is
 * stacked by `layOutFlow`, so adding a card or changing a format moves
 * everything below it instead of quietly landing one card on top of another.
 *
 * ── Filling it with real videos ──────────────────────────────────────────
 *
 * Give an entry a `src` and the card plays that file instead of the drawn
 * placeholder — muted, looping, inline, the way every feed has taught people
 * a silent tile behaves. Put the files in `public/flow/`.
 */

export const FLOW_BOX = { w: 1200, h: 790 };
/** Half the core tile, in viewBox units — where a wire has to stop. */
export const FLOW_CORE = { x: 600, y: 395, half: 104 };

/**
 * The label strip under a card's picture.
 *
 * Part of the card's height, and forgetting that is what had the first
 * version's cards sitting on each other. It is used for SPACING only: a wire
 * meets the middle of the picture, which is a number this file knows exactly,
 * never the middle of the card, whose real height depends on font metrics.
 */
const META_H = 24;

export const FLOW_SIZE: Record<string, { w: number; h: number }> = {
  '9:16': { w: 132, h: 234 },
  '16:9': { w: 220, h: 124 },
};

export interface FlowSpec {
  side: 'in' | 'out';
  /** Where the column sits horizontally; staggered so it reads as scattered. */
  x: number;
  ratio: Extract<Aspect, '9:16' | '16:9'>;
  /** "Raw" going in; the style it was cut in coming out. */
  kind: string;
  len: string;
  /** A file under /public, or null for the drawn placeholder. */
  src?: string | null;
}

export interface FlowNode extends FlowSpec {
  /** The card's top-left, in viewBox units. */
  left: number;
  top: number;
  /** The middle of the PICTURE — where a wire should meet this card. */
  wireX: number;
  wireY: number;
  /** Where this wire lands on the core, so several do not meet at one pixel. */
  lane: number;
}

/* Three a side: two shorts and one long-form, so both formats are on screen
   without the column turning into a list. */
export const FLOW_SPECS: FlowSpec[] = [
  { side: 'in', x: 168, ratio: '9:16', kind: 'Raw', len: '3:42', src: null },
  { side: 'in', x: 126, ratio: '16:9', kind: 'Raw', len: '18:05', src: null },
  { side: 'in', x: 178, ratio: '9:16', kind: 'Raw', len: '41:27', src: null },
  { side: 'out', x: 1032, ratio: '9:16', kind: 'Punchy', len: '0:38', src: null },
  { side: 'out', x: 1074, ratio: '16:9', kind: 'Chaptered', len: '11:40', src: null },
  { side: 'out', x: 1022, ratio: '9:16', kind: 'Reaction', len: '0:47', src: null },
];

const LANES = [-46, 0, 46];
const GAP = 30;

/** Keeps a card inside the box however its x was written. */
function clampX(left: number, width: number): number {
  const margin = 10;
  return Math.max(margin, Math.min(FLOW_BOX.w - width - margin, left));
}

/** Stacks each side and works out where every card and wire end belongs. */
export function layOutFlow(specs: FlowSpec[] = FLOW_SPECS): FlowNode[] {
  const nodes: FlowNode[] = [];

  for (const side of ['in', 'out'] as const) {
    const column = specs.filter((s) => s.side === side);
    const total =
      column.reduce((sum, s) => sum + FLOW_SIZE[s.ratio].h + META_H, 0) + GAP * (column.length - 1);
    let y = (FLOW_BOX.h - total) / 2;

    column.forEach((spec, i) => {
      const size = FLOW_SIZE[spec.ratio];
      const left = clampX(spec.x - size.w / 2, size.w);
      nodes.push({
        ...spec,
        left,
        top: y,
        wireX: left + size.w / 2,
        wireY: y + size.h / 2,
        lane: LANES[i % LANES.length],
      });
      y += size.h + META_H + GAP;
    });
  }

  return nodes;
}

/**
 * The curve from a card to the core.
 *
 * The control points are pulled horizontally, which gives the wire its flat
 * approach and stops it arriving at the core on a diagonal.
 */
export function flowWirePath(node: FlowNode): string {
  const into = node.side === 'in';
  const edgeX = FLOW_CORE.x + (into ? -FLOW_CORE.half : FLOW_CORE.half);
  const edgeY = FLOW_CORE.y + node.lane;
  const reach = into ? 250 : -250;
  return `M ${node.wireX} ${node.wireY} C ${node.wireX + reach} ${node.wireY}, ${edgeX - reach} ${edgeY}, ${edgeX} ${edgeY}`;
}

/** Where a wire meets the core, for the little join dot. */
export function flowCoreJoin(node: FlowNode): { x: number; y: number } {
  return {
    x: FLOW_CORE.x + (node.side === 'in' ? -FLOW_CORE.half : FLOW_CORE.half),
    y: FLOW_CORE.y + node.lane,
  };
}

/**
 * A card's box, as custom properties rather than as `width`/`left`/`top`.
 *
 * Inline styles beat every class, so setting the position directly would keep
 * the absolute layout on a phone too — where the cards are meant to be plain
 * grid items, and a 9% width turns each one into a sliver. As variables they
 * are inert until a rule asks for them, and only the wide breakpoint does.
 */
export function flowCardVars(node: FlowNode): Record<string, string> {
  const size = FLOW_SIZE[node.ratio];
  return {
    '--fm-w': `${((size.w / FLOW_BOX.w) * 100).toFixed(3)}%`,
    '--fm-x': `${((node.left / FLOW_BOX.w) * 100).toFixed(3)}%`,
    '--fm-y': `${((node.top / FLOW_BOX.h) * 100).toFixed(3)}%`,
  };
}
