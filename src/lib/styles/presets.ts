import type { Aspect, CaptionStyle, Layout, TransitionType } from '@/lib/edl/types';
import { findCaptionPreset } from '@/lib/captions/presets';

/**
 * A style preset is the entire creative brief expressed as data. The pipeline
 * has no per-style code paths — swapping "Clean" for "Punchy" changes numbers,
 * never branches. That is what lets us add a style in five minutes and what
 * keeps the renderer honest.
 */

export type StyleId =
  | 'clean'
  | 'punchy'
  | 'reaction'
  | 'commentary'
  | 'news'
  | 'stacked'
  | 'split'
  | 'documentary'
  | 'explainer'
  | 'podcast'
  | 'sidebar'
  | 'vlog';

export interface PacingProfile {
  /** Seconds between punch-ins. The "second camera" cadence. */
  punchInEverySec: [min: number, max: number];
  punchInScale: [min: number, max: number];
  /** Seconds of finished video per B-roll insert. */
  brollEverySec: number;
  brollDurationSec: [min: number, max: number];
  /** Seconds of finished video per graphic element. */
  graphicEverySec: number;
  graphicDurationSec: number;
  /** 0..1 — fraction of visible cuts that get a decorated transition. */
  transitionDensity: number;
  /** 0..1 — fraction of beats that get a sound effect. */
  sfxDensity: number;
}

export interface StylePreset {
  id: StyleId;
  name: string;
  tagline: string;
  /** Who this is for, in the user's language — shown on the picker card. */
  bestFor: string;
  accent: string;
  /**
   * How the frame is divided. The picker draws this and the composition renders
   * it, from this one value — see src/lib/styles/layouts.ts.
   */
  layout: Layout;
  /**
   * Which formats this style is offered for.
   *
   * A split screen is a short-form shape and a side-by-side is a widescreen
   * one; offering either in the wrong place is offering something that will
   * look wrong. The format is detected from the footage, so the list a person
   * sees is already the list that applies to them.
   */
  formats: FormatMode[];
  /**
   * The caption look this style opens with. Pacing and typography are separate
   * decisions — people have opinions about the second long before the first —
   * so a style only names a starting point the user is free to replace.
   */
  captionPreset: string;
  /** Resolved from captionPreset below; the pipeline reads this. */
  captionStyle: CaptionStyle;
  transitions: TransitionType[];
  musicMood: string;
  musicGainDb: number;
  /** Silence handling aggressiveness for raw footage. */
  silencePreset: 'aggressive' | 'balanced' | 'gentle';
  short: PacingProfile;
  long: PacingProfile;
  /** Extra layers this style turns on. */
  overlays: { progressBar: boolean; lowerThird: boolean; grain: boolean; vignette: boolean };
  /** Steers the director LLM's taste without changing its schema. */
  directorNotes: string;
}

