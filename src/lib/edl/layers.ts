import type { Edl } from './types';

/**
 * The layers a person can decline.
 *
 * One list, used in three places that must agree: the question at upload, the
 * switches on a finished video, and the strip that applies either of them to a
 * document. They were three separate lists before, which is how "transitions"
 * came to be switchable in one of them and not the others.
 */
export const LAYER_NAMES = [
  'captions',
  'broll',
  'graphics',
  'sfx',
  'punchIns',
  'transitions',
  'music',
] as const;

export type LayerName = (typeof LAYER_NAMES)[number];

/** Everything on. */
export function allLayersOn(): Record<LayerName, boolean> {
  return Object.fromEntries(LAYER_NAMES.map((n) => [n, true])) as Record<LayerName, boolean>;
}

/** Reads a stored list of refusals, ignoring anything it does not recognise. */
export function parseLayersOff(json: string | null | undefined): LayerName[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is LayerName => LAYER_NAMES.includes(n));
  } catch {
    return [];
  }
}

/**
 * Takes the declined layers out of a document.
 *
 * Emptying the track rather than flagging it: the renderer, the editor and the
 * cost report all read the document, and a layer that is present but suppressed
 * is a layer three of them will get wrong.
 */
export function stripLayers(edl: Edl, off: readonly LayerName[]): Edl {
  if (!off.length) return edl;
  const gone = new Set<LayerName>(off);

  return {
    ...edl,
    captions: gone.has('captions') ? [] : edl.captions,
    broll: gone.has('broll') ? [] : edl.broll,
    graphics: gone.has('graphics') ? [] : edl.graphics,
    sfx: gone.has('sfx') ? [] : edl.sfx,
    punchIns: gone.has('punchIns') ? [] : edl.punchIns,
    transitions: gone.has('transitions') ? [] : edl.transitions,
    music: gone.has('music') ? null : edl.music,
  };
}
