import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { env } from '@/lib/config/env';
import type { SceneLook } from '@/lib/edl/types';
import { guideAsPrompt, styleGuideFor } from '@/lib/scenes/style-guides';
import { completionCostUsd, composerProviders as scenesRoute, llmFetch, routedModel, type ChatProvider } from '@/lib/llm/chat';

const require_ = createRequire(import.meta.url);

/**
 * Opus choreographs the scene, not just draws it.
 *
 * ── Why this exists next to the SVG path ────────────────────────────────
 *
 * In the SVG path Opus decides WHAT is in the picture and the renderer
 * decides how it moves: every part arrives through one of six entrances,
 * idles through one of seven loops, and the camera does the same push on
 * every scene. That vocabulary is why the scenes read as one template wearing
 * different drawings. The model that understood the sentence never gets to
 * say that the needle should hesitate before it swings.
 *
 * Here Opus writes the whole scene as an HTML page with a paused GSAP
 * timeline — markup, styling and every tween, timed against the words being
 * spoken — and HyperFrames seeks that timeline frame by frame into a clip.
 * HTML, CSS and GSAP are what a frontier model writes best, so the
 * choreography is authored rather than picked from a list.
 *
 * ── What is NOT handed over ─────────────────────────────────────────────
 *
 * The page skeleton. Opus returns three blocks — a `<style>`, one
 * `<div id="scene">` and a `<script>` that adds tweens to a timeline it is
 * given — and `buildCompositionHtml` wraps them. The root element, the
 * timeline registration, the frame size and GSAP itself (inlined, so a render
 * never touches the network) are ours, because a composition that gets any of
 * those wrong renders a blank clip without an error.
 *
 * The rules that held for the drawings hold here too, for the same reasons:
 * no lettering (the captions are the only words), one background that owns
 * the frame, the caption band kept clear.
 */

const API_BASE = 'https://llm.wavespeed.ai/v1';

/** The id the wrapper registers the timeline under. */
export const COMPOSITION_ID = 'scene';

export interface WordCue {
  text: string;
  /** Seconds from the start of the scene. */
  atSec: number;
}

export interface CompositionRequest {
  /** What is being said over this scene, verbatim. */
  line: string;
  /** The same words with their times, so beats can land on them. */
  words: WordCue[];
  headline: string;
  items: string[];
  kind: string;
  look: SceneLook;
  width: number;
  height: number;
  durationSec: number;
}

export interface CompositionParts {
  style: string;
  markup: string;
  script: string;
  /** The one-line idea the model committed to before building. Empty if it skipped it. */
  concept?: string;
}

export interface CompositionResult {
  parts: CompositionParts | null;
  costUsd: number;
  error?: string;
}

/**
 * The accounts that can serve the composer, in the order they are tried —
 * the same list every other pass uses (see src/lib/llm/chat.ts): Anthropic,
 * then Kie, then WaveSpeed, whichever have keys.
 */
export function composerProviders(): ChatProvider[] {
  return scenesRoute();
}

/** The account tried first, or null when none is configured. */
export function composerProvider(): ChatProvider | null {
  return scenesRoute()[0] ?? null;
}

export function isComposerConfigured(): boolean {
  return composerProvider() !== null;
}

/**
 * The prompt. Written in numbers wherever there is one, because "smooth" and
 * "punchy" give a different scene every call.
 */
