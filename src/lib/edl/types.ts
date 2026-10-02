import { z } from 'zod';
// Relative, not `@/`: this module is in the Remotion bundle, whose webpack
// config does not carry the alias. One aliased import here fails the whole
// composition — see the note in the motion-graphics skill.
import { ART_ENTERS, ART_IDLES } from '../assets/illustration';
import { floorFor } from './safe-area';

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
  /**
   * Where somebody DRAGGED the words to, as fractions of the frame.
   *
   * Null — the default — means nobody has, and the automatic rule applies:
   * `positionY` clamped into the caption band, horizontally centred. A value
   * here is an explicit decision about this video and outranks the band; see
   * `framedPositionY` for why those are two different things and not one
   * number with a wider range.
   *
   * `x` is the CENTRE of the text column, not its left edge, so a caption
   * dragged to the middle of the frame stays there when its words change
   * length. Both are fractions so the placement survives an export at a
   * different aspect ratio.
   */
  placement: z.object({ x: z.number(), y: z.number() }).nullable().default(null),
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
   * Break every card into two lines and style the second one differently.
   *
   * A whole look rather than a tweak: line one in plain white, line two in a
   * colour, the two set tight enough to read as one block. It is everywhere in
   * short form because it does two jobs at once — the eye lands on the
   * coloured half, and a card that always has the same shape stops the caption
   * jumping about between cards.
   *
   * The split is by WIDTH, not by word count: two lines of roughly equal
   * length look composed, "four words then one" looks like a mistake.
   *
   * Distinct from `emphasisOwnLine`, which pulls ONE word out of the sentence
   * because the director marked it. This colours the back half of every card,
   * marked or not.
   */
  splitLines: z.boolean().default(false),
  /** How the second line differs. Null with `splitLines` means only the break. */
  lineTwoStyle: CaptionWordStyleSchema.nullable().default(null),
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

/* ------------------------------------------------- full-frame transitions */

/**
 * How something that COVERS the frame arrives and leaves.
 *
 * Distinct from `TRANSITION_TYPES`, which decorate a cut between two shots of
 * the speaker: those are an effect drawn on top of a moment, and these move
 * the clip itself. A B-roll insert that simply appears reads as a dropped
 * frame; one that travels in from an edge reads as an edit.
 *
 * Two families, deliberately in one list because the user picking them does
 * not care which is which:
 *
 *  - **Moves.** `slide-*` and `zoom` transform the clip. Named by the
 *    direction the clip TRAVELS, so `slide-left` comes in from the right edge
 *    and leaves past the left one — the eye follows one continuous movement
 *    through the whole insert.
 *  - **Flavours.** `glitch`, `film-burn`, `light-leak`, `flash` and `whip`
 *    snap the clip in over a short effect. The effect is the transition; the
 *    clip barely moves.
 */
export const CLIP_TRANSITIONS = [
  'cut',
  'fade',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
  'zoom',
  'whip',
  'glitch',
  'film-burn',
  'light-leak',
  'flash',
] as const;
export type ClipTransition = (typeof CLIP_TRANSITIONS)[number];

/** The ones that are a movement of the clip rather than an effect over it. */
export const CLIP_TRANSITION_MOVES: readonly ClipTransition[] = [
  'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom',
];

/**
 * What an insert can wear.
 *
 * All six are DRAWN, every frame, from the clip's own seed — there is not a
 * single overlay file anywhere in this product and that is deliberate. The
 * usual way to do this is a library of 4K ProRes plates screen-blended over
 * the picture, which means gigabytes to store and serve, a licence per plate,
 * a fixed length that has to be looped or trimmed, and a look nobody can
 * adjust afterwards. Drawn, they cost nothing, they are the exact length of
 * the insert, they scale to any aspect, and their strength is a number.
 *
 * Two groups, and the split is how visible each one is rather than how weird.
 * The subtle six are felt more than seen; the strong five are unmistakable and
 * are still, every one of them, a look somebody would actually choose — a
 * diffusion filter, an old television, 8mm stock.
 *
 * ── The line that was crossed once ──────────────────────────────────────
 *
 * An earlier pass read "more extreme" as "more destructive" and shipped
 * datamosh, duotone and halftone: inverted bands, a two-colour posterise and
 * a print screen. They were certainly visible. They were also things nobody
 * puts on their own video, because each of them throws the FOOTAGE away —
 * and the footage is what the insert is for. Visible has to mean the shot
 * looking treated, never the shot being replaced by the treatment.
 *
 * Nothing here flashes, either. A hard strobe is the obvious way to make an
 * overlay unmissable and it is a photosensitivity risk. `super8`'s gate
 * flicker is a few per cent of exposure at about four hertz, which is the
 * film tell and nowhere near the threshold.
 */
