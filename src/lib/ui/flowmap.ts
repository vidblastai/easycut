/**
 * The hero flow map: raw footage in at one edge, finished videos out at the
 * other, and us in the middle — with the footage doing the moving.
 *
 * ── Why the geometry is a module and not JSX ─────────────────────────────
 *
 * Every wire and every clip is placed from the table below, in the same
 * 2000×520 space the SVG's viewBox declares, and the container is pinned to
 * that ratio. That is the only reason a wire drawn in SVG and a card laid out
 * in HTML meet at all — there is one set of numbers and both read it. Two
 * copies would drift the first time a clip changed size.
 *
 * ── Proportions ─────────────────────────────────────────────────────────
 *
 * Measured off the reference rather than guessed: the tile is 202 across
 * (about a tenth of the width), its halo about 1.55× that, the wires run edge
 * to edge and stay flat until the last 380 units before the tile, and a clip
 * is roughly a twentieth of the width. The lanes spread across ~70% of the
 * band at the screen's edges and funnel to ~27% at the tile, which is what
 * gives the picture its shape.
 *
 * ── Filling it with real videos ─────────────────────────────────────────
 *
 * A lane takes `src` (the take going in) and `srcDone` (the cut coming out).
 * Either one plays in place of the drawn stand-in — muted, looping, inline.
 * Put the files in `public/flow/`.
 */

export const FLOW_BOX = { w: 2000, h: 520 };
/** The mark: centre, and half its width. */
export const FLOW_CORE = { x: 1000, y: 260, half: 101 };
/** How long a wire stays flat before it starts bending toward the tile. */
const BEND = 380;

/** Clip sizes, in viewBox units. Small, like the reference. */
export const FLOW_SIZE: Record<string, { w: number; h: number }> = {
  '9:16': { w: 110, h: 196 },
  '16:9': { w: 186, h: 105 },
};

/**
 * Card widths for the phone's stacked version, in px.
 *
 * The same proportions as `FLOW_SIZE`, three quarters the size — small enough
 * that two widescreen cards sit side by side on a 320px phone, and a vertical
 * one still clears the slot they share.
 */
export const FLOW_RAIL: Record<string, number> = { '9:16': 84, '16:9': 140 };

export interface FlowLane {
  /** Where the wire sits at the left edge of the screen. */
  edge: number;
  /** Where it meets the tile. */
  core: number;
  /** Where it leaves at the right edge — deliberately not the same as `edge`. */
  out: number;
  /** Omit to leave the lane empty: light runs down it instead of a clip. */
  ratio?: '9:16' | '16:9';
  /** The style the clip comes out cut in. */
  done?: string;
  /** A file under /public for the take going in, and the cut coming out. */
  src?: string | null;
  srcDone?: string | null;
}

export const FLOW_LANES: FlowLane[] = [
  { edge: 105, core: 190, out: 98, ratio: '9:16', done: 'Punchy' },
  { edge: 165, core: 218, out: 176 },
  { edge: 250, core: 244, out: 244, ratio: '16:9', done: 'Chaptered' },
  { edge: 305, core: 270, out: 298, ratio: '9:16', done: 'Reaction' },
  { edge: 395, core: 300, out: 404 },
  { edge: 462, core: 328, out: 452, ratio: '16:9', done: 'Side by side' },
];

/** One trip end to end, in seconds. Clips are spread evenly along it. */
export const FLOW_LOOP = 13;

/**
 * A wire, from one edge of the screen to the other.
 *
 * Flat for most of its run, then an S-bend into the tile, straight through
 * behind it, and back out. The straight middle is what the tile covers, so a
 * clip passing through is hidden for exactly as long as it takes to be edited
 * — which is where the raw and finished frames cross-fade.
 */
export function flowWire(lane: FlowLane): string {
  const edgeL = FLOW_CORE.x - FLOW_CORE.half;
  const edgeR = FLOW_CORE.x + FLOW_CORE.half;
  const startBend = edgeL - BEND;
  const endBend = edgeR + BEND;
  return (
    `M 0 ${lane.edge}` +
    ` L ${startBend} ${lane.edge}` +
    ` C ${startBend + BEND * 0.55} ${lane.edge}, ${edgeL - BEND * 0.55} ${lane.core}, ${edgeL} ${lane.core}` +
    ` L ${edgeR} ${lane.core}` +
    ` C ${edgeR + BEND * 0.55} ${lane.core}, ${endBend - BEND * 0.55} ${lane.out}, ${endBend} ${lane.out}` +
    ` L ${FLOW_BOX.w} ${lane.out}`
  );
}

/**
 * The lanes that carry a clip, with the delay that spreads them along the
 * loop so they arrive steadily rather than in a pack.
 */
export function flowClips(lanes: FlowLane[] = FLOW_LANES): Array<{ lane: FlowLane; delay: string }> {
  const carrying = lanes.filter((l) => l.ratio);
  const step = FLOW_LOOP / Math.max(1, carrying.length);
  return carrying.map((lane, i) => ({ lane, delay: `${(-i * step).toFixed(2)}s` }));
}