const RAW_PRESETS: Record<StyleId, Omit<StylePreset, 'captionStyle'>> = {
  clean: {
    id: 'clean',
    name: 'Clean',
    tagline: 'Let the message carry it.',
    bestFor: 'Founders, coaches, anyone who wants to look credible rather than loud.',
    accent: '#9B7BFF',
    layout: 'full',
    formats: ['short', 'long'],
    captionPreset: 'clean-plate',
    transitions: ['cut', 'dissolve'],
    musicMood: 'minimal ambient',
    musicGainDb: -22,
    silencePreset: 'balanced',
    short: {
      punchInEverySec: [5, 9],
      punchInScale: [1.08, 1.16],
      brollEverySec: 12,
      brollDurationSec: [1.6, 2.8],
      graphicEverySec: 14,
      graphicDurationSec: 2.6,
      transitionDensity: 0.25,
      sfxDensity: 0.2,
    },
    long: {
      punchInEverySec: [18, 30],
      punchInScale: [1.06, 1.12],
      brollEverySec: 45,
      brollDurationSec: [3, 5.5],
      graphicEverySec: 55,
      graphicDurationSec: 3.5,
      transitionDensity: 0.15,
      sfxDensity: 0.08,
    },
    overlays: { progressBar: false, lowerThird: true, grain: false, vignette: true },
    directorNotes:
      'Restrained and trustworthy. Pick B-roll that illustrates literally, never decoratively. ' +
      'Emphasise at most one word per sentence. No hype language in titles.',
  },

  punchy: {
    id: 'punchy',
    name: 'Punchy',
    tagline: 'Built to stop the scroll.',
    bestFor: 'Short-form creators who need retention in the first two seconds.',
    accent: '#9B7BFF',
    layout: 'full',
    formats: ['short', 'long'],
    captionPreset: 'impact',
    transitions: ['cut', 'whip-pan', 'zoom-punch', 'flash', 'glitch'],
    musicMood: 'upbeat energetic',
    musicGainDb: -16,
    silencePreset: 'aggressive',
    short: {
      punchInEverySec: [3, 6],
      punchInScale: [1.12, 1.28],
      brollEverySec: 7,
      brollDurationSec: [1.2, 2.2],
      graphicEverySec: 9,
      graphicDurationSec: 2.2,
      transitionDensity: 0.65,
      sfxDensity: 0.8,
    },
    long: {
      punchInEverySec: [10, 18],
      punchInScale: [1.1, 1.2],
      brollEverySec: 28,
      brollDurationSec: [2.5, 4.5],
      graphicEverySec: 32,
      graphicDurationSec: 3,
      transitionDensity: 0.4,
      sfxDensity: 0.35,
    },
    overlays: { progressBar: true, lowerThird: false, grain: false, vignette: false },
    directorNotes:
      'High energy. The hook is everything — find the single most arresting sentence and open on it, ' +
      'even if it comes from the middle. Emphasise numbers, contradictions and stakes. ' +
      'Prefer graphics that quantify (big numbers, comparisons).',
  },

  reaction: {
    /*
     * The reaction cut.
     *
     * Its numbers say the format out loud: B-roll every six seconds rather
     * than every twelve, and inserts held three to six seconds, because the
     * SWITCHING is the style. Cut too often and the speaker is a blur of
     * shrinking and growing; cut too rarely and it is just a talking head with
     * occasional pictures.
     *
     * Punch-ins are turned right down for the same reason — the speaker
     * already changes size constantly, and a punch on top of that reads as the
     * camera being knocked.
     */
    id: 'reaction',
    name: 'Reaction',
    tagline: 'Full frame while you talk, in the corner while they look.',
    bestFor: 'Commentary, hot takes, reacting to something — anything where the point is you responding to it.',
    accent: '#F5C453',
    layout: 'reaction',
    formats: ['short', 'long'],
    captionPreset: 'bold-pop',
    transitions: ['cut', 'zoom-punch', 'flash'],
    musicMood: 'upbeat energetic',
    musicGainDb: -19,
    silencePreset: 'aggressive',
    short: {
      punchInEverySec: [14, 22],
      punchInScale: [1.04, 1.09],
      brollEverySec: 6,
      brollDurationSec: [3, 6],
      graphicEverySec: 20,
      graphicDurationSec: 2,
      transitionDensity: 0.35,
      sfxDensity: 0.8,
    },
    long: {
      punchInEverySec: [25, 40],
      punchInScale: [1.04, 1.08],
      brollEverySec: 14,
      brollDurationSec: [5, 10],
      graphicEverySec: 45,
      graphicDurationSec: 3,
      transitionDensity: 0.22,
      sfxDensity: 0.5,
    },
    overlays: { progressBar: false, lowerThird: false, grain: false, vignette: false },
    directorNotes:
      'This is a reaction edit: the speaker is full frame until a picture comes up, then shrinks ' +
      'into the corner while it plays. So every B-roll cue is a moment the viewer is looking at ' +
      'something INSTEAD of at the speaker — choose them where the script names a specific thing ' +
      'worth seeing, and give each one long enough to be read. Prefer fewer, longer, more concrete ' +
      'inserts over a scatter of short ones.',
  },

  /*
   * The commentary bubble.
   *
   * Different from a reaction cut in exactly one way that changes everything:
   * the picture never leaves. That makes the B-roll track the video rather
   * than an ornament on it, which is why `brollEverySec` here is the tightest
   * number in this file and why `alwaysOn` on the layout makes the pipeline
   * fill every gap. A bubble layout with a hole in its B-roll is a circle of
   * face on a black screen.
   *
   * Punch-ins are off. The speaker is a fixed circle; scaling the footage
   * inside it moves the face around behind a hole it cannot leave, which reads
   * as a mistake rather than as a second camera.
   */
  commentary: {
    id: 'commentary',
    name: 'Commentary',
    tagline: 'The thing you are talking about fills the screen. You watch from the corner.',
    bestFor: 'Reacting to an article, a clip or a screenshot — where what you are discussing is worth looking at the whole time.',
    accent: '#5BD6A0',
    layout: 'bubble',
    formats: ['short', 'long'],
    captionPreset: 'bold-pop',
    transitions: ['cut', 'dissolve'],
    musicMood: 'low-key groove',
    musicGainDb: -21,
    silencePreset: 'balanced',
    short: {
      punchInEverySec: [0, 0],
      punchInScale: [1, 1],
      brollEverySec: 4,
      brollDurationSec: [4, 8],
      graphicEverySec: 18,
      graphicDurationSec: 2.2,
      transitionDensity: 0.25,
      sfxDensity: 0.45,
    },
    long: {
      punchInEverySec: [0, 0],
      punchInScale: [1, 1],
      brollEverySec: 8,
      brollDurationSec: [6, 12],
      graphicEverySec: 40,
      graphicDurationSec: 3,
      transitionDensity: 0.18,
      sfxDensity: 0.3,
    },
    overlays: { progressBar: true, lowerThird: false, grain: false, vignette: true },
    directorNotes:
      'The viewer is looking at the PICTURE for this entire video; the speaker is a small circle ' +
      'in the corner. So there must be something worth showing at every moment — never leave a ' +
      'gap. Prefer literal, specific images of whatever is being discussed over mood footage, and ' +
      'hold each one long enough to actually read it.',
  },

  /*
   * The bulletin.
   *
   * Built for the feed rather than for the viewer who has already decided to
   * watch: a headline across the top that does its work on mute, in a
   * thumbnail, before any audio plays. That is also why the silence preset is
   * the aggressive one and the hook matters more here than anywhere else —
   * the format promises news, and news that takes four seconds to start is not
   * news.
   *
   * No music by default. A bulletin scored like a trailer reads as a hoax, and
   * this is the one style where being believed is the whole product.
   */
  news: {
    id: 'news',
    name: 'Bulletin',
    tagline: 'A headline across the top, the story underneath.',
    bestFor: 'Explaining something that happened — announcements, updates, anything where the headline IS the hook.',
    accent: '#FF6B6B',
    layout: 'headline',
    formats: ['short'],
    captionPreset: 'subtitle',
    transitions: ['cut', 'slide'],
    musicMood: '',
    musicGainDb: -26,
    silencePreset: 'aggressive',
    short: {
      punchInEverySec: [0, 0],
      punchInScale: [1, 1],
      brollEverySec: 7,
      brollDurationSec: [2.5, 5],
      graphicEverySec: 12,
      graphicDurationSec: 2.5,
      transitionDensity: 0.3,
      sfxDensity: 0.2,
    },
    long: {
      punchInEverySec: [0, 0],
      punchInScale: [1, 1],
      brollEverySec: 12,
      brollDurationSec: [4, 8],
      graphicEverySec: 30,
      graphicDurationSec: 3,
      transitionDensity: 0.2,
      sfxDensity: 0.15,
    },
    overlays: { progressBar: true, lowerThird: true, grain: false, vignette: false },
    directorNotes:
      'This is a news bulletin. The TITLE is the headline printed across the top of every frame, ' +
      'so write it as a headline and not as a caption: specific, under twelve words, the fact ' +
      'first. Graphics should be numbers, dates and names rather than mood. Keep the hook to one ' +
      'sentence — the format has already told the viewer what this is about.',
  },

  /*
   * Rapid-fire story stacking.
   *
   * The retention trick of a series without asking anyone to come back: a
   * chapter card every few seconds resets the viewer\'s sense of how far in
   * they are, so a two-minute video feels like six short ones. The graphics
   * cadence here is the style — everything else is ordinary.
   *
   * Long form is deliberately absent. Past about ninety seconds the cards stop
   * reading as chapters and start reading as an edit that will not sit still.
   */
  stacked: {
    id: 'stacked',
    name: 'Chaptered',
    tagline: 'A title card every few seconds, so it never feels long.',
    bestFor: 'Lists, steps and multi-part stories — anything with more than one beat to get through.',
    accent: '#9B7BFF',
    layout: 'full',
    formats: ['short'],
    captionPreset: 'bold-pop',
    transitions: ['cut', 'whip-pan', 'slide'],
    musicMood: 'upbeat energetic',
    musicGainDb: -18,
    silencePreset: 'aggressive',
    short: {
      punchInEverySec: [9, 14],
      punchInScale: [1.05, 1.1],
      brollEverySec: 8,
      brollDurationSec: [2, 4],
      // The whole style: a card roughly every six seconds.
      graphicEverySec: 6,
      graphicDurationSec: 1.8,
      transitionDensity: 0.8,
      sfxDensity: 0.7,
    },
    long: {
      punchInEverySec: [18, 28],
      punchInScale: [1.04, 1.08],
      brollEverySec: 12,
      brollDurationSec: [3, 6],
      graphicEverySec: 20,
      graphicDurationSec: 2.5,
      transitionDensity: 0.4,
      sfxDensity: 0.4,
    },
    overlays: { progressBar: true, lowerThird: false, grain: false, vignette: false },
    directorNotes:
      'Break the script into numbered beats and give every one a short title card — three or four ' +
      'words, not a sentence. The cards are the spine of this edit: a viewer should be able to ' +
      'follow the whole thing from them alone with the sound off. Cut hard between beats; no ' +
      'dissolves.',
  },

  /* The shape that made short-form watchable on mute: your face on top, a
     picture running underneath the whole time, the words on the seam. */
  split: {
    id: 'split',
    name: 'Split screen',
    tagline: 'Your face on top, something to watch underneath.',
    bestFor: 'Anything people scroll past on mute — the bottom half is what stops the thumb.',
    accent: '#5BD6A0',
    layout: 'split',
    formats: ['short'],
    captionPreset: 'bold-pop',
    transitions: ['cut', 'whip-pan', 'zoom-punch'],
    musicMood: 'upbeat energetic',
    musicGainDb: -18,
    silencePreset: 'aggressive',
    short: {
      punchInEverySec: [5, 9],
      punchInScale: [1.06, 1.14],
      /*
       * The bottom slot is on screen the whole time, so B-roll is not an
       * occasional insert here — it is the other half of the video. The
       * pipeline fills whatever this leaves uncovered.
       *
       * FEWER and LONGER, deliberately. A lower half that cuts every three
       * seconds is two videos competing, and the format works precisely
       * because there is calm continuous motion to rest on while somebody
       * talks. It also halves the number of stock clips a single video has to
       * fetch, which is the other thing this slot is expensive for.
       */
      brollEverySec: 8,
      brollDurationSec: [6, 12],
      graphicEverySec: 16,
      graphicDurationSec: 2.2,
      transitionDensity: 0.3,
      sfxDensity: 0.7,
    },
    long: {
      punchInEverySec: [12, 20],
      punchInScale: [1.05, 1.12],
      brollEverySec: 12,
      brollDurationSec: [8, 16],
      graphicEverySec: 40,
      graphicDurationSec: 3,
      transitionDensity: 0.2,
      sfxDensity: 0.4,
    },
    overlays: { progressBar: true, lowerThird: false, grain: false, vignette: false },
    directorNotes:
      'The bottom half of the frame is always showing something. Its job is to HOLD THE EYE, not ' +
      'to illustrate every noun: the format works because there is continuous calm motion to look ' +
      'at while somebody talks, and it stops working when the lower half cuts as often as the ' +
      'script changes subject. So prefer long, slow, loopable footage — hands doing something, a ' +
      'process running, water, machinery, a road — over a literal picture of each thing named, and ' +
      'let one clip run for several sentences. Cut it only where the subject genuinely changes. ' +
      'Keep graphics rare: the frame is already carrying two pictures.',
  },
  documentary: {
    id: 'documentary',
    name: 'Documentary',
    tagline: 'Cinematic, patient, considered.',
    bestFor: 'Storytelling, interviews, brand films.',
    accent: '#E8C89A',
    layout: 'full',
    formats: ['short', 'long'],
    captionPreset: 'editorial',
    transitions: ['cut', 'dissolve', 'film-burn'],
    musicMood: 'cinematic emotional',
    musicGainDb: -20,
    silencePreset: 'gentle',
    short: {
      punchInEverySec: [7, 12],
      punchInScale: [1.05, 1.12],
      brollEverySec: 9,
      brollDurationSec: [2.2, 4],
      graphicEverySec: 30,
      graphicDurationSec: 3,
      transitionDensity: 0.3,
      sfxDensity: 0.15,
    },
    long: {
      punchInEverySec: [22, 40],
      punchInScale: [1.04, 1.1],
      brollEverySec: 30,
      brollDurationSec: [4, 7],
      graphicEverySec: 90,
      graphicDurationSec: 4,
      transitionDensity: 0.25,
      sfxDensity: 0.1,
    },
    overlays: { progressBar: false, lowerThird: true, grain: true, vignette: true },
    directorNotes:
      'Let moments land. Keep pauses that carry emotion. B-roll should be atmospheric and wide, ' +
      'not literal stock-photo illustration. Almost no on-screen graphics.',
  },

  explainer: {
    id: 'explainer',
    name: 'Explainer',
    tagline: 'Every idea gets a picture.',
    bestFor: 'Teaching, how-tos, product walkthroughs.',
    accent: '#5BD6A0',
    layout: 'full',
    formats: ['short', 'long'],
    captionPreset: 'highlight-box',
    transitions: ['cut', 'slide', 'zoom-punch'],
    musicMood: 'light curious',
    musicGainDb: -24,
    silencePreset: 'balanced',
    short: {
      punchInEverySec: [5, 9],
      punchInScale: [1.08, 1.18],
      brollEverySec: 14,
      brollDurationSec: [1.5, 2.5],
      graphicEverySec: 5,
      graphicDurationSec: 3,
      transitionDensity: 0.35,
      sfxDensity: 0.45,
    },
    long: {
      punchInEverySec: [16, 26],
      punchInScale: [1.06, 1.14],
      brollEverySec: 50,
      brollDurationSec: [3, 5],
      graphicEverySec: 18,
      graphicDurationSec: 4,
      transitionDensity: 0.25,
      sfxDensity: 0.25,
    },
    overlays: { progressBar: true, lowerThird: true, grain: false, vignette: false },
    directorNotes:
      'Visualise structure. Every list becomes a build-on list graphic, every number becomes a stat card, ' +
      'every named concept gets an icon. Prefer graphics over B-roll when the idea is abstract.',
  },

  podcast: {
    id: 'podcast',
    name: 'Podcast',
    tagline: 'Long conversations, watchable.',
    bestFor: 'Interviews and long-form talking head.',
    accent: '#9B7BFF',
    layout: 'full',
    formats: ['long'],
    captionPreset: 'podcast',
    transitions: ['cut', 'dissolve'],
    musicMood: 'low-key groove',
    musicGainDb: -26,
    silencePreset: 'gentle',
    short: {
      punchInEverySec: [6, 11],
      punchInScale: [1.1, 1.2],
      brollEverySec: 11,
      brollDurationSec: [1.8, 3],
      graphicEverySec: 16,
      graphicDurationSec: 2.6,
      transitionDensity: 0.2,
      sfxDensity: 0.25,
    },
    long: {
      punchInEverySec: [14, 24],
      punchInScale: [1.08, 1.16],
      brollEverySec: 60,
      brollDurationSec: [3, 5],
      graphicEverySec: 70,
      graphicDurationSec: 4,
      transitionDensity: 0.1,
      sfxDensity: 0.05,
    },
    overlays: { progressBar: false, lowerThird: true, grain: false, vignette: false },
    directorNotes:
      'Keep the conversation intact. Cut only genuine dead air. Use chapter cards at topic changes. ' +
      'B-roll sparingly, only when something specific is named.',
  },

  /* The widescreen version of the same idea. Half the frame is you, half is
     what you are talking about, and neither one ever cuts away. */
  sidebar: {
    id: 'sidebar',
    name: 'Side by side',
    tagline: 'You on the left, what you mean on the right.',
    bestFor: 'Walkthroughs, teardowns, anything where the thing matters as much as the talking.',
    accent: '#7FB4FF',
    layout: 'side',
    formats: ['long'],
    captionPreset: 'subtitle',
    transitions: ['cut', 'dissolve'],
    musicMood: 'light curious',
    musicGainDb: -24,
    silencePreset: 'balanced',
    short: {
      punchInEverySec: [8, 14],
      punchInScale: [1.05, 1.1],
      brollEverySec: 5,
      brollDurationSec: [3, 6],
      graphicEverySec: 20,
      graphicDurationSec: 2.4,
      transitionDensity: 0.15,
      sfxDensity: 0.2,
    },
    long: {
      punchInEverySec: [20, 34],
      punchInScale: [1.04, 1.1],
      brollEverySec: 9,
      brollDurationSec: [5, 11],
      graphicEverySec: 36,
      graphicDurationSec: 3.4,
      transitionDensity: 0.12,
      sfxDensity: 0.12,
    },
    overlays: { progressBar: true, lowerThird: true, grain: false, vignette: false },
    directorNotes:
      'The right half never goes empty, so keep naming what is on screen. Prefer specific nouns over ' +
      'abstractions, and let a picture stay for a whole thought rather than cutting every two seconds.',
  },
  vlog: {
    id: 'vlog',
    name: 'Vlog',
    tagline: 'Loose, warm, personal.',
    bestFor: 'Day-in-the-life, updates, casual pieces to camera.',
    accent: '#F5C453',
    layout: 'full',
    formats: ['short'],
    captionPreset: 'bold-pop',
    transitions: ['cut', 'whip-pan', 'dissolve', 'slide'],
    musicMood: 'warm lo-fi',
    musicGainDb: -19,
    silencePreset: 'balanced',
    short: {
      punchInEverySec: [4, 8],
      punchInScale: [1.1, 1.2],
      brollEverySec: 9,
      brollDurationSec: [1.4, 2.6],
      graphicEverySec: 13,
      graphicDurationSec: 2.4,
      transitionDensity: 0.45,
      sfxDensity: 0.5,
    },
    long: {
      punchInEverySec: [12, 22],
      punchInScale: [1.08, 1.16],
      brollEverySec: 25,
      brollDurationSec: [2.5, 5],
      graphicEverySec: 45,
      graphicDurationSec: 3,
      transitionDensity: 0.3,
      sfxDensity: 0.25,
    },
    overlays: { progressBar: false, lowerThird: false, grain: true, vignette: false },
    directorNotes:
      'Friendly and unpolished on purpose. Keep the odd laugh or aside — personality beats tightness. ' +
      'B-roll should feel like the creator shot it, so prefer handheld-looking stock.',
  },
};

