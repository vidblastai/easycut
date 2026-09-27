import { SCENE_LOOKS, type SceneLook } from '../edl/types';

/**
 * The style guides: one source of truth per look.
 *
 * ── Why this file exists ────────────────────────────────────────────────
 *
 * The same visual world now has to be described to three different readers,
 * and before this they each held their own half-remembered version of it:
 *
 *   1. **Opus**, when it draws the scene as SVG.
 *   2. **Seedance**, when it animates that drawing into footage.
 *   3. **The app**, when it shows somebody the styles they can pick from.
 *
 * Three descriptions of one style is three styles. The palette in the drawing
 * prompt had already drifted from the palette in the renderer's look, which is
 * exactly how a video ends up with four scenes that look like four videos.
 *
 * So a style guide is written once, here, in the terms a model can actually
 * act on: named colours with hex values, a rendering rule, a lighting rule, a
 * motion character, a camera language, and a list of what this world never
 * does. Adding a style is adding an entry to this file — the prompts, the
 * renderer and the picker all pick it up.
 *
 * ── Writing a good one ──────────────────────────────────────────────────
 *
 * Every field is phrased as an instruction a model can follow, not as an
 * adjective. "Warm and cinematic" produces a different picture on every run;
 * "cream #F6EAD2 on near-black, lit by a single lamp from the upper left,
 * deep shadows" produces the same one. Where a field is a list, it is a list
 * of concrete nouns and hex values. Nothing in here is decorative prose.
 */

export interface StyleGuide {
  id: SceneLook;
  /** The ground everything sits on. */
  ground: string;
  /**
   * Named colours, in the order a drawing should reach for them.
   *
   * Named rather than just listed, because "use the palette" produces a muddy
   * average of it and "the object body is #1A1F44, its lit edge is #B9C3F0"
   * produces a drawn object.
   */
  palette: Array<{ role: string; hex: string }>;
  /** The spot colour. One or two elements a beat, never the whole drawing. */
  accent: string;
  /** How the shapes themselves are made. */
  rendering: string;
  /** Where the light comes from and what it does. */
  lighting: string;
  /** What the background of a beat is, so nothing floats on a flat colour. */
  ground_rule: string;
  /** How things move in this world — read by the animation prompt. */
  motion: string;
  /** What the camera does here. */
  camera: string;
  /** What this world never contains. Fed to both prompts as negatives. */
  never: string[];
}

