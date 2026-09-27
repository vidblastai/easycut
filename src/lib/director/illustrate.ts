import { env } from '@/lib/config/env';
import { auditIllustration, parseIllustration, isDrawn, type Illustration } from '@/lib/assets/illustration';
import type { AnimatedScene, SceneLook } from '@/lib/edl/types';
import { guideAsPrompt, styleGuideFor } from '@/lib/scenes/style-guides';
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

/** One beat's square. The strip is this tall per beat. */
const CANVAS = 1000;
const TWO = CANVAS * 2;
/** Three beats, which is the default the prompt is written around. */
const TALL = CANVAS * 3;

const SYSTEM = `You draw one moment of a video as a single SVG — not a picture, but a short sequence that plays out.

It is shown full-screen for a few seconds while someone talks over it. It IS the shot: there is no footage behind it and nothing else on screen but a few words. So it has to carry the frame on its own, and it has to HAPPEN rather than sit there.

## The sequence

The canvas is a tall strip with the beats of the sequence stacked down it, and the camera travels down the strip as the voice moves on. Beat 0 is the top ${CANVAS}x${CANVAS} square, beat 1 is the next one down, and so on.

\`<svg viewBox="0 0 ${CANVAS} ${TALL}" xmlns="http://www.w3.org/2000/svg">\` for three beats — height is ${CANVAS} per beat.

**Two or three beats.** Each one is a thing the viewer looks at, and then leaves behind. What the camera does at the end of a beat is follow an arrow down to the next one, so the beat that was on screen slides up and out and the next thing rises into view. Think:

- beat 0: a wallet, notes sliding out of it
- an arrow curving down out of beat 0
- beat 1: a single note, alone
- another arrow down
- beat 2: a clock

That is a sequence. "A wallet, a note and a clock arranged side by side" is not — it is a picture, and it is the thing to avoid.

**Each beat is drawn INSIDE its own square.** Beat 1's shapes have y coordinates between ${CANVAS} and ${TWO}, beat 2's between ${TWO} and ${TALL}. Nothing straddles a boundary except a connector.

## The groups

Every top-level \`<g>\` is one piece, in the order it should appear. Three to five per beat.

\`<g data-stage="1" data-depth="0.7" data-enter="rise" data-idle="bob" data-pivot="520 1430"> … </g>\`

- **data-stage** — which beat it belongs to. 0, 1 or 2.
- **data-depth** — 0 is far behind, 1 is right at the lens, 0.5 is the picture plane. The camera pushes and drifts within each beat, and near things travel further than far things: this is what makes a flat drawing read as a space. Give the pieces of a beat DIFFERENT depths.
- **data-enter** — \`pop\`, \`rise\` (up from below), \`slide-left\` / \`slide-right\`, \`grow\`, \`draw\` (a stroke draws itself end to end).
- **data-idle** — what it does for the rest of its beat: \`bob\`, \`drift\`, \`sway\`, \`pulse\`, \`tick\` (steps round like a clock hand), \`spin\` (turns continuously — a gear, a ring), \`none\`.
- **data-pivot** — \`"x y"\` in canvas coordinates, the point this piece turns and scales about. **Required on anything that ticks, spins or sways.** A clock's hands pivot on the pin at the centre of the dial. Get this wrong and the hand does not turn on the clock, it swings around the frame on its own — which is the single ugliest failure this drawing can have.

## One line per beat, saying what moves

Right after the opening \`<svg>\` tag, before the groups, put one \`<desc>\` per beat:

\`<desc data-stage="0">The glow pulses brighter and the two dashed silhouettes fade away one at a time.</desc>\`

One sentence each. Say only what physically CHANGES — not what the picture contains, not the mood, not the camera. These lines are handed to a video model that can already see the drawing, so describing the subject to it makes it draw a second copy of the subject; the change is the only thing it cannot work out for itself. One or two changes, no more, and make them visible in three seconds.

Good: "The hands sweep forward a quarter turn and the pendulum swings."
Bad: "A clock sits on a plinth in a bright room, conveying the passage of time."

**A connector between every pair of beats.** A dashed curve with an arrowhead, leading from the bottom of one beat into the top of the next, as its own group with \`data-stage\` set to the beat it leads FROM, \`data-enter="draw"\` and \`fill="none"\`. It draws itself just before the camera follows it. This is the piece that turns two beats into one sequence, so do not leave it out.

## Anything that pivots

Draw it so it CAN pivot, or the motion exposes it:

- A clock hand is a TAPERED SOLID SHAPE — a polygon or path, wide at the pin and narrow at the tip, in a colour that contrasts with the dial. Not a pie wedge, not a thin line the same colour as the face. Draw both hands, at different lengths and angles, both starting exactly at the pin.
- Its group's pivot is the pin. Put the hands in their own group; the dial, the bezel and the marks are a different group and do not move.
- A hand must visibly attach: it starts AT the pin coordinates, and a small cap circle is drawn over the join so the two hands and the pin read as one mechanism.
- Same for a gear (pivot at its centre), a swinging sign (pivot at its hook), a needle (pivot at its base).

## Hard requirements

1. **FILL EACH BEAT'S SQUARE.** The drawing in a beat spans at least 800 of the ${CANVAS} units across and is centred left to right. A composition sitting small in the middle is unusable: this is full-screen on a phone, so anything at half scale is a postage stamp in an empty frame.
2. Shapes only: path, circle, ellipse, rect, line, polyline, polygon, g. \`linearGradient\` and \`radialGradient\` in a \`<defs>\` are fine and worth using.
3. **No \`<text>\`.** Words are drawn by the renderer in the video's own typeface. Leave room for them in the lower part of each beat.
4. No \`<filter>\`, no \`<image>\`, no CSS \`filter\`, no blend modes, no \`<animate>\`. They are stripped, and a drawing that relied on them arrives broken.
5. Every shape gets an explicit \`fill\` (or \`fill="none"\` with a \`stroke\`). An inherited fill renders black.
6. **50 to 140 shapes across the whole strip.** That is the line between clipart and illustration, and it is worth spending.

## Craft

- **One background for the WHOLE strip, and it must be continuous.** Make the first group a backdrop that spans every beat — full width, from y=0 to the bottom of the last beat — with \`data-stage="0"\` and \`data-depth="0.05"\`. The camera pans down between beats and travels over the boundary, so a backdrop that stops at the end of a beat leaves the screen blank for half a second. Give it something to look at all the way down: a wall that changes tone, a floor line that runs through, a soft pool of light under each object, a grid, a drift of texture dots, a long soft gradient.
- **Then give each beat its own ground.** A surface the object stands on, a shadow under it, a horizon behind it. An object floating on a flat colour is the most common thing that makes these look cheap.
- **Build volume from flat shapes.** A lit face and a shadowed one. A darker plane where a surface turns away. A cast shadow as a low-opacity ellipse underneath — without one, everything floats.
- **Detail the object the way it really is.** A clock has a bezel, a dial, an inner ring, twelve marks, two hands and a cap. A banknote has a border, a portrait oval, a denomination block, a guilloche line. Three or four of those is the difference between "a clock" and a clock.
- One or two stroke weights throughout, 6–14 units, \`stroke-linecap="round"\`.
- Stay in the palette you are given. The accent is a spot colour — one or two elements a beat, not the whole drawing.

**Output ONE <svg> element and nothing else.** No prose, no code fence, no explanation.`;

