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
   * Light or dark, derived from the ground the drawing sits on.
   *
   * The picker leads with this because it is the only thing anybody asks
   * first — "I want to see it in the dark style" — and a list of five proper
   * nouns does not answer it. Derived rather than written down for the same
   * reason the swatch is: two places holding the same fact is one place
   * holding it wrong.
   */
  tone: 'light' | 'dark';
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

const NAMED: Record<SceneLook, Omit<LookMeta, 'swatch' | 'tone'>> = {
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
  science: {
    id: 'science',
    name: 'Flat science',
    ink: '#FFF6E0',
    dim: '#9FB3E8',
    bestFor: 'Explaining how something works — bright flat shapes with soft glows, the camera diving in.',
    entry: 'cut',
  },
  paper: {
    id: 'paper',
    name: 'Paper cut-out',
    ink: '#1F3A5F',
    dim: '#7A6F60',
    bestFor: 'Stories and how-tos — layered card with soft shadows, like a pop-up book.',
    entry: 'cut',
  },
  ink: {
    id: 'ink',
    name: 'Ink line',
    ink: '#141414',
    dim: '#6E685E',
    bestFor: 'Ideas and opinions — a black pen drawing itself on paper, one red accent.',
    entry: 'cut',
  },
  blueprint: {
    id: 'blueprint',
    name: 'Blueprint',
    ink: '#EAF2FF',
    dim: '#9BB8E3',
    bestFor: 'How things are built — precise white drafting lines on blueprint blue.',
    entry: 'cut',
  },
  riso: {
    id: 'riso',
    name: 'Riso print',
    ink: '#1B1B1B',
    dim: '#6C3A8C',
    bestFor: 'Bold, artsy takes — fluoro pink and blue inks overprinting, halftone dots.',
    entry: 'cut',
  },
  pixel: {
    id: 'pixel',
    name: 'Pixel art',
    ink: '#F1FAEE',
    dim: '#4CC9F0',
    bestFor: 'Gaming, tech and nostalgia — chunky pixels that move in steps.',
    entry: 'cut',
  },
  chalk: {
    id: 'chalk',
    name: 'Chalkboard',
    ink: '#F2F0E6',
    dim: '#A9B5AE',
    bestFor: 'Teaching and step-by-steps — chalk drawings sketched onto a board.',
    entry: 'cut',
  },
  scope: {
    id: 'scope',
    name: 'Oscilloscope',
    ink: '#7CFF8A',
    dim: '#2BD45A',
    bestFor: 'Tech, signals and sound — one glowing green beam tracing every shape.',
    entry: 'cut',
  },
  graph: {
    id: 'graph',
    name: 'Math graph',
    ink: '#F4F4F4',
    dim: '#8B90A0',
    bestFor: 'Numbers, growth and logic — exact curves morphing smoothly on black.',
    entry: 'cut',
  },
  glass: {
    id: 'glass',
    name: 'Glass',
    ink: '#FFFFFF',
    dim: '#B6B9E0',
    bestFor: 'Apps and premium products — frosted panels over glowing colour.',
    entry: 'cut',
  },
  clay: {
    id: 'clay',
    name: 'Clay',
    ink: '#3A2A22',
    dim: '#8C7462',
    bestFor: 'Friendly and fun — soft squishy clay shapes on a tabletop.',
    entry: 'cut',
  },
  poster: {
    id: 'poster',
    name: 'Bold poster',
    ink: '#0E0F1F',
    dim: '#5A5C7A',
    bestFor: 'Hype and launches — huge flat shapes slamming in on the beat.',
    entry: 'cut',
  },
  diorama: {
    id: 'diorama',
    name: 'Pastel diorama',
    ink: '#4A2A2E',
    dim: '#9A7A78',
    bestFor: 'Lifestyle and travel — a tidy, symmetrical miniature set in pastels.',
    entry: 'cut',
  },
  pencil: {
    id: 'pencil',
    name: 'Storybook pencil',
    ink: '#4A4038',
    dim: '#8C8274',
    bestFor: 'Gentle stories and personal posts — coloured-pencil drawings on sketchbook paper.',
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
  SCENE_LOOKS.map((id) => [
    id,
    { ...NAMED[id], swatch: STYLE_GUIDES[id].accent, tone: toneOf(STYLE_GUIDES[id].ground) },
  ]),
) as Record<SceneLook, LookMeta>;

/**
 * Light or dark, measured off the ground colour.
 *
 * Perceptual weights rather than a plain average: `#EFF0F4` and `#05060F` are
 * obvious either way, but a saturated mid-tone ground is not, and green reads
 * far lighter than blue at the same number.
 */
function toneOf(ground: string): 'light' | 'dark' {
  const hex = ground.replace('#', '');
  const to = (at: number) => parseInt(hex.slice(at, at + 2), 16) / 255;
  const luma = 0.2126 * to(0) + 0.7152 * to(2) + 0.0722 * to(4);
  return luma > 0.5 ? 'light' : 'dark';
}

/** For the picker, in the order it should offer them. */
export const LOOK_LIST: LookMeta[] = SCENE_LOOKS.map((id) => LOOK_META[id]);