export const BROLL_OVERLAYS = [
  'none',
  /* ── quiet: felt more than seen ─────────────────────────────────────── */
  'dust',        // particles drifting through the light
  'grain',       // 16mm film grain
  'light-leak',  // a warm bloom crossing the frame
  'scanlines',   // CRT line structure and a rolling band
  'prism',       // chromatic fringe at the edges
  'vignette',    // darkened corners, nothing else
  /* ── strong: you can see it, and it still flatters the shot ─────────── */
  'bloom',       // diffusion filter: highlights bloom and halate
  'bokeh',       // out-of-focus orbs of light drifting across
  'crt',         // an old television: curved glass, phosphor stripe, bloom
  'vhs',         // a worn tape: chroma bleed, tracking, head-switch noise
  'super8',      // 8mm: warm faded stock, gate flicker, dust and hairs
] as const;
export type BrollOverlay = (typeof BROLL_OVERLAYS)[number];

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
  /**
   * How the insert arrives and leaves.
   *
   * Defaulted to `fade` rather than `cut` so a document written before these
   * existed keeps the short cross-fade it was rendered with — the same picture
   * it had, not a new one.
   */
  enter: z.enum(CLIP_TRANSITIONS).default('fade'),
  exit: z.enum(CLIP_TRANSITIONS).default('fade'),
  /**
   * A treatment painted over this insert, and only this insert.
   *
   * Scoped to the clip rather than the frame, which is the whole difference
   * between this and the `overlays` layer above: that one is the VIDEO's
   * chrome — a progress bar, a vignette over everything — and this is
   * something the insert is wearing. Grain over the B-roll and not over the
   * speaker is an edit; grain over both is a filter.
   *
   * `none` by default, so a document written before these existed renders
   * exactly the picture it rendered before.
   */
  /*
   * `.catch` rather than a bare enum, deliberately.
   *
   * Overlays get added and dropped as the set is tuned, and a stored document
   * naming one that no longer exists must degrade to an untreated insert
   * rather than failing to parse — a whole project that will not open because
   * a treatment was renamed is not a trade worth making for stricter typing.
   */
  overlay: z.enum(BROLL_OVERLAYS).catch('none').default('none'),
  /**
   * The video's accent, resolved into the clip.
   *
   * Only `duotone` reads it, but it lives HERE rather than being looked up at
   * paint time, and that is the rule the whole renderer runs on: the
   * composition draws the document and never imports the style presets.
   * Reaching across for it cost a build — `src/lib/styles/presets.ts` uses
   * `@/` imports, Remotion's webpack carries no such alias, and the bundle
   * simply failed. A resolved value has no such problem and makes the clip
   * describe itself.
   */
  accent: z.string().default('#9B7BFF'),
});
export type BrollClip = z.infer<typeof BrollClipSchema>;

/* ---------------------------------------------------------------- graphics */

export const GRAPHIC_TYPES = [
  'icon',          // animated SVG/PNG icon with a label
  'stat',          // big number + caption
  'list',          // bullets that build in one by one
  'title-card',    // full-frame title, usually at 0s
  'quote',
  'arrow',         // pointer/annotation aimed at a screen position
  'image',         // generated or fetched illustration
  /* ── motion graphics: the ones that are a MOVE, not a card ──────────── */
  'counter',       // a number that runs up to its target as it is said
  'progress-ring', // a ring that fills to a percentage
  'bar-chart',     // two to four bars that grow from nothing
  'checklist',     // ticks that land one at a time
  'badge',         // a pill that snaps in and settles
  'underline',     // a stroke drawn under a point on the frame
] as const;
export type GraphicType = (typeof GRAPHIC_TYPES)[number];

/**
 * Which of these carries its own motion.
 *
 * A stat card animates in and then holds; a counter IS the animation, and the
 * moment it lands has to sit under the words that earned it. The renderer uses
 * this to decide whether the entrance is the whole of the movement or only the
 * beginning of it.
 */
export const MOVING_GRAPHICS: readonly GraphicType[] = [
  'counter', 'progress-ring', 'bar-chart', 'checklist', 'underline',
];

export const GRAPHIC_ANIMATIONS = [
  'pop', 'slide-up', 'slide-left', 'fade', 'draw', 'count-up',
  'spin-in',  // arrives turning — for icons, where a flat pop reads as a sticker
  'bounce',   // overshoots and settles
  'pulse',    // lands, then breathes once so the eye comes back to it
  'wipe',     // revealed left to right behind a moving edge
] as const;

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

