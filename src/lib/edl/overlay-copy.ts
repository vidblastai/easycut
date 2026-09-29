import { BROLL_OVERLAYS, type BrollOverlay } from './types';

/**
 * What each B-roll treatment is called, and what it does.
 *
 * The note matters more than the name here. "Prism" and "scanlines" mean
 * nothing until you have seen them, and the whole failure mode of a list like
 * this is somebody picking one they have never watched and finding out after a
 * render — the same reason the transition list carries a sentence each.
 */
export const OVERLAY_COPY: Record<BrollOverlay, { label: string; note: string }> = {
  none: { label: 'None', note: 'The insert as it was shot.' },
  dust: { label: 'Dust', note: 'Specks drifting through the light, in and out of focus.' },
  grain: { label: 'Film grain', note: '16mm texture over the whole frame.' },
  'light-leak': { label: 'Light leak', note: 'A warm bloom crossing once, over the insert’s life.' },
  scanlines: { label: 'Scanlines', note: 'CRT line structure, a rolling band and a phosphor tint.' },
  prism: { label: 'Prism', note: 'Chromatic fringe at the edges, the way a fast lens disperses.' },
  vignette: { label: 'Vignette', note: 'Corners down. The quiet one.' },

  bokeh: { label: 'Bokeh', note: 'Big out-of-focus orbs of light drifting across.' },
  vhs: { label: 'VHS', note: 'Tracking tears, chroma bleed and a picture that will not hold.' },
  datamosh: { label: 'Datamosh', note: 'Hard bands of inverted colour, re-rolled every frame.' },
  duotone: { label: 'Duotone', note: 'The whole insert in two colours, keyed to your accent.' },
  halftone: { label: 'Halftone', note: 'Print dots, like a newspaper blown up.' },
};

/**
 * Which are felt and which are seen.
 *
 * The pickers group by this rather than listing twelve in a row, because it is
 * the only distinction that helps somebody choose: the quiet ones make a video
 * look better without anybody noticing a filter was applied, and the loud ones
 * are a statement. Mixing the two on one video is usually a mistake.
 */
export const OVERLAY_GROUPS: ReadonlyArray<{ label: string; note: string; types: BrollOverlay[] }> = [
  {
    label: 'Subtle',
    note: 'Felt, not seen.',
    types: ['none', 'dust', 'grain', 'light-leak', 'scanlines', 'prism', 'vignette'],
  },
  {
    label: 'Loud',
    note: 'Meant to be noticed.',
    types: ['bokeh', 'vhs', 'datamosh', 'duotone', 'halftone'],
  },
];

export const OVERLAY_LIST: readonly BrollOverlay[] = BROLL_OVERLAYS;
