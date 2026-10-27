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
