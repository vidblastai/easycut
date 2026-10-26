import type { SceneLook } from '@/lib/edl/types';

/**
 * The look somebody wants their made pictures in, picked from examples.
 *
 * ── Why a page of examples rather than a style field ────────────────────
 *
 * Asking "what visual style?" gets a shrug or an adjective, and "make it look
 * cinematic" produces a different picture every call. Pointing at three tiles
 * is a decision anybody can make in five seconds, and each tile stands for a
 * paragraph written for a model rather than for a person.
 *
 * ── What a pick changes ─────────────────────────────────────────────────
 *
 *   - Every generated B-roll insert is asked for in that look instead of the
 *     default documentary realism. With more than one picked, the inserts
 *     cycle through them in the order they were picked, the way transitions
 *     do — variety inside a set the person chose, not inside the whole space.
 *   - The animated scenes are drawn in the world closest to the first pick,
 *     unless a scene look was chosen explicitly on the previous screen.
 *
 * What a pick does NOT change is the two rules in `broll-prompt.ts` that
 * decide whether a made picture survives next to real footage: nobody in
 * frame, and no lettering. A look is a style, not a licence.
 */

export interface VisualInspo {
  id: string;
  name: string;
  /** One line under the tile. */
  blurb: string;
  /**
   * The look, written for an image or video model.
   *
   * Concrete — the medium, the light, the colour, the lens or the brush —
   * because a model acts on nouns and ignores adjectives.
   */
  look: string;
  /** The world the animated scenes are drawn in for this pick. */
  sceneLook: SceneLook;
  /**
   * The tile's stand-in picture, as CSS backgrounds.
   *
   * Painted rather than loaded, like the overlay swatches: the picker ships
   * no assets and cannot show a broken thumbnail.
   */
  paint: string;
  /** Painted on top of `paint`: the subject silhouette in the tile. */
  figure: string;
}

/** More than this and it stops being a look and becomes a collage. */
export const MAX_INSPO = 3;