export const STYLE_GUIDES: Record<SceneLook, StyleGuide> = {
  studio: {
    id: 'studio',
    ground: '#FCFCFD',
    palette: [
      { role: 'ink, the darkest shape', hex: '#0D0D10' },
      { role: 'the shadowed face of an object', hex: '#3A3A46' },
      { role: 'mid grey, secondary surfaces', hex: '#8A8A96' },
      { role: 'the lit face of an object', hex: '#E8E8EE' },
      { role: 'highlight and paper', hex: '#FFFFFF' },
    ],
    accent: '#9B7BFF',
    rendering:
      'Clean flat product illustration. Solid fills with no outlines except where a hairline is the point. ' +
      'Generously rounded corners. Two tones per object — a lit face and a shadowed one — never a gradient doing the work.',
    lighting: 'Soft, from directly above. Wide diffuse contact shadows, nothing hard-edged.',
    ground_rule:
      'A pale surface the object stands on with a soft shadow under it, a lighter wall behind, ' +
      'and a faint dot grid in the background at very low contrast.',
    motion:
      'Things grow and settle in place rather than sliding in from off-frame. UI elements assemble: ' +
      'a card fills, a row appears, a number counts. Everything is calm and mechanical, nothing bounces.',
    camera: 'A slow push in, almost imperceptible. No handheld, no shake, no whip.',
    never: ['photorealism', 'drop shadows with hard edges', 'gradients as the main rendering', 'neon', 'grain'],
  },

  neon: {
    id: 'neon',
    ground: '#05060F',
    palette: [
      { role: 'the glowing outline of an object', hex: '#FFFFFF' },
      { role: 'a cooler secondary glow', hex: '#B9C3F0' },
      { role: 'the lit edge where a surface turns', hex: '#4B5BD0' },
      { role: 'the body of an object, nearly black', hex: '#1A1F44' },
      { role: 'the deepest background', hex: '#0A0D22' },
    ],
    accent: '#B14BFF',
    rendering:
      'Neon line art: objects are drawn as bright glowing OUTLINES around near-black bodies, ' +
      'the way a neon sign is. Stroke weight 8–14 units, round caps, no fills brighter than the ground except the strokes themselves. ' +
      'Secondary objects are dashed outlines at low opacity.',
    lighting:
      'The lines are the light source. A soft radial pool of glow behind the main subject, falling to near-black at the frame edges. ' +
      'No external light, no cast shadows — a faint reflection on the floor instead.',
    ground_rule:
      'A near-black void with one soft pool of light under the subject, a faint horizon line, ' +
      'and a scatter of very small dim points like distant lights.',
    motion:
      'The glow pulses and breathes. Outlines draw themselves on. Dashed shapes fade away one at a time. ' +
      'Objects hover and drift slightly rather than sitting still. Nothing swings or bounces.',
    camera: 'A slow push in with a touch of drift, as if floating. No shake.',
    never: ['photorealism', 'daylight', 'white or pale backgrounds', 'hard cast shadows', 'flat unlit shapes'],
  },

  gallery: {
    id: 'gallery',
    ground: '#EFF0F4',
    palette: [
      { role: 'ink, the darkest shape', hex: '#22222A' },
      { role: 'the shadowed face of an object', hex: '#6E7180' },
      { role: 'mid grey marble', hex: '#B7BAC6' },
      { role: 'the lit face of an object', hex: '#E4E6EC' },
      { role: 'highlight and fog', hex: '#FFFFFF' },
    ],
    accent: '#C0A062',
    rendering:
      'A solid object standing on a marble plinth in a bright fogged colonnade. ' +
      'Objects are rendered with real volume — a lit side, a shadowed side, and a darker plane where a surface turns away. ' +
      'Everything behind the subject is softened by haze rather than by blur.',
    lighting: 'Bright and overcast, from above and slightly front. A soft contact shadow directly under the plinth.',
    ground_rule:
      'A marble plinth under the object, a fogged colonnade of pale columns behind it, ' +
      'and a bright floor that fades into haze at the bottom of the frame.',
    motion:
      'Objects arrive by sliding in from the side and stopping hard, with the fog drifting behind them. ' +
      'An object on a plinth rotates slowly. Objects can be swapped for one another to make a point.',
    camera: 'A slow push in, or a horizontal track as if walking past the plinths.',
    never: ['photorealism', 'dark backgrounds', 'neon', 'saturated colour beyond the accent', 'grain'],
  },

  archive: {
    id: 'archive',
    ground: '#0B0710',
    palette: [
      { role: 'cream, the brightest highlight', hex: '#F6EAD2' },
      { role: 'gold, the lit face of an object', hex: '#E0A94E' },
      { role: 'dark gold, the shadowed face', hex: '#9A6B2A' },
      { role: 'deep brown, objects in shadow', hex: '#4A2E12' },
      { role: 'near-black background', hex: '#160D06' },
    ],
    accent: '#E0A94E',
    rendering:
      'A single object lit by one warm lamp in a dark room, like a museum piece at night. ' +
      'Strong contrast: a bright gold rim where the light catches an edge, and deep brown-black everywhere it does not. ' +
      'Solid shapes, no outlines.',
    lighting:
      'One warm source from the upper left. Everything falls off quickly into darkness. ' +
      'A heavy vignette, and small embers or dust drifting in the light.',
    ground_rule:
      'A dark surface the object rests on, catching a little of the light, ' +
      'with the room behind it falling away into black.',
    motion:
      'Slow and heavy. Dust and embers drift upward through the light. The object turns very slightly. ' +
      'Nothing is quick — this world moves as if the air were thick.',
    camera: 'A continuous slow push in that never stops, with a very slight drift.',
    never: ['photorealism', 'bright or white backgrounds', 'cool colours', 'neon', 'flat even lighting'],
  },
  /*
   * From a reference edit the user supplied, with a written art-direction
   * breakdown of it. The distinguishing thing is not "purple": it is the
   * combination of near-black with ONE localised violet pool, oversized
   * cropped curves in the foreground, and rim-lit metal — and the note that
   * came with it is worth keeping verbatim, because it is the failure mode
   * this world has: "do not treat glow as a substitute for design".
   */
  editorial: {
    id: 'editorial',
    ground: '#030105',
    palette: [
      { role: 'primary text and the brightest highlight', hex: '#F5F2F7' },
      { role: 'secondary text and supporting copy', hex: '#BEB7C6' },
      { role: 'the violet light pool behind the subject', hex: '#9B18F4' },
      { role: 'deep violet ambient, where the light falls off', hex: '#160026' },
      { role: 'the cropped foreground curve, almost black', hex: '#0A0410' },
    ],
    accent: '#C323DC',
    rendering:
      'Dark editorial. One or two huge cropped circles or arcs in the foreground, 0.95 to 1.6 times the frame width, ' +
      'entering from below or the lower left, shaded almost black with dark-violet faces and a thin lit edge — never bright decorative blobs. ' +
      'The hero object is detailed metal or dark glass, rim-lit in violet, with silver highlights and deep shadow. ' +
      'Keyword emphasis is a luminous rectangular strip behind the word, square-cornered, tight to the letters.',
    lighting:
      'A localised radial violet pool behind the subject, falling to black at every edge. Large quiet black regions are the point. ' +
      'The brightest violet is concentrated on the meaning-bearing element and nowhere else.',
    ground_rule:
      'Near-black with one violet pool, a cropped foreground curve, and two to four dim topic objects further back, ' +
      'each smaller, darker and less sharp than the subject.',
    motion:
      'Three depth planes moving at different rates: the cropped foreground curve, the focal group, and dim satellites drifting ' +
      '6 to 18 units with 1 to 4 degrees of slow rotation, phase-offset so they never move together. ' +
      'Type assembles from offset letters and settles quickly into a readable word — never a prolonged scramble.',
    camera: 'A slow push or drift of two to four per cent during a hold, with a quick motivated move between beats.',
    never: [
      'photorealism',
      'bright or white backgrounds',
      'emoji or flat clip art as the hero object',
      'neon outlines everywhere',
      'particles',
      'glow used in place of design',
    ],
  },
};

