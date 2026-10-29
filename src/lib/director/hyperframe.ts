import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { env } from '@/lib/config/env';
import type { SceneLook } from '@/lib/edl/types';
import { guideAsPrompt, styleGuideFor } from '@/lib/scenes/style-guides';
import { completionCostUsd, composerProviders as scenesRoute, llmFetch, routedModel, type ChatProvider } from '@/lib/llm/chat';
import { layoutReferenceFor, referenceFor, suggestLayout, type Layout } from '@/lib/director/reference-scene';

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
 * Where a shot may put anything, in px.
 *
 * From the platforms' own overlays on a 9:16 frame (TikTok, Reels, Shorts):
 * the top 11% holds the account row and search, the bottom 21% the caption,
 * handle and audio ticker, a thin strip each side is cropped on some phones,
 * and the like, comment and share column runs down the right edge of the
 * lower half. A landscape frame has none of that, so it just keeps a margin.
 */
export interface SafeZone {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Below this y, the right edge pulls in to `notchRight` — the button column. */
  notchTop: number;
  notchRight: number;
}

export function safeZone(width: number, height: number): SafeZone {
  if (height <= width) {
    const mx = Math.round(width * 0.06), my = Math.round(height * 0.08);
    return { left: mx, right: width - mx, top: my, bottom: height - my, notchTop: height - my, notchRight: width - mx };
  }
  const x = (v: number) => Math.round((v / 1080) * width);
  const y = (v: number) => Math.round((v / 1920) * height);
  return { left: x(60), right: x(1020), top: y(220), bottom: y(1520), notchTop: y(1020), notchRight: x(900) };
}

/**
 * The prompt. Written in numbers wherever there is one, because "smooth" and
 * "punchy" give a different scene every call.
 */