export function systemPrompt(width: number, height: number, durationSec: number): string {
  const dur = durationSec.toFixed(2);
  return `You make one shot of a video as an HTML motion graphic: the picture AND how it moves, beat by beat.

It plays full-screen on a phone for ${dur} seconds while someone talks over it. It IS the shot — no footage behind it — so it has to carry the frame on its own and it must never sit still.

## Decide the idea first

Before any markup, commit to ONE concept in one sentence and write it as the very first line:

<!-- concept: one sentence -->

A concept is a single visual idea that carries the whole shot, not a list of things to show. Good: "a seed cracks open and its root becomes the line of a growth chart". "A brain, then neurons, then lightning" is a list, not a concept. Everything you build serves that sentence.

## What you return

The concept line, then exactly three blocks, in this order, and nothing else — no prose, no code fence:

<!-- concept: … -->
<style> … </style>
<div id="scene"> … </div>
<script> … </script>

The page around them is provided. The frame is ${width}×${height} px. Inside your script these already exist:

- \`tl\` — a paused \`gsap.timeline()\`. Add every tween to it with an ABSOLUTE position: \`tl.fromTo("#cup", {y: 400, opacity: 0}, {y: 0, opacity: 1, duration: 0.6, ease: "expo.out"}, 0.2)\`. Never create another timeline, never call play/pause/seek.
- \`W\`, \`H\` — the frame size in px. \`DURATION\` — ${dur}.
- \`WORDS\` — \`[{text, atSec}]\`, the spoken words timed from the start of this shot.
- \`at(word, fallback)\` — the time the first spoken word containing \`word\` starts, or \`fallback\`. Use it to land a beat ON the word that names it.
- \`rand(i)\` — a deterministic number in [0, 1) for integer \`i\`. The only randomness allowed.

## The picture

- Build it from \`<div>\`s and inline \`<svg>\` (path, circle, rect, polygon, line, g, linearGradient, radialGradient). Position things absolutely in px against the ${width}×${height} frame.
- **One background that fills the whole frame, edge to edge**, and give it something to look at — a floor line, a soft pool of light, a gradient, a grid. It is the only background there is.
- **Big.** The subject spans at least 70% of the frame's width. Anything at half scale is a postage stamp on a phone.
- **Three depth planes**: a large cropped foreground shape running off an edge, the focal subject, two to four dim smaller satellites behind. Move them by different amounts when the camera moves — that parallax is what makes it a space instead of a sticker.
- Real detail. A clock has a bezel, a dial, twelve marks, two tapered hands and a cap over the pin. 40 to 120 shapes in all.
- **No text of any kind.** No letters, numbers, labels or words anywhere — not in an element, not in an SVG. The video's captions are the only words on screen and they are drawn over your shot afterwards.
- **Keep the band from ${Math.round(height * 0.55)}px to ${Math.round(height * 0.75)}px down clear of anything important** — the captions sit there.
- No \`<img>\`, \`<image>\`, \`<video>\`, \`<audio>\`, \`<iframe>\`, \`<link>\`, \`<text>\`, no \`url(http…)\`, no \`@import\`, no web fonts. Nothing may load from anywhere.

## The motion

A sequence, not a picture that moves: two or three beats, each one a thing the viewer looks at and then leaves behind, following what the voice says.

- **Land on the word.** Each beat's key move starts at \`at("word", fallback)\` for the word that names it. A move three frames late reads as lag.
- **Ease by role, in numbers.** Arrivals ease out on a long tail: \`expo.out\` or \`power4.out\`, 0.4–0.8 s — or, where the world below says things pop or spring, \`back.out(1.4)\` to \`back.out(2)\`: a tightly damped spring with a small overshoot, never a wobble. Camera moves ease both ways with \`power2.inOut\` and run at half the speed you would default to, except the dive between beats. Exits accelerate with \`power3.in\` and are 40–50% shorter than their entrance. When content swaps in place, the outgoing piece leaves before the incoming one lands — separate their timing. Never the same ease and duration on everything.
- **Overlap**: the next element starts when the previous is 30–50% done. Stagger repeats 0.05–0.12 s apart.
- **Transform, never cut.** Every beat is made out of the previous one. The camera dives INTO the subject until its colour fills the frame and the next beat grows out of that colour; or a shape morphs into the next (a circle becomes a planet, a card grows into the next frame, a line becomes a chart); or the subject shrinks into a detail of something larger. 0.5–0.7 s, accelerating in (\`power3.in\`) and settling out (\`expo.out\`). Never a hard cut between beats, never a fade to an empty frame, never two beats side by side.
- **Two or three things per beat ACT after they land**: a bar fills, a needle swings to its mark, a line draws itself (\`strokeDashoffset\`), a tick lands, a counter dial turns. The act is the sentence — pick the ones that show what the voice says.
- **It never stops**: a slow camera drift on the outermost wrapper from 0 to ${dur} (scale 1 → 1.08, a little x/y, \`ease: "none"\`), so no frame is a photograph. A landed object holds still — no breathing, bobbing or pulsing loops — UNLESS the world below says things drift, bob or pulse; then its motion line wins, gently and with finite repeats.
- Pivots: set \`transformOrigin\` on anything that rotates — a clock hand turns about its pin, not about the frame.
- Animate transforms (x, y, scale, rotation), opacity, \`strokeDashoffset\` and SVG \`attr\`. Not \`left\`/\`top\`/\`width\`/\`height\`, never \`display\` or \`visibility\`.
- The last beat has settled by ${(durationSec - 0.4).toFixed(2)} s and stays on screen to the end; nothing exits at the end — the edit cuts away.

## Hard rules

No \`Math.random\`, \`Date\`, \`setTimeout\`, \`setInterval\`, \`requestAnimationFrame\`, \`fetch\`, CSS \`animation\` or \`transition\`, and no \`repeat: -1\` (a finite \`repeat\` is fine). Everything visible is a function of the timeline's time. Do not touch \`#root\` or \`#stage\`; everything lives inside \`#scene\`.`;
}