/* ------------------------------------------------------------- icon cards */

/**
 * The icon that rises on the word that earned it.
 *
 * ── What this is, and why it is not a graphic ───────────────────────────
 *
 * A graphic is a card with words on it — a stat, a list, a quote — placed
 * where the director thought a point neededsupport. This is a different
 * instrument: ONE illustrated object on a plain tile, with no type at all,
 * that slides up out of nowhere at the exact moment its noun is spoken, holds
 * dead still, and fades.
 *
 * It earns its own track because the timing contract is different. A graphic
 * is synced to a passage; a card is synced to a WORD, and a card that lands
 * even three frames after the word reads as a lag rather than as punctuation.
 * Everything here is built to protect that: the moment comes from the word's
 * own timestamp in the transcript, and the rise is timed so the card ARRIVES
 * on the word rather than starting to move on it.
 *
 * ── Rows, not singles ───────────────────────────────────────────────────
 *
 * "The two best fruits are bananas and apples" wants a banana on "bananas" and
 * an apple on "apples", side by side, both leaving together. So a cue is a ROW
 * of up to three cards with their own arrival times and one shared exit: the
 * row is laid out for its final width from the start, so the first card does
 * not slide sideways when the second one appears.
 */
export const IconCardSchema = z.object({
  /**
   * Seconds after the row starts, not an absolute time.
   *
   * Relative so the row behaves like every other clip on the timeline: drag it
   * and its cards keep their spacing, because `outStartSec` is the only thing
   * that moved. With absolute times, moving the row would leave the cards
   * behind it and the second card would arrive before the first.
   */
  offsetSec: z.number().nonnegative().default(0),
  /** The word that earned it — shown in the editor, and used to re-roll. */
  word: z.string().default(''),
  /** What the icon library was asked for. */
  query: z.string().default(''),
  /**
   * The icon itself, inlined as sanitised SVG.
   *
   * Markup rather than a URL for the same reason the graphics layer inlines
   * its icons: headless Chromium refuses to `decode()` these SVGs, so an
   * `<Img>` kills the frame it is on. A card with no markup is dropped at
   * render rather than drawn as an empty tile.
   */
  markup: z.string().nullable().default(null),
  /** Where it came from, e.g. `openmoji:banana`. Kept for the editor. */
  iconId: z.string().default(''),
});
export type IconCard = z.infer<typeof IconCardSchema>;

export const IconCueSchema = z.object({
  id: z.string(),
  /**
   * When the first card arrives, and when the whole row leaves.
   *
   * Named like every other clip's span on purpose: the timeline's move, trim
   * and delete are written once against `outStartSec`/`outEndSec`, so a track
   * that spells its own times differently has to re-implement all three.
   */
  outStartSec: z.number().nonnegative(),
  outEndSec: z.number().nonnegative(),
  /** Normalised centre of the row. The builder keeps it clear of the captions. */
  y: z.number().default(0.56),
  /**
   * And across the frame. Only meaningful for a side column; a row rising from
   * the floor is centred on the frame, because that is what "from below" means.
   */
  x: z.number().default(0.5),
  /**
   * Which way this row is laid out — see `IconSide`.
   *
   * On the cue rather than derived at paint time for the same reason `tone` is:
   * a person can move a row to the other side of a widescreen frame, and a
   * rule recomputed from the aspect would put it straight back.
   */
  side: z.enum(['below', 'left', 'right']).catch('below').default('below'),
  /**
   * White tile or near-black one.
   *
   * Carried on the cue rather than read from the style at paint time, and that
   * is not redundancy: the renderer must not import the style presets, because
   * Remotion's bundle does not resolve the `@/` alias those modules are built
   * on and one such import silently kills the whole composition. Writing the
   * answer into the document also means the editor can flip a single row
   * without touching the video's style.
   */
  tone: z.enum(['light', 'dark']).default('light'),
  cards: z.array(IconCardSchema).min(1).max(3),
});
export type IconCue = z.infer<typeof IconCueSchema>;

/** When a card lands, in output time. */
export function iconCardAt(cue: IconCue, card: IconCard): number {
  return cue.outStartSec + card.offsetSec;
}

