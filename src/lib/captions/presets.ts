import type { CaptionStyle } from '../edl/types';

/**
 * The caption looks.
 *
 * These used to be welded to the six edit styles: pick "Punchy" and you got
 * Punchy's captions, with no way to say "that pacing, but quieter type". Pacing
 * and typography are different decisions and people have opinions about the
 * second one long before they have opinions about the first, so they are two
 * lists now. An edit style names a default caption preset; the user can change
 * it without touching anything else, and a caption change re-renders from
 * cached analysis — no transcription, no AI call, no re-upload.
 *
 * Each preset is a COMPLETE CaptionStyle. There is no inheritance and no
 * partial merge: a look you can only understand by reading three other looks
 * first is a look nobody will edit with confidence.
 */

export interface CaptionPreset {
  id: string;
  name: string;
  /** One line, in the editor. Says what it does, not what it is called. */
  blurb: string;
  /** Rough grouping for the picker. */
  family: 'quiet' | 'punchy' | 'loud' | 'editorial';
  /** Short-form, long-form, or both — a 9:16 hook look is wrong on a 10-minute talk. */
  bestFor: 'short' | 'long' | 'both';
  style: CaptionStyle;
}

/** Fields nearly every preset agrees on. Spelled out per preset anyway — see above. */
const NO_SHADOW = null;
const SOFT_SHADOW = { offsetX: 0, offsetY: 4, blur: 24, color: 'rgba(0,0,0,0.55)' };
const HARD_SHADOW = { offsetX: 0, offsetY: 6, blur: 0, color: 'rgba(0,0,0,0.9)' };

