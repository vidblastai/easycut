import { env } from '@/lib/config/env';
import { parseIllustration, isDrawn, type Illustration } from '@/lib/assets/illustration';
import type { AnimatedScene, SceneLook } from '@/lib/edl/types';
import { LOOK_META } from '@/lib/scenes/looks';
import { wavespeedPriceFor } from './wavespeed';

/**
 * Opus draws the picture.
 *
 * ── Why this is a second pass and not a bigger first one ────────────────
 *
 * Choosing which four seconds of a video deserve an animation is a judgement
 * about the transcript. Drawing the thing that goes there is a completely
 * different job, and asking one call to do both makes it worse at the first —
 * a model that has to produce two kilobytes of vector art per scene starts
 * economising on the part where it decides whether the scene should exist. So
 * the selection pass stays as it was, and this runs afterwards, once per scene
 * it chose, in parallel.
 *
 * It also isolates the failure. A drawing that comes back malformed costs that
 * one scene its illustration and nothing else: the scene still renders, with
 * the icons the selection pass named. Nothing about this pass can take a scene
 * away, and that matters because it took several rounds to make scenes appear
 * at all.
 *
 * ── Why SVG, drawn, rather than an image model ──────────────────────────
 *
 * Three reasons, in order of how much they matter:
 *
 *   1. It arrives IN PARTS. The model is asked for `<g id="part-1">` groups,
 *      and the renderer brings them in one at a time. A raster illustration
 *      can only fade up; a drawing in pieces assembles, and assembling is the
 *      whole difference between a picture on screen and a motion graphic.
 *   2. It is vector, so it is sharp at 1080x1920 and costs nothing to recolour
 *      to whatever world the scene is drawn in.
 *   3. It is free of the thing that makes generated art unusable in a
 *      composition — a background you then have to key out.
 */

const API_BASE = 'https://llm.wavespeed.ai/v1';

/** The coordinate space every drawing is asked for, so the renderer can size it. */
const CANVAS = 1000;

const SYSTEM = `You draw the illustration for one moment of a video, as a single SVG.

It is shown full-screen for a few seconds while someone talks over it. It IS the shot — there is no footage behind it and nothing else on screen but a couple of words. So it has to carry the frame on its own: an icon floating in space does not, and neither does a diagram nobody can read in three seconds.

Draw the THING being talked about. If the sentence is about a phone, draw the phone. About money, draw notes, a card, a stack of coins. About time, draw the clock. Concrete objects and simple scenes beat abstract shapes every time, and both beat a symbol.

**Output ONE <svg> element and nothing else.** No prose, no code fence, no explanation.

Hard requirements:

1. \`<svg viewBox="0 0 ${CANVAS} ${CANVAS}" xmlns="http://www.w3.org/2000/svg">\`.
1b. **FILL THE CANVAS.** The drawing's bounding box must span at least 800 of the 1000 units across, and be centred left-to-right. A composition sitting small in one corner is the most common thing that comes back and it is unusable: this is shown full-screen on a phone, so anything drawn at half scale is a postage stamp in the middle of an empty frame. Work out roughly where your shapes end up and push them out to the edges. Keep 40 units of margin, no more.
2. **The top-level children are groups, in the order they should appear on screen: \`<g id="part-1">\`, \`<g id="part-2">\`, up to part-6.** Each is a piece a viewer would notice arriving on its own — the desk, then the laptop, then the chart on its screen, then the arrow. Three to six parts. This is the single most important instruction here: the renderer brings them in one at a time, a few frames apart, and a drawing in one group cannot animate.
3. Shapes only: path, circle, ellipse, rect, line, polyline, polygon, g. \`linearGradient\` and \`radialGradient\` in a \`<defs>\` are fine.
4. **No \`<text>\`.** Words are drawn by the renderer in the video's own typeface. If a label belongs on the drawing, leave room for it instead.
5. No \`<filter>\`, no \`<image>\`, no CSS \`filter\`, no blend modes, no animation elements. They are stripped out, and a drawing that depended on them arrives broken.
6. Every shape gets an explicit \`fill\` (or \`fill="none"\` with a \`stroke\`). An inherited fill renders black.
7. 20 to 80 shapes. Under 20 is a clipart symbol; over 80 nobody reads it in four seconds.

Craft:

- Build volume from flat shapes: a lighter face and a darker one, a cast shadow as a low-opacity ellipse. No outlines-only line art unless the palette is a stroke palette.
- Keep strokes at one or two weights throughout, 6–14 units, \`stroke-linecap="round"\`.
- Use the palette you are given and stay in it. The accent is a spot colour — one or two elements, not the whole drawing.
- Compose to the centre, and leave the bottom fifth emptier than the rest: that is where the caption sits.
- Vertically, sit the mass between y=80 and y=800. Put a soft contact shadow under whatever is standing on the ground — a low-opacity ellipse is enough, and without it everything floats.`;

export interface IllustrationRequest {
  /** What is being said over this scene, verbatim. */
  line: string;
  /** The scene's own words, so the drawing does not repeat them. */
  headline: string;
  items: string[];
  kind: string;
  look: SceneLook;
  accent: string;
}

export interface IllustrationResult {
  illustration: Illustration | null;
  costUsd: number;
  error?: string;
}

/**
 * The colours a drawing is allowed to use, per world.
 *
 * Handed to the model as a short list rather than described in words, because
 * "warm and cinematic" produces a different palette every run and the four
 * scenes in one video then look like they came from four different videos.
 */
