import { z } from 'zod';

/**
 * The EDL (Edit Decision List) is the single source of truth for a finished
 * video. The AI never renders pixels — it produces one of these, and a
 * deterministic renderer executes it.
 *
 * TIMEBASE: every number ending in `Sec` is seconds.
 *   - `sourceStart`/`sourceEnd` are timestamps in the ORIGINAL uploaded file.
 *   - everything else is in OUTPUT time (the finished video's own clock).
 * Frames are only computed at the renderer boundary, so an EDL is fps-agnostic
 * and the same document can be rendered at 30 or 60 fps.
 */

export const ASPECTS = ['9:16', '1:1', '16:9', '4:5'] as const;
export type Aspect = (typeof ASPECTS)[number];

export const ASPECT_DIMENSIONS: Record<Aspect, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '16:9': { width: 1920, height: 1080 },
};

/* ------------------------------------------------------------------ format */

/**
 * How the frame is divided between the speaker and everything else.
 *
 *  - `full`  — the speaker fills the frame and B-roll cuts in over the top.
 *  - `split` — the speaker holds the upper half, B-roll runs underneath for the
 *              whole video, and the captions sit on the seam. The shape that
 *              made short-form watchable on mute.
 *  - `side`  — the widescreen version of the same idea: speaker left, pictures
 *              right, both on screen throughout.
 *
 * This is a property of the DOCUMENT, not of the renderer, because the picker
 * draws it and the composition executes it from the same number. A style that
 * advertises a split screen and renders a full frame is a lie, and the only way
 * to make that impossible is to have one source of truth.
 */
export const LAYOUTS = ['full', 'split', 'side', 'reaction', 'bubble', 'headline', 'screencast', 'cinema'] as const;
export type Layout = (typeof LAYOUTS)[number];

export const FormatSchema = z.object({
  aspect: z.enum(ASPECTS),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive().default(30),
  durationSec: z.number().nonnegative(),
  layout: z.enum(LAYOUTS).default('full'),
});
export type Format = z.infer<typeof FormatSchema>;

/* ------------------------------------------------------------------ source */

export const SourceSchema = z.object({
  assetId: z.string(),
  url: z.string(),
  /** Low-res proxy used for scrubbing in the browser editor. */
  proxyUrl: z.string().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  durationSec: z.number().nonnegative(),
  hasAudio: z.boolean().default(true),
});
export type Source = z.infer<typeof SourceSchema>;

/* ---------------------------------------------------------------- segments */

/** Why a slice of the source survived, or why the gap before it was removed. */
export const CUT_REASONS = [
  'keep',            // ordinary speech
  'hook',            // relocated to the top of a short
  'silence',         // dead air
  'filler',          // "um", "uh", standalone
  'false-start',     // abandoned clause
  'retake',          // an earlier attempt at a line delivered again later
  'off-topic',       // director judged it irrelevant
  'manual',          // the user cut it themselves in the editor
] as const;
export type CutReason = (typeof CUT_REASONS)[number];

export const SegmentSchema = z.object({
  id: z.string(),
  /** Slice of the source file. */
  sourceStartSec: z.number().nonnegative(),
  sourceEndSec: z.number().nonnegative(),
  /** Where that slice lands in the finished video. */
  outStartSec: z.number().nonnegative(),
  outEndSec: z.number().nonnegative(),
  /** 1 = realtime. Used for gentle "tighten the dull bit" ramps. */
  speed: z.number().positive().default(1),
  reason: z.enum(CUT_REASONS).default('keep'),
  /** Transcript text covered by this segment — handy for debugging and the UI. */
  text: z.string().default(''),
});
export type Segment = z.infer<typeof SegmentSchema>;

/* ---------------------------------------------------------------- captions */

/**
 * One word styled differently from the rest of its line.
 *
 * ── Why the word, and not the line, is the unit ──────────────────────────
 *
 * A caption used to carry exactly one styling fact per word: `emphasis`,
 * true or false, which meant the accent colour and a bit more weight. That is
 * enough for sixteen clean presets and nowhere near enough for the look people
 * actually want, where one word in a line is a different TYPEFACE, in a
 * gradient, larger, on a slant, crossing the lines above and below it.
 *
 * Every field is optional and every one falls back to the line's own style, so
 * a word with no override renders exactly as it always did — this widened what
 * is possible without changing a single existing caption.
 */
