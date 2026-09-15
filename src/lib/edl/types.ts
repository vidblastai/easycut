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

export const FormatSchema = z.object({
  aspect: z.enum(ASPECTS),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive().default(30),
  durationSec: z.number().nonnegative(),
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

export const CaptionWordSchema = z.object({
  text: z.string(),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  /** Director-chosen emphasis — rendered in the accent colour / scaled up. */
  emphasis: z.boolean().default(false),
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
