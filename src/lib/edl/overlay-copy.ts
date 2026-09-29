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
};

export const OVERLAY_LIST: readonly BrollOverlay[] = BROLL_OVERLAYS;