export const CaptionWordStyleSchema = z.object({
  /** A different face for this word. Must be a family id in CAPTION_FONTS. */
  fontFamily: z.string().nullable().optional(),
  fontWeight: z.number().nullable().optional(),
  italic: z.boolean().nullable().optional(),
  /** Multiplier on the line's font size. 1.4 is noticeably bigger, not shouting. */
  scale: z.number().nullable().optional(),
  color: z.string().nullable().optional(),
  /** Fills this word's glyphs with a gradient, independent of the line's. */
  gradient: z.object({ from: z.string(), to: z.string(), angle: z.number().default(180) })
    .nullable().optional(),
  /** Degrees. A degree or two is a designed slant; ten is a mistake. */
  rotate: z.number().nullable().optional(),
  /**
   * Vertical nudge in em, so it tracks the type size.
   *
   * This is what lets a word overlap the lines around it rather than sit
   * politely between them — the single detail that separates the reference
   * look from "a coloured word".
   */
  offsetY: z.number().nullable().optional(),
  /**
   * Opt this word out of the line's uppercase, or into it.
   *
   * A script face in ALL CAPS is not the same look with different letters, it
   * is a different and much worse one — the connecting strokes a brush script
   * is made of only exist between lowercase letters. The first render of this
   * style came back with a capitalised script word and that single fact was
   * most of why it did not match.
   */
  uppercase: z.boolean().nullable().optional(),
  /**
   * A coloured bloom around this word only.
   *
   * The reference looks this exists for all carry one: a script word in a
   * bright colour reads as lit rather than merely coloured, and that is the
   * glow. Without it the word is the right hue and still looks flat beside
   * the footage.
   */
  glow: z.object({ color: z.string(), blur: z.number() }).nullable().optional(),
  /** Drawn behind this word only. Overrides the line's wordBox while active. */
  box: z.object({
    color: z.string(),
    padding: z.number().default(6),
    radius: z.number().default(8),
  }).nullable().optional(),
});
export type CaptionWordStyle = z.infer<typeof CaptionWordStyleSchema>;

export const CaptionWordSchema = z.object({
  text: z.string(),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  /** Director-chosen emphasis — rendered in the accent colour / scaled up. */
  emphasis: z.boolean().default(false),
  /**
   * Hand-set overrides for this one word. Null is the normal case: the word
   * takes the line's style, which is what every caption did before this
   * existed.
   */
  style: CaptionWordStyleSchema.nullable().optional(),
});
export type CaptionWord = z.infer<typeof CaptionWordSchema>;

/** A caption "card": the group of words on screen at one time. */
export const CaptionCueSchema = z.object({
  id: z.string(),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  words: z.array(CaptionWordSchema),
});
export type CaptionCue = z.infer<typeof CaptionCueSchema>;

export const CAPTION_ANIMATIONS = [
  'karaoke',     // whole line visible, active word highlighted
  'word-pop',    // words appear one at a time with a spring
  'line-fade',   // whole line fades in
  'typewriter',  // words appear with no animation at all
  'bounce',      // word-pop with an overshoot, very "punchy" preset
  'word-box',    // whole line visible, active word sits on a filled plate
  'slide-up',    // the line rises into place from below
  'scale-in',    // the line scales up into place
  'shake',       // emphasis words jitter as they land
] as const;
export type CaptionAnimation = (typeof CAPTION_ANIMATIONS)[number];

/**
 * Shadow, as four numbers rather than a boolean.
 *
 * `shadow: true` could only ever mean one shadow. A hard offset drop shadow and
 * a soft ambient one are different looks, and the difference between a caption
 * that survives a bright background and one that does not is usually this.
 */
export const CaptionShadowSchema = z.object({
  offsetX: z.number().default(0),
  offsetY: z.number().default(4),
  blur: z.number().default(24),
  color: z.string().default('rgba(0,0,0,0.55)'),
});
export type CaptionShadow = z.infer<typeof CaptionShadowSchema>;

