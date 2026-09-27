// A relative import, not the `@/` alias: this module is pulled in by the
// Remotion bundle as well as by Next, and Remotion's webpack config does not
// carry the alias. With `@/` here the whole composition fails to bundle, which
// shows up as a still sheet that silently renders nothing new.
import { SCENE_LOOKS, type SceneLook } from '../edl/types';
import { STYLE_GUIDES } from './style-guides';

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
  /**
   * The colour the picker draws the chip in.
   *
   * Taken from the style guide rather than written here, because it was
   * written here and drifted: the picker showed `studio` as green while the
   * drawing prompt was told the accent was violet. One number, one place.
   */
  swatch: string;
  /**
   * Type colours, for captions drawn outside the look's own components.
   *
   * A scene the model illustrated puts its labels under the picture rather
   * than through a slot, and it still has to be in the world's ink — white
   * text on the gallery's white fog is the obvious failure, and it is not one
   * the look would ever make about itself.
   */
  ink: string;
  dim: string;
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

const NAMED: Record<SceneLook, Omit<LookMeta, 'swatch'>> = {
  studio: {
    id: 'studio',
    name: 'Studio',
    ink: '#0D0D10',
    dim: '#8A8A96',
    bestFor: 'Software, coaching, anything you want to look like a real product.',
    entry: 'cut',
  },
  neon: {
    id: 'neon',
    name: 'Neon',
    ink: '#FFFFFF',
    dim: '#9AA3C4',
    bestFor: 'Money, mindset and meme edits — loud, dark, built for the scroll.',
    entry: 'cut',
  },
  gallery: {
    id: 'gallery',
    name: 'Gallery',
    ink: '#22222A',
    dim: '#7C7C88',
    bestFor: 'Comparisons and before/after — objects arriving on a plinth.',
    entry: 'cut',
  },
  editorial: {
    id: 'editorial',
    name: 'Editorial',
    ink: '#F5F2F7',
    dim: '#BEB7C6',
    bestFor: 'Punchy talking-head takes — heavy type, one violet light, deep black.',
    entry: 'cut',
  },
  archive: {
    id: 'archive',
    name: 'Archive',
    ink: '#F6EAD2',
    dim: '#C9A268',
    bestFor: 'Storytelling, history, documentary — warm, heavy, cinematic.',
    entry: 'fade',
  },
};

export const LOOK_META: Record<SceneLook, LookMeta> = Object.fromEntries(
  SCENE_LOOKS.map((id) => [id, { ...NAMED[id], swatch: STYLE_GUIDES[id].accent }]),
) as Record<SceneLook, LookMeta>;

/** For the picker, in the order it should offer them. */
export const LOOK_LIST: LookMeta[] = SCENE_LOOKS.map((id) => LOOK_META[id]);
