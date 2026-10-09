import { env } from '@/lib/config/env';
import { isDrawn, parseIllustration, type Illustration } from '@/lib/assets/illustration';
import type { PanelScene } from '@/lib/edl/types';
import { wavespeedPriceFor } from './wavespeed';

/**
 * The panel, drawn rather than assembled.
 *
 * ── What was wrong ──────────────────────────────────────────────────────
 *
 * `Panel.tsx` holds eight React components and the writing pass picks one per
 * exhibit. That is a template library: twenty exhibits in a video are the same
 * eight animations with different words in them, and across two videos they
 * are the same eight again. The note was exact — *"it just repeats the same
 * animations over and over from the training data… you should also be able to
 * make your own unique animations that look completely different"* — and it
 * is a fair description of what the architecture could produce.
 *
 * The scene layer already solved this: `director/illustrate.ts` has the model
 * DRAW the shot as an SVG in parts, and the renderer brings the parts in one
 * at a time. The panel never got it. This is that, for the panel.
 *
 * ── Why this is not just illustrate.ts pointed at a smaller box ─────────
 *
 * Three things differ, and each one changes the prompt:
 *
 *  - **Shape.** A scene is a tall phone screen with three beats stacked down
 *    it and a camera travelling between them. A panel exhibit is a WIDE strip
 *    on screen for two seconds — one beat, no travel, no connectors.
 *  - **Subject.** A scene draws an idea: a wallet, a clock, a path. An
 *    exhibit draws a MOCK OF AN INTERFACE or a measurement, because that is
 *    the whole reason the format works — a viewer believes a claim about a
 *    product when they are looking at the product.
 *  - **Volume.** Four scenes in a video, twenty exhibits. One call per
 *    exhibit would be twenty round trips and forty minutes, so they are drawn
 *    in batches and the batches run at once.
 *
 * ── The fallback stays ──────────────────────────────────────────────────
 *
 * The eight kinds are what renders when this pass fails or is not configured,
 * exactly as the icon layout is what a scene falls back to. They have to stay
 * good: they are what ships when the model is down.
 */

const API_BASE = 'https://llm.wavespeed.ai/v1';

/**
 * The exhibit's canvas.
 *
 * 1000 x 756 is the panel's own shape — the explainer layout gives it the top
 * 42.5% of a 9:16 frame, so 1080 x 816, which is 1 : 0.756. A square canvas
 * would crop at the sides, which is the mistake the scene drawings made for a
 * while and the reason they are now asked for in the frame's own aspect.
 */
const WIDTH = 1000;
const HEIGHT = 756;

/**
 * Exhibits per call.
 *
 * Small enough that a batch cannot run out of output tokens — the failure
 * there is silent and total, because a drawing missing its closing tag is
 * refused whole — and large enough that a twenty-exhibit video is five calls
 * rather than twenty. They run together, so the wall time is one call.
 */
const PER_CALL = 4;

/** Past this the panel costs more than the rest of the edit put together. */
const MAX_DRAWN = 24;