/**
 * Where the captions sit, once the frame has had its say.
 *
 * ── The rule ────────────────────────────────────────────────────────────
 *
 * Cut the frame into quarters: the words belong in the SECOND quarter up from
 * the bottom. High enough not to crowd the bottom edge, low enough to stay out
 * of the speaker's face, and — the part that actually matters — the same for
 * every style, so a video does not change where its words live when somebody
 * tries a different caption look.
 *
 * ── Why a clamp and not a rewrite ───────────────────────────────────────
 *
 * The twenty presets had drifted from 0.54 to 0.87, which is the difference
 * between the middle of the frame and hard against the bottom edge. Rewriting
 * each one's `positionY` would fix today's and drift again by the twenty-first;
 * clamping keeps whatever difference a preset meant INSIDE the band and pulls
 * only the outliers back.
 *
 * Measured, not assumed: the rendered ink of a caption block tracks
 * `positionY` to within about 0.05 of the frame across every preset, so
 * clamping the number the style declares is enough — there is no correction
 * factor hiding in here. The upper bound is set by what has to fit UNDER it:
 * a block centred at 0.66 reaches about 0.728 at its deepest, and the icon
 * cards' band starts at 0.74.
 *
 * Most presets end up at the top of the band, which is the point — this is a
 * clamp rather than a constant so that a preset with a real reason to sit
 * higher keeps it, and only the drift gets corrected.
 *
 * ── Not for a split screen ──────────────────────────────────────────────
 *
 * A split layout hands the captions its own band, which is the one strip
 * covering neither the face above nor the picture below, and that band is the
 * whole point of the layout. `LayoutPlan.captionY` wins outright; this is only
 * consulted when the layout has no opinion.
 */
export const CAPTION_BAND: readonly [number, number] = [0.6, 0.66];

/**
 * How far into the frame a hand-placed caption may go.
 *
 * Wider than the band by a long way, because this is not the band's job. The
 * band stops twenty presets DRIFTING; these two numbers stop a caption being
 * dragged off the screen. The only thing they owe anybody is that the words
 * stay visible, so they sit just inside the edge — everything between is a
 * decision somebody made on purpose and gets honoured.
 */
export const CAPTION_PLACEMENT_BOUNDS = { x: [0.08, 0.92], y: [0.1, 0.92] } as const;

type Placed = Pick<CaptionStyle, 'positionY'> & Partial<Pick<CaptionStyle, 'placement'>>;

export function framedPositionY(style: Placed): number {
  // A placement is a decision, not a drift. The band exists to pull twenty
  // presets back into line with each other; somebody who dragged the words
  // somewhere has said exactly where they want them, and overruling that with
  // a rule about preset hygiene is how a drag ends up looking broken.
  if (style.placement) return clampTo(style.placement.y, CAPTION_PLACEMENT_BOUNDS.y);
  const [low, high] = CAPTION_BAND;
  return Math.min(high, Math.max(low, style.positionY));
}

/**
 * The centre of the text column, or null when nobody has placed it.
 *
 * Null rather than 0.5, because "centred" and "not placed" are not the same
 * thing: unplaced captions are laid out by `align`, which gives a left-aligned
 * style a margin from the frame edge rather than a centre point. Returning a
 * number here would quietly replace that layout on every video that has never
 * been touched.
 */
export function framedPositionX(style: Pick<CaptionStyle, 'placement'>): number | null {
  return style.placement ? clampTo(style.placement.x, CAPTION_PLACEMENT_BOUNDS.x) : null;
}

/**
 * How wide the column may be where it has been placed.
 *
 * A block centred at 0.12 with a width of 0.86 of the frame runs off both
 * edges — it is centred on its own anchor, so half of it is to the left of a
 * point that is already near the left edge. Twice the distance to the nearer
 * edge is the widest it can be and still fit, and the style's own ratio caps
 * it from above so dragging a caption toward the middle never makes its lines
 * longer than the look intended.
 */
export function framedWidthRatio(style: Pick<CaptionStyle, 'placement' | 'widthRatio'>): number {
  const x = framedPositionX(style);
  if (x === null) return style.widthRatio;
  // Twice the distance to the nearer edge is the widest that FITS, and a line
  // that exactly fits reads as a line that was cut off — the descenders and
  // the drop shadow touch the frame edge with nothing either side of them. The
  // gutter is what makes it look placed rather than clipped.
  return Math.max(0.08, Math.min(style.widthRatio, 2 * (Math.min(x, 1 - x) - CAPTION_EDGE_GUTTER)));
}

/** Clear space kept between a placed caption and the frame edge. */
const CAPTION_EDGE_GUTTER = 0.035;

function clampTo(n: number, [low, high]: readonly [number, number]): number {
  return Math.min(high, Math.max(low, n));
}

