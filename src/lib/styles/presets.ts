import type { Aspect, CaptionStyle, TransitionType } from '@/lib/edl/types';
import { findCaptionPreset } from '@/lib/captions/presets';

/**
 * A style preset is the entire creative brief expressed as data. The pipeline
 * has no per-style code paths — swapping "Clean" for "Punchy" changes numbers,
 * never branches. That is what lets us add a style in five minutes and what
 * keeps the renderer honest.
 */

export type StyleId = 'clean' | 'punchy' | 'documentary' | 'explainer' | 'podcast' | 'vlog';

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

  documentary: {
    id: 'documentary',
    name: 'Documentary',
    tagline: 'Cinematic, patient, considered.',
    bestFor: 'Storytelling, interviews, brand films.',
    accent: '#E8C89A',
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

  vlog: {
    id: 'vlog',
    name: 'Vlog',
    tagline: 'Loose, warm, personal.',
    bestFor: 'Day-in-the-life, updates, casual pieces to camera.',
    accent: '#F5C453',
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