const SYSTEM = `You draw exhibits for the top half of a vertical explainer video.

The frame is split. The bottom 57% is a person talking, the whole way through. The top 42% is a panel, and you are drawing what goes in it: a run of small exhibits, each on screen for about two seconds, each one a MOCK OF AN INTERFACE or a MEASUREMENT showing what the voice is describing at that moment.

This format works for one reason: a viewer believes a claim about a product when they are looking at the product. A drawn icon of a chart says "statistics". A dashboard with three stat tiles, a sparkline and a filter row says the thing happened.

## The canvas

\`<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">\` — a WIDE strip, the shape of the panel itself. One exhibit per svg. There is no camera travel and no sequence of beats: the viewer looks at this one thing for two seconds and then it is replaced.

## The groups

Every top-level \`<g>\` is one piece, in the order it should arrive. **Four to eight pieces.**

\`<g data-stage="0" data-depth="0.5" data-enter="rise" data-idle="bob" data-pivot="500 380"> … </g>\`

- **data-stage** — always \`0\`. There is only one beat.
- **data-depth** — 0 is far behind, 1 is at the lens. Give the pieces different depths; the parallax is what stops a flat drawing reading as a sticker.
- **data-enter** — \`pop\`, \`rise\`, \`slide-left\`, \`slide-right\`, \`grow\`, \`draw\` (a stroke draws itself end to end).
- **data-idle** — what it keeps doing: \`bob\`, \`drift\`, \`sway\`, \`pulse\`, \`tick\`, \`spin\`, \`none\`. At least two pieces must keep moving, or the exhibit is a still picture for two seconds.
- **data-pivot** — \`"x y"\`, the point this piece turns and scales about. **Required on anything that ticks, spins or sways.**

One \`<desc data-stage="0">\` right after the opening tag, one sentence, saying only what physically CHANGES.

## Hard requirements

1. **FILL THE STRIP.** The exhibit spans at least 820 of the ${WIDTH} units across and 600 of the ${HEIGHT} down. A small object centred in an empty strip is the most common way these fail.
2. **Leave the top 110 units clear.** A two-part caption in small caps is drawn there by the renderer, over your drawing.
3. Shapes only: path, circle, ellipse, rect, line, polyline, polygon, g. \`linearGradient\` and \`radialGradient\` in a \`<defs>\` are fine and worth using.
4. **No \`<text>\` and no lettering of any kind** — not a label, not a figure, not a word on a screen. The renderer draws the words. Where an interface would have a line of type, draw a ROUNDED BAR in a muted grey at the weight that type would be: that is how a mock reads as a mock. Where it would have a number, draw a heavy bar.
5. No \`<filter>\`, no \`<image>\`, no CSS filter, no blend modes, no \`<animate>\`. They are stripped.
6. Every shape gets an explicit \`fill\`, or \`fill="none"\` with a \`stroke\`. An inherited fill renders black.
7. **25 to 70 shapes.** Below that it is clipart; above it nobody reads it in two seconds.

## What an exhibit looks like

You are not choosing from a list. Draw whatever the line actually needs — these are the shapes this kind of video uses, as a sense of the register, not a menu:

a dashboard of stat tiles · a chat thread with a reply arriving · a file list with rows highlighting · a timeline of clips with one being trimmed · a progress ring closing · a bar chart where one bar overtakes · a phone screen with a sheet sliding up · a toggle row flipping on · a node graph connecting up · a settings panel · a comparison of two cards · a search field with results dropping in · a calendar with slots filling · a waveform being cut · a queue draining · a stack of layers assembling · a map with pins landing · a gauge sweeping

**Make the exhibit specific to the line.** The same video must not contain two exhibits built the same way. If the line is about cutting footage, draw a TIMELINE with clips on it and a cut landing. If it is about a tool doing the work, draw that tool's window with a job running in it. If it is about a choice between two things, draw the two things as different objects — not two identical tiles with different labels.

## Craft

- **A ground, always.** The panel's own surface is a light grey; give the exhibit something to sit on — a card with a hairline border and a soft shadow, a device frame, a window chrome bar with three dots. An object floating on flat colour is what makes these look cheap.
- **Three depth planes.** A backdrop at \`data-depth="0.1"\` (a soft tint field, a grid, a pool of colour). The exhibit at 0.5. One or two small things in front at 0.8 — a cursor, a badge, a chip, a tag — larger than they need to be.
- **Build volume from flat shapes.** A lit face and a shadowed one. A hairline a shade darker than the fill. A cast shadow as a low-opacity rounded rect underneath.
- **Detail it the way the real thing is.** A chat window has a title bar, an avatar circle, a bubble with a tail, a timestamp bar, a compose field and a send button. Three or four of those is the difference between "a chat" and a chat.
- One or two stroke weights, 3–8 units, \`stroke-linecap="round"\`.
- Stay in the palette you are given. The accent is a spot colour: one or two elements, never the field.

## Do not do these

Flat clipart. A ring of icons around a circle (the renderer already has one). Everything the same depth. A drawing that would not read in flat grey. The same composition twice in one video. Anything spelled out in shapes that are secretly letters.`;

export interface PanelArtResult {
  /** Keyed by scene id. A scene missing from here keeps its template kind. */
  drawn: Map<string, Illustration>;
  costUsd: number;
  errors: string[];
}

export function isPanelArtConfigured(): boolean {
  return Boolean(env.llm.wavespeedKey && env.llm.motionModel);
}