/**
 * Where a row of cards sits and how big each one is.
 *
 * ── The bottom quarter, and only the bottom quarter ─────────────────────
 *
 * Cut the frame into quarters. The captions own the second one up from the
 * bottom (see `CAPTION_BAND`); the icon cards own the first. That is the whole
 * rule, and it is a rule rather than a calculation on purpose.
 *
 * The version before this one measured the caption block and placed the row
 * under whatever it found, which sounds more careful and was worse: the
 * rendered height of a caption block does not follow from its `lineHeight` or
 * its `maxLines` — it depends on how many lines the words actually made — so
 * the model was wrong by up to eight per cent of the frame in both directions.
 * Too small, and the words sat on the cards. Too large, and the card shrank to
 * a sixth of the frame to make room for space that was never occupied.
 *
 * Two fixed bands cannot be wrong about each other.
 *
 * ── Why the size is computed at all ─────────────────────────────────────
 *
 * The band is a fraction of the HEIGHT, and three cards side by side are
 * limited by the WIDTH. In a wide frame the width bites first, so the card is
 * whichever of the two allows it — never larger than the 0.30 of the short
 * edge the reference clip measured, never smaller than the point an icon
 * stops reading as an object.
 */
export interface IconRowPlacement {
  /** Normalised centre of the row, across the frame. */
  x: number;
  /** Normalised centre of the row. */
  y: number;
  /** Card side, in pixels. */
  card: number;
  /** Between cards, in pixels. */
  gap: number;
}

/**
 * The biggest a card gets, as a fraction of the frame's short edge.
 *
 * The reference clip measured 0.30, and 0.30 is too big here — that clip had
 * no captions over it and nothing else competing for the lower frame. Against
 * a line of words the tile has to read as punctuation under them rather than
 * as the subject, which it does at about two thirds of the reference size.
 */
const ICON_CARD_MAX = 0.22;

/** Smaller than this and the icon stops reading as an object. */
const ICON_CARD_MIN = 0.13;

/**
 * The top of the cards' band.
 *
 * Set to sit close under the words rather than to clear the worst case, and
 * that is a deliberate trade. Caption blocks vary by about eight per cent of
 * the frame in how deep they run — it depends on how many lines the words
 * actually made, which nothing here can know — so a value that guaranteed
 * clearance for the deepest preset left a 167px hole under the shallow ones,
 * which is what this looks like in practice.
 *
 * At 0.70 the common case sits about 90px under the last line, and the deepest
 * blocks overlap the top of the tile by a few dozen pixels. That costs
 * nothing: the cards render UNDER the captions, and the tile's top seventh is
 * padding around the icon, so what ends up behind the text is blank tile.
 */
const ICON_BAND_TOP = 0.7;

/**
 * And between the cards and the bottom of the frame.
 *
 * Generous on purpose. At 0.03 the tile's bottom edge sat three per cent of
 * the frame off the floor, which reads as a thing that fell rather than a
 * thing placed — "very, very far down" was the note. The card gives up size
 * before it gives up this margin: a smaller tile in the right place looks
 * deliberate, and a big one wedged against the edge does not.
 */
const ICON_BOTTOM_MARGIN = 0.07;

/**
 * How many cards a row rising from the floor has. Always this many.
 *
 * One card climbing up out of the bottom of the frame on its own reads as a
 * thing that happened rather than a thing that was designed — the eye has
 * nothing to relate it to, and it lands off to one side of a centred subject
 * looking like a mistake. Three is a group: it arrives one at a time, it fills
 * the space under the words evenly, and it reads as punctuation.
 *
 * It is a hard count, not a maximum. A window that can only find one or two
 * nouns does not get a short row, it gets no row.
 */
export const ICON_ROW_BELOW_COUNT = 3;

/**
 * Where a row of cards goes.
 *
 * `below` is the original: a horizontal row rising out of a floor under the
 * captions, which is right when the picture is a vertical frame the subject
 * fills. `left` and `right` are a vertical column in the margin, which is what
 * a widescreen frame wants — there the subject sits in the middle and the
 * sides are empty, so a row squeezed under the captions is crowding the one
 * part of the frame that was already busy.
 */
export type IconSide = 'below' | 'left' | 'right';

/**
 * A card in the side margin is bigger than one under the captions.
 *
 * It can afford to be: nothing else is out there. This is the reference clip's
 * own 0.30 of the short edge, which the band under the captions had to give up
 * to avoid competing with a line of words.
 */
const ICON_CARD_SIDE_MAX = 0.3;

/**
 * How far off centre a side column sits, as a fraction of the width.
 *
 * Measured from the MIDDLE outwards, not from the edge inwards, and that is
 * the whole point of the number. A talking head is framed centrally and takes
 * up roughly the middle 40% of a widescreen picture, so the band that is both
 * empty and still part of the composition is the one just outside them —
 * around 0.22 and 0.78. Pinned to the edge instead, the column drifted out to
 * 0.86 and read as something that had slid off the frame rather than something
 * placed beside the subject.
 *
 * It is deliberately not further in: the face is at 0.5, and a card on top of
 * it is the problem this whole layout exists to avoid.
 */