export const CaptionStyleSchema = z.object({
  /** Which preset this came from — provenance, so the editor can show it. */
  preset: z.string().default('bold-pop'),
  animation: z.enum(CAPTION_ANIMATIONS).default('word-pop'),

  /* ---- type ---- */
  /** Must be a family id in CAPTION_FONTS; anything else falls back. */
  fontFamily: z.string().default('Plus Jakarta Sans'),
  fontWeight: z.number().default(800),
  italic: z.boolean().default(false),
  /** Fraction of output HEIGHT, so it scales across aspects. */
  fontSizeRatio: z.number().default(0.058),
  /** In em, so it tracks the size. Negative tightens. */
  letterSpacing: z.number().default(-0.02),
  lineHeight: z.number().default(1.12),
  uppercase: z.boolean().default(false),

  /* ---- layout ---- */
  maxWordsPerCue: z.number().int().default(4),
  /** Hard cap on how much of the frame the captions may ever eat. */
  maxLines: z.number().int().default(2),
  align: z.enum(['left', 'center', 'right']).default('center'),
  /** Vertical anchor, 0 = top, 1 = bottom. */
  positionY: z.number().default(0.74),
  /** Text column width as a fraction of frame width. */
  widthRatio: z.number().default(0.86),

  /* ---- colour ---- */
  color: z.string().default('#FFFFFF'),
  emphasisColor: z.string().default('#9B7BFF'),
  /** The word being spoken right now, for karaoke and word-box. Null = emphasisColor. */
  activeColor: z.string().nullable().default(null),
  /** Fills the glyphs with a gradient instead of a flat colour. */
  gradient: z.object({ from: z.string(), to: z.string(), angle: z.number().default(180) })
    .nullable().default(null),

  /* ---- decoration ---- */
  stroke: z.object({ width: z.number(), color: z.string() }).nullable().default(null),
  shadow: CaptionShadowSchema.nullable().default({ offsetX: 0, offsetY: 4, blur: 24, color: 'rgba(0,0,0,0.55)' }),
  /** A coloured bloom around the glyphs. Stacks with shadow. */
  glow: z.object({ color: z.string(), blur: z.number() }).nullable().default(null),
  /** Rounded plate behind the whole line. */
  background: z.object({
    color: z.string(),
    padding: z.number(),
    radius: z.number(),
  }).nullable().default(null),
  /**
   * What an EMPHASISED word looks like.
   *
   * ── Why a whole style and not just a colour ─────────────────────────────
   *
   * `emphasisColor` could only ever mean "the same words, in a different
   * colour". The look people actually ask for — a heavy line interrupted by
   * one word in a brush script, larger, glowing, crossing the line above — is
   * six decisions, and none of them is the colour.
   *
   * Putting it on the STYLE is what makes it a preset rather than a chore.
   * The director already marks the word worth leaning on; this says what
   * happens to it. Without this, picking the preset gave you a plain line and
   * the highlight had to be applied to every video by hand, one word at a
   * time — which is the same as not having it.
   *
   * A word's own `style` still wins: a deliberate choice outranks a rule.
   */
  emphasisStyle: CaptionWordStyleSchema.nullable().default(null),
  /**
   * Put the emphasised word on a line of its own, underneath.
   *
   * ── Why this is a rule and not a preference ─────────────────────────────
   *
   * A word in a different face, a different size and a different colour,
   * sitting mid-sentence between two words of the base style, reads as a
   * mistake — the eye takes it for a rendering fault rather than a decision.
   * Every version of this look in the wild puts the highlight on its own line
   * BELOW the plain one, and that is what makes it read as designed:
   *
   *     WATCHING WAS
   *       entirely
   *
   * It also solves the collision. A script word one and a half times the size
   * of its neighbours, nudged upward to overlap, has to overlap SOMETHING —
   * and on its own line that something is empty space above it rather than the
   * word next to it.
   */
  emphasisOwnLine: z.boolean().default(false),
  /**
   * The shortest word worth setting in the highlight face.
   *
   * A highlight is a whole line to itself, in another typeface, half again as
   * large. Spend that on "to" and it reads as a glitch: the line below the
   * sentence holds a word carrying none of its meaning, blown up and
   * flourished for no reason. Five letters is where a word starts to look
   * like the point of the sentence rather than a joint in it.
   *
   * Only consulted where the highlight owns a line — a preset that merely
   * recolours a word can recolour any word it likes.
   */
  emphasisMinChars: z.number().int().min(1).max(20).default(5),
  /** Rounded plate behind just the word being spoken. */
  wordBox: z.object({
    color: z.string(),
    padding: z.number().default(6),
    radius: z.number().default(8),
  }).nullable().default(null),
});
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;

/* ------------------------------------------------------------------- broll */