/**
 * Resolve each style's caption preset once, at module load, so an unknown id is
 * a crash on boot rather than a video that silently renders in the wrong face.
 */
export const STYLE_PRESETS: Record<StyleId, StylePreset> = Object.fromEntries(
  Object.entries(RAW_PRESETS).map(([id, preset]) => {
    const caption = findCaptionPreset(preset.captionPreset);
    if (!caption) {
      throw new Error(`Style "${id}" names caption preset "${preset.captionPreset}", which does not exist.`);
    }
    return [id, { ...preset, captionStyle: { ...caption.style } }];
  }),
) as Record<StyleId, StylePreset>;

export const STYLE_LIST = Object.values(STYLE_PRESETS);

/**
 * Whether a style's signature is the CADENCE of its title cards.
 *
 * Read off the pacing rather than set by hand, so it cannot disagree with what
 * the renderer does: a card every few seconds is a chaptered edit whatever the
 * style is called, and a style that slows its cards down stops claiming to be
 * one on the same edit.
 */
export function leadsWithCards(style: StylePreset, mode: FormatMode = 'short'): boolean {
  return style[mode].graphicEverySec <= 8;
}

export function getStyle(id: string): StylePreset {
  return STYLE_PRESETS[id as StyleId] ?? STYLE_PRESETS.clean;
}