const ICON_SIDE_OFFSET = 0.28;

/** But never so far out that a card hangs off the frame. */
const ICON_SIDE_EDGE_MIN = 0.03;

/** Above and below the column. */
const ICON_SIDE_BAND = [0.1, 0.92] as const;

/**
 * Whether this frame has room beside the subject.
 *
 * A talking head is framed centrally whatever the aspect, so a 16:9 picture
 * has two empty columns either side of them and a 9:16 picture has none. That
 * is the whole reason this is decided from the frame rather than from the
 * format: it is a fact about where the subject is, not about which platform
 * the video is for.
 */
export function hasSideRoom(width: number, height: number): boolean {
  return width / height > 1.2;
}

export function iconRowPlacement(
  count: number,
  width: number,
  height: number,
  side: IconSide = 'below',
): IconRowPlacement {
  const shortEdge = Math.min(width, height);

  if (side !== 'below') {
    /*
     * A column, sized to fit the height it has rather than to a fixed cap:
     * one card in the margin can be the full reference size, and three have to
     * share the band between them.
     */
    const gap = shortEdge * 0.055;
    const band = (ICON_SIDE_BAND[1] - ICON_SIDE_BAND[0]) * height;
    const card = Math.max(
      shortEdge * ICON_CARD_MIN,
      Math.min(shortEdge * ICON_CARD_SIDE_MAX, (band - (count - 1) * gap) / count),
    );
    /*
     * Placed off the centre line, then pushed back in if the card would spill.
     *
     * The clamp almost never fires at 16:9 — a 0.30 card is 0.17 of the width
     * there — but it is what keeps the rule honest on a wider frame or a much
     * bigger card, where "0.28 off centre" and "on screen" stop agreeing.
     */
    const half = card / width / 2;
    const offset = Math.min(ICON_SIDE_OFFSET, 0.5 - half - ICON_SIDE_EDGE_MIN);
    return {
      x: side === 'right' ? 0.5 + offset : 0.5 - offset,
      y: (ICON_SIDE_BAND[0] + ICON_SIDE_BAND[1]) / 2,
      card,
      gap,
    };
  }

  /*
   * The floor is the row's own margin, or the player's controls, whichever
   * reaches further up.
   *
   * A widescreen video is watched in a player that draws its scrubber and
   * buttons over the bottom of the picture, and a card resting on its own 7%
   * margin ended exactly on the top edge of that band — touching the one strip
   * of the frame guaranteed to be covered. See `floorFor`.
   */
  const floor = floorFor(width, height, ICON_BOTTOM_MARGIN);
  const room = floor - ICON_BAND_TOP;

  /*
   * Three cards have to fit ACROSS as well as under, and the width limit bites
   * first in a wide frame: a third of the short edge each is a third of the
   * height in 16:9 and most of the width in 9:16.
   */
  const widthLimit = (width * 0.86 - (count - 1) * shortEdge * 0.055) / count;
  const card = Math.max(
    shortEdge * ICON_CARD_MIN,
    Math.min(shortEdge * ICON_CARD_MAX, widthLimit, room * height),
  );

  /*
   * Hung from the TOP of the band down, so the cards sit directly under the
   * words rather than floating above the floor.
   *
   * Anchoring to the bottom margin instead — which is what this did — ties the
   * row's position to the card's size, so every time the card got smaller the
   * gap under the captions got bigger and the tile drifted toward the bottom
   * edge on its own. From the top, a smaller card is simply a smaller card in
   * the same place.
   */
  // Hung from the top of the band, then lifted if that would push the bottom
  // of the card into the controls.
  const y = Math.min(ICON_BAND_TOP + card / height / 2, floor - card / height / 2);

  return { x: 0.5, y, card, gap: shortEdge * 0.055 };
}

/* ------------------------------------------------------------------ scenes */

/**
 * A faceless animation: a complete picture that REPLACES the frame.
 *
 * Everything else in this file decorates the speaker. A scene does not — for
 * the seconds it is on, the speaker is gone and what you see is a made thing
 * with its own background, built out of the words being said over it. It is
 * B-roll that we draw instead of buying, and for a channel with no face in it
 * that is not a garnish, it is the video.
 *
 * ── Why a fixed vocabulary and not free-form ────────────────────────────
 *
 * The obvious design is to let the model describe any animation it likes and
 * render whatever comes back. That produces a renderer that must execute
 * arbitrary generated code, output nobody can predict or re-render the same
 * way twice, and — the part that actually decides it — animation with no
 * house style, because every scene was invented from scratch. Six kinds, each
 * properly art-directed once, gives a model a real choice to make (which shape
 * does this sentence actually have?) and gives the channel a look.
 */