export const BrollClipSchema = z.object({
  id: z.string(),
  outStartSec: z.number().nonnegative(),
  outEndSec: z.number().nonnegative(),
  kind: z.enum(['stock-video', 'stock-photo', 'generated-image']),
  url: z.string(),
  /** Where in the stock clip to start — stock footage often has a dull head. */
  clipStartSec: z.number().nonnegative().default(0),
  /** 1 = covers the frame, <1 = picture-in-picture inset. */
  scale: z.number().default(1),
  /** Slow push/pan applied over the insert so stills never feel static. */
  kenBurns: z.enum(['none', 'in', 'out', 'pan-left', 'pan-right']).default('in'),
  /** Speech keeps playing underneath; this is the B-roll's own audio level. */
  audioGainDb: z.number().default(-60),
  opacity: z.number().default(1),
  /** The director's reason — surfaced in the editor so the user can judge it. */
  intent: z.string().default(''),
  query: z.string().default(''),
  attribution: z.string().optional(),
});
export type BrollClip = z.infer<typeof BrollClipSchema>;

/* ---------------------------------------------------------------- graphics */

export const GRAPHIC_TYPES = [
  'icon',        // animated SVG/PNG icon with a label
  'stat',        // big number + caption
  'list',        // bullets that build in one by one
  'title-card',  // full-frame title, usually at 0s
  'quote',
  'arrow',       // pointer/annotation aimed at a screen position
  'image',       // generated or fetched illustration
] as const;
export type GraphicType = (typeof GRAPHIC_TYPES)[number];

export const GRAPHIC_ANIMATIONS = ['pop', 'slide-up', 'slide-left', 'fade', 'draw', 'count-up'] as const;

export const GraphicElementSchema = z.object({
  id: z.string(),
  type: z.enum(GRAPHIC_TYPES),
  outStartSec: z.number().nonnegative(),
  outEndSec: z.number().nonnegative(),
  animation: z.enum(GRAPHIC_ANIMATIONS).default('pop'),
  /** Normalised 0..1 position of the element's centre. */
  x: z.number().default(0.5),
  y: z.number().default(0.28),
  scale: z.number().default(1),
  text: z.string().default(''),
  subtext: z.string().default(''),
  items: z.array(z.string()).default([]),
  /** Resolved asset URL (Iconify SVG, generated PNG, …). */
  assetUrl: z.string().nullable().default(null),
  /** What we asked for, kept so the user can re-roll it. */
  iconQuery: z.string().default(''),
  imagePrompt: z.string().default(''),
  color: z.string().default('#9B7BFF'),
});
export type GraphicElement = z.infer<typeof GraphicElementSchema>;

/* ---------------------------------------------------------------- overlays */

export const OVERLAY_TYPES = ['lower-third', 'progress-bar', 'chapter-card', 'end-card', 'watermark', 'vignette', 'grain'] as const;

export const OverlayElementSchema = z.object({
  id: z.string(),
  type: z.enum(OVERLAY_TYPES),
  outStartSec: z.number().nonnegative(),
  outEndSec: z.number().nonnegative(),
  text: z.string().default(''),
  subtext: z.string().default(''),
  color: z.string().default('#9B7BFF'),
  opacity: z.number().default(1),
});
export type OverlayElement = z.infer<typeof OverlayElementSchema>;

/* ------------------------------------------------------------- transitions */

export const TRANSITION_TYPES = [
  'none', 'cut', 'dissolve', 'whip-pan', 'zoom-punch', 'glitch', 'slide', 'flash', 'film-burn',
] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

export const TransitionCueSchema = z.object({
  id: z.string(),
  /** Transition is centred on this output timestamp (the cut point). */
  atSec: z.number().nonnegative(),
  type: z.enum(TRANSITION_TYPES),
  durationSec: z.number().positive().default(0.25),
});
export type TransitionCue = z.infer<typeof TransitionCueSchema>;

/* -------------------------------------------------------------- camera fx */

/** A punch-in: the "second camera" that makes a single-take talking head watchable. */
export const PunchInSchema = z.object({
  id: z.string(),
  outStartSec: z.number().nonnegative(),
  outEndSec: z.number().nonnegative(),
  /** Target zoom, e.g. 1.18 = 18 % tighter. */
  scale: z.number().default(1.15),
  /** Normalised focal point — usually the face centre from the reframe track. */
  x: z.number().default(0.5),
  y: z.number().default(0.42),
  easing: z.enum(['snap', 'ramp']).default('snap'),
});
export type PunchIn = z.infer<typeof PunchInSchema>;

