---
name: motion-graphics
description: How EasyCut's faceless animated scenes are built and how to add a new look. Read before touching remotion/components/Scenes.tsx, remotion/lib/motion.ts, remotion/looks/*, src/lib/director/scenes.ts or src/lib/edl/scene-fallback.ts, or when asked to make the motion graphics look better, add a style, or fix how a scene animates.
---

# Motion graphics that look hand-made

A scene takes the frame away from the speaker for two to six seconds and
replaces it with a made picture. It is the single loudest thing this product
renders, so it is the thing most worth getting right.

This file is the measured record of four reference edits the user supplied,
plus the rules that came out of reading them frame by frame. Numbers here were
counted off real 30fps frames, not guessed.

## The one architectural rule

**A look is not a kind.** Two axes, kept apart:

- **kind** — the *shape of the explanation*: one phrase, one figure, a list
  around a centre, two things compared, layers stacking, a path. The model
  picks this from the transcript.
- **look** — the *world it is drawn in*: ground, type, chrome, how things
  arrive. This is a named pack in `remotion/looks/`.

Every kind must render in every look. That only stays affordable because a
kind does not draw anything — it arranges **slots** (`Title`, `Figure`,
`Objects`, `Rows`) and a look supplies the four. Adding a look is four small
components, not twenty-four.

## The four reference looks

### `studio` — clean product UI (ref: motion_1)

Near-white ground `#FCFCFC` with a faint dot grid. White cards, 1px hairline
border, a wide soft shadow, radius 18–24. Type is the brand sans, near-black,
tight. One saturated accent, used as a filled circle or a badge, with a big
soft colour glow bled behind it.

What makes it read as real product footage:

- **Nothing slides. Everything grows.** A pill appears, avatars pop into it one
  at a time, then the pill *morphs* into a card — width, height and radius all
  animating together (999 → 20) — and rows stagger in afterwards.
- **Stagger is 4 frames.** Measured: avatars 4 apart, rows 4 apart, the status
  badges a second pass 4 apart, starting ~8 frames after their row.
- **Rings**: concentric circles expanding out of the centre object, each
  starting 2 frames after the last, each fading as it grows. 3–4 rings.
- Handwriting: a green underline drawn under a phrase with an SVG dash offset,
  ~10 frames, with a little tail curl.

### `neon` — dark glow (ref: motion_3)

Radial navy `#0E1533` centre → `#000` at the corners. A single glyph in pale
cyan with a large soft glow. Over it, a **huge condensed uppercase title** in a
violet→magenta gradient with a dark extruded edge and a glow.

- The scene starts on a **hard cut**, not a fade. The subject is already at
  full size on frame 1.
- The title does not fly in. It appears wide and flat and *settles*: a
  perspective `rotateX` unwinds over ~20 frames while the gradient slides from
  violet to magenta. Scale change is small (1.06 → 1.00).
- Emoji props drift in from the corners, slow and oversized, half out of frame.
  They are atmosphere, never information.
- A small label under the glyph fades up over 4 frames.

### `gallery` — 3D prop world (ref: motion_4)

A bright fogged colonnade: white marble columns behind a haze, everything
behind the subject softly out of focus. One plinth centre frame. Objects stand
on it — a trophy, a medal.

- **The carousel is the whole idea.** Objects slide in from the right and stop
  hard. The slide is ~4 frames with an extreme ease-out, and it carries real
  **motion blur proportional to velocity**.
- Do not use a CSS `filter` for that blur. Draw 5 ghost copies of the object
  along the motion vector at falling opacity. Same look, no full-frame repaint.
- The background parallaxes at about a fifth of the object's speed.
- Objects swap on the plinth to make a point (silver → gold).

### `archive` — cinematic documentary (ref: motion_5)

A full-bleed dark photograph, warm amber, heavy vignette, sprocket-hole film
bars top and bottom, and the whole frame sitting on a slight perspective tilt
that drifts.

- **Slow continuous push-in** the entire time, ~1% per 10 frames. It never
  stops, and that is what sells it.
- **Crossfade in and out**, ~12 frames, unlike every other look.
- Type is heavy condensed caps, cream-to-gold, with a warm glow and a hard drop
  shadow, arriving **a word group at a time**, not letter by letter.
- One word can slam in red, larger, rotated a degree or two, as a stamp.
- A figure counts up (92 → 95) across the entry, landing as the crossfade ends.

## Rules that apply to every look

1. **Pure function of the frame.** No timers, no transitions, no `Math.random`.
   Seeded hashes only (`seeded()` in `remotion/lib/timing.ts`). A resumed
   Lambda render must produce identical pixels.
2. **Keyframe tables, not scattered `interpolate` calls.** `kf(frame, [[0, 0],
   [8, 1]])` reads like a timeline and reviews like one.
3. **Transform and opacity only.** No `filter`, `backdrop-filter` or
   `mix-blend-mode` on anything full-frame — that forces a per-frame readback
   and it is exactly why the editor used to stutter. Ghost copies instead of
   blur; painted gradients instead of blend modes.
4. **Ease out hard, never ease in-out.** Almost everything in the references is
   `easeOutExpo` over 6–10 frames. In-out reads as corporate template.
5. **Stagger everything that repeats**, 3–5 frames apart, and give a second
   pass (badges, underlines, sub-labels) its own later offset.
6. **Hold at rest.** Once a scene has assembled, it must be still except for
   one slow continuous move. Things that keep wiggling look cheap.
7. **Land on the word.** A scene's beats are timed off the transcript words
   underneath it, not off the scene's own duration.
8. **Captions stand down** whenever a scene carries text — `sceneHasText()` in
   `src/lib/edl/types.ts`, enforced in `remotion/components/Captions.tsx`.

## Adding a look

1. Add the id to `SCENE_LOOKS` in `src/lib/edl/types.ts`.
2. Create `remotion/looks/<id>.tsx` exporting a `Look`: `Ground`, `Title`,
   `Figure`, `Objects`, `Rows`, plus `enter` and `palette`.
3. Register it in `remotion/looks/index.ts`.
4. Give it a line in the `look` enum description in
   `src/lib/director/scenes.ts` so the model knows when to choose it.
5. Render a still at the midpoint and look at it before claiming it works:
   `npx tsx scripts/scene-still.ts <look> <kind>`.

## Verifying

Render stills, do not reason about it. A scene that is broken is usually
broken visibly and instantly — lost centring, clipped text, an invisible
element. `scripts/scene-still.ts` writes a PNG per look/kind pair.
