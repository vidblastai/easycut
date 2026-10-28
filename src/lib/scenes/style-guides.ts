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
  /*
   * The big science-explainer channels' house style, described rather than
   * named: flat vector shapes with no outlines, every object lit by a lighter
   * crescent on one edge, saturated colour on a deep navy, layered depth, and a
   * camera that never cuts inside a topic — it dives INTO an object and that
   * object becomes the next scene. Their characters and branding are theirs;
   * the visual grammar is the thing worth having.
   */
  science: {
    id: 'science',
    ground: '#0B1636',
    palette: [
      { role: 'cream highlight, the rim of light on a lit edge', hex: '#FFF6E0' },
      { role: 'warm yellow, glowing things and the one thing to look at', hex: '#FFD166' },
      { role: 'teal, life and the cool side of an object', hex: '#2EC4B6' },
      { role: 'coral, danger and warmth', hex: '#FF5D73' },
      { role: 'indigo, the shadowed body of an object', hex: '#2B3A8C' },
      { role: 'deep navy, background planes', hex: '#142257' },
    ],
    accent: '#FFB627',
    rendering:
      'Flat vector illustration with NO outlines. Simple geometric, rounded shapes. Every object has a base colour, ' +
      'a darker shadow side, and a thin lighter crescent rim on its lit edge. Soft radial glows behind glowing things. ' +
      'Cute and readable — whatever the line is about, drawn as a few clean shapes, not a diagram.',
    lighting:
      'Light comes from the upper left. Rims and highlights face it; a soft glow surrounds anything that emits light. ' +
      'No cast shadows on a floor — depth comes from layered planes getting darker and bluer with distance.',
    ground_rule:
      'A deep navy field with soft depth behind the subject: a gentle radial pool of lighter blue where the subject ' +
      'sits, two or three large blurred rounded shapes far behind, and a few small soft floating particles, each ' +
      'plane darker and less saturated. Abstract only — the backdrop is never a place or an object of its own.',
    motion:
      'Never still: everything drifts, bobs or rotates gently, particles float, glows pulse slowly. Objects pop in with ' +
      'a soft spring overshoot. Between ideas the camera dives INTO an object and that object becomes the next scene — ' +
      'no hard cuts inside a topic.',
    camera: 'A slow continuous push, and a fast zoom-dive into an object to move to the next idea.',
    never: [
      'outlines or strokes around shapes',
      'photorealism',
      'pure black backgrounds',
      'muddy gradients',
      'thin line art',
      'space, planets, stars or moons unless the line is about them',
    ],
  },

  /*
   * The looks below were added after a survey of the styles people ask Opus
   * to animate in — paper cut-outs, monoline ink, blueprints, riso prints,
   * pixel art and the rest. Each is described from scratch in our own terms:
   * how to draw and move in it, never what to draw. A look that names
   * subjects puts them in every scene (Flat science once had a planet).
   */

  paper: {
    id: 'paper',
    ground: '#F3E9D8',
    palette: [
      { role: 'the top sheet, the subject’s main body', hex: '#E8553D' },
      { role: 'a second sheet stacked beneath, for depth', hex: '#F2A541' },
      { role: 'a cool sheet for secondary parts', hex: '#3E7CB1' },
      { role: 'deep sheet for the darkest layer and inner cut-outs', hex: '#1F3A5F' },
      { role: 'pale sheet for highlights and small details', hex: '#FFF8EC' },
    ],
    accent: '#E8553D',
    rendering:
      'Layered paper cut-out: every shape is a flat sheet of coloured card with slightly irregular hand-cut edges ' +
      '(paths with gentle wobble, no perfect circles), stacked two to four sheets deep. Each sheet casts a soft short ' +
      'drop shadow (offset 6–10px down-right, blur 10px, 25% black) onto the sheet below. Detail is made by cutting ' +
      'holes and laying smaller sheets on top, never by drawing lines.',
    lighting:
      'Soft daylight from the upper left. Light only shows as the drop shadows between layers; no glows, no gradients ' +
      'inside a sheet beyond a barely visible paper grain.',
    ground_rule:
      'A warm cream card ground with a faint fibre texture, and one or two very large pale sheets far behind the ' +
      'subject casting their own soft shadows. Abstract only.',
    motion:
      'Sheets slide in and flip up like paper on a table: arrivals use back.out(1.3) with a slight rotation that ' +
      'settles to a resting tilt of ±2°. Layers move at different speeds for parallax. Things unfold, fold and pop up ' +
      'like a pop-up book. No smooth morphing between unrelated shapes — a sheet is swapped by flipping it.',
    camera: 'A gentle push and slight lateral slide across the layers; a dive goes between sheets, revealing the layer behind.',
    never: ['outlines or strokes', 'glows', 'glossy or metallic surfaces', 'photographs', 'perfect geometric circles'],
  },

  ink: {
    id: 'ink',
    ground: '#F4EFE4',
    palette: [
      { role: 'the ink line itself, every outline', hex: '#141414' },
      { role: 'a light grey wash for shadow sides', hex: '#CFC8BA' },
      { role: 'the paper, used to knock out shapes', hex: '#F4EFE4' },
      { role: 'a muted secondary wash, used sparingly', hex: '#8FA3A8' },
    ],
    accent: '#E0412C',
    rendering:
      'Monoline ink drawing on paper: everything is an open black stroke of one weight (6–8px, round caps and joins), ' +
      'like a confident pen drawing. Shapes are left mostly unfilled; at most a flat light-grey wash on shadow sides. ' +
      'The one accent colour is a single filled shape or underline per beat — the thing to look at.',
    lighting: 'None to speak of: flat paper light. Shade only with the grey wash or a few parallel hatch strokes.',
    ground_rule:
      'Plain warm off-white paper with a very faint grain and a soft vignette; nothing else behind the subject.',
    motion:
      'Lines draw themselves on (strokeDashoffset) in the order a hand would draw them, 0.3–0.6 s per stroke, ' +
      'power2.inOut. Finished drawings transform by redrawing: strokes retract and new ones draw on. Small objects ' +
      'pop with back.out(1.6). The accent fills in last, like a marker stroke.',
    camera: 'Mostly still with a slow push; a dive follows a single line into the next drawing.',
    never: ['gradients', 'glows', 'more than one accent colour', 'thick filled cartoon shapes', 'dark backgrounds'],
  },

  blueprint: {
    id: 'blueprint',
    ground: '#0F3B78',
    palette: [
      { role: 'the main drafting line', hex: '#EAF2FF' },
      { role: 'construction lines and the grid, faint', hex: '#5E8AC7' },
      { role: 'the paper, a slightly lighter blue for panels', hex: '#174A8F' },
      { role: 'hidden or secondary edges, dashed', hex: '#9BB8E3' },
    ],
    accent: '#FFC94A',
    rendering:
      'Technical blueprint: objects drawn as precise thin white lines (3–4px) in clean orthographic or isometric ' +
      'projection, with dashed hidden edges, centre lines, circles for joints and short dimension arrows WITHOUT numbers. ' +
      'Almost no fills — a faint lighter-blue panel at most. The accent marks the one part that matters.',
    lighting: 'Flat; the lines are the image. A very soft lighter-blue pool behind the subject for depth.',
    ground_rule:
      'Blueprint blue with a fine square grid (60px, 12% white) and a heavier grid every fifth line, slightly faded at the frame edges.',
    motion:
      'Construction first: faint guide lines sweep across, then the object draws on line by line along them ' +
      '(strokeDashoffset, power1.inOut). Parts slide apart into an exploded view and back together. Dimension ' +
      'arrows extend from their tick marks. Motion is precise and mechanical — no bounce.',
    camera: 'Steady, level and centred on the drawing; a slow push, and a dive that zooms into one detail until it becomes the next drawing.',
    never: ['text or numbers on dimension lines', 'soft cartoon blobs', 'glows', 'photorealism', 'warm backgrounds'],
  },

  riso: {
    id: 'riso',
    ground: '#F2EDE3',
    palette: [
      { role: 'fluorescent pink ink, the main shape colour', hex: '#FF48B0' },
      { role: 'blue ink, the second plate', hex: '#0078BF' },
      { role: 'yellow ink, the third plate', hex: '#FFE800' },
      { role: 'where pink and blue overprint', hex: '#6C3A8C' },
    ],
    accent: '#FF48B0',
    rendering:
      'Risograph print: bold flat shapes in two or three spot inks with mix-blend-mode: multiply so overlaps make new ' +
      'colours. Each ink plate is slightly misregistered (offset 4–8px). Shading is a coarse halftone dot pattern ' +
      '(an SVG pattern of dots), never a gradient. Edges are crisp but a little rough.',
    lighting: 'No light — print logic only. Shadow is a halftone in the darker ink.',
    ground_rule:
      'Off-white recycled paper with a faint speckled grain and a large halftone dot field in one ink fading out from behind the subject.',
    motion:
      'Snappy and graphic: shapes slam in with expo.out, plates slide into registration a beat apart, halftone ' +
      'dots grow from nothing. Things stamp, slide and stack like printed layers. A little misregistration jitter on landing.',
    camera: 'Flat and frontal; cuts are replaced by one plate sliding over the next, or a halftone dot growing to fill the frame.',
    never: ['smooth gradients', 'glows', 'more than three inks', 'photorealism', 'drop shadows'],
  },

  pixel: {
    id: 'pixel',
    ground: '#1B1F3B',
    palette: [
      { role: 'the main sprite colour', hex: '#4CC9F0' },
      { role: 'the sprite shadow', hex: '#3A0CA3' },
      { role: 'warm highlight pixels', hex: '#FFD166' },
      { role: 'a second sprite colour', hex: '#F72585' },
      { role: 'light outline pixels', hex: '#F1FAEE' },
    ],
    accent: '#FFD166',
    rendering:
      'Pixel art: everything is built from square cells on a strict grid (cells of 20–24px), drawn as rects with ' +
      'shape-rendering: crispEdges. A one-cell dark outline around each sprite, one cell of highlight and one of shadow. ' +
      'A limited palette, no anti-aliasing, no gradients, no curves — diagonals are stair-steps.',
    lighting: 'Baked into the cells: highlight on the top-left cells, shadow on the bottom-right. No glow filters.',
    ground_rule:
      'A dark blue ground with a sparse grid of tiny single-cell dots and two or three big blocky shapes far behind in a slightly lighter blue.',
    motion:
      'Stepped, like a game: positions move in whole cells with ease "steps(6)" or similar, sprites squash one cell ' +
      'on landing, things appear by filling in cell by cell. Bounces are crisp arcs. Two-frame idle loops (finite repeats).',
    camera: 'Moves in whole-cell steps; a dive is a blocky zoom where the pixels get bigger until one cell fills the frame.',
    never: ['anti-aliased curves', 'gradients', 'blur or glow', 'thin lines', 'photographs'],
  },

  chalk: {
    id: 'chalk',
    ground: '#1E2B26',
    palette: [
      { role: 'white chalk, every main line', hex: '#F2F0E6' },
      { role: 'yellow chalk for the important part', hex: '#F6D55C' },
      { role: 'blue chalk for secondary parts', hex: '#7FB7E3' },
      { role: 'pink chalk, sparingly', hex: '#F28FAD' },
    ],
    accent: '#F6D55C',
    rendering:
      'Chalk on a blackboard: strokes 6–10px with a rough, broken texture (an SVG turbulence filter or dashed overlays ' +
      'so the line is grainy), loose hand-drawn shapes, fills done as quick diagonal hatching rather than solid colour.',
    lighting: 'Flat classroom light. No glows; brightness is only chalk pressure.',
    ground_rule:
      'A deep green-black board with faint smudges of erased chalk (very low-opacity blurred white patches) and soft darker corners.',
    motion:
      'Drawn on by hand: strokes write on with strokeDashoffset, hatching fills in quickly, arrows swoop in. ' +
      'Changes happen by wiping: a soft eraser smear clears an area before the next drawing appears. Small wobble on landing.',
    camera: 'Stays centred on the drawing with a slow push; zooms into one drawing to start the next.',
    never: ['clean vector fills', 'glows', 'gradients', 'photorealism', 'white backgrounds'],
  },

  scope: {
    id: 'scope',
    ground: '#020804',
    palette: [
      { role: 'the bright phosphor trace', hex: '#7CFF8A' },
      { role: 'the trace’s glow halo', hex: '#2BD45A' },
      { role: 'the faint graticule and afterglow', hex: '#0F4A22' },
      { role: 'a hot white centre on the brightest points', hex: '#E9FFE9' },
    ],
    accent: '#E9FFE9',
    rendering:
      'Oscilloscope vector display: everything is a single continuous glowing green line (3–4px core with a soft blur ' +
      'halo), like a beam tracing shapes. Objects are outlines and Lissajous-style curves; no fills at all.',
    lighting: 'The beam is the only light: a bright core, a green halo (drop-shadow glow), and a fading afterglow trail.',
    ground_rule:
      'Near-black CRT glass with a faint green graticule grid, a subtle round vignette and thin horizontal scanlines.',
    motion:
      'The beam traces each shape on (strokeDashoffset, ease "none" or power1.inOut) leaving an afterglow that fades. ' +
      'Shapes morph into each other line-to-line, waves oscillate, the trace flickers very slightly. Smooth and continuous.',
    camera: 'Static like a fixed screen; the image itself zooms and rotates inside it.',
    never: ['filled shapes', 'colours other than greens', 'flat cartoon style', 'photographs', 'light backgrounds'],
  },

  graph: {
    id: 'graph',
    ground: '#101118',
    palette: [
      { role: 'the primary curve and main object', hex: '#58C4DD' },
      { role: 'the secondary curve', hex: '#FFFF66' },
      { role: 'a third quantity', hex: '#83C167' },
      { role: 'axes and faint grid lines', hex: '#4A4E5A' },
      { role: 'a warm highlight for the answer', hex: '#FC6255' },
    ],
    accent: '#FFFF66',
    rendering:
      'Mathematical animation: precise thin strokes (4–6px) and translucent fills (20–30% opacity) in clear distinct ' +
      'colours on near-black, clean geometry — curves, vectors with arrowheads, shaded areas, dots on a plane. ' +
      'Elegant and exact; no texture, no cartoon features.',
    lighting: 'None; colour and opacity do the work. A very faint glow on the active curve only.',
    ground_rule:
      'Near-black with an optional faint coordinate grid that fades out towards the edges, and nothing else.',
    motion:
      'Smooth, deliberate transformations: shapes morph continuously into the next form, curves draw on left to ' +
      'right, areas fill in, vectors rotate about their tails, the plane itself stretches. power2.inOut throughout, ' +
      'unhurried. Nothing bounces.',
    camera: 'Centred on the active shape with a calm slow push; a dive zooms into a point until a new plane opens from it.',
    never: ['cartoon characters', 'bouncy springs', 'textures', 'warm backgrounds', 'heavy outlines'],
  },

  glass: {
    id: 'glass',
    ground: '#0E1024',
    palette: [
      { role: 'frosted glass panel body, white at low opacity', hex: '#FFFFFF' },
      { role: 'a violet colour blob behind the glass', hex: '#7B5CFF' },
      { role: 'a cyan colour blob behind the glass', hex: '#3FD0FF' },
      { role: 'a pink colour blob behind the glass', hex: '#FF5FA2' },
      { role: 'deep ground behind everything', hex: '#15183A' },
    ],
    accent: '#3FD0FF',
    rendering:
      'Glass: objects are rounded translucent panels and shapes (white at 8–16% opacity with backdrop-filter: ' +
      'blur(24px)), a 1.5px bright rim on the top-left edge, a soft inner highlight, over large saturated blurred ' +
      'colour blobs that show through. Clean and premium.',
    lighting: 'Light from the top left catches the glass rims; colour comes from the blobs behind, refracted through the panels.',
    ground_rule:
      'A deep indigo ground with three large, heavily blurred colour blobs (violet, cyan, pink) drifting slowly behind the subject.',
    motion:
      'Smooth and weighty: panels glide in with expo.out and settle, blobs drift and swap places behind, the glass ' +
      'subtly tilts (small rotationX/rotationY) as it lands. Elements morph between rounded shapes. No hard snaps.',
    camera: 'A slow push with gentle parallax between the glass and the blobs; a dive goes through a panel into the colour behind.',
    never: ['flat opaque cartoon shapes', 'hard black outlines', 'pixelated edges', 'textures like paper or grain', 'white backgrounds'],
  },

  clay: {
    id: 'clay',
    ground: '#E9DCCB',
    palette: [
      { role: 'the main clay body', hex: '#E86A50' },
      { role: 'a second clay colour', hex: '#4FA3A5' },
      { role: 'a warm third clay', hex: '#F2C14E' },
      { role: 'clay shadow side, darker and warmer', hex: '#A8432F' },
      { role: 'soft highlight on the rounded tops', hex: '#FFF1E0' },
    ],
    accent: '#F2C14E',
    rendering:
      'Claymation: chunky, soft, rounded forms with no sharp corners, each modelled with a radial gradient (lit top-left, ' +
      'warmer darker underside), a soft highlight blob and a subtle noise texture so the surface looks hand-pressed. ' +
      'Slightly uneven proportions, thick and toy-like.',
    lighting: 'One warm soft key light from the upper left; soft contact shadows directly under each object on the ground.',
    ground_rule:
      'A matte clay tabletop in warm beige meeting a slightly darker backdrop with a soft curved horizon, soft shadows under everything.',
    motion:
      'Stop-motion feel: squash and stretch on every landing (scaleY 0.85 → 1.05 → 1), arrivals with back.out(1.8), ' +
      'objects reshape by squishing into the next form. A slight step to the motion (ease with steps on small idle ' +
      'moves) sells the handmade look.',
    camera: 'A tabletop camera: small slow dolly and push, a dive presses into the clay until its colour fills the frame.',
    never: ['thin lines', 'glows', 'neon colours', 'flat vector shapes without shading', 'dark backgrounds'],
  },

  poster: {
    id: 'poster',
    ground: '#F6E4C6',
    palette: [
      { role: 'cobalt, the dominant bold shape', hex: '#2B3BFF' },
      { role: 'deep ink for contrast shapes', hex: '#0E0F1F' },
      { role: 'tangerine, the second bold colour', hex: '#FF5A1F' },
      { role: 'pink, small punchy details', hex: '#FF7DC7' },
    ],
    accent: '#FF5A1F',
    rendering:
      'Loud graphic poster: huge flat geometric shapes — circles, half-circles, bars, arrows, rectangles — in a few ' +
      'saturated colours, hard edges, no shading. The subject is built big from a handful of these primitives, ' +
      'Bauhaus-like, with bold scale contrast between its own parts.',
    lighting: 'None. Pure flat colour; contrast comes from scale and colour blocking.',
    ground_rule:
      'Flat warm cream paper, with one oversized cropped shape bleeding off an edge far behind the subject in a pale tint of a palette colour.',
    motion:
      'Punchy and rhythmic: shapes slam in on the beat with expo.out or back.out(2), wipe across with hard masks, ' +
      'rotate in 90° snaps, scale from 0 to full in 0.25 s. Strong overlap and staggered rhythm, like it is cut to music.',
    camera: 'Locked off and centred; big moves are done by the shapes, plus a hard zoom that punches into a shape until it fills the frame.',
    never: ['gradients', 'textures', 'soft glows', 'thin lines', 'realistic detail'],
  },

  diorama: {
    id: 'diorama',
    ground: '#F6DCD6',
    palette: [
      { role: 'dusty pink, the main walls and surfaces', hex: '#E9A3A0' },
      { role: 'mint, the second surface colour', hex: '#9ED2C6' },
      { role: 'mustard for the key object', hex: '#E7B75F' },
      { role: 'deep burgundy for trims and shadows', hex: '#7D2E3A' },
      { role: 'cream highlights', hex: '#FFF4E8' },
    ],
    accent: '#7D2E3A',
    rendering:
      'Pastel miniature diorama: a perfectly symmetrical, front-facing composition, like a tiny set built in a box. ' +
      'Flat pastel shapes with neat trims and small precise details, centred on the vertical axis, everything placed ' +
      'with fussy order. Soft shading only.',
    lighting: 'Even, soft, slightly warm light from the front; tiny soft shadows under objects.',
    ground_rule:
      'A soft pastel back wall and floor meeting at a horizon behind the centred subject, with a faint symmetrical arch or panel directly behind it. Nothing at the frame edges.',
    motion:
      'Precise and deadpan: objects slide in on straight lines and stop exactly in place (power3.out), doors and ' +
      'panels flip open, things pop up from below the floor. Symmetric pairs move in mirror image.',
    camera: 'Dead-centre and level always; moves are straight pushes in and straight lateral tracks, never tilted.',
    never: ['asymmetric layouts', 'dark backgrounds', 'neon colours', 'glows', 'messy hand-drawn lines'],
  },

  pencil: {
    id: 'pencil',
    ground: '#F6F0E1',
    palette: [
      { role: 'warm graphite for outlines', hex: '#4A4038' },
      { role: 'coloured pencil red', hex: '#D9534F' },
      { role: 'coloured pencil blue', hex: '#4A7FB5' },
      { role: 'coloured pencil green', hex: '#6BA368' },
      { role: 'coloured pencil yellow', hex: '#F0C04A' },
    ],
    accent: '#D9534F',
    rendering:
      'Coloured-pencil storybook illustration: soft, slightly wobbly graphite outlines (3–4px), colour laid in as ' +
      'visible pencil hatching — fills made of many thin parallel strokes at a slight angle, or a fill with an SVG ' +
      'turbulence texture so paper shows through. Charming, gentle, hand-made.',
    lighting: 'Soft daylight; shading is denser hatching on the shadow side.',
    ground_rule:
      'Warm sketchbook paper with a faint tooth texture, and a loose pale pencil wash around the subject fading to bare paper.',
    motion:
      'Gentle and storybook-like: outlines sketch on, hatching fills in a few strokes at a time, objects bob in with ' +
      'back.out(1.4). Small boiling wobble on lines (tiny finite jitter) gives it life. Transitions draw the next page over the last.',
    camera: 'Soft slow push; a dive follows a pencil line into the next drawing.',
    never: ['clean vector fills', 'glows', 'neon colours', 'dark backgrounds', 'photorealism'],
  },
  /*
   * Social looks: the styles editors reach for on TikTok and Reels, from the
   * motion-graphics half of the same survey — one shape morphing through UI
   * states, liquid chrome, high-end minimal, particle swarms, cut-out
   * stickers, retro CRT. Same rule as above: how, never what.
   */

  morph: {
    id: 'morph',
    ground: '#E9E7E3',
    palette: [
      { role: 'the shape itself, near-black UI', hex: '#111111' },
      { role: 'white surfaces and content on the shape', hex: '#FFFFFF' },
      { role: 'light grey for tracks, empty states and dividers', hex: '#CFCCC6' },
      { role: 'mid grey for secondary icons', hex: '#8C8A85' },
    ],
    accent: '#3D5AFE',
    rendering:
      'Crisp product-UI motion design: ONE rounded shape (a pill, a card, a circle) that IS the subject, drawn as clean flat ' +
      'components — buttons, toggles, sliders, loaders, progress rings, check marks, simple line icons (stroke 6–8px, round ' +
      'caps). Black and white with the one accent on the active part. A small black arrow cursor with a white outline drives ' +
      'every change by moving, pressing (scale 0.85) and releasing. Build the morphing shape as an SVG rect and tween ' +
      'its attr x, y, width, height and rx together so it stays centred. No device frames, no screenshots.',
    lighting: 'Flat; a single soft shadow under the shape (0 30px 60px at 15%). No glows, no gradients on the UI.',
    ground_rule: 'A warm light-grey canvas with nothing on it — all attention on the one shape.',
    motion:
      'One shape, never cut: every state is the same element morphing its width, height, corner radius and colour ' +
      '(0.35–0.5 s, back.out(1.2) — a spring with a tiny overshoot), while its content swaps with a quick fade and slight ' +
      'scale. The cursor arrives just before each change and clicks on the beat. Something changes on every word that names it.',
    camera: 'Locked and centred; the shape itself grows to fill the frame for its big moment.',
    never: ['bouncy wobbly easing', 'particle bursts', 'glows', 'gradients on UI elements', 'phone or browser frames'],
  },

  chrome: {
    id: 'chrome',
    ground: '#0D0B14',
    palette: [
      { role: 'bright chrome highlight', hex: '#FFFFFF' },
      { role: 'chrome mid-tone reflection', hex: '#A7A9B4' },
      { role: 'chrome dark reflection band', hex: '#2A2B33' },
      { role: 'holographic violet sheen', hex: '#B79CFF' },
      { role: 'holographic aqua sheen', hex: '#7FF3E8' },
    ],
    accent: '#FF8AD8',
    rendering:
      'Liquid chrome, Y2K: objects are smooth, bulbous, mirror-polished metal — built from sharp-banded linear and radial ' +
      'gradients (white, light grey, near-black bands, white again) that read as reflections, with a thin iridescent ' +
      'violet-to-aqua edge sheen. Shapes are blobby and inflated, like liquid metal or a balloon. A few small four-point ' +
      'sparkle stars.',
    lighting: 'Studio reflections: hard white highlight bands across the top of every object, a dark band below the middle, a soft pink rim.',
    ground_rule:
      'A near-black ground with one large soft holographic gradient glow (violet into aqua) behind the subject and a faint reflection under it.',
    motion:
      'Liquid: objects swell in from a droplet with elastic.out(1, 0.6) on arrival only, then morph into the next shape by ' +
      'melting (scale squash, blur 2–4px through the change). The reflection bands slide across objects as they turn. ' +
      'Sparkles twinkle in and out.',
    camera: 'A slow orbit-like drift with slight scale; a dive goes into the mirror surface of the subject.',
    never: ['flat matte colours', 'outlines', 'paper or hand-drawn textures', 'pixel art', 'white backgrounds'],
  },

  mono: {
    id: 'mono',
    ground: '#0A0A0A',
    palette: [
      { role: 'pure white, the subject', hex: '#FFFFFF' },
      { role: 'light grey for second planes', hex: '#BDBDBD' },
      { role: 'dark grey for shapes receding into the ground', hex: '#262626' },
      { role: 'off-black panels', hex: '#141414' },
    ],
    accent: '#C6FF00',
    rendering:
      'High-end minimal, like a premium launch film: very few, very clean geometric shapes in white on near-black, thin ' +
      'precise lines (3–4px) and solid forms, enormous negative space, and exactly ONE electric-lime accent per beat. ' +
      'Elements are revealed through masks (clipPath rectangles sliding) rather than faded in.',
    lighting: 'None to speak of — contrast does everything. At most a very faint radial lift behind the subject.',
    ground_rule: 'Near-black, perfectly flat, nothing else on it.',
    motion:
      'Precise and expensive: masked wipes and slides with expo.out (0.5–0.7 s), match cuts where one shape becomes the ' +
      'next in exactly the same place, a single smooth camera push. Tight rhythm on the words. No bounce at all.',
    camera: 'One smooth continuous push; transitions are match-cuts inside the frame, never camera shakes.',
    never: ['glows', 'gradients', 'bouncy easing', 'more than one accent colour', 'textures or grain'],
  },

  particles: {
    id: 'particles',
    ground: '#05060D',
    palette: [
      { role: 'bright particle cores', hex: '#FFFFFF' },
      { role: 'cool cyan particles', hex: '#5CE1E6' },
      { role: 'warm amber particles', hex: '#FFB547' },
      { role: 'dim far particles', hex: '#2B3A67' },
    ],
    accent: '#5CE1E6',
    rendering:
      'Everything is made of particles: hundreds of small glowing dots (3–8px, a soft glow on the brightest) that swarm ' +
      'together to form each object’s silhouette and outline, denser on edges, sparser inside. No solid shapes — the ' +
      'subject exists only as a cloud of points.',
    lighting: 'The particles are the light: a soft bloom (drop-shadow glow) on the cores and a faint haze where they gather.',
    ground_rule: 'Deep blue-black with a few hundred dim drifting far particles at different depths.',
    motion:
      'Swarm: particles start scattered and fly in to their positions on the word with staggered expo.out (each with its ' +
      'own small delay), hold with a gentle shimmer, then explode outward and re-gather as the next object. Smooth, fluid, ' +
      'never all moving in lockstep.',
    camera: 'A slow push through the field so near particles move faster than far ones.',
    never: ['solid filled shapes', 'outlines drawn as lines', 'flat cartoon style', 'light backgrounds', 'text made of particles'],
  },

  sticker: {
    id: 'sticker',
    ground: '#FFD43B',
    palette: [
      { role: 'thick white sticker border around every object', hex: '#FFFFFF' },
      { role: 'hot pink, the first object colour', hex: '#FF4D8D' },
      { role: 'electric blue, the second object colour', hex: '#2F6BFF' },
      { role: 'black for marker doodles and details', hex: '#111111' },
      { role: 'mint, the third object colour', hex: '#2EE6A6' },
    ],
    accent: '#111111',
    rendering:
      'Creator-reel stickers: each object is a bold, simple, flat illustration with a THICK white die-cut border (14–20px) ' +
      'and a hard drop shadow (8px offset, 25% black), like a sticker slapped onto the frame. Around them, black marker ' +
      'doodles — arrows, circles, underlines, sparkle strokes, squiggles — that draw themselves on.',
    lighting: 'Flat colour; the only depth is the sticker shadow.',
    ground_rule: 'A saturated flat colour with a faint grid or halftone dots, and one or two oversized pale blobs behind.',
    motion:
      'Punchy and playful: stickers slap on with a quick scale-down from 1.4 and back.out(2.5), a little rotation (±8°) ' +
      'and a shake on landing; they peel off by flipping. Marker doodles draw on fast (0.2–0.3 s). Things pop exactly on the words.',
    camera: 'Locked and centred, with quick punch-in zooms (scale 1 → 1.08) on the important beats.',
    never: ['photorealism', 'soft gradients', 'thin hairlines', 'dark backgrounds', 'objects without the white border'],
  },

  retro: {
    id: 'retro',
    ground: '#14100F',
    palette: [
      { role: 'warm phosphor orange, the main colour', hex: '#FF8A3D' },
      { role: 'teal, the second colour', hex: '#2EC4B6' },
      { role: 'cream highlights', hex: '#FFE8C2' },
      { role: 'deep brown shadows', hex: '#3A2418' },
      { role: 'faded magenta, sparingly', hex: '#E0567A' },
    ],
    accent: '#FF8A3D',
    rendering:
      'Retro-futurist CRT: chunky rounded shapes from 70s–80s tech (rounded rectangles, sunset stripes, horizon grids) in ' +
      'warm orange, teal and cream, seen through an old screen — horizontal scanlines over everything, a slight RGB ' +
      'fringe (red and cyan copies offset 3–4px), animated film grain, and a curved dark vignette.',
    lighting: 'A warm glow bleeding from bright shapes (soft orange bloom), dark corners like a curved tube.',
    ground_rule: 'A deep warm brown-black with a perspective grid floor fading into a horizon behind the subject, under the scanlines.',
    motion:
      'Analogue: things power on with a quick vertical squash-and-flash like an old TV, the picture rolls or jitters ' +
      'a couple of pixels on big beats (finite), stripes wipe across, and changes happen with a brief static flicker.',
    camera: 'A steady push with a tiny occasional jitter; transitions are TV switch-offs and switch-ons.',
    never: ['clean modern flat UI', 'pure white backgrounds', 'pastel colours', 'smooth glassy surfaces', 'neon pink-cyan cyberpunk'],
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
  if (include.includes('ground_rule')) lines.push(`Behind the subject: ${guide.ground_rule}`);
  if (include.includes('motion')) lines.push(`How things move here: ${guide.motion}`);
  if (include.includes('camera')) lines.push(`Camera: ${guide.camera}`);

  lines.push(`Never: ${guide.never.join(', ')}.`);
  return lines.join('\n');
}

/** Every look has a guide, checked at module load rather than at render time. */
for (const look of SCENE_LOOKS) {
  if (!STYLE_GUIDES[look]) throw new Error(`No style guide for look "${look}"`);
}