const PALETTES: Record<SceneLook, { ground: string; swatch: string[]; note: string }> = {
  studio: {
    ground: '#FCFCFD',
    swatch: ['#0D0D10', '#3A3A46', '#8A8A96', '#E8E8EE', '#FFFFFF'],
    note: 'Clean product illustration on near-white. Soft neutral fills, one hairline outline weight, generous rounded corners.',
  },
  neon: {
    ground: '#05060F',
    swatch: ['#FFFFFF', '#B9C3F0', '#4B5BD0', '#1A1F44', '#0A0D22'],
    note: 'Glowing shapes on near-black. Bright rim-lit edges against dark bodies. No dark-on-dark detail — it disappears.',
  },
  gallery: {
    ground: '#EFF0F4',
    swatch: ['#22222A', '#6E7180', '#B7BAC6', '#E4E6EC', '#FFFFFF'],
    note: 'A solid object lit from above, standing on a plinth. Grey marble neutrals, a soft contact shadow under it.',
  },
  archive: {
    ground: '#0B0710',
    swatch: ['#F6EAD2', '#E0A94E', '#9A6B2A', '#4A2E12', '#160D06'],
    note: 'Warm amber and cream on near-black, like an object lit by a single lamp. Deep shadows, gold highlights.',
  },
};

export function isIllustratorConfigured(): boolean {
  return Boolean(env.llm.wavespeedKey && env.llm.motionModel);
}

/**
 * Draw every scene at once.
 *
 * In parallel because they are independent and a video can have six: run in
 * sequence they would add most of a minute to a render for no reason. Each
 * settles on its own, so one slow or failed drawing never holds up the rest.
 */
export async function illustrateScenes(
  scenes: AnimatedScene[],
  lineFor: (scene: AnimatedScene) => string,
): Promise<{ drawn: Map<string, Illustration>; costUsd: number; errors: string[] }> {
  const drawn = new Map<string, Illustration>();
  const errors: string[] = [];
  let costUsd = 0;

  if (!scenes.length || !isIllustratorConfigured()) {
    return { drawn, costUsd, errors: scenes.length ? ['no illustration model configured'] : [] };
  }

  const results = await Promise.all(
    scenes.map(async (scene) => ({
      id: scene.id,
      result: await drawScene({
        line: lineFor(scene),
        headline: scene.headline,
        items: scene.items,
        kind: scene.kind,
        look: scene.look,
        accent: scene.accent,
      }),
    })),
  );

  for (const { id, result } of results) {
    costUsd += result.costUsd;
    if (result.illustration) drawn.set(id, result.illustration);
    else if (result.error) errors.push(result.error);
  }

  return { drawn, costUsd, errors };
}

export async function drawScene(request: IllustrationRequest): Promise<IllustrationResult> {
  const model = env.llm.motionModel;
  if (!isIllustratorConfigured()) {
    return { illustration: null, costUsd: 0, error: 'no illustration model configured' };
  }

  const palette = PALETTES[request.look] ?? PALETTES.studio;

  /*
   * Inside a world, the world's colour wins.
   *
   * The project accent is a brand colour and it belongs on the type and the
   * UI. Handed to the drawing it produces a violet arrow in the middle of a
   * gold-on-black documentary frame, which reads as a mistake rather than as
   * branding. `studio` is the exception and the reason the axis exists: it is
   * a neutral world built to carry one saturated colour, so the brand's own
   * accent is exactly what should appear in it.
   */
  const accent = request.look === 'studio' ? request.accent : LOOK_META[request.look].swatch;
  const words = [request.headline, ...request.items].filter(Boolean).join(' · ');

  const brief = `Being said over this shot: "${request.line}"

${words ? `Words the renderer will put on top (do NOT draw them, just leave room): ${words}` : 'No words on this one — the drawing carries it alone.'}

Background it sits on: ${palette.ground}
Palette: ${palette.swatch.join(', ')}
Accent (use sparingly, one or two elements): ${accent}
Style: ${palette.note}

Draw what is being described, in ${request.kind === 'compare' ? 'two halves, the two things side by side' : request.kind === 'journey' ? 'a left-to-right progression' : 'one centred composition'}. Return only the <svg>.`;

  try {
    const response = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.llm.wavespeedKey!}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: brief },
        ],
        // Enough for eighty shapes with room to spare. A drawing that runs out
        // of tokens arrives without its closing tags, and the parser then
        // rejects the whole thing rather than showing half a picture.
        max_tokens: 6000,
        // Higher than the selection pass on purpose: that one is a judgement
        // with a right answer, this one is drawing, and a cautious drawing is
        // a boring one.
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(body.error?.message ?? `${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const pricing = wavespeedPriceFor(model);
    const costUsd =
      ((body.usage?.prompt_tokens ?? 0) / 1_000_000) * pricing.inputPerMTok +
      ((body.usage?.completion_tokens ?? 0) / 1_000_000) * pricing.outputPerMTok;

    const illustration = parseIllustration(body.choices?.[0]?.message?.content ?? '');
    if (!isDrawn(illustration)) {
      return { illustration: null, costUsd, error: 'illustration came back empty or too sparse to use' };
    }

    return { illustration, costUsd };
  } catch (error) {
    return {
      illustration: null,
      costUsd: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