export const VISUAL_INSPO: readonly VisualInspo[] = [
  {
    id: 'documentary',
    name: 'Real footage',
    blurb: 'Looks shot on a real camera. Blends in with your own clips.',
    look:
      'A frame from real documentary footage. Shot on a full-frame camera with a 35mm lens, natural available ' +
      'light, ordinary realistic colour, real materials and real wear. Not cinematic, not stylised, not a render.',
    sceneLook: 'studio',
    paint: 'linear-gradient(180deg,#b9c4cc 0%,#8e9aa3 45%,#5b5146 46%,#3d342b 100%)',
    figure: 'radial-gradient(ellipse 22% 14% at 50% 52%,#e9e2d4 0 60%,transparent 62%),radial-gradient(ellipse 30% 4% at 50% 60%,rgba(0,0,0,.35) 0 60%,transparent 70%)',
  },
  {
    id: 'cinematic',
    name: 'Cinematic',
    blurb: 'Film stills: anamorphic, moody contrast, teal and amber.',
    look:
      'A still from a feature film. Anamorphic lens, shallow depth of field, soft background bokeh, teal shadows ' +
      'and warm amber highlights, deliberate low-key lighting with one motivated source, subtle film grain.',
    sceneLook: 'archive',
    paint: 'radial-gradient(circle at 70% 35%,rgba(255,170,90,.75) 0 8%,transparent 30%),linear-gradient(180deg,#0f2a33 0%,#173c45 50%,#0a1519 100%)',
    figure: 'linear-gradient(180deg,transparent 0 30%,rgba(0,0,0,.85) 30% 33%,transparent 33% 67%,rgba(0,0,0,.85) 67% 70%,transparent 70%),radial-gradient(ellipse 18% 22% at 38% 58%,#0b1a1f 0 60%,transparent 62%)',
  },
  {
    id: 'golden-hour',
    name: 'Golden hour',
    blurb: 'Warm low sun, long shadows, soft haze.',
    look:
      'Photographed at golden hour. Low warm sun raking across the scene, long soft shadows, gentle lens flare and ' +
      'atmospheric haze, honey and peach tones, natural textures glowing at the edges.',
    sceneLook: 'archive',
    paint: 'radial-gradient(circle at 62% 46%,#fff1c2 0 6%,#ffc46b 14%,transparent 42%),linear-gradient(180deg,#f7a65a 0%,#e5784a 52%,#5b2d24 53%,#2c1612 100%)',
    figure: 'radial-gradient(ellipse 40% 6% at 50% 56%,rgba(60,25,15,.7) 0 60%,transparent 70%)',
  },
  {
    id: 'clay-3d',
    name: '3D clay',
    blurb: 'Soft matte 3D renders, pastel and playful.',
    look:
      'A soft 3D clay render. Matte plasticine materials with rounded edges, pastel colours, soft global ' +
      'illumination, gentle ambient occlusion, a seamless pale backdrop, objects that look sculpted by hand.',
    sceneLook: 'gallery',
    paint: 'radial-gradient(circle at 50% 40%,#fbe3ea 0 30%,#f3c7d6 60%,#e8b4c8 100%)',
    figure: 'radial-gradient(circle at 42% 46%,#8fd3c8 0 13%,transparent 13.5%),radial-gradient(circle at 60% 52%,#ffb38a 0 10%,transparent 10.5%),radial-gradient(ellipse 30% 5% at 50% 66%,rgba(160,90,110,.35) 0 60%,transparent 70%)',
  },
  {
    id: 'isometric',
    name: 'Isometric',
    blurb: 'Tidy little 3D worlds seen from above.',
    look:
      'An isometric 3D illustration. A tidy miniature diorama seen from a 30-degree angle, clean geometric ' +
      'shapes, soft shadows, a limited bright palette, crisp edges, everything on a floating tile.',
    sceneLook: 'studio',
    paint: 'linear-gradient(160deg,#e9f0ff 0%,#cfdcff 100%)',
    figure: 'conic-gradient(from 210deg at 50% 52%,#6b7cff 0 120deg,#9aa7ff 0 240deg,#4453d6 0 360deg)',
  },
  {
    id: 'neon-night',
    name: 'Neon night',
    blurb: 'Rain-slick streets, glowing signs, deep blues and pinks.',
    look:
      'A night scene lit by neon. Deep blue darkness, magenta and cyan light spilling across wet reflective ' +
      'surfaces, glowing edges, light rain, rich saturated colour, high contrast.',
    sceneLook: 'neon',
    paint: 'radial-gradient(circle at 30% 30%,rgba(255,60,200,.55) 0 10%,transparent 35%),radial-gradient(circle at 75% 45%,rgba(60,220,255,.5) 0 8%,transparent 32%),linear-gradient(180deg,#0b0f2e 0%,#1b0f3a 55%,#05060f 100%)',
    figure: 'linear-gradient(180deg,transparent 0 62%,rgba(255,60,200,.25) 62% 64%,transparent 64% 74%,rgba(60,220,255,.2) 74% 76%,transparent 76%)',
  },
  {
    id: 'dark-editorial',
    name: 'Dark editorial',
    blurb: 'Near-black, one violet glow, rim-lit metal.',
    look:
      'A dark editorial product shot. Near-black background with one localised violet light pool behind the ' +
      'subject, rim-lit metal and dark glass, silver highlights, deep shadows, large quiet black areas.',
    sceneLook: 'editorial',
    paint: 'radial-gradient(circle at 50% 42%,#7d16c9 0 6%,#3a0866 22%,#0d0216 50%,#030105 75%)',
    figure: 'radial-gradient(circle at 50% 44%,#1a0f22 0 16%,transparent 16.5%),radial-gradient(circle at 50% 44%,transparent 0 15.5%,#c9b6e6 16%,transparent 17%)',
  },
  {
    id: 'bright-studio',
    name: 'Bright studio',
    blurb: 'Clean product shots on a seamless white.',
    look:
      'A bright studio product photograph. Seamless white backdrop, large soft key light, gentle contact shadow, ' +
      'crisp detail, clean neutral colour, minimal and airy composition.',
    sceneLook: 'studio',
    paint: 'radial-gradient(circle at 50% 40%,#ffffff 0 40%,#eef0f4 75%,#dfe2e8 100%)',
    figure: 'radial-gradient(ellipse 14% 20% at 50% 46%,#2b2e36 0 60%,transparent 62%),radial-gradient(ellipse 26% 4% at 50% 64%,rgba(0,0,0,.18) 0 60%,transparent 70%)',
  },
  {
    id: 'retro-film',
    name: 'Retro film',
    blurb: '70s film stock: faded colour, grain, warm cast.',
    look:
      'A photograph on 1970s 35mm film stock. Faded warm colour, lifted blacks, visible grain, slight halation ' +
      'around highlights, soft focus at the edges, a nostalgic orange and olive cast.',
    sceneLook: 'archive',
    paint: 'linear-gradient(180deg,#d9b78a 0%,#c4925e 40%,#7a6a3c 41%,#4d4426 100%)',
    figure: 'repeating-radial-gradient(circle at 30% 30%,rgba(0,0,0,.06) 0 1px,transparent 1px 3px),radial-gradient(ellipse 20% 14% at 50% 50%,#f2e1c0 0 60%,transparent 62%)',
  },
  {
    id: 'anime',
    name: 'Anime',
    blurb: 'Hand-painted backgrounds, big skies, soft light.',
    look:
      'A hand-painted anime background illustration. Painterly clouds, vivid clean sky gradients, soft cel ' +
      'shading, detailed environment art, warm afternoon light, lush colour.',
    sceneLook: 'gallery',
    paint: 'radial-gradient(ellipse 30% 12% at 30% 28%,#ffffff 0 60%,transparent 62%),radial-gradient(ellipse 26% 10% at 70% 20%,#ffffff 0 60%,transparent 62%),linear-gradient(180deg,#4aa3ff 0%,#9fd3ff 58%,#5fae6a 59%,#3f8a4d 100%)',
    figure: 'radial-gradient(ellipse 60% 10% at 50% 60%,rgba(40,110,60,.6) 0 60%,transparent 70%)',
  },
  {
    id: 'watercolor',
    name: 'Watercolour',
    blurb: 'Loose washes and paper texture.',
    look:
      'A loose watercolour painting on textured paper. Soft bleeding washes, visible paper grain, gentle pigment ' +
      'blooms, a light hand-drawn ink line, airy white space, muted natural palette.',
    sceneLook: 'gallery',
    paint: 'radial-gradient(circle at 35% 45%,rgba(120,170,210,.55) 0 18%,transparent 40%),radial-gradient(circle at 65% 55%,rgba(230,160,140,.5) 0 16%,transparent 38%),linear-gradient(180deg,#faf6ee 0%,#f1ebdf 100%)',
    figure: 'repeating-linear-gradient(35deg,rgba(0,0,0,.025) 0 2px,transparent 2px 5px)',
  },
  {
    id: 'moody-noir',
    name: 'Moody noir',
    blurb: 'Black and white, hard light, deep shadow.',
    look:
      'A black-and-white noir photograph. Hard single light source, deep crushed shadows, venetian-blind light ' +
      'stripes, smoke in the air, high contrast silver tones, dramatic composition.',
    sceneLook: 'editorial',
    paint: 'linear-gradient(135deg,#0c0c0c 0%,#2a2a2a 55%,#0a0a0a 100%)',
    figure: 'repeating-linear-gradient(160deg,rgba(255,255,255,.22) 0 10px,transparent 10px 26px)',
  },
];