/**
 * The style to build with, once the user's own caption choice is applied.
 *
 * Pacing and typography are separate decisions — "that energy, quieter type" is
 * a thing people want and a thing the old welded-together version could not
 * express. An unknown or absent preset id falls back to the edit style's own,
 * so a stale id in the database is a default rather than a crash.
 */
export function styleFor(styleId: string, captionPreset?: string | null): StylePreset {
  const style = getStyle(styleId);
  if (!captionPreset) return style;

  const caption = findCaptionPreset(captionPreset);
  if (!caption) return style;

  return { ...style, captionStyle: { ...caption.style } };
}

/* --------------------------------------------------------------- formats */

export type FormatMode = 'short' | 'long';

export interface FormatPreset {
  mode: FormatMode;
  label: string;
  description: string;
  aspect: Aspect;
  maxDurationSec: number;
  /** Where the finished video is meant to go — shown as platform chips. */
  platforms: string[];
}

export const FORMAT_PRESETS: Record<FormatMode, FormatPreset> = {
  short: {
    mode: 'short',
    label: 'Short form',
    description: 'Vertical, up to 90 seconds, hook-first.',
    aspect: '9:16',
    maxDurationSec: 90,
    platforms: ['TikTok', 'Reels', 'Shorts'],
  },
  long: {
    mode: 'long',
    label: 'Long form',
    description: 'Widescreen, up to 10 minutes, chaptered.',
    aspect: '16:9',
    maxDurationSec: 600,
    platforms: ['YouTube', 'LinkedIn', 'Web'],
  },
};

export function pacingFor(style: StylePreset, mode: FormatMode): PacingProfile {
  return mode === 'short' ? style.short : style.long;
}

/**
 * The styles worth showing for a given format.
 *
 * The format is detected from the footage, so by the time anybody is choosing a
 * style the list is already narrowed to the ones that suit their video. A split
 * screen offered on a widescreen edit is an offer to make something that will
 * look wrong.
 */
export function stylesFor(mode: FormatMode): StylePreset[] {
  return STYLE_LIST.filter((s) => s.formats.includes(mode));
}