/** Crop path for turning landscape footage into vertical without beheading anyone. */
export const ReframeKeyframeSchema = z.object({
  outSec: z.number().nonnegative(),
  /** Centre of the crop window, normalised against the SOURCE frame. */
  cx: z.number(),
  cy: z.number(),
  /** Crop window width as a fraction of source width. */
  w: z.number(),
});
export type ReframeKeyframe = z.infer<typeof ReframeKeyframeSchema>;

export const ReframeTrackSchema = z.object({
  keyframes: z.array(ReframeKeyframeSchema),
  /** How the track was derived — shown in the editor's "why does it look like this". */
  method: z.enum(['face-track', 'saliency', 'center', 'manual']).default('center'),
});
export type ReframeTrack = z.infer<typeof ReframeTrackSchema>;

/* ------------------------------------------------------------------- audio */

export const SfxCueSchema = z.object({
  id: z.string(),
  atSec: z.number().nonnegative(),
  /** Key into the bundled SFX library. */
  sound: z.string(),
  gainDb: z.number().default(-12),
  url: z.string().optional(),
});
export type SfxCue = z.infer<typeof SfxCueSchema>;

export const MusicTrackSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string().default(''),
  mood: z.string().default(''),
  bpm: z.number().nullable().default(null),
  /** Bed level before ducking. */
  gainDb: z.number().default(-18),
  /** Extra attenuation applied while speech is present. */
  duckDb: z.number().default(-12),
  startAtSec: z.number().default(0),
  fadeInSec: z.number().default(0.8),
  fadeOutSec: z.number().default(1.5),
  attribution: z.string().optional(),
});
export type MusicTrack = z.infer<typeof MusicTrackSchema>;

export const AudioSettingsSchema = z.object({
  /** Broadcast target. −14 LUFS is the social-platform consensus. */
  targetLufs: z.number().default(-14),
  denoise: z.boolean().default(true),
  /** Removes the low rumble of a room / desk bumps. */
  highPassHz: z.number().default(80),
  compress: z.boolean().default(true),
});
export type AudioSettings = z.infer<typeof AudioSettingsSchema>;

/* --------------------------------------------------------------- metadata */

export const DeliverableSchema = z.object({
  title: z.string().default(''),
  socialCaption: z.string().default(''),
  hashtags: z.array(z.string()).default([]),
  /** Output-time seconds of the most visually interesting frame. */
  thumbnailAtSec: z.number().default(0),
  chapters: z.array(z.object({ atSec: z.number(), title: z.string() })).default([]),
});
export type Deliverable = z.infer<typeof DeliverableSchema>;

/* ------------------------------------------------------------------- root */

export const EdlSchema = z.object({
  version: z.literal('1.0'),
  projectId: z.string(),
  styleId: z.string(),
  /**
   * Whether the finished video carries the EasyCut mark.
   *
   * Deliberately a property of the EDL's root rather than an entry in
   * `overlays`: an overlay is something the director chose and the customer
   * may delete in the editor, and a watermark you can delete is not a
   * watermark. This is set from the plan when the edit is built, defaults to
   * false so a self-hosted clone is unmarked, and the editor never offers it
   * as a layer.
   */
  watermark: z.boolean().default(false),
  format: FormatSchema,
  source: SourceSchema,
  segments: z.array(SegmentSchema),
  captions: z.array(CaptionCueSchema).default([]),
  captionStyle: CaptionStyleSchema,
  broll: z.array(BrollClipSchema).default([]),
  graphics: z.array(GraphicElementSchema).default([]),
  overlays: z.array(OverlayElementSchema).default([]),
  transitions: z.array(TransitionCueSchema).default([]),
  punchIns: z.array(PunchInSchema).default([]),
  reframe: ReframeTrackSchema.nullable().default(null),
  sfx: z.array(SfxCueSchema).default([]),
  music: MusicTrackSchema.nullable().default(null),
  audio: AudioSettingsSchema,
  deliverable: DeliverableSchema,
  /** Layers that were skipped because a provider was unavailable. */
  degraded: z.array(z.string()).default([]),
});
export type Edl = z.infer<typeof EdlSchema>;

export function parseEdl(input: unknown): Edl {
  return EdlSchema.parse(input);
}

/** Total output duration implied by the segment list. */
export function edlDuration(edl: Edl): number {
  return edl.segments.reduce((max, s) => Math.max(max, s.outEndSec), 0);
}

export function secToFrames(sec: number, fps: number): number {
  return Math.round(sec * fps);
}
