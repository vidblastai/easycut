import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SceneLook } from '@/lib/edl/types';

/**
 * The bar a written scene is held to, shown to the composer as an example.
 *
 * One hand-made scene per look, in `references/<look>.txt`, each written to
 * its own line and checked frame by frame before it went in: one big subject
 * in the middle, drawn in the look's own technique, landing on its words,
 * becoming the next beat rather than cutting to it, alive to the last frame.
 * Showing Opus the scene in the SAME look it is about to draw teaches the
 * technique as well as the craft — a riso scene overprints its inks, a pixel
 * scene moves in steps — which a description alone never quite did.
 *
 * `science` is the neurons fixture with its old starfield and planet taken
 * out: an example teaches its props as surely as its craft. Looks without a
 * reference of their own borrow it.
 *
 * Read from disk rather than bundled into a string: they are tens of
 * kilobytes of markup each, and as files they can be opened, rendered and
 * edited like any other fixture (`scripts/hyperframe-scene.ts --fixture`).
 */

export interface Reference {
  look: SceneLook;
  line: string;
  scene: string;
}

/** What each reference was written to say. */
export const REFERENCE_LINES: Partial<Record<SceneLook, string>> = {
  science: 'Your brain has eighty six billion neurons, and every single thought is a storm of electricity.',
  paper: 'A single bee visits about five thousand flowers a day, and every trip makes the honey a little sweeter.',
  ink: 'Most great ideas start as a bad sketch on a napkin, so stop waiting for the perfect one.',
  blueprint: 'A bicycle wheel stays strong because thirty six thin spokes pull on the rim from every side.',
  riso: 'Coffee hits your brain in ten minutes, but the crash comes back an hour later, every single time.',
  pixel: 'Save a little every week, and in a year your piggy bank levels up like a game character.',
  chalk: 'Photosynthesis is simple: the leaf takes in sunlight, water and air, and turns them into sugar.',
  scope: 'Your heart beats about a hundred thousand times a day, and every beat is a tiny spike of electricity.',
  graph: 'Compound interest is slow at first, then the curve bends upward and your money starts growing on its own.',
  glass: 'Your phone unlocks in under a second by mapping thirty thousand invisible dots across your face.',
  clay: 'A seed needs only water, warmth and time, and then it pushes up through the soil toward the light.',
  poster: 'Three habits changed everything: wake up early, move your body, and finish one hard task before lunch.',
  diorama: 'In Lisbon, a tiny yellow tram climbs the steepest hill in the city every twelve minutes.',
  pencil: 'Every night the old lighthouse keeper climbs ninety nine steps to switch on the light for the ships.',
  morph: 'One tap to sign up, two seconds to load, and your first order is already on its way.',
  chrome: 'It all starts with a single drop, then the beat hits and a million people press play.',
  mono: 'Cut the noise, keep one idea, and give it room to breathe.',
  particles: 'Every atom in your body was forged inside a star that exploded billions of years ago.',
  sticker: 'My morning routine is simple: coffee first, a ten minute walk, and only then I open my emails.',
  retro: 'In nineteen eighty five, a home computer had less memory than one photo on your phone today.',
};

export function referencePath(look: SceneLook): string {
  return join(process.cwd(), 'src/lib/director/references', `${look}.txt`);
}

const cache = new Map<SceneLook, Reference>();

/** The look's own reference, or the science one for a look without one. */
export function referenceFor(look: SceneLook): Reference {
  const own = REFERENCE_LINES[look] && existsSync(referencePath(look)) ? look : 'science';
  const cached = cache.get(own);
  if (cached) return cached;
  const reference = { look: own, line: REFERENCE_LINES[own]!, scene: readFileSync(referencePath(own), 'utf8').trim() };
  cache.set(own, reference);
  return reference;
}

/**
 * How a shot uses the screen. A hero is one subject that transforms; the rest
 * spread over the whole safe area — see the layout list in the composer's
 * prompt, which this mirrors.
 */
export type Layout = 'hero' | 'stack' | 'path' | 'split' | 'grid';

/** What each layout reference was written to say, and in which look. */
export const LAYOUT_REFERENCES: Record<Exclude<Layout, 'hero'>, { line: string; look: SceneLook }> = {
  stack: { look: 'sticker', line: 'My morning routine is simple: coffee first, a ten minute walk, and only then I open my emails.' },
  path: { look: 'paper', line: 'Your parcel leaves the warehouse at night, crosses three cities, and lands on your doorstep by breakfast.' },
  split: { look: 'glass', line: "Editing used to eat your whole weekend, now it's done before your coffee gets cold." },
  grid: { look: 'poster', line: 'Out of every ten people who try it, nine come back the very next day.' },
};

/**
 * The layout a line most likely wants, from its shape alone.
 *
 * A suggestion, not a ruling — the composer is told it may pick another — but
 * left to itself the model draws one centred subject for everything, so it
 * needs to be shown the alternative that fits. Checked in order: a contrast
 * reads as a split, a share of a crowd as a grid, a journey as a path, a list
 * as a stack.
 */
export function suggestLayout(line: string): Layout {
  const l = ` ${line.toLowerCase()} `;
  const contrast = /\b(used to|before|versus|vs|instead of|compared to|than)\b/.test(l) && /\b(now|today|than|instead|after)\b/.test(l);
  if (contrast) return 'split';
  if (/\b(out of|one in|in every|percent)\b|%/.test(l)) return 'grid';
  if (/\b(leaves?|travels?|crosses|journey|from .+ to|on its way|arrives?|lands?|reaches)\b/.test(l) && /\b(then|and|to|by)\b/.test(l)) return 'path';
  const commas = (line.match(/,/g) ?? []).length;
  if (commas >= 2 || /\bfirst\b.*\bthen\b/.test(l) || /\b(two|three|four|five) (things|habits|steps|ways|tips|rules|reasons)\b/.test(l)) return 'stack';
  return 'hero';
}

export function layoutPath(layout: Exclude<Layout, 'hero'>): string {
  return join(process.cwd(), 'src/lib/director/references/layouts', `${layout}.txt`);
}

const layoutCache = new Map<Layout, string>();

/** The scene that shows a layout, or null for a hero — the look's own reference already is one. */
export function layoutReferenceFor(layout: Layout): { layout: Layout; line: string; look: SceneLook; scene: string } | null {
  if (layout === 'hero') return null;
  const meta = LAYOUT_REFERENCES[layout];
  if (!layoutCache.has(layout)) layoutCache.set(layout, readFileSync(layoutPath(layout), 'utf8').trim());
  return { layout, ...meta, scene: layoutCache.get(layout)! };
}
