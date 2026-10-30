---
name: scene-design
description: How to design, test and ship the Opus-written HyperFrames scenes (the full-screen animations) — the safe area, the layouts, the per-look and per-layout reference scenes, the local voiced preview loop, and the traps that break a scene. Read before changing src/lib/director/hyperframe.ts, src/lib/director/reference-scene.ts, anything in src/lib/director/references/, a look in src/lib/scenes/style-guides.ts, or when asked to make the animations look better, add a style or layout, or "work on the style here until it's perfect".
---

# Designing the animated scenes

A scene is a few seconds of full-screen motion graphic that Claude Opus 5.5
writes as HTML + GSAP, which HyperFrames renders to a clip. Opus is good at
this when it is shown what good looks like, so the work is mostly: make a
scene by hand that is exactly right, save it as a reference, and let the
prompt carry it to every video. Everything below is how that was done, so
it can be done again and come out the same.

## Where everything lives

| What | Where |
|---|---|
| The composer prompt, the review prompt, the audit, the page wrapper | `src/lib/director/hyperframe.ts` (`systemPrompt`, `briefFor`, `layoutHint`, `reviewInstructions`, `auditComposition`, `buildCompositionHtml`) |
| The safe area | `safeZone()` in `hyperframe.ts` |
| One reference scene per look | `src/lib/director/references/<look>.txt`, lines in `REFERENCE_LINES` (`reference-scene.ts`) |
| One reference scene per layout | `src/lib/director/references/layouts/<layout>.txt`, lines in `LAYOUT_REFERENCES` |
| Real word timings for every reference | `src/lib/director/references/words.json` |
| The looks themselves | `src/lib/scenes/style-guides.ts` (how to draw), `src/lib/scenes/looks.ts` (picker names) |
| Compose → check → look-and-fix → render | `src/lib/assets/scene-clips.ts` (`designScene`, `composeSceneClips`) |
| Local preview of a hand-written scene | `scripts/scene-preview.ts` |
| Voiced test lines + word timings | `scripts/voice-lines.py` |

Opus sees, per scene: the system prompt (rules + the look's reference),
and the brief (the line, its word timings, the look's style guide, and — when
the line is a list, journey, comparison or crowd — the matching layout
reference). Change a reference file and every future scene in that look or
layout changes with it; nothing else needs touching.

## The rules a scene is held to

**Draw what is being said.** Every object is something the line is about.
A look decides HOW things are drawn, never WHAT. No props the words don't
mention (Flat science once put a planet in a video about editing).

**The safe area** (1080×1920; scales with the frame): x 60–1020, y 220–1520,
and below y 1020 only up to x 900 — the platforms put the account row on
top, the caption, handle and audio ticker at the bottom, and the like /
comment / share column down the right of the lower half. Nothing that matters
goes outside it — that is the one hard rule about space. How MUCH of it a
scene uses is a decision, not a quota: a single striking object can sit in
the middle at whatever size reads best (the earlier hero scenes are right as
they are); a list, a journey or a comparison spreads out. The video's own
captions sit at about y 1056–1440; things may pass behind them, but not the
one detail that matters at the moment its word is said.

**Decide the layout — whatever makes the most sense for the line.** The app
suggests one from the line's shape (`suggestLayout`, with the reason, and an
example scene in that layout); Opus makes the call and names it in the
concept line. None is the default:

- **Hero** — one striking idea: one big subject that transforms into the next
  (the brain that becomes neurons).
- **Stack** — a list or routine: 2–4 items down the screen, one per spoken
  item, each arriving on its word and staying, linked by arrows; earlier ones
  settle back (sticker morning routine).
- **Path** — a journey or process: a route winding top to bottom with stops
  that light up (paper parcel).
- **Split** — a contrast or before/after: top half against bottom half; show
  the bottom faintly from the start so the frame is never half empty (glass
  weekend vs coffee).
- **Grid** — a share of a crowd, a collection: cells filling the safe area,
  then some of them act (poster "nine out of ten").

**Short-video timing.** The subject is on screen and moving by 0.3 s. Each
beat lands on the word that names it (`at("word", fallback)`). Something
visibly changes at least every 0.4 s. The last beat is the payoff — the
biggest, most finished moment — and holds to the end.

**No text, ever.** Captions are the only words. No numbers either.

## The loop: make a scene by hand, here

1. **Write the line and voice it.** Put `name|line` rows in a file and run
   `scripts/voice-lines.py lines.txt out/voices`. It needs a Python venv with
   `piper-tts faster-whisper numpy`, a Piper voice (`en_US-ryan-high.onnx`
   + `.json` from huggingface.co/rhasspy/piper-voices) and ffmpeg
   (`FFMPEG=$(node -p "require('ffmpeg-static')")`). You get a voiced 9:16
   clip per line and `words.json` with transcribed word timings — the same
   kind the live pipeline gets from Deepgram, so beats land where they will
   land live.
