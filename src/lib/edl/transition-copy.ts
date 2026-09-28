import { CLIP_TRANSITIONS, CLIP_TRANSITION_MOVES, type ClipTransition } from './types';

/**
 * What each transition is called, and what it does, in the fewest words that
 * are still true.
 *
 * One list, read by three places — the upload wizard's picker, the editor's
 * inspector, and the badges on the timeline itself. It used to be two copies
 * with no descriptions, and the labels had already drifted.
 *
 * The notes matter more than they look. `whip` and `slide-left` are the same
 * word to anyone who has not watched them side by side, and a name alone gives
 * you no way to tell `film-burn` from `light-leak`. The one sentence is what
 * makes the list pickable without rendering twelve videos.
 */
export interface TransitionCopy {
  label: string;
  note: string;
}

export const TRANSITION_COPY: Record<ClipTransition, TransitionCopy> = {
  cut: { label: 'Cut', note: 'Straight in, no transition at all.' },
  fade: { label: 'Fade', note: 'Dissolves up, with a hair of scale under it.' },
  'slide-left': { label: 'Slide left', note: 'Travels left — in from the right edge.' },
  'slide-right': { label: 'Slide right', note: 'Travels right — in from the left edge.' },
  'slide-up': { label: 'Slide up', note: 'Travels up — in from below.' },
  'slide-down': { label: 'Slide down', note: 'Travels down — in from above.' },
  zoom: { label: 'Zoom', note: 'Pushes in as it arrives, out as it leaves.' },
  whip: { label: 'Whip', note: 'A fast pan, smeared sideways.' },
  glitch: { label: 'Glitch', note: 'The picture tears apart and blows out white.' },
  'film-burn': { label: 'Film burn', note: 'A hot spot eats outward and fogs the frame.' },
  'light-leak': { label: 'Light leak', note: 'Stray light sweeps across and washes it out.' },
  flash: { label: 'Flash', note: 'A single frame of white on the cut.' },
};

/** For a label somewhere too small for a sentence. */
export function transitionLabel(type: ClipTransition): string {
  return TRANSITION_COPY[type]?.label ?? type;
}

/**
 * The two families, in the order a picker should show them.
 *
 * A move carries the picture across the frame; a flavour snaps it in at full
 * opacity and plays an effect over it. Somebody choosing does not think in
 * those terms, but they do think "calm" and "loud", and this is that split.
 */
export const TRANSITION_GROUPS: ReadonlyArray<{ label: string; note: string; types: ClipTransition[] }> = [
  {
    label: 'Moves',
    note: 'The picture travels. Named by where it goes.',
    types: CLIP_TRANSITIONS.filter((t) => CLIP_TRANSITION_MOVES.includes(t)),
  },
  {
    label: 'Effects',
    note: 'It snaps in and something happens over it.',
    types: CLIP_TRANSITIONS.filter((t) => t !== 'cut' && !CLIP_TRANSITION_MOVES.includes(t)),
  },
];

/**
 * A glyph small enough to sit on a timeline clip.
 *
 * The badge on a clip's edge is about fourteen pixels tall and shares its row
 * with a trim handle, so there is room for one character and no more. Arrows
 * for the moves, because a move IS a direction and an arrow says it with no
 * reading at all; a distinct mark for each flavour, which nobody will learn
 * but which does the one job needed — telling you at a glance that the two
 * ends of a clip are different.
 */
export const TRANSITION_GLYPH: Record<ClipTransition, string> = {
  cut: '▮',
  fade: '◑',
  'slide-left': '←',
  'slide-right': '→',
  'slide-up': '↑',
  'slide-down': '↓',
  zoom: '⤢',
  whip: '⇶',
  glitch: '⌁',
  'film-burn': '◉',
  'light-leak': '☀',
  flash: '✦',
};
