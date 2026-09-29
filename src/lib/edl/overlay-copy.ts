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

  bloom: { label: 'Diffusion', note: 'Highlights bloom and halate, the way a mist filter does it.' },
  bokeh: { label: 'Bokeh', note: 'Out-of-focus orbs of light drifting across the shot.' },
  crt: { label: 'Old TV', note: 'Curved glass, phosphor stripe and a bloom off the tube.' },
  vhs: { label: 'VHS', note: 'A worn tape: chroma bleed, tracking, head-switch noise.' },
  super8: { label: 'Super 8', note: '8mm stock — warm and faded, with gate flicker and dust.' },
};

/**
 * Which are felt and which are seen.
 *
 * The pickers group by this rather than listing twelve in a row, because it is
 * the only distinction that helps somebody choose: the subtle ones make a
 * video look better without anybody noticing a filter was applied, and the
 * strong ones are seen. Both groups are things a person would pick on
 * purpose — visible has to mean the shot looking TREATED, never the shot
 * being replaced by the treatment.
 */
export const OVERLAY_GROUPS: ReadonlyArray<{ label: string; note: string; types: BrollOverlay[] }> = [
  {
    label: 'Subtle',
    note: 'Felt, not seen.',
    types: ['none', 'dust', 'grain', 'light-leak', 'scanlines', 'prism', 'vignette'],
  },
  {
    label: 'Strong',
    note: 'Unmistakable, and still flattering.',
    types: ['bloom', 'bokeh', 'crt', 'vhs', 'super8'],
  },
];

export const OVERLAY_LIST: readonly BrollOverlay[] = BROLL_OVERLAYS;