2. **Write the scene**: `<!-- concept: <layout>: … -->`, `<style>`,
   `<div id="scene">`, `<script>` adding tweens to `tl`. Start from the
   closest reference. Generate repetitive markup (dots, spokes, grids,
   particles) with a small script rather than by hand, or build it in the
   scene's script with `createElementNS` from `rand(i)`.
3. **Preview it**:
   `npx tsx scripts/scene-preview.ts scene.txt <look> --voice out/voices/<name>.mp4 --words out/voices/words.json:<name> --out out/preview`.
   It runs the audit, HyperFrames' lint, a real page load (script errors),
   the blank test, renders, lays the voice under it, and writes an 8-frame
   sheet with everything outside the safe area tinted red.
4. **Look at the sheet, critically**, as a motion designer would: is it on
   topic, inside the safe area and using all of it, big enough on a phone,
   never stalled, landing on the words, ending on the payoff? Watch the mp4
   for timing. Fix and render again until it is right — expect three or four
   rounds.
5. **Save it.** Copy the scene to `references/<look>.txt` (or
   `references/layouts/<layout>.txt`), add its line to `REFERENCE_LINES` /
   `LAYOUT_REFERENCES`, add its timings to `references/words.json`, and run
   `npx vitest run tests/scene-references.test.ts` — every reference must
   parse, carry a concept and pass the audit. That is all it takes to ship it.

## Traps that break a scene (all hit for real; all in the prompt too)

- **Lines that draw on**: `pathLength="1" stroke-dasharray="1"
  stroke-dashoffset="1"`, tween `strokeDashoffset` to 0. The wrapper
  registers a plugin so fractions interpolate (GSAP's CSS plugin rounded
  them to whole pixels — lines popped instead of drawing). Hide undrawn lines
  with `opacity: 0` until they start: round caps show as dots.
- **`fromTo` paints its start state at time 0.** Anything that appears later:
  hide it in CSS, `tl.set` it visible when it arrives, `immediateRender: false`.
- **Pivots**: on an SVG element, `transformOrigin: "540px 600px"` is measured
  from the element's own box. For a point in the frame use
  `svgOrigin: "540 600"`; `"50% 50%"` is safe. Give an element one pivot —
  changing it between tweens shifts the element.
- **One job per element**: an entrance and a wobble on the same property
  fight; put entrance, wobble and camera drift on different wrapper groups.
- **An SVG `transform` attribute is replaced** as soon as GSAP tweens x/y/scale/
  rotation on that element (cells placed with `translate(580 800)` all flew to
  the corner). Place with a wrapper `<g>`, animate the child.
- **A class-wide flicker** (`tl.to(".beam", {opacity…})`) records hidden
  elements' opacity too and keeps them hidden — a whole string never appeared.
- **Never measure the page** (`getBBox` etc.) for placement — compute it.
- **Ids `root` and `stage` are the wrapper's own** — a `#stage` platform
  in one scene hid the entire picture. The audit now rejects them anywhere.
- **`keyframes`** ease each step with `power1.inOut` unless
  `easeEach: "none"`.
- **`at(word)`** matches the whole word first ("light" no longer fires on
  "lighthouse"), then a prefix, then a substring.
- **The review stills** are at 20/45/70/93% of the shot; if they are all bare
  ground the scene is refused, and so is a blank final clip.

## The decision, as practised

Twenty scenes made in one pass (`suggestLayout` first, then the call):
the suggestion was kept for 15 and overruled for 5 — "more stars than
grains of sand" (suggested split) became a hero where a galaxy outgrows a
tiny Earth; "pizza was invented … two hundred years ago" (split, from
"than") became a hero; "open the app, pick your style, and hit export"
(stack) became a single morphing UI shape, because it is one object
changing, not three things. Overrule whenever the line is one moment that
happens to contain a comma or a "than".

## Shipping to the live app

The live app uses exactly these files, so a reference that looks right in
`scene-preview.ts` is what Opus is shown in production. After changing the
prompt or a reference: `npx tsc --noEmit -p .`, `npx vitest run`, open a PR
against `claude/easycut-ai-video-editor-cnpana` (Railway deploys it on merge),
then run one real video per changed look through the live site and check its
scene the same way — download the clip, make a sheet, compare against the
reference. Live scenes need credit on the Anthropic account behind the
`Antropic` variable.