/**
 * Draws every exhibit in the panel, in batches that run together.
 *
 * Nothing in here can fail the stage. An exhibit with no drawing renders as
 * the template kind it was already assigned, which is the panel this feature
 * replaced — so the worst case of the whole pass is the previous version of
 * it.
 */
export async function drawPanel(scenes: readonly PanelScene[], accent: string): Promise<PanelArtResult> {
  const drawn = new Map<string, Illustration>();
  const errors: string[] = [];
  let costUsd = 0;

  if (!scenes.length) return { drawn, costUsd, errors };
  if (!isPanelArtConfigured()) {
    return { drawn, costUsd, errors: ['no motion model configured'] };
  }

  const wanted = scenes.slice(0, MAX_DRAWN);
  const batches: PanelScene[][] = [];
  for (let i = 0; i < wanted.length; i += PER_CALL) batches.push(wanted.slice(i, i + PER_CALL));

  const results = await Promise.all(batches.map((batch) => drawBatch(batch, accent)));

  for (const result of results) {
    costUsd += result.costUsd;
    if (result.error) errors.push(result.error);
    for (const [id, art] of result.drawn) drawn.set(id, art);
  }

  return { drawn, costUsd, errors };
}

async function drawBatch(
  batch: readonly PanelScene[],
  accent: string,
): Promise<{ drawn: Map<string, Illustration>; costUsd: number; error?: string }> {
  const drawn = new Map<string, Illustration>();
  const model = env.llm.motionModel;

  try {
    const response = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.llm.wavespeedKey!}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: briefFor(batch, accent) },
        ],
        // Four drawings of up to seventy shapes, with room for gradients. A
        // batch that hits the ceiling arrives with its last drawing unclosed
        // and that one is refused; the others still parse, which is why the
        // exhibits are separated by a marker rather than wrapped in JSON.
        max_tokens: 24000,
        // Drawing, not judgement. A cautious drawing is a boring one, and
        // boring is the thing this pass exists to fix.
        temperature: 0.85,
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

    const text = body.choices?.[0]?.message?.content ?? '';
    for (const [index, markup] of splitDrawings(text).entries()) {
      const scene = batch[index];
      if (!scene) continue;
      const art = parseIllustration(markup, scene.id);
      if (art && isDrawn(art)) drawn.set(scene.id, art);
    }

    return { drawn, costUsd };
  } catch (error) {
    return { drawn, costUsd: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The drawings out of one reply.
 *
 * Split on the `<svg>` tags themselves rather than on a marker the model has
 * to remember, and taken in order. A batch whose last drawing ran out of
 * tokens therefore loses that one and keeps the rest, where a JSON envelope
 * would lose the whole reply to one unterminated string.
 */
function splitDrawings(text: string): string[] {
  return [...text.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)].map((m) => m[0]);
}

function briefFor(batch: readonly PanelScene[], accent: string): string {
  const exhibits = batch
    .map((scene, i) => {
      const said = scene.reason || scene.eyebrow.filter(Boolean).join(' ');
      const shown = [scene.label, ...scene.items, scene.figure].filter(Boolean).join(' · ');
      return [
        `### Exhibit ${i + 1}`,
        `Being said over it: "${said}"`,
        shown
          ? `What it is about, for your understanding only — do NOT draw these words or any others: ${shown}`
          : '',
        `The caption over it reads: ${scene.eyebrow.filter(Boolean).join(' · ') || '(none)'}`,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  return `Draw ${batch.length} exhibit${batch.length === 1 ? '' : 's'}, in order, as ${batch.length} separate <svg> elements one after another. No prose, no code fences, nothing between them.

PALETTE — use these and nothing else:
  #F1F1F3  the panel's own surface, behind everything
  #FFFFFF  a card, a window, a sheet
  #E4E4E9  a hairline border, a divider, an empty track
  #D4D4DB  a muted bar standing in for a line of type
  #15151A  ink: a heavy bar, a filled control, a dark chip
  #8C8C98  secondary ink, a label bar, an inactive control
  #2E9E5B  success: a tick, a rising bar, an active toggle
  ${accent}  the accent. One or two elements per exhibit, never the field.

${exhibits}

Each exhibit must be built differently from the others in this set. Return only the <svg> elements.`;
}