const BY_ID = new Map(VISUAL_INSPO.map((inspo) => [inspo.id, inspo]));

export function findInspo(id: string): VisualInspo | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Known ids only, each once, at most `MAX_INSPO`, in the order given.
 *
 * The order is kept because it is a choice: the first pick sets the scenes'
 * world and leads the cycle. A name a later build drops costs a preference,
 * not a render.
 */
export function sanitiseInspo(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const id of raw) {
    if (typeof id === 'string' && BY_ID.has(id) && !out.includes(id)) out.push(id);
    if (out.length === MAX_INSPO) break;
  }
  return out;
}

/** Reads the stored JSON column. */
export function parseInspo(stored?: string | null): string[] {
  if (!stored) return [];
  try {
    return sanitiseInspo(JSON.parse(stored));
  } catch {
    return [];
  }
}

/** The look for the Nth made insert: the picks, cycled in order. */
export function inspoForInsert(ids: readonly string[] | null | undefined, index: number): VisualInspo | null {
  if (!ids?.length) return null;
  return findInspo(ids[index % ids.length]);
}

/** The world the animated scenes follow from, when nobody chose one. */
export function sceneLookForInspo(ids: readonly string[] | null | undefined): SceneLook | null {
  const first = ids?.length ? findInspo(ids[0]) : null;
  return first?.sceneLook ?? null;
}