export function styleGuideFor(look: SceneLook): StyleGuide {
  return STYLE_GUIDES[look] ?? STYLE_GUIDES.studio;
}

/**
 * The guide as a block of prompt text.
 *
 * Both the drawing pass and the animation pass paste this in verbatim, which
 * is the point: two prompts describing the same world in their own words is
 * how two scenes in one video stop matching. `include` trims it to the fields
 * that mean something to the reader — an SVG has no camera, a video has no
 * stroke weight.
 */
export function guideAsPrompt(
  guide: StyleGuide,
  include: Array<keyof Omit<StyleGuide, 'id' | 'never'>> = ['palette', 'rendering', 'lighting', 'ground_rule'],
): string {
  const lines: string[] = [`Background: ${guide.ground}`];

  if (include.includes('palette')) {
    lines.push(
      'Palette — use these and only these, for the things they name:',
      ...guide.palette.map((swatch) => `  ${swatch.hex}  ${swatch.role}`),
      `  ${guide.accent}  the accent, one or two elements only`,
    );
  }
  if (include.includes('rendering')) lines.push(`Rendering: ${guide.rendering}`);
  if (include.includes('lighting')) lines.push(`Light: ${guide.lighting}`);
  if (include.includes('ground_rule')) lines.push(`Every beat sits in a place: ${guide.ground_rule}`);
  if (include.includes('motion')) lines.push(`How things move here: ${guide.motion}`);
  if (include.includes('camera')) lines.push(`Camera: ${guide.camera}`);

  lines.push(`Never: ${guide.never.join(', ')}.`);
  return lines.join('\n');
}

/** Every look has a guide, checked at module load rather than at render time. */
for (const look of SCENE_LOOKS) {
  if (!STYLE_GUIDES[look]) throw new Error(`No style guide for look "${look}"`);
}
