import React from 'react';
import type { AnimatedScene } from '../../src/lib/edl/types';
import type { LookMeta } from '../../src/lib/scenes/looks';

/**
 * What a look has to supply.
 *
 * The split this file exists to hold: a SCENE KIND decides what is on screen
 * and where — one phrase, one figure, parts around a centre — and a LOOK
 * decides what any of those things are made of and how they arrive. A kind
 * draws nothing. It arranges four slots, and every look fills all four.
 *
 * Without that split, four looks times six kinds is twenty-four bespoke
 * layouts, which is how a renderer like this one stops being maintainable
 * after the second style anybody asks for. With it, a new look is four small
 * components and an entry in `index.ts`.
 */

export interface LookContext {
  scene: AnimatedScene;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  /** A thousandth of the frame height. Every size below is written in these so
   *  a look composes identically at 1080x1920 and 1920x1080. */
  unit: number;
}

/** How the parts of a group are laid out. The kind picks; the look obeys. */
export type Arrange = 'ring' | 'row' | 'column' | 'duo' | 'plinth';

export interface TitleProps {
  ctx: LookContext;
  text: string;
  /** Frame this starts on, relative to the scene. */
  at: number;
  /** The phrase IS the scene, rather than labelling something under it. */
  hero?: boolean;
}

export interface FigureProps {
  ctx: LookContext;
  /** The figure as written — "95%", "63K", "$1.2M". Counted up, unit pinned. */
  value: string;
  label: string;
  at: number;
}

export interface GroupProps {
  ctx: LookContext;
  items: string[];
  icons: Array<string | null>;
  arrange: Arrange;
  at: number;
}

/**
 * A look: its name and blurb from `src/lib/scenes/looks.ts`, its drawing here.
 *
 * The metadata lives in `src` rather than here because the editor's picker
 * needs the name, the blurb and the swatch, and importing this file to get
 * them would pull `useCurrentFrame` and the whole Remotion runtime into the
 * browser bundle for the sake of four strings.
 */
export interface Look extends LookMeta {
  Ground: React.FC<{ ctx: LookContext }>;
  Title: React.FC<TitleProps>;
  Figure: React.FC<FigureProps>;
  Group: React.FC<GroupProps>;
  Rows: React.FC<{ ctx: LookContext; items: string[]; icons: Array<string | null>; at: number }>;
}

/**
 * An icon, drawn from markup we already hold.
 *
 * `dangerouslySetInnerHTML` is the point rather than a shortcut: the markup was
 * fetched and stripped of everything executable in `assets/icons.ts` before it
 * reached the document, and inlining it means the renderer never has to load or
 * decode an image — which is the one thing that reliably kills a frame in
 * headless Chromium.
 */
export const Glyph: React.FC<{ svg: string | null; size: number; color: string }> = ({ svg, size, color }) => {
  if (!svg) {
    /*
     * No icon is a normal state, not an error: the icon pass is allowed to
     * come back empty and a scene has to read without it. So the placeholder
     * is a small dot that sits inside the space an icon would have taken,
     * rather than a disc filling it — a full-size blob is the thing that makes
     * an iconless scene look broken instead of plain.
     */
    return (
      <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: size * 0.34, height: size * 0.34, borderRadius: '50%', background: color, opacity: 0.55 }} />
      </div>
    );
  }
  return (
    <div
      style={{ width: size, height: size, color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      dangerouslySetInnerHTML={{ __html: svg.replace('<svg', '<svg width="100%" height="100%"') }}
    />
  );
};

/** Split a phrase into the groups it should arrive in — never letter by letter. */
export function wordGroups(text: string, perGroup = 1): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (perGroup <= 1) return words;
  const out: string[] = [];
  for (let i = 0; i < words.length; i += perGroup) out.push(words.slice(i, i + perGroup).join(' '));
  return out;
}

/**
 * How wide the ring may be.
 *
 * A fixed radius is how "B-roll" ends up half off the right edge of a 1080
 * frame: the satellites sit AT the radius and their labels run wider still.
 * So the radius is capped against the frame with room for a label either side.
 */
export function ringRadius(ctx: { width: number; unit: number }, want: number): number {
  // Wide enough that the satellites clear the centre, narrow enough that their
  // labels stay on the frame. A satellite is about 100 units across, so half
  // of one plus a margin is what has to be kept back from each edge.
  return Math.max(ctx.unit * 190, Math.min(want, ctx.width * 0.5 - ctx.unit * 70));
}

/** Positions on a circle, starting at the top and going clockwise. */
export function ringPoints(count: number, radius: number): Array<{ x: number; y: number }> {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}
