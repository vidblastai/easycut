import { CLIP_TRANSITIONS, SCENE_LOOKS, type Aspect, type BrollOverlay, type CaptionStyle, type ClipTransition, type Layout, type SceneLook, type TransitionType } from '@/lib/edl/types';
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
  | 'tutorial'
  | 'essay'
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
   * The world this style's animated scenes are drawn in.
   *
   * Separate from `layout` and from `captionPreset` because it answers a
   * different question: those two decide how the SPEAKER is framed and
   * lettered, and this one decides what replaces them. A documentary wants
   * warm film grain over its inserts and a money channel wants dark glow, and
   * neither preference follows from how the talking head is cropped.
   */
  sceneLook: SceneLook;
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
  /**
   * How this style's full-frame clips arrive and leave.
   *
   * A separate vocabulary from `transitions` above, which decorates a cut
   * between two shots of the speaker. These move the clip itself, and the
   * builder cycles through the list so consecutive inserts differ without the
   * video looking like it was assembled from someone else's presets.
   *
   * First entry wins for a scene, which takes the whole frame and should use
   * the style's signature move rather than a rotating one.
   */
  clipTransitions: ClipTransition[];
  /**
   * The treatment every insert in this style wears.
   *
   * A property of the LOOK, like the transition vocabulary beside it, because
   * grain belongs to a documentary and scanlines belong to something loud, and
   * neither is a property of the clip that happened to be found. Overridable
   * per clip in the editor.
   */
  brollOverlay: BrollOverlay;
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
    sceneLook: 'studio',
    name: 'Clean',
    tagline: 'Let the message carry it.',
    bestFor: 'Founders, coaches, anyone who wants to look credible rather than loud.',
    accent: '#9B7BFF',
    layout: 'full',
    formats: ['short', 'long'],
    captionPreset: 'clean-plate',
    transitions: ['cut', 'dissolve'],
    clipTransitions: ['fade', 'slide-up', 'zoom'],
    brollOverlay: 'none',
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
    sceneLook: 'neon',
    name: 'Punchy',
    tagline: 'Built to stop the scroll.',
    bestFor: 'Short-form creators who need retention in the first two seconds.',
    accent: '#9B7BFF',
    layout: 'full',
    formats: ['short', 'long'],
    captionPreset: 'impact',
    transitions: ['cut', 'whip-pan', 'zoom-punch', 'flash', 'glitch', 'zoom-blur', 'pixelate'],
    clipTransitions: ['glitch', 'slide-left', 'whip', 'slide-up', 'flash'],
    brollOverlay: 'prism',
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
    sceneLook: 'neon',
    name: 'Reaction',
    tagline: 'Full frame while you talk, in the corner while they look.',
    bestFor: 'Commentary, hot takes, reacting to something — anything where the point is you responding to it.',
    accent: '#F5C453',
    layout: 'reaction',
    formats: ['short', 'long'],
    captionPreset: 'bold-pop',
    transitions: ['cut', 'zoom-punch', 'flash', 'zoom-blur'],
    clipTransitions: ['whip', 'zoom', 'slide-left', 'flash'],
    brollOverlay: 'scanlines',
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
    sceneLook: 'studio',
    name: 'Commentary',
    tagline: 'The thing you are talking about fills the screen. You watch from the corner.',
    bestFor: 'Reacting to an article, a clip or a screenshot — where what you are discussing is worth looking at the whole time.',
    accent: '#5BD6A0',
    layout: 'bubble',
    formats: ['short', 'long'],
    captionPreset: 'bold-pop',
    transitions: ['cut', 'dissolve'],
    clipTransitions: ['fade', 'zoom', 'slide-up'],
    brollOverlay: 'grain',
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
    sceneLook: 'studio',
    name: 'Bulletin',
    tagline: 'A headline across the top, the story underneath.',
    bestFor: 'Explaining something that happened — announcements, updates, anything where the headline IS the hook.',
    accent: '#FF6B6B',
    layout: 'headline',
    formats: ['short'],
    captionPreset: 'subtitle',
    transitions: ['cut', 'slide', 'push'],
    clipTransitions: ['slide-left', 'slide-right', 'slide-up', 'fade'],
    brollOverlay: 'none',
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
    sceneLook: 'studio',
    name: 'Chaptered',
    tagline: 'A title card every few seconds, so it never feels long.',
    bestFor: 'Lists, steps and multi-part stories — anything with more than one beat to get through.',
    accent: '#9B7BFF',
    layout: 'full',
    formats: ['short'],
    captionPreset: 'bold-pop',
    transitions: ['cut', 'whip-pan', 'slide', 'push', 'barn-door'],
    clipTransitions: ['slide-up', 'slide-left', 'whip', 'slide-down'],
    brollOverlay: 'prism',
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

  /*
   * The screencast.
   *
   * The one style here where the SOURCE of the B-roll is different in kind:
   * a tutorial's screen is not stock footage, it is the thing being
   * demonstrated. Until a screen recording can be uploaded as a second track
   * this leans on generated stills and stock, and the director note says so
   * plainly so the cues at least land on the right moments.
   *
   * Long form first. A walkthrough that fits in sixty seconds is a tip, and a
   * tip does not need a screen.
   */
  tutorial: {
    id: 'tutorial',
    sceneLook: 'studio',
    name: 'Screencast',
    tagline: 'The screen fills the frame. You narrate from the corner.',
    bestFor: 'Walkthroughs, demos and how-tos — anything where the thing on screen is the lesson.',
    accent: '#7FC8FF',
    layout: 'screencast',
    formats: ['long', 'short'],
    captionPreset: 'subtitle',
    transitions: ['cut', 'dissolve'],
    clipTransitions: ['fade', 'slide-up', 'zoom'],
    brollOverlay: 'none',
    musicMood: '',
    musicGainDb: -26,
    silencePreset: 'balanced',
    short: {
      punchInEverySec: [0, 0],
      punchInScale: [1, 1],
      brollEverySec: 5,
      brollDurationSec: [5, 10],
      graphicEverySec: 14,
      graphicDurationSec: 2.5,
      transitionDensity: 0.15,
      sfxDensity: 0.2,
    },
    long: {
      punchInEverySec: [0, 0],
      punchInScale: [1, 1],
      // Long holds. A tutorial where the picture changes every few seconds is
      // one nobody can follow, and the viewer is reading the screen.
      brollEverySec: 11,
      brollDurationSec: [10, 20],
      graphicEverySec: 45,
      graphicDurationSec: 3.5,
      transitionDensity: 0.1,
      sfxDensity: 0.12,
    },
    overlays: { progressBar: true, lowerThird: true, grain: false, vignette: false },
    directorNotes:
      'This is a screencast: whatever is being demonstrated fills the frame and the speaker is a ' +
      'small camera in the corner. There must be something on screen at every moment. Place a cue ' +
      'wherever the script moves to a new step, screen, menu or file, and describe what would be ' +
      'ON THE SCREEN at that point rather than a mood — "a spreadsheet with a formula bar", not ' +
      '"productivity". Hold each one for the whole step; a tutorial whose picture changes every ' +
      'few seconds is one nobody can follow. Use lower thirds to number the steps.',
  },

  /*
   * The cinematic essay.
   *
   * Everything here is turned DOWN. No punch-ins, the slowest silence preset,
   * the fewest transitions, the quietest sound — because the letterbox is
   * making the argument that this was considered, and an edit that fidgets
   * inside it contradicts that on every cut.
   *
   * Long form only. The bars take a fifth of a widescreen frame and nearly
   * two thirds of a vertical one, which is not a letterbox, it is a slot.
   */
  essay: {
    id: 'essay',
    sceneLook: 'archive',
    name: 'Essay',
    tagline: 'Letterboxed, unhurried, the words in the bar underneath.',
    bestFor: 'Long arguments and deep dives — where the point is the thinking, not the pace.',
    accent: '#E8C89A',
    layout: 'cinema',
    formats: ['long'],
    captionPreset: 'editorial',
    transitions: ['cut', 'dissolve'],
    clipTransitions: ['fade', 'zoom', 'slide-up'],
    brollOverlay: 'grain',
    musicMood: 'cinematic emotional',
    musicGainDb: -23,
    silencePreset: 'gentle',
    short: {
      punchInEverySec: [0, 0],
      punchInScale: [1, 1],
      brollEverySec: 10,
      brollDurationSec: [4, 8],
      graphicEverySec: 30,
      graphicDurationSec: 3,
      transitionDensity: 0.12,
      sfxDensity: 0.1,
    },
    long: {
      punchInEverySec: [0, 0],
      punchInScale: [1, 1],
      brollEverySec: 16,
      brollDurationSec: [6, 14],
      // A chapter card at each turn in the argument — what makes a long video
      // navigable, and what YouTube reads to build its own chapter list.
      graphicEverySec: 70,
      graphicDurationSec: 4,
      transitionDensity: 0.1,
      sfxDensity: 0.08,
    },
    overlays: { progressBar: true, lowerThird: false, grain: true, vignette: true },
    directorNotes:
      'A long-form essay, letterboxed and unhurried. Structure it: find the three to six points the ' +
      'argument actually turns on and mark each with a short chapter card — those are the ' +
      'signposts a viewer navigates by and the ones YouTube reads for its chapter list. B-roll ' +
      'should be atmospheric and slow rather than literal, and held long; a picture that changes ' +
      'every few seconds fights the format. Never cut for energy here — cut only when the subject ' +
      'moves on.',
  },

  /* The shape that made short-form watchable on mute: your face on top, a
     picture running underneath the whole time, the words on the seam. */
  split: {
    id: 'split',
    sceneLook: 'gallery',
    name: 'Split screen',
    tagline: 'Your face on top, something to watch underneath.',
    bestFor: 'Anything people scroll past on mute — the bottom half is what stops the thumb.',
    accent: '#5BD6A0',
    layout: 'split',
    formats: ['short'],
    captionPreset: 'bold-pop',
    transitions: ['cut', 'whip-pan', 'zoom-punch'],
    clipTransitions: ['slide-left', 'slide-right', 'fade'],
    brollOverlay: 'none',
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
    sceneLook: 'archive',
    name: 'Documentary',
    tagline: 'Cinematic, patient, considered.',
    bestFor: 'Storytelling, interviews, brand films.',
    accent: '#E8C89A',
    layout: 'full',
    formats: ['short', 'long'],
    captionPreset: 'editorial',
    transitions: ['cut', 'dissolve', 'film-burn'],
    clipTransitions: ['film-burn', 'fade', 'light-leak', 'zoom'],
    brollOverlay: 'grain',
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
    sceneLook: 'studio',
    name: 'Explainer',
    tagline: 'Every idea gets a picture.',
    bestFor: 'Teaching, how-tos, product walkthroughs.',
    accent: '#5BD6A0',
    layout: 'full',
    formats: ['short', 'long'],
    captionPreset: 'highlight-box',
    transitions: ['cut', 'slide', 'zoom-punch'],
    clipTransitions: ['slide-up', 'slide-left', 'zoom', 'fade'],
    brollOverlay: 'dust',
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
    sceneLook: 'archive',
    name: 'Podcast',
    tagline: 'Long conversations, watchable.',
    bestFor: 'Interviews and long-form talking head.',
    accent: '#9B7BFF',
    layout: 'full',
    formats: ['long'],
    captionPreset: 'podcast',
    transitions: ['cut', 'dissolve'],
    clipTransitions: ['fade', 'slide-up'],
    brollOverlay: 'grain',
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
    sceneLook: 'studio',
    name: 'Side by side',
    tagline: 'You on the left, what you mean on the right.',
    bestFor: 'Walkthroughs, teardowns, anything where the thing matters as much as the talking.',
    accent: '#7FB4FF',
    layout: 'side',
    formats: ['long'],
    captionPreset: 'subtitle',
    transitions: ['cut', 'dissolve'],
    clipTransitions: ['fade', 'slide-right', 'zoom'],
    brollOverlay: 'none',
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
    sceneLook: 'gallery',
    name: 'Vlog',
    tagline: 'Loose, warm, personal.',
    bestFor: 'Day-in-the-life, updates, casual pieces to camera.',
    accent: '#F5C453',
    layout: 'full',
    formats: ['short'],
    captionPreset: 'bold-pop',
    transitions: ['cut', 'whip-pan', 'dissolve', 'slide'],
    clipTransitions: ['light-leak', 'whip', 'slide-left', 'fade'],
    brollOverlay: 'light-leak',
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
export function styleFor(
  styleId: string,
  captionPreset?: string | null,
  sceneLook?: string | null,
  clipTransitions?: readonly string[] | null,
): StylePreset {
  const base = getStyle(styleId);

  // Every override is validated rather than trusted, and an unknown one falls
  // back to the style's own pick rather than failing the render: a stale id in
  // a months-old project should cost you a preference, not the video.
  const caption = captionPreset ? findCaptionPreset(captionPreset) : null;
  const look = sceneLook && (SCENE_LOOKS as readonly string[]).includes(sceneLook)
    ? (sceneLook as SceneLook)
    : null;
  const moves = sanitiseTransitions(clipTransitions);

  if (!caption && !look && !moves) return base;
  return {
    ...base,
    ...(caption ? { captionStyle: { ...caption.style } } : {}),
    ...(look ? { sceneLook: look } : {}),
    ...(moves ? { clipTransitions: moves } : {}),
  };
}

/**
 * The transitions somebody picked, as a vocabulary the builder can cycle.
 *
 * ORDER IS KEPT, and that is the whole reason this is a list rather than a
 * set: `placeBroll` walks the vocabulary per insert, so picking slide-left
 * then slide-right gives alternating inserts, and picking them the other way
 * round gives a different edit. Sorting it here — the tidy-looking thing to do
 * — would quietly throw away a decision somebody made.
 *
 * An empty list means the same as no list: take the style's own. Anything else
 * would let a stray click produce a video with no transitions in it at all,
 * and "I picked nothing" is not a request for nothing.
 */
export function sanitiseTransitions(picked?: readonly string[] | null): ClipTransition[] | null {
  if (!picked?.length) return null;
  const seen = new Set<string>();
  const kept = picked.filter(
    (name): name is ClipTransition =>
      (CLIP_TRANSITIONS as readonly string[]).includes(name) && !seen.has(name) && !!seen.add(name),
  );
  return kept.length ? kept : null;
}

/** The stored JSON, back as a list. A corrupt value is no preference, not a crash. */
export function parseTransitions(stored?: string | null): ClipTransition[] | null {
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? sanitiseTransitions(parsed.filter((n) => typeof n === 'string')) : null;
  } catch {
    return null;
  }
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
