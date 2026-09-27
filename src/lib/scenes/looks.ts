import { SCENE_LOOKS, type SceneLook } from '@/lib/edl/types';

/**
 * What a look is called and when to reach for it.
 *
 * Deliberately separate from the components in `remotion/looks/`, which is
 * where the drawing lives. The picker in the editor and the style cards need
 * the name, the blurb and the swatch, and importing the renderer to get them
 * would drag `useCurrentFrame` and the whole Remotion runtime into the browser
 * bundle for the sake of four strings.
 *
 * The renderer imports this too, so the two cannot drift.
 */
export interface LookMeta {
  id: SceneLook;
  name: string;
  /** One line, in the user's language. */
  bestFor: string;
  /** The colour the picker draws the chip in. */
  swatch: string;
  /**
   * How the scene meets the footage either side of it.
   *
   * Three of the four cut hard, and that is most of why the reference edits
   * feel edited rather than generated: a dissolve on a two-second insert
   * spends a quarter of the insert being neither thing. `archive` fades
   * because it has no hard edges anywhere else and a cut into it reads as a
   * mistake.
   */
  entry: 'cut' | 'fade';
}

export const LOOK_META: Record<SceneLook, LookMeta> = {
  studio: {
    id: 'studio',
    name: 'Studio',
    bestFor: 'Software, coaching, anything you want to look like a real product.',
    swatch: '#34D171',
    entry: 'cut',
  },
  neon: {
    id: 'neon',
    name: 'Neon',
    bestFor: 'Money, mindset and meme edits — loud, dark, built for the scroll.',
    swatch: '#B14BFF',
    entry: 'cut',
  },
  gallery: {
    id: 'gallery',
    name: 'Gallery',
    bestFor: 'Comparisons and before/after — objects arriving on a plinth.',
    swatch: '#C0A062',
    entry: 'cut',
  },
  archive: {
    id: 'archive',
    name: 'Archive',
    bestFor: 'Storytelling, history, documentary — warm, heavy, cinematic.',
    swatch: '#E0A94E',
    entry: 'fade',
  },
};

/** For the picker, in the order it should offer them. */
export const LOOK_LIST: LookMeta[] = SCENE_LOOKS.map((id) => LOOK_META[id]);