export function systemPrompt(width: number, height: number, durationSec: number, look: SceneLook = 'science'): string {
  const dur = durationSec.toFixed(2);
  const reference = referenceFor(look);
  const sameWorld = reference.look === look;
  const z = safeZone(width, height);
  const midX = Math.round((z.left + z.right) / 2), midY = Math.round((z.top + z.bottom) / 2);
  return `You make one shot of a video as an HTML motion graphic: the picture AND how it moves, beat by beat.

It plays full-screen on a phone for ${dur} seconds while someone talks over it. It IS the shot — no footage behind it — so it has to carry the frame on its own and it must never sit still.

## Draw what is being said

Every object on screen is something the line is literally about, or a picture a viewer would read instantly as that thing. "Put in your footage and it does everything else" is one film clip that gets snipped into pieces that snap into a neat strip and light up — not a planet, a rocket or a galaxy. The world below decides HOW things are drawn (shapes, colours, light, motion), never WHAT is drawn: it has no subjects of its own. No decorative props that the line does not mention — no planets, stars, moons, rockets, cells, atoms or creatures unless the words are about them. If you would have to explain why an object is there, it does not belong.

## Decide the idea first

Before any markup, commit to ONE concept in one sentence and write it as the very first line:

<!-- concept: one sentence -->

A concept is a single visual idea that carries the whole shot, built from the things being said, not a list of unrelated things to show. Good: "a brain, and the camera dives into it until its colour becomes a web of firing neurons" for a line about the brain; "three stickers stack down the screen — coffee, a sneaker, an envelope — and each gets ticked off" for a morning routine. Everything you build serves that sentence.

Then DECIDE the layout — whichever makes the most sense for this line. None is the default and none is a requirement:

- **Hero** — one striking idea or object: one subject that transforms into the next (the camera dives in, a shape morphs). It sits in the middle of the safe area at whatever size reads best — big and close for a dramatic object, smaller with room around it for a calm or minimal one.
- **Stack** — a list or a routine ("coffee, a walk, then emails"; "three habits"): two to four items, one per spoken item, arriving one after another down the screen on their words and staying, linked by a line or arrows.
- **Path** — a journey or a process over time: a route through the safe area with stops that light up as the voice reaches them.
- **Split** — a contrast or a before/after: one half against the other, the second answering the first.
- **Grid** — a share of a crowd or a collection ("nine out of ten"): cells that pop in, then some of them act.

Ask what a good motion designer would do with THIS line: how many things does it name, do they happen in order, is it a comparison, is it one big moment? Then use as much of the safe area as that idea needs — a single object does not have to fill the screen, and a list should not be crammed into a corner. Start the concept line with the layout ("stack: …", "hero: …").

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
- **One background that fills the whole frame, edge to edge**: the world's ground with a soft pool of light behind the subject. It is the only background there is, and it stays quiet.
- **The safe area is a hard edge.** Everything that matters sits inside x ${z.left}–${z.right}, y ${z.top}–${z.bottom}, and below y ${z.notchTop} only up to x ${z.notchRight} — the platform's account row, captions and like/share buttons cover the rest, which is backdrop only. The safe area's centre is (${midX}, ${midY}). How much of it you use is your decision from the layout: whatever makes the idea clearest.
- **Readable on a phone and in focus.** Nothing important smaller than about a fifth of the frame's width. The eye always knows where to look: the thing being named is the biggest, brightest or moving one; what came before settles back.
- **Few objects, richly drawn.** Space around each item, but each item is richly drawn: base colour, a darker shadow side, a light rim, inner parts (a brain has its folds and a highlight; a film clip has sprocket holes, frames, a sheen). A flat circle with an icon on it is a placeholder, not an illustration. A later beat often multiplies the subject into a system that fills the safe area — one brain becomes a web of seven linked neurons. 20 to 120 shapes in all.
- **No screens.** No phone frames, monitors, app windows, dashboards, toolbars or interface mock-ups — a full-size device on screen is an empty box with things at its edges. Software is shown by what it does, as an object: a clip, a play button, scissors, a waveform, a check mark.
- Depth comes from the backdrop: a couple of dim, soft, blurred shapes far behind, moving slower than the subject when the camera moves.
- **No text of any kind.** No letters, numbers, labels or words anywhere — not in an element, not in an SVG. The video's captions are the only words on screen and they are drawn over your shot afterwards.
- **The video's captions are drawn over your shot at about y ${Math.round(height * 0.55)}–${Math.round(height * 0.75)}.** Things may run behind them, but do not put the one detail that matters right there at the moment its word is said.
- No \`<img>\`, \`<image>\`, \`<video>\`, \`<audio>\`, \`<iframe>\`, \`<link>\`, \`<text>\`, no \`url(http…)\`, no \`@import\`, no web fonts. Nothing may load from anywhere.

## The motion

A sequence, not a picture that moves, cut for a short vertical video where attention is gone in a second:

- **Hook at once.** The subject is on screen and moving by 0.3 s — no fade-up from an empty frame, no slow build.
- **Beats follow the words.** Two beats for a shot under 4 s, three at most for a longer one. Each beat shows the thing being said at that moment — the noun or verb the voice is on — and changes when the voice moves on.
- **The last beat is the payoff**: the biggest, most detailed moment of the shot, held until the end.

- **Land on the word.** Each beat's key move starts at \`at("word", fallback)\` for the word that names it. A move three frames late reads as lag.
- **Ease by role, in numbers.** Arrivals ease out on a long tail: \`expo.out\` or \`power4.out\`, 0.4–0.8 s — or, where the world below says things pop or spring, \`back.out(1.4)\` to \`back.out(2)\`: a tightly damped spring with a small overshoot, never a wobble. Camera moves ease both ways with \`power2.inOut\` and run at half the speed you would default to, except the dive between beats. Exits accelerate with \`power3.in\` and are 40–50% shorter than their entrance. When content swaps in place, the outgoing piece leaves before the incoming one lands — separate their timing. Never the same ease and duration on everything.
- **Overlap**: the next element starts when the previous is 30–50% done. Stagger repeats 0.05–0.12 s apart.
- **Transform, never cut.** In a hero, every beat is made out of the previous one; in a stack, path or grid, earlier items stay and step back while the new one arrives. The camera dives INTO the subject until its colour fills the frame and the next beat grows out of that colour; or a shape morphs into the next (a circle becomes a clock face, a card grows into the next frame, a line becomes a chart); or the subject shrinks into a detail of something larger. 0.5–0.7 s, accelerating in (\`power3.in\`) and settling out (\`expo.out\`). Never a hard cut between beats and never a fade to an empty frame.
- **Two or three things per beat ACT after they land**: a bar fills, a needle swings to its mark, a line draws itself (\`strokeDashoffset\`), a tick lands, a counter dial turns. The act is the sentence — pick the ones that show what the voice says.
- **Something visibly changes at least every 0.4 s**, from the first frame to the last — a beat lands, a part acts, a pulse travels, the camera dives. A subject that just sits there for two seconds is a still image with a caption.
- **It never stops**: a slow camera drift on the outermost wrapper from 0 to ${dur} (scale 1 → 1.08, a little x/y, \`ease: "none"\`), so no frame is a photograph. A landed object holds still — no breathing, bobbing or pulsing loops — UNLESS the world below says things drift, bob or pulse; then its motion line wins, gently and with finite repeats.
- Pivots: set \`transformOrigin\` on anything that rotates — a clock hand turns about its pin, not about the frame.
- Animate transforms (x, y, scale, rotation), opacity, \`strokeDashoffset\` and SVG \`attr\`. Not \`left\`/\`top\`/\`width\`/\`height\`, never \`display\` or \`visibility\`.
- The last beat has settled by ${(durationSec - 0.4).toFixed(2)} s and stays on screen to the end; nothing exits at the end — the edit cuts away.

## When the world and these rules disagree

The world below sets the drawing technique, palette and motion character. Where it suggests anything about layout or framing, the rules above win: the layout you decided on, inside the safe area.

## Traps that break a scene

- **A line drawn on**: give it \`pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"\` and tween \`strokeDashoffset\` to 0. Hide it with \`opacity: 0\` in the CSS and \`tl.set(el, {opacity: 1}, t)\` when it starts — a round line cap still shows as a dot while the line is undrawn.
- **Things that appear later**: \`fromTo\` paints its FROM state at time 0. For anything that should not be visible yet, hide it in the CSS, \`tl.set\` it visible when it arrives, and pass \`immediateRender: false\` to its \`fromTo\`.
- **Pivots**: give each SVG element ONE \`transformOrigin\` or \`svgOrigin\` — the same in every tween of it, or once in a \`tl.set\` at 0. Changing it between tweens shifts the element.
- **SVG pivots are local**: on an element inside an \`<svg>\`, \`transformOrigin: "540px 600px"\` is measured from the element's OWN box, not the frame — to turn or scale about a point in the frame use \`svgOrigin: "540 600"\`.
- **One job per element**: an element that enters with a \`y\` tween must not also get a looping wobble on \`y\`; put the wobble, the camera drift and the entrance on different wrapper groups.
- **Keyframes**: \`keyframes: [...]\` eases each step with \`power1.inOut\` by default; pass \`easeEach: "none"\` when the path should move evenly.
- \`at(word, fallback)\` matches the whole word first, then a word starting with it.

## Hard rules

No \`Math.random\`, \`Date\`, \`setTimeout\`, \`setInterval\`, \`requestAnimationFrame\`, \`fetch\`, CSS \`animation\` or \`transition\`, and no \`repeat: -1\` (a finite \`repeat\` is fine). Everything visible is a function of the timeline's time. Do not touch \`#root\` or \`#stage\`; everything lives inside \`#scene\`.

## The bar

This is a finished scene that meets the bar, written for the line "${reference.line}"${sameWorld ? ' in the same world you are drawing in. Match its technique and its craft' : ' in another world. Match its craft'}: one big, richly drawn subject in the middle landing on its word, the next beat made out of the last one, a payoff at the end, and something alive in every frame. Never copy its subject or its layout — yours come from your line.

${reference.scene}`;
}