export interface IllustrationRequest {
  /** Namespaces the drawing's gradient ids, so two scenes cannot collide. */
  id?: string;
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
/**
 * How many scenes in one video get a drawing.
 *
 * A three-beat strip with a hundred shapes and a repair round is about fifty
 * cents and three minutes of model time. Six of them is three dollars on a
 * single upload, which is more than the rest of the pipeline costs put
 * together — so the first few scenes get the drawing and the rest fall back to
 * the icon layout, which still works and still reads.
 *
 * The first few rather than a spread on purpose: attention is highest early,
 * and a video whose best scene is its ninetieth second has spent the money in
 * the wrong place.
 */
export const MAX_DRAWN_SCENES = 4;

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
    scenes.slice(0, MAX_DRAWN_SCENES).map(async (scene) => ({
      id: scene.id,
      result: await drawScene({
        id: scene.id,
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

/** Beats per drawing. Two is thin, four cannot be read in a four-second insert. */
const STAGES = 3;

/**
 * What the sequence should be, per shape of explanation.
 *
 * Phrased as a progression rather than as a layout, because the failure this
 * is guarding against is the model arranging three things side by side and
 * calling it a sequence — which is a picture, and the whole point of the beats
 * is that the camera LEAVES one to find the next.
 */
function sequenceFor(kind: string): string {
  switch (kind) {
    case 'compare':
      return 'the first thing alone, then an arrow down, then the second thing alone — never the two side by side';
    case 'journey':
      return 'one step per beat, in order, each one leading down to the next';
    case 'stack':
      return 'the foundation, then what sits on it, then what sits on that';
    case 'big-number':
      return 'the thing the figure is about, then what it becomes, then the consequence';
    case 'orbit':
      return 'the whole thing, then one part of it close up, then another';
    default:
      return 'the situation, then what changes, then where it ends up';
  }
}

export async function drawScene(request: IllustrationRequest): Promise<IllustrationResult> {
  const model = env.llm.motionModel;
  if (!isIllustratorConfigured()) {
    return { illustration: null, costUsd: 0, error: 'no illustration model configured' };
  }

  const guide = styleGuideFor(request.look);

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
  const words = [request.headline, ...request.items].filter(Boolean).join(' · ');

  const brief = `Being said over this shot: "${request.line}"

${
    words
      ? `Words the renderer will draw on top afterwards (do NOT draw them, just leave the lower fifth of each beat clear): ${words}`
      : 'No words on this one — the drawing carries it alone.'
  }

${guideAsPrompt(guide, ['palette', 'rendering', 'lighting', 'ground_rule'])}

Draw this as ${STAGES} beats: ${sequenceFor(request.kind)}. Return only the <svg>.`;

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
        // Raised for the detail the craft notes ask for: a hundred shapes
        // with gradients runs past six thousand, and a drawing that runs out
        // of tokens arrives without its closing tags and is refused whole.
        // A three-beat strip with 140 shapes runs long; a drawing that hits
        // the ceiling arrives without its closing tags and is refused whole.
        max_tokens: 16000,
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

    const drawn = body.choices?.[0]?.message?.content ?? '';
    const illustration = parseIllustration(drawn, request.id ?? '');
    if (!illustration || !isDrawn(illustration)) {
      return { illustration: null, costUsd, error: 'illustration came back empty or too sparse to use' };
    }

    /*
     * Look at it before using it, and send it back if it is wrong.
     *
     * "Make sure to render the icons before, so they actually make sense" —
     * and the specific complaint was a clock whose hands were not attached to
     * it. We cannot see the picture, but the things that go wrong here are
     * structural and ARE visible in the markup: a hand that rotates with no
     * pivot, a beat drawn outside its own band, a composition occupying a
     * corner of the square. One repair round fixes most of them, costs a few
     * cents, and the original is kept if the repair comes back worse — a
     * second attempt is not automatically a better one.
     */
    const problems = auditIllustration(illustration, STAGES);
    if (!problems.length) return { illustration, costUsd };

    const repair = await repairScene(request, brief, drawn, problems, model);
    return {
      illustration: repair.illustration ?? illustration,
      costUsd: costUsd + repair.costUsd,
      error: repair.illustration ? undefined : `kept the first drawing; ${problems[0]}`,
    };
  } catch (error) {
    return {
      illustration: null,
      costUsd: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * One round of "here is what is wrong with it, draw it again".
 *
 * Deliberately not a conversation: the original brief and the drawing go back
 * with a list of faults, and whatever comes out is audited the same way. If it
 * is not better than what went in, the caller keeps the original — a second
 * attempt is not automatically an improvement, and shipping a worse drawing
 * because it was newer is a trap worth naming.
 */
async function repairScene(
  request: IllustrationRequest,
  brief: string,
  drawn: string,
  problems: string[],
  model: string,
): Promise<{ illustration: Illustration | null; costUsd: number }> {
  try {
    const response = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.llm.wavespeedKey!}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: brief },
          { role: 'assistant', content: drawn },
          {
            role: 'user',
            content:
              `Not right yet. Fix these and return the whole corrected <svg>, nothing else:\n\n` +
              problems.map((problem, i) => `${i + 1}. ${problem}`).join('\n') +
              `\n\nKeep everything that already works — the subject, the palette, the parts that are drawn well. Change only what is listed.`,
          },
        ],
        max_tokens: 16000,
        // Lower than the first pass: this one is a correction against a list,
        // not an invention, and a creative repair tends to fix the fault by
        // drawing something else entirely.
        temperature: 0.4,
      }),
    });

    if (!response.ok) return { illustration: null, costUsd: 0 };

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const pricing = wavespeedPriceFor(model);
    const costUsd =
      ((body.usage?.prompt_tokens ?? 0) / 1_000_000) * pricing.inputPerMTok +
      ((body.usage?.completion_tokens ?? 0) / 1_000_000) * pricing.outputPerMTok;

    const fixed = parseIllustration(body.choices?.[0]?.message?.content ?? '', request.id ?? '');
    if (!fixed || !isDrawn(fixed)) return { illustration: null, costUsd };

    // Only kept if it actually has fewer faults than the drawing it replaces.
    const after = auditIllustration(fixed, STAGES).length;
    return { illustration: after < problems.length ? fixed : null, costUsd };
  } catch {
    return { illustration: null, costUsd: 0 };
  }
}
