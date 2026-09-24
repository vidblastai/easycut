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

export const FLOW_BOX = { w: 1000, h: 480 };
/** Half the core tile, in viewBox units — where a wire has to stop. */
export const FLOW_CORE = { x: 500, y: 240, half: 70 };

/**
 * The label strip under a card's picture.
 *
 * Part of the card's height, and forgetting that is what had the first
 * version's cards sitting on each other. It is used for SPACING only: a wire
 * meets the middle of the picture, which is a number this file knows exactly,
 * never the middle of the card, whose real height depends on font metrics.
 */
const META_H = 22;

export const FLOW_SIZE: Record<string, { w: number; h: number }> = {
  '9:16': { w: 104, h: 185 },
  '16:9': { w: 176, h: 99 },
};

export interface FlowSpec {
  side: 'in' | 'out';
  /**
   * Which column this card belongs to.
   *
   * The two verticals stack in an INNER column near the core; the widescreen
   * one sits further OUT, vertically centred, in the space beside them. Three
   * portrait cards in a single column is 600 units tall whatever you do to
   * them, and this graphic has to finish above the fold on a laptop.
   */
  slot: 'inner' | 'outer';
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

/*
 * Three a side: two shorts and one long-form, so both formats are on screen
 * without the column turning into a list.
 *
 * Entries pair up by position — the first `in` becomes the first `out`, and
 * that pairing is the journey a travelling clip makes.
 */
export const FLOW_SPECS: FlowSpec[] = [
  { side: 'in', slot: 'inner', x: 300, ratio: '9:16', kind: 'Raw', len: '3:42', src: null },
  { side: 'in', slot: 'outer', x: 122, ratio: '16:9', kind: 'Raw', len: '18:05', src: null },
  { side: 'in', slot: 'inner', x: 300, ratio: '9:16', kind: 'Raw', len: '0:58', src: null },
  { side: 'out', slot: 'inner', x: 700, ratio: '9:16', kind: 'Punchy', len: '0:38', src: null },
  { side: 'out', slot: 'outer', x: 878, ratio: '16:9', kind: 'Chaptered', len: '11:40', src: null },
  { side: 'out', slot: 'inner', x: 700, ratio: '9:16', kind: 'Reaction', len: '0:47', src: null },
];

const LANES = [-38, 0, 38];
const GAP = 34;
/** How far the control points are pulled sideways, flattening the approach. */
const REACH = 190;

/** Keeps a card inside the box however its x was written. */
function clampX(left: number, width: number): number {
  const margin = 10;
  return Math.max(margin, Math.min(FLOW_BOX.w - width - margin, left));
}

/** Stacks each side and works out where every card and wire end belongs. */
export function layOutFlow(specs: FlowSpec[] = FLOW_SPECS): FlowNode[] {
  const nodes: FlowNode[] = [];

  const place = (spec: FlowSpec, top: number, lane: number): FlowNode => {
    const size = FLOW_SIZE[spec.ratio];
    const left = clampX(spec.x - size.w / 2, size.w);
    return {
      ...spec,
      left,
      top,
      wireX: left + size.w / 2,
      // The middle of the PICTURE. The label strip hangs below it and is not
      // part of the frame a wire should meet.
      wireY: top + size.h / 2,
      lane,
    };
  };

  for (const side of ['in', 'out'] as const) {
    const column = specs.filter((s) => s.side === side);
    const laneOf = (spec: FlowSpec) => LANES[column.indexOf(spec) % LANES.length];

    const inner = column.filter((s) => s.slot === 'inner');
    const total =
      inner.reduce((sum, s) => sum + FLOW_SIZE[s.ratio].h + META_H, 0) + GAP * (inner.length - 1);
    let y = (FLOW_BOX.h - total) / 2;
    for (const spec of inner) {
      nodes.push(place(spec, y, laneOf(spec)));
      y += FLOW_SIZE[spec.ratio].h + META_H + GAP;
    }

    for (const spec of column.filter((s) => s.slot === 'outer')) {
      nodes.push(place(spec, (FLOW_BOX.h - (FLOW_SIZE[spec.ratio].h + META_H)) / 2, laneOf(spec)));
    }
  }

  return nodes;
}

/** The pairs: the first card in is the first card out, and so on. */
export function flowPairs(nodes: FlowNode[]): Array<[FlowNode, FlowNode]> {
  const going = FLOW_SPECS.filter((s) => s.side === 'in')
    .map((s) => nodes.find((n) => n.side === 'in' && n.x === s.x && n.len === s.len)!);
  const coming = FLOW_SPECS.filter((s) => s.side === 'out')
    .map((s) => nodes.find((n) => n.side === 'out' && n.x === s.x && n.len === s.len)!);
  return going.map((from, i) => [from, coming[i]] as [FlowNode, FlowNode]).filter(([a, z]) => a && z);
}

/**
 * One continuous path from a raw card, through the core, to the finished one.
 *
 * Drawn as the wire AND used as the track a travelling clip rides, so the clip
 * cannot take a route the picture does not show. It passes behind the core
 * tile, which is opaque and sits above it.
 */
export function flowJourney(from: FlowNode, to: FlowNode): string {
  const edgeL = FLOW_CORE.x - FLOW_CORE.half;
  const edgeR = FLOW_CORE.x + FLOW_CORE.half;
  const yIn = FLOW_CORE.y + from.lane;
  const yOut = FLOW_CORE.y + to.lane;
  return (
    `M ${from.wireX} ${from.wireY}` +
    ` C ${from.wireX + REACH} ${from.wireY}, ${edgeL - REACH} ${yIn}, ${edgeL} ${yIn}` +
    ` L ${edgeR} ${yOut}` +
    ` C ${edgeR + REACH} ${yOut}, ${to.wireX - REACH} ${to.wireY}, ${to.wireX} ${to.wireY}`
  );
}

/** The two ends of the core a pair's wire touches, for the join dots. */
export function flowCoreJoins(from: FlowNode, to: FlowNode) {
  return [
    { x: FLOW_CORE.x - FLOW_CORE.half, y: FLOW_CORE.y + from.lane },
    { x: FLOW_CORE.x + FLOW_CORE.half, y: FLOW_CORE.y + to.lane },
  ];
}

/**
 * The clip that makes the journey, drawn twice.
 *
 * `raw` and `done` are the same shape with different treatment, stacked and
 * cross-faded at the halfway point — which is the core. So a clip visibly goes
 * in plain and comes out captioned, rather than a dot sliding along a line.
 */
export function flowChipGeometry(ratio: string) {
  const vertical = ratio === '9:16';
  const w = vertical ? 38 : 66;
  const h = vertical ? 67 : 37;
  const headR = vertical ? 6.2 : 5.4;
  const headY = -h / 2 + h * (vertical ? 0.3 : 0.32);
  return {
    w,
    h,
    x: -w / 2,
    y: -h / 2,
    headR,
    headY,
    bodyW: w * 0.52,
    bodyH: h * (vertical ? 0.34 : 0.3),
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