export const SCENE_KINDS = [
  'kinetic-text', // the phrase itself, landing word by word
  'journey',      // a path drawn across the frame, waypoints lighting up
  'compare',      // the frame split in two: this against that
  'orbit',        // one idea in the middle, its parts arriving around it
  'stack',        // layers settling on top of each other
  'big-number',   // one figure, filling the frame
] as const;
export type SceneKind = (typeof SCENE_KINDS)[number];

/** What is behind it. All of these move; none of them cost a repaint. */
export const SCENE_BACKDROPS = ['gradient', 'grid', 'dots', 'rays', 'solid'] as const;
export type SceneBackdrop = (typeof SCENE_BACKDROPS)[number];

/**
 * The world a scene is drawn in.
 *
 * A look is a separate axis from a kind, and keeping them apart is the whole
 * reason the scene renderer stays a readable size. A KIND is the shape of the
 * explanation — one phrase, one figure, parts around a centre — and comes from
 * what is being said. A LOOK is ground, type, chrome and how things arrive,
 * and comes from the video's style. Every kind renders in every look, because
 * a kind arranges slots and a look supplies them.
 *
 * The four are drawn from four reference edits, and each one is a different
 * genre of channel rather than a different palette of the same one:
 *
 *   studio   near-white product UI: cards, avatars, rings, hairline borders
 *   neon     dark glow: one lit glyph, a huge gradient title, drifting props
 *   gallery  a bright fogged colonnade, objects arriving on a plinth
 *   archive  cinematic amber, film-strip bars, a push-in that never stops
 *   editorial  near-black and violet: heavy type on magenta highlight strips,
 *              huge cropped foreground curves, rim-lit metal objects
 */
export const SCENE_LOOKS = ['studio', 'neon', 'gallery', 'archive', 'editorial'] as const;
export type SceneLook = (typeof SCENE_LOOKS)[number];

export const AnimatedSceneSchema = z.object({
  id: z.string(),
  outStartSec: z.number().nonnegative(),
  outEndSec: z.number().nonnegative(),
  kind: z.enum(SCENE_KINDS),
  /** The world it is drawn in. See SCENE_LOOKS. */
  look: z.enum(SCENE_LOOKS).default('studio'),
  /**
   * How the scene takes the frame and gives it back.
   *
   * Null means "whatever this look does", which is the behaviour every scene
   * had before this existed: three of the five cut hard and `archive` fades.
   * A value here overrides that for this scene alone.
   */
  enter: z.enum(CLIP_TRANSITIONS).nullable().default(null),
  exit: z.enum(CLIP_TRANSITIONS).nullable().default(null),
  backdrop: z.enum(SCENE_BACKDROPS).default('gradient'),
  /** The phrase being said, in the speaker's own words. Two to six words. */
  headline: z.string().default(''),
  /** Meaning depends on the kind: waypoints, the two sides, the layers. */
  items: z.array(z.string()).default([]),
  /** Iconify concepts, one per item where the kind shows icons. */
  iconQueries: z.array(z.string()).default([]),
  /**
   * The icons as SVG markup, fetched and stripped at build time.
   *
   * Markup rather than URLs because Remotion's `<Img>` cannot decode these in
   * headless Chromium — see `assets/icons.ts`. Nulls are fine: every scene
   * kind reads without icons.
   */
  iconSvgs: z.array(z.string().nullable()).default([]),
  /**
   * The drawing, in the pieces it should arrive in.
   *
   * Authored by the motion model (see `director/illustrate.ts`) and split into
   * top-level groups at build time, so the renderer can bring one part in
   * every few frames instead of fading a flat picture up. Null is a normal
   * state, not an error: the scene falls back to its icons, which is worse but
   * works, and nothing about the drawing pass is allowed to cost a scene its
   * existence.
   */
  art: z
    .object({
      viewBox: z.string(),
      /** The drawing's gradients; every `url(#…)` in the parts points here. */
      defs: z.string().default(''),
      /** How many beats the camera travels through. At least one. */
      stages: z.number().int().min(1).default(1),
      /** What physically happens in each beat, for the animation prompt. */
      motion: z.array(z.string()).default([]),
      /*
       * A part is an object, but a bare string is still accepted and widened.
       *
       * The first version of this field stored plain markup, and projects
       * rendered under it are sitting in the database. A union here means
       * those still parse — without it the whole EDL fails validation and an
       * old project becomes unopenable, which is a much worse outcome than an
       * old drawing animating a little more plainly than a new one.
       */
      parts: z.array(
        z.union([
          z.string().transform((markup) => ({
            markup,
            stage: 0,
            depth: 0.5,
            enter: 'pop' as const,
            idle: 'bob' as const,
            hasPivot: false,
            pivot: { x: 500, y: 500 },
          })),
          z.object({
            markup: z.string(),
            /** Which beat this piece belongs to; the camera travels between them. */
            stage: z.number().int().min(0).default(0),
            depth: z.number().min(0).max(1).default(0.5),
            enter: z.enum(ART_ENTERS).default('pop'),
            idle: z.enum(ART_IDLES).default('bob'),
            /** Whether the pivot was stated by the model or measured for it. */
            hasPivot: z.boolean().default(false),
            /** Where the piece turns and scales about, in viewBox units. */
            pivot: z
              .object({ x: z.number(), y: z.number() })
              .default({ x: 500, y: 500 }),
          }),
        ]),
      ),
    })
    .nullable()
    .default(null),
  accent: z.string().default('#9B7BFF'),
  /** Kept so the editor can show why this moment was chosen. */
  reason: z.string().default(''),
});
export type AnimatedScene = z.infer<typeof AnimatedSceneSchema>;