export function briefFor(request: CompositionRequest): string {
  const guide = styleGuideFor(request.look);
  const words = [request.headline, ...request.items].filter(Boolean).join(' · ');
  const timed = request.words.map((word) => `${word.atSec.toFixed(2)}s ${word.text}`).join('\n');

  return `Being said over this shot: "${request.line}"

${words ? `What it is about, for your understanding only — do NOT put these words on screen: ${words}\n` : ''}
The words, timed from the start of the shot:
${timed || '(no timings — spread the beats across the shot)'}

The world it is drawn in — use exactly this palette:
${guideAsPrompt(guide, ['palette', 'rendering', 'lighting', 'ground_rule', 'motion', 'camera'])}

The background of the frame is ${guide.ground}. Shape of the explanation: ${request.kind}.
Return only the three blocks.`;
}

/**
 * Pulls the three blocks out of whatever came back.
 *
 * Models fence code and add a sentence of preamble whatever they are told, so
 * this looks for the blocks rather than expecting the reply to be them.
 */
export function parseComposition(text: string): CompositionParts | null {
  const body = text.replace(/```[a-z]*\n?/gi, '');
  const style = body.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] ?? '';
  const script = lastMatch(body, /<script[^>]*>([\s\S]*?)<\/script>/gi);

  const open = body.search(/<div[^>]*\bid=["']scene["'][^>]*>/i);
  if (open < 0 || !script) return null;
  const scriptAt = body.search(/<script[^>]*>[\s\S]*?<\/script>\s*$/i);
  const end = scriptAt > open ? scriptAt : body.length;
  const markup = body.slice(open, end).replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').trim();
  if (!markup) return null;

  const concept = body.match(/<!--\s*concept:\s*([\s\S]*?)-->/i)?.[1]?.trim() ?? '';
  return { style: style.trim(), markup, script: script.trim(), concept };
}

function lastMatch(text: string, pattern: RegExp): string {
  let found = '';
  for (const match of text.matchAll(pattern)) found = match[1] ?? '';
  return found;
}

/** Things that make a render non-deterministic, or reach the network. */
const BANNED_SCRIPT: Array<[RegExp, string]> = [
  [/Math\.random/, 'uses Math.random — use rand(i)'],
  [/\bDate\b/, 'reads the clock (Date)'],
  [/setTimeout|setInterval|requestAnimationFrame/, 'uses a timer — put it on the timeline instead'],
  [/\bfetch\s*\(|XMLHttpRequest|import\s*\(/, 'loads something over the network'],
  [/repeat\s*:\s*-\s*1/, 'repeats forever (repeat: -1) — use a finite repeat'],
  [/gsap\.timeline\s*\(/, 'creates its own timeline — add tweens to `tl`'],
  [/\.(play|pause|seek|restart)\s*\(/, 'drives the timeline itself — the renderer seeks it'],
  [/#root|#stage/, 'touches #root or #stage'],
];

const BANNED_MARKUP: Array<[RegExp, string]> = [
  [/<(img|image|video|audio|iframe|link|object|embed)\b/i, 'loads external media'],
  [/<script\b/i, 'puts a script inside the markup'],
  [/<text\b|<tspan\b|<foreignObject\b/i, 'contains an SVG text element'],
  [/(src|href)\s*=\s*["']\s*(https?:|\/\/)/i, 'references a URL'],
];

const BANNED_STYLE: Array<[RegExp, string]> = [
  [/@import|url\(\s*["']?\s*(https?:|\/\/)/i, 'loads a stylesheet or image over the network'],
  [/@font-face/i, 'loads a web font'],
  [/(^|[;{\s])(animation|transition)\s*:/i, 'uses a CSS animation or transition — put it on the timeline'],
];

/**
 * What can be checked without a browser.
 *
 * The same idea as `auditIllustration`: we cannot look at the picture, but
 * the failures that blank a render or put words on screen are visible in the
 * source, and a fault list is what the repair round is fed.
 */
export function auditComposition(parts: CompositionParts): string[] {
  const problems: string[] = [];
  for (const [pattern, message] of BANNED_SCRIPT) if (pattern.test(parts.script)) problems.push(`The script ${message}.`);
  for (const [pattern, message] of BANNED_MARKUP) if (pattern.test(parts.markup)) problems.push(`The markup ${message}.`);
  for (const [pattern, message] of BANNED_STYLE) if (pattern.test(parts.style)) problems.push(`The style ${message}.`);

  // Whatever is left once the tags are gone is text a viewer would read.
  const visible = parts.markup
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .trim();
  if (/[\p{L}\p{N}]/u.test(visible)) {
    problems.push(`The markup puts words on screen ("${visible.slice(0, 40)}") — remove every piece of text; the captions are the only words.`);
  }

  const tweens = parts.script.match(/\btl\s*\.\s*(to|from|fromTo|set)\s*\(/g)?.length ?? 0;
  if (tweens < 8) {
    problems.push(`Only ${tweens} tweens on the timeline — that is a picture fading in, not a sequence. Choreograph two or three beats with their acts.`);
  }

  if (!parts.concept) {
    problems.push('No concept line — start with <!-- concept: one sentence --> and build the shot around that one idea.');
  }

  const shapes = parts.markup.match(/<(div|path|circle|ellipse|rect|polygon|polyline|line)\b/gi)?.length ?? 0;
  if (shapes < 25) problems.push(`Only ${shapes} shapes — too sparse to be an illustration; aim for 40 to 120.`);

  return problems;
}

/** GSAP, read once and inlined, so a render never reaches for a CDN. */
let gsapSource: string | null = null;
function gsapScript(): string {
  if (gsapSource === null) {
    gsapSource = readFileSync(require_.resolve('gsap/dist/gsap.min.js'), 'utf8');
  }
  return gsapSource;
}

export interface CompositionFrame {
  width: number;
  height: number;
  durationSec: number;
  ground: string;
  words: WordCue[];
}

/**
 * The full page HyperFrames renders.
 *
 * The model's script runs inside a function so its `const`s cannot collide
 * with ours, and the timeline is registered AFTER it — registering first is
 * the documented way to get a blank render. The trailing `set` pads the
 * timeline to the scene's length, so a choreography that settles early still
 * yields a clip exactly as long as the scene.
 */
export function buildCompositionHtml(parts: CompositionParts, frame: CompositionFrame): string {
  const { width, height, durationSec, ground } = frame;
  const dur = Number(durationSec.toFixed(3));
  const words = JSON.stringify(frame.words.map((w) => ({ text: w.text, atSec: Number(w.atSec.toFixed(3)) })));

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script>${gsapScript()}</script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: ${ground}; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: ${ground}; }
      #stage { position: absolute; inset: 0; overflow: hidden; }
      #scene { position: absolute; inset: 0; }
    </style>
    <style>
${parts.style}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="${COMPOSITION_ID}" data-start="0" data-duration="${dur}" data-width="${width}" data-height="${height}">
      <div id="stage" class="clip" data-start="0" data-duration="${dur}" data-layout-allow-overflow data-layout-allow-overlap>
${parts.markup}
      </div>
    </div>
    <script>
      (function () {
        const W = ${width}, H = ${height}, DURATION = ${dur};
        const WORDS = ${words};
        const at = (word, fallback) => {
          const needle = String(word).toLowerCase();
          const hit = WORDS.find((w) => w.text.toLowerCase().includes(needle));
          return hit ? hit.atSec : fallback;
        };
        const rand = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
        const tl = gsap.timeline({ paused: true });
        (function () {
${parts.script}
        })();
        tl.set({}, {}, DURATION);
        window.__timelines = window.__timelines || {};
        window.__timelines["${COMPOSITION_ID}"] = tl;
      })();
    </script>
  </body>
</html>
`;
}

/**
 * Ask Opus for the scene, audit it, and give it one repair round.
 *
 * `check` is the browser-side gate — HyperFrames' own lint and runtime
 * validation — passed in so this module stays free of the renderer. Its
 * findings join the static audit in the repair brief, and the second attempt
 * is only kept if it has fewer faults: newer is not automatically better.
 */
export async function composeScene(
  request: CompositionRequest,
  check?: (parts: CompositionParts) => Promise<string[]>,
): Promise<CompositionResult> {
  if (!isComposerConfigured()) return { parts: null, costUsd: 0, error: 'no motion model configured' };

  const system = systemPrompt(request.width, request.height, request.durationSec);
  const brief = briefFor(request);
  const faultsOf = async (parts: CompositionParts) => [...auditComposition(parts), ...(check ? await check(parts) : [])];

  try {
    const first = await complete([{ role: 'system', content: system }, { role: 'user', content: brief }], 0.7);
    let costUsd = first.costUsd;
    const parts = parseComposition(first.text);
    if (!parts) return { parts: null, costUsd, error: 'composition came back without a #scene and a <script>' };

    const problems = await faultsOf(parts);
    if (!problems.length) return { parts, costUsd };

    const repair = await complete(
      [
        { role: 'system', content: system },
        { role: 'user', content: brief },
        { role: 'assistant', content: first.text },
        {
          role: 'user',
          content:
            `Not right yet. Fix these and return all three blocks again, nothing else:\n\n` +
            problems.map((problem, i) => `${i + 1}. ${problem}`).join('\n') +
            `\n\nKeep everything that already works. Change only what is listed.`,
        },
      ],
      0.4,
    ).catch(() => null);
    costUsd += repair?.costUsd ?? 0;

    const fixed = repair ? parseComposition(repair.text) : null;
    if (fixed) {
      const after = await faultsOf(fixed);
      if (!after.length) return { parts: fixed, costUsd };
      if (after.length < problems.length && !after.some(isFatal)) return { parts: fixed, costUsd };
    }

    // Unfixed, the first one still ships if nothing it does is fatal.
    if (!problems.some(isFatal)) return { parts, costUsd };
    return { parts: null, costUsd, error: problems[0] };
  } catch (error) {
    return { parts: null, costUsd: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The blocks back as the model wrote them, for a conversation that continues from them. */
export function serialiseComposition(parts: CompositionParts): string {
  return [
    parts.concept ? `<!-- concept: ${parts.concept} -->` : '',
    `<style>\n${parts.style}\n</style>`,
    parts.markup,
    `<script>\n${parts.script}\n</script>`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** What the reviewer says when it would ship the scene as it is. */
export const REVIEW_OK = 'LOOKS GOOD';

/** When to look: early, the middle of the move, late, and the settled end. */
export function reviewTimes(durationSec: number): number[] {
  return [0.2, 0.45, 0.7, 0.93].map((f) => Number((durationSec * f).toFixed(2)));
}

/**
 * Asks the model to LOOK at its own scene.
 *
 * Everything before this checks the source; this checks the picture. The best
 * scenes in the reference collection all came out of the same loop — build,
 * render, look, fix — and the faults it catches are invisible in markup: a
 * subject at a third of the size it was meant to be, two pieces sitting on
 * each other, a beat that is just background because a tween landed late, a
 * clock hand swinging round the frame instead of its pin.
 */
/** Said first when every frame came back as bare ground — the review's one non-negotiable. */
export const BLANK_WARNING = `IMPORTANT: every one of these frames is completely empty — nothing but the background colour. Nothing you drew is visible at any point. Something in the markup, the CSS or the script is hiding everything or stopping the timeline being built (an element left at opacity 0, positioned off-frame, sized to zero, or a script error before the tweens are added). Find it and fix it. Do not reply ${REVIEW_OK}.`;

export function reviewInstructions(times: number[], height: number, blank = false): string {
  return `${blank ? `${BLANK_WARNING}\n\n` : ''}Here are frames of the scene you just wrote, rendered exactly as it will ship, at ${times.map((t) => `${t}s`).join(', ')} (labelled on the sheet).

Look at them the way a motion designer reviewing a colleague's work would, and check:

1. Any letters, numbers or words visible anywhere — they must not be.
2. A frame that is mostly empty background, or a subject too small to read on a phone.
3. Anything important inside the caption band, ${Math.round(height * 0.55)}–${Math.round(height * 0.75)}px down.
4. Pieces overlapping by accident, cut off by the frame edge unintentionally, or misaligned.
5. Something rotating about the wrong point, or a shape that looks broken or unfinished.
6. Beats that look the same — the frames should show the sequence progressing.
7. Colours outside the palette you were given, or a flat look with no depth.
8. Whether the frames actually show your concept and what is being said.

If it is genuinely good, reply with exactly: ${REVIEW_OK}

Otherwise fix what is wrong and reply with the concept line and all three blocks again, nothing else. Keep everything that already works.`;
}

export interface ReviewResult {
  /** The revision, or null when the scene was approved or the review failed. */
  parts: CompositionParts | null;
  approved: boolean;
  costUsd: number;
  error?: string;
}

/** One look-and-fix round. A failed review never costs the scene: the caller keeps what it had. */
export async function reviewScene(
  request: CompositionRequest,
  parts: CompositionParts,
  sheet: { dataUri: string; times: number[]; blank?: boolean },
): Promise<ReviewResult> {
  if (!isComposerConfigured()) return { parts: null, approved: false, costUsd: 0, error: 'no motion model configured' };
  try {
    const reply = await complete(
      [
        { role: 'system', content: systemPrompt(request.width, request.height, request.durationSec) },
        { role: 'user', content: briefFor(request) },
        { role: 'assistant', content: serialiseComposition(parts) },
        {
          role: 'user',
          content: [
            { type: 'text', text: reviewInstructions(sheet.times, request.height, sheet.blank) },
            { type: 'image_url', image_url: { url: sheet.dataUri } },
          ],
        },
      ],
      0.4,
    );
    // A blank scene is never approved, whatever the reply says.
    if (reply.text.trim().toUpperCase().startsWith(REVIEW_OK)) {
      if (sheet.blank) return { parts: null, approved: false, costUsd: reply.costUsd, error: 'approved a blank scene' };
      return { parts: null, approved: true, costUsd: reply.costUsd };
    }
    const revised = parseComposition(reply.text);
    return revised
      ? { parts: { ...revised, concept: revised.concept || parts.concept }, approved: false, costUsd: reply.costUsd }
      : { parts: null, approved: false, costUsd: reply.costUsd, error: 'review reply had neither a verdict nor blocks' };
  } catch (error) {
    return { parts: null, approved: false, costUsd: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * A fault that ruins the clip rather than weakening it.
 *
 * Sparse or under-choreographed still renders as a scene; words on screen,
 * a script error or anything non-deterministic does not ship.
 */
export function isFatal(problem: string): boolean {
  return !/^(Only \d+ (tweens|shapes)|No concept line)/.test(problem);
}

type Content = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

type Message = { role: 'system' | 'user' | 'assistant'; content: Content };

/**
 * One completion, through the shared router.
 *
 * Written in the OpenAI shape every pass speaks; `llmFetch` sends it to
 * Claude on Anthropic or Kie (or WaveSpeed as written), moving on to the
 * next account when one refuses and naming each refusal if all of them do.
 */
async function complete(messages: Message[], temperature: number): Promise<{ text: string; costUsd: number }> {
  const providers = scenesRoute();
  const model = routedModel(env.llm.motionModel, providers);
  const response = await llmFetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.llm.wavespeedKey ?? ''}` },
    // A composition with a hundred shapes and its timeline runs well past the
    // drawing's size; one cut off mid-script has no closing tag and is refused.
    body: JSON.stringify({ model: env.llm.motionModel, messages, max_tokens: 20000, temperature }),
  }, providers);
  const body = (await response.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    cost_usd?: number;
    error?: { message?: string } | string;
  };
  if (!response.ok) {
    throw new Error((typeof body.error === 'string' ? body.error : body.error?.message) ?? `${response.status} ${response.statusText}`);
  }
  return { text: body.choices?.[0]?.message?.content ?? '', costUsd: completionCostUsd(body, model) };
}