/**
 * The layout the line most likely wants, and a finished scene that uses it.
 *
 * Shown in the brief rather than the system prompt because it depends on the
 * line. A hero needs no example — the look's own reference is one.
 */
const LAYOUT_REASONS: Record<Layout, string> = {
  hero: 'the line reads as one idea or one moment',
  stack: 'the line names several things in a row',
  path: 'the line describes something moving from one place or stage to the next',
  split: 'the line sets one thing against another',
  grid: 'the line is about a share of many',
};

export function layoutHint(line: string): string {
  const layout = suggestLayout(line);
  const example = layoutReferenceFor(layout);
  if (!example) return `Suggested layout: hero — ${LAYOUT_REASONS.hero}. A suggestion: decide what makes the most sense for this line.`;
  return `Suggested layout: ${layout} — ${LAYOUT_REASONS[layout]}. A suggestion: decide what makes the most sense for this line; a hero is still right if the line is really one striking moment.

Here is a finished ${layout} scene, written for "${example.line}" in another world. If you go with ${layout}, follow how it uses the screen — where the items sit, how they arrive on their words and stay — never its subject, objects or palette:

${example.scene}
`;
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
${layoutHint(request.line)}
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
  // A swarm built in a loop by the script is hundreds of shapes the markup never shows.
  const generated = /createElementNS\s*\(/.test(parts.script);
  if (shapes < 15 && !generated) problems.push(`Only ${shapes} shapes — too sparse to be an illustration; aim for 20 to 80, the detail inside the one subject.`);

  return problems;
}

/** GSAP, read once and inlined, so a render never reaches for a CDN. */
/**
 * `strokeDashoffset`, tweened without rounding.
 *
 * GSAP's CSS plugin snaps it to whole pixels, and every line in these scenes
 * is drawn with `pathLength="1"` — so a line went from hidden to fully drawn
 * in one frame instead of drawing itself, which is most of what a line in
 * motion design is for. A plugin by the property's own name takes precedence
 * over the CSS one, so the model's ordinary `strokeDashoffset: 0` now
 * interpolates through every fraction in between.
 */
const DASH_PLUGIN = `gsap.registerPlugin({
  name: "strokeDashoffset",
  init(target, value, tween, index, targets) {
    if (typeof value === "function") value = value(index, target, targets);
    const inline = target.style && target.style.strokeDashoffset;
    const attr = target.getAttribute && target.getAttribute("stroke-dashoffset");
    const start = parseFloat(inline || attr || "0") || 0;
    const relative = typeof value === "string" && /^[+-]=/.test(value);
    const amount = parseFloat(String(value).replace(/^([+-])=/, "$1"));
    this.t = target; this.s = start; this.e = relative ? start + amount : amount;
  },
  render(ratio, data) { data.t.style.strokeDashoffset = String(data.s + (data.e - data.s) * ratio); },
});`;

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
    <script>${DASH_PLUGIN}</script>
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
        // The whole word first: "light" must not land on "lighthouse" when
        // both are said. Then a word that starts with it, then anywhere in one.
        const clean = (text) => String(text).toLowerCase().replace(/[^\\p{L}\\p{N}']/gu, "");
        const at = (word, fallback) => {
          const needle = clean(word);
          const hit =
            WORDS.find((w) => clean(w.text) === needle) ||
            WORDS.find((w) => clean(w.text).startsWith(needle)) ||
            WORDS.find((w) => clean(w.text).includes(needle));
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

  const system = systemPrompt(request.width, request.height, request.durationSec, request.look);
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

export function reviewInstructions(times: number[], height: number, blank = false, width = Math.round((height * 9) / 16)): string {
  const z = safeZone(width, height);
  return `${blank ? `${BLANK_WARNING}\n\n` : ''}Here are frames of the scene you just wrote, rendered exactly as it will ship, at ${times.map((t) => `${t}s`).join(', ')} (labelled on the sheet).

Look at them the way a motion designer reviewing a colleague's work would, and check:

1. Any letters, numbers or words visible anywhere — they must not be.
2. Anything that matters outside the safe area (x ${z.left}–${z.right}, y ${z.top}–${z.bottom}, and right of x ${z.notchRight} below y ${z.notchTop}); a use of space that does not suit the idea — a list crammed into one corner, or a lone object stranded at the edge; items too small to read on a phone; plain flat placeholder shapes instead of richly drawn objects.
3. Anything important inside the caption band, ${Math.round(height * 0.55)}–${Math.round(height * 0.75)}px down.
4. Pieces overlapping by accident, cut off by the frame edge unintentionally, or misaligned.
5. Something rotating about the wrong point, or a shape that looks broken or unfinished.
6. Two frames that look nearly the same — the scene has stalled between them. Every frame should show the sequence clearly progressing.
7. Colours outside the palette you were given, or a drawing technique that does not match the world you were given (paper looks like paper, chalk like chalk, pixels like pixels).
8. Whether the frames actually show your concept and what is being said.
9. Clutter: no clear focus on the item being named, a screen, phone or app window, or anything that is not something the line is about — a planet, stars, a creature or any decoration the words never mention. Replace it with the thing being talked about.
10. A weak ending — the last frame should be the payoff: the biggest, most finished moment, not smaller or emptier than what came before.

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
        { role: 'system', content: systemPrompt(request.width, request.height, request.durationSec, request.look) },
        { role: 'user', content: briefFor(request) },
        { role: 'assistant', content: serialiseComposition(parts) },
        {
          role: 'user',
          content: [
            { type: 'text', text: reviewInstructions(sheet.times, request.height, sheet.blank, request.width) },
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