/**
 * Whether a scene puts words on the screen.
 *
 * This decides whether the captions get out of its way. Two sets of words over
 * one picture — the caption band saying one thing while a kinetic-text scene
 * says another, half a beat apart — is unreadable, and it is the reason the
 * rule exists. A scene that is only shapes and icons has no such quarrel, so
 * the captions stay.
 */
export function sceneHasText(scene: AnimatedScene): boolean {
  /*
   * A drawn scene never puts words on screen.
   *
   * It used to, and the result was a line of type sitting perfectly still over
   * a moving picture, which reads as a caption that forgot to animate. The
   * scene's own words are still in the document — the editor shows them, and
   * the illustrator is briefed with them — they are simply not rendered.
   *
   * Which means the captions have nothing to collide with, so they play over
   * the drawing like they do over the footage. That is the whole trade: one
   * set of moving words instead of two sets, one of them frozen.
   */
  if (sceneIsDrawn(scene)) return false;
  return Boolean(scene.headline.trim()) || scene.items.some((item) => item.trim());
}

/**
 * Whether the drawing is carrying this scene, rather than the words.
 *
 * Where this is true the layout demotes the type — a small line under a
 * picture instead of a headline filling the frame. The rule exists because the
 * failure mode of a generated animation is that everything becomes a caption:
 * a scene whose content is three words set large is not a motion graphic, it
 * is a title card, and a video made of title cards is the thing this feature
 * was supposed to replace.
 */
export function sceneIsDrawn(scene: AnimatedScene): boolean {
  return Boolean(scene.art && scene.art.parts.length);
}

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
  'zoom-blur',   // the frame rushes at you and clears
  'barn-door',   // two panels part from the middle
  'pixelate',    // breaks into blocks and reassembles
  'light-leak',  // a warm streak crosses the frame
  'push',        // the outgoing frame is shoved off by the incoming one
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
  /**
   * What put it here — "slide-left in · coffee", "icon card · banana".
   *
   * Written so the editor can say what a cue is FOR before you delete it. A
   * sound-effect track is a row of identical marks otherwise, and the whole
   * point of these living on their own layer is that you can remove the whoosh
   * while keeping the slide it came from — a choice you cannot make about a
   * mark you cannot identify.
   */
  reason: z.string().default(''),
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
  /**
   * How far the audio crosses a cut ahead of the picture — the J/L cut.
   *
   * Every cut this product makes is a splice out of ONE continuous take, so
   * the room, the mic and the voice are identical either side of it. Butt the
   * two together and the only thing that changes at the join is the sentence,
   * which is exactly what makes an automated edit sound automated: the audio
   * lands on the same frame as the picture, every time, all the way down.
   *
   * A real editor never does that. The next line's audio starts a breath
   * before you see the cut (a J cut) and the last line's room carries a breath
   * past it (an L cut), so the join is heard somewhere the eye is not looking
   * for it. 140ms is enough to feel and short enough never to sound like two
   * people talking over each other.
   *
   * Zero turns it off and restores the hard butt-join.
   */
  jCutSec: z.number().min(0).max(0.5).default(0.14),
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
  icons: z.array(IconCueSchema).default([]),
  scenes: z.array(AnimatedSceneSchema).default([]),
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