export const CAPTION_PRESETS: CaptionPreset[] = [
  /* ───────────────────────────────────────────────────────────── quiet ─── */
  {
    id: 'clean-plate',
    name: 'Clean plate',
    blurb: 'A dark rounded plate under white text. Readable over anything.',
    family: 'quiet',
    bestFor: 'both',
    style: {
      preset: 'clean-plate',
      animation: 'karaoke',
      fontFamily: 'Plus Jakarta Sans',
      fontWeight: 700,
      italic: false,
      fontSizeRatio: 0.046,
      letterSpacing: -0.015,
      lineHeight: 1.22,
      uppercase: false,
      maxWordsPerCue: 5,
      maxLines: 2,
      align: 'center',
      positionY: 0.78,
      widthRatio: 0.84,
      color: '#FFFFFF',
      emphasisColor: '#9B7BFF',
      activeColor: '#9B7BFF',
      gradient: null,
      stroke: null,
      shadow: NO_SHADOW,
      glow: null,
      background: { color: 'rgba(13,13,16,0.72)', padding: 18, radius: 14 },
      wordBox: null,
      emphasisStyle: null,
    },
  },
  {
    id: 'subtitle',
    name: 'Subtitle',
    blurb: 'Small, bottom, out of the way. When the picture is the point.',
    family: 'quiet',
    bestFor: 'long',
    style: {
      preset: 'subtitle',
      animation: 'line-fade',
      fontFamily: 'Inter',
      fontWeight: 600,
      italic: false,
      fontSizeRatio: 0.036,
      letterSpacing: -0.005,
      lineHeight: 1.3,
      uppercase: false,
      maxWordsPerCue: 8,
      maxLines: 2,
      align: 'center',
      positionY: 0.87,
      widthRatio: 0.78,
      color: '#FFFFFF',
      emphasisColor: '#FFFFFF',
      activeColor: null,
      gradient: null,
      stroke: null,
      shadow: SOFT_SHADOW,
      glow: null,
      background: { color: 'rgba(0,0,0,0.6)', padding: 12, radius: 8 },
      wordBox: null,
      emphasisStyle: null,
    },
  },
  {
    id: 'soft',
    name: 'Soft',
    blurb: 'Rounded type on a rounded plate. Takes the edge off a hard message.',
    family: 'quiet',
    bestFor: 'both',
    style: {
      preset: 'soft',
      animation: 'line-fade',
      fontFamily: 'Rubik',
      fontWeight: 600,
      italic: false,
      fontSizeRatio: 0.048,
      letterSpacing: -0.01,
      lineHeight: 1.25,
      uppercase: false,
      maxWordsPerCue: 5,
      maxLines: 2,
      align: 'center',
      positionY: 0.76,
      widthRatio: 0.82,
      color: '#F5F5F7',
      emphasisColor: '#B39AFF',
      activeColor: null,
      gradient: null,
      stroke: null,
      shadow: NO_SHADOW,
      glow: null,
      background: { color: 'rgba(25,25,31,0.82)', padding: 20, radius: 22 },
      wordBox: null,
      emphasisStyle: null,
    },
  },
  {
    id: 'podcast',
    name: 'Podcast',
    blurb: 'Two calm lines in the lower third, the current word lit.',
    family: 'quiet',
    bestFor: 'long',
    style: {
      preset: 'podcast',
      animation: 'karaoke',
      fontFamily: 'Figtree',
      fontWeight: 600,
      italic: false,
      fontSizeRatio: 0.042,
      letterSpacing: -0.01,
      lineHeight: 1.32,
      uppercase: false,
      maxWordsPerCue: 7,
      maxLines: 2,
      align: 'center',
      positionY: 0.82,
      widthRatio: 0.8,
      color: 'rgba(245,245,247,0.7)',
      emphasisColor: '#FFFFFF',
      activeColor: '#FFFFFF',
      gradient: null,
      stroke: null,
      shadow: SOFT_SHADOW,
      glow: null,
      background: null,
      wordBox: null,
      emphasisStyle: null,
    },
  },

  /* ──────────────────────────────────────────────────────────── punchy ─── */
  {
    id: 'bold-pop',
    name: 'Bold pop',
    blurb: 'Words spring in one at a time. The default short-form look.',
    family: 'punchy',
    bestFor: 'short',
    style: {
      preset: 'bold-pop',
      animation: 'word-pop',
      fontFamily: 'Plus Jakarta Sans',
      fontWeight: 800,
      italic: false,
      fontSizeRatio: 0.058,
      letterSpacing: -0.025,
      lineHeight: 1.12,
      uppercase: false,
      maxWordsPerCue: 4,
      maxLines: 2,
      align: 'center',
      positionY: 0.74,
      widthRatio: 0.86,
      color: '#FFFFFF',
      emphasisColor: '#9B7BFF',
      activeColor: null,
      gradient: null,
      stroke: { width: 6, color: 'rgba(0,0,0,0.85)' },
      shadow: SOFT_SHADOW,
      glow: null,
      background: null,
      wordBox: null,
      emphasisStyle: null,
    },
  },
  {
    id: 'highlight-box',
    name: 'Highlight box',
    blurb: 'The word being spoken sits on a coloured plate. Impossible to lose.',
    family: 'punchy',
    bestFor: 'short',
    style: {
      preset: 'highlight-box',
      animation: 'word-box',
      fontFamily: 'Poppins',
      fontWeight: 700,
      italic: false,
      fontSizeRatio: 0.055,
      letterSpacing: -0.02,
      lineHeight: 1.35,
      uppercase: false,
      maxWordsPerCue: 4,
      maxLines: 2,
      align: 'center',
      positionY: 0.72,
      widthRatio: 0.84,
      color: '#FFFFFF',
      emphasisColor: '#FFFFFF',
      activeColor: '#0D0D10',
      gradient: null,
      stroke: null,
      shadow: SOFT_SHADOW,
      glow: null,
      background: null,
      wordBox: { color: '#9B7BFF', padding: 8, radius: 10 },
      emphasisStyle: null,
    },
  },
  {
    id: 'neon',
    name: 'Neon',
    blurb: 'Bright type with a coloured bloom behind it. Reads on dark footage.',
    family: 'punchy',
    bestFor: 'short',
    style: {
      preset: 'neon',
      animation: 'word-pop',
      fontFamily: 'Outfit',
      fontWeight: 800,
      italic: false,
      fontSizeRatio: 0.056,
      letterSpacing: -0.015,
      lineHeight: 1.15,
      uppercase: false,
      maxWordsPerCue: 4,
      maxLines: 2,
      align: 'center',
      positionY: 0.73,
      widthRatio: 0.86,
      color: '#EAFBFF',
      emphasisColor: '#64E9FF',
      activeColor: null,
      gradient: null,
      stroke: { width: 3, color: 'rgba(8,24,32,0.9)' },
      shadow: NO_SHADOW,
      glow: { color: 'rgba(100,233,255,0.85)', blur: 26 },
      background: null,
      wordBox: null,
      emphasisStyle: null,
    },
  },
  {
    id: 'gradient',
    name: 'Gradient',
    blurb: 'Heavy type filled with a violet fade. Lands as one block.',
    family: 'punchy',
    bestFor: 'short',
    style: {
      preset: 'gradient',
      animation: 'scale-in',
      fontFamily: 'Montserrat',
      fontWeight: 900,
      italic: false,
      fontSizeRatio: 0.06,
      letterSpacing: -0.03,
      lineHeight: 1.08,
      uppercase: true,
      maxWordsPerCue: 3,
      maxLines: 2,
      align: 'center',
      positionY: 0.72,
      widthRatio: 0.88,
      color: '#FFFFFF',
      emphasisColor: '#FFFFFF',
      activeColor: null,
      gradient: { from: '#FFFFFF', to: '#9B7BFF', angle: 180 },
      stroke: { width: 5, color: 'rgba(13,13,16,0.9)' },
      shadow: SOFT_SHADOW,
      glow: null,
      background: null,
      wordBox: null,
      emphasisStyle: null,
    },
  },
  {
    id: 'mono',
    name: 'Mono',
    blurb: 'Technical and tight, one word at a time, no easing.',
    family: 'punchy',
    bestFor: 'both',
    style: {
      preset: 'mono',
      animation: 'typewriter',
      fontFamily: 'Space Grotesk',
      fontWeight: 700,
      italic: false,
      fontSizeRatio: 0.048,
      letterSpacing: -0.01,
      lineHeight: 1.2,
      uppercase: false,
      maxWordsPerCue: 5,
      maxLines: 2,
      align: 'center',
      positionY: 0.76,
      widthRatio: 0.84,
      color: '#FFFFFF',
      emphasisColor: '#5BD6A0',
      activeColor: null,
      gradient: null,
      stroke: { width: 4, color: 'rgba(0,0,0,0.8)' },
      shadow: NO_SHADOW,
      glow: null,
      background: null,
      wordBox: null,
      emphasisStyle: null,
    },
  },

  /* ────────────────────────────────────────────────────────────── loud ─── */
  {
    id: 'spotlight',
    name: 'Spotlight',
    blurb: 'Heavy caps, soft shadow, built for one word in a script to cut across it.',
    family: 'loud',
    bestFor: 'short',
    style: {
      preset: 'spotlight',
      animation: 'word-pop',
      fontFamily: 'Anton',
      fontWeight: 400,
      italic: false,
      fontSizeRatio: 0.068,
      letterSpacing: -0.005,
      /*
       * TIGHT, and that is the whole point of this preset.
       *
       * The look it exists for has a script word riding up into the line
       * above. At a normal 1.1 line height there is a corridor of empty space
       * between the lines for it to sit politely inside, and "politely inside"
       * is exactly what it must not look like. At 0.92 the lines are close
       * enough that a word nudged upward genuinely crosses the one above.
       */
      lineHeight: 0.92,
      uppercase: true,
      maxWordsPerCue: 3,
      maxLines: 2,
      align: 'center',
      positionY: 0.68,
      widthRatio: 0.92,
      color: '#FFFFFF',
      emphasisColor: '#2AD6FF',
      activeColor: null,
      /* Barely a gradient. White to a cool near-white, which reads as light
         falling across the letters rather than as a coloured fill — the thing
         that stops heavy white caps looking like a subtitle track. */
      gradient: { from: '#FFFFFF', to: '#E4EAF4', angle: 180 },
      /*
       * A thin outline, not a thick one.
       *
       * The references this is built from separate their lines with a soft
       * shadow and the barest dark edge. A ten-pixel outline — the `impact`
       * setting — turns the frame into a sticker sheet and flattens the
       * script word's glow against it.
       */
      /*
       * Barely there, and deliberately so.
       *
       * A dark ring fights the glow on a highlighted word: the glow is light
       * spilling OUT of the letter and the ring is a hard edge stopping it, so
       * the two cancel and the word reads as outlined rather than lit. The
       * separation from the footage comes from the shadow below instead, which
       * sits under the whole line and does not touch the letterform.
       */
      stroke: { width: 1.5, color: 'rgba(0,0,0,0.45)' },
      shadow: { offsetX: 0, offsetY: 7, blur: 22, color: 'rgba(0,0,0,0.55)' },
      glow: null,
      background: null,
      wordBox: null,
      /*
       * THE POINT OF THIS PRESET.
       *
       * Everything above is a competent heavy caption; this is the part
       * somebody picks it for. The director already marks the word worth
       * leaning on, and here that word becomes a brush script, half again as
       * large, in its own lit gradient, riding up into the line above.
       *
       * Lowercase whatever the line says, because a brush script is made of
       * the strokes that JOIN lowercase letters — set in caps it is a row of
       * disconnected shapes. Colours sampled off the reference frame: deeper
       * blue at the top, bright cyan at the bottom, which reads as light
       * falling from above rather than as a puddle.
       */
      emphasisStyle: {
        fontFamily: 'Yellowtail',
        uppercase: false,
        gradient: { from: '#2AB9FB', to: '#24F6FF', angle: 180 },
        glow: { color: 'rgba(42,214,255,0.55)', blur: 26 },
        scale: 1.35,
        offsetY: -0.12,
      },
    },
  },

  {
    id: 'impact',
    name: 'Impact',
    blurb: 'Condensed caps with a thick black outline. Shouts, in a good way.',
    family: 'loud',
    bestFor: 'short',
    style: {
      preset: 'impact',
      animation: 'bounce',
      fontFamily: 'Anton',
      fontWeight: 400,
      italic: false,
      fontSizeRatio: 0.072,
      letterSpacing: 0,
      lineHeight: 1.02,
      uppercase: true,
      maxWordsPerCue: 3,
      maxLines: 2,
      align: 'center',
      positionY: 0.7,
      widthRatio: 0.9,
      color: '#FFFFFF',
      emphasisColor: '#FFE14D',
      activeColor: null,
      gradient: null,
      stroke: { width: 10, color: '#000000' },
      shadow: HARD_SHADOW,
      glow: null,
      background: null,
      wordBox: null,
      emphasisStyle: null,
    },
  },
  {
    id: 'cartoon',
    name: 'Cartoon',
    blurb: 'Comic shout with a hard drop shadow. Kids, gaming, high energy.',
    family: 'loud',
    bestFor: 'short',
    style: {
      preset: 'cartoon',
      animation: 'shake',
      fontFamily: 'Luckiest Guy',
      fontWeight: 400,
      italic: false,
      fontSizeRatio: 0.066,
      letterSpacing: 0.01,
      lineHeight: 1.1,
      uppercase: true,
      maxWordsPerCue: 3,
      maxLines: 2,
      align: 'center',
      positionY: 0.71,
      widthRatio: 0.88,
      color: '#FFFFFF',
      emphasisColor: '#FFD23F',
      activeColor: null,
      gradient: null,
      stroke: { width: 12, color: '#101014' },
      shadow: { offsetX: 6, offsetY: 8, blur: 0, color: 'rgba(0,0,0,0.85)' },
      glow: null,
      background: null,
      wordBox: null,
      emphasisStyle: null,
    },
  },
  {
    id: 'slab',
    name: 'Slab',
    blurb: 'One immovable block of type. Nothing animates, nothing needs to.',
    family: 'loud',
    bestFor: 'short',
    style: {
      preset: 'slab',
      animation: 'slide-up',
      fontFamily: 'Archivo Black',
      fontWeight: 400,
      italic: false,
      fontSizeRatio: 0.062,
      letterSpacing: -0.02,
      lineHeight: 1.08,
      uppercase: true,
      maxWordsPerCue: 3,
      maxLines: 2,
      align: 'center',
      positionY: 0.73,
      widthRatio: 0.88,
      color: '#0D0D10',
      emphasisColor: '#0D0D10',
      activeColor: null,
      gradient: null,
      stroke: null,
      shadow: NO_SHADOW,
      glow: null,
      background: { color: '#9B7BFF', padding: 16, radius: 6 },
      wordBox: null,
      emphasisStyle: null,
    },
  },
  {
    id: 'ticker',
    name: 'Ticker',
    blurb: 'Tall caps, wide tracking, rising into place. Trailer energy.',
    family: 'loud',
    bestFor: 'short',
    style: {
      preset: 'ticker',
      animation: 'slide-up',
      fontFamily: 'Bebas Neue',
      fontWeight: 400,
      italic: false,
      fontSizeRatio: 0.078,
      letterSpacing: 0.06,
      lineHeight: 1.0,
      uppercase: true,
      maxWordsPerCue: 4,
      maxLines: 2,
      align: 'center',
      positionY: 0.74,
      widthRatio: 0.9,
      color: '#FFFFFF',
      emphasisColor: '#9B7BFF',
      activeColor: null,
      gradient: null,
      stroke: null,
      shadow: SOFT_SHADOW,
      glow: null,
      background: null,
      wordBox: null,
      emphasisStyle: null,
    },
  },

  /* ───────────────────────────────────────────────────────── editorial ─── */
  {
    id: 'newsroom',
    name: 'Newsroom',
    blurb: 'Condensed caps on a bar, aligned left. A lower third, basically.',
    family: 'editorial',
    bestFor: 'long',
    style: {
      preset: 'newsroom',
      animation: 'line-fade',
      fontFamily: 'Oswald',
      fontWeight: 600,
      italic: false,
      fontSizeRatio: 0.044,
      letterSpacing: 0.02,
      lineHeight: 1.24,
      uppercase: true,
      maxWordsPerCue: 6,
      maxLines: 2,
      align: 'left',
      positionY: 0.84,
      widthRatio: 0.7,
      color: '#FFFFFF',
      emphasisColor: '#FFE14D',
      activeColor: null,
      gradient: null,
      stroke: null,
      shadow: NO_SHADOW,
      glow: null,
      background: { color: 'rgba(13,13,16,0.86)', padding: 16, radius: 4 },
      wordBox: null,
      emphasisStyle: null,
    },
  },
  {
    id: 'editorial',
    name: 'Editorial',
    blurb: 'A high-contrast serif that fades in. Documentary, unhurried.',
    family: 'editorial',
    bestFor: 'long',
    style: {
      preset: 'editorial',
      animation: 'line-fade',
      fontFamily: 'Playfair Display',
      fontWeight: 700,
      italic: false,
      fontSizeRatio: 0.05,
      letterSpacing: -0.005,
      lineHeight: 1.26,
      uppercase: false,
      maxWordsPerCue: 6,
      maxLines: 2,
      align: 'center',
      positionY: 0.8,
      widthRatio: 0.78,
      color: '#FFFFFF',
      emphasisColor: '#E8D7A8',
      activeColor: null,
      gradient: null,
      stroke: null,
      shadow: SOFT_SHADOW,
      glow: null,
      background: null,
      wordBox: null,
      emphasisStyle: null,
    },
  },
  {
    id: 'memoir',
    name: 'Memoir',
    blurb: 'A warm reading serif, low and quiet. Captions as an aid, not a hook.',
    family: 'editorial',
    bestFor: 'long',
    style: {
      preset: 'memoir',
      animation: 'line-fade',
      fontFamily: 'Lora',
      fontWeight: 600,
      italic: true,
      fontSizeRatio: 0.04,
      letterSpacing: 0,
      lineHeight: 1.36,
      uppercase: false,
      maxWordsPerCue: 8,
      maxLines: 2,
      align: 'center',
      positionY: 0.86,
      widthRatio: 0.72,
      color: 'rgba(255,255,255,0.92)',
      emphasisColor: '#FFFFFF',
      activeColor: null,
      gradient: null,
      stroke: null,
      shadow: SOFT_SHADOW,
      glow: null,
      background: null,
      wordBox: null,
      emphasisStyle: null,
    },
  },
];

export const CAPTION_PRESET_IDS = CAPTION_PRESETS.map((p) => p.id);

export function findCaptionPreset(id: string): CaptionPreset | undefined {
  return CAPTION_PRESETS.find((p) => p.id === id);
}

/**
 * The preset a style came from, or null if the user has since edited it.
 *
 * Worth being exact about: an editor that says "Impact" over a style whose
 * colours and size no longer match Impact is lying, and the next person to open
 * the project will not know which of the two to trust.
 */
export function captionPresetFor(style: CaptionStyle): CaptionPreset | null {
  const preset = findCaptionPreset(style.preset);
  if (!preset) return null;
  return JSON.stringify(preset.style) === JSON.stringify(style) ? preset : null;
}
