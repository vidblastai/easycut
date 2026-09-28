---
name: motion-graphics
description: How EasyCut's faceless animated scenes, icon cards and full-frame clip transitions are built, and how to add a new look. Read before touching remotion/components/Scenes.tsx, remotion/components/IconCards.tsx, remotion/components/BrollLayer.tsx, remotion/lib/clip-transition.tsx, remotion/lib/motion.ts, remotion/looks/*, src/lib/director/scenes.ts, src/lib/assets/icon-cards.ts or src/lib/edl/scene-fallback.ts, or when asked to make the motion graphics look better, add a style, or fix how a scene animates.
---

# Motion graphics that look hand-made

A scene takes the frame away from the speaker for two to six seconds and
replaces it with a made picture. It is the single loudest thing this product
renders, so it is the thing most worth getting right.

This file is the measured record of four reference edits the user supplied,
plus the rules that came out of reading them frame by frame. Numbers here were
counted off real 30fps frames, not guessed.

## A drawn scene carries no words

The drawing renders no headline, no labels, no lettering of any kind. It used
to carry a caption under the picture and the note was exact — *"no text like
this that is just static and standing there"*. A line of type holding still
over a moving picture reads as a subtitle that forgot to animate.

Taking it out costs nothing, because the video's real captions are already
running. `sceneHasText()` returns false for any scene with `art`, so the
captions play over a drawing exactly as they play over the footage — one set
of moving words instead of two, one of them frozen.

The scene's own words stay in the document: the editor shows them, and the
illustrator is briefed with them so it knows what the shot is about. They are
simply never rendered. The drawing prompt bans lettering outright — not a
label, not a number on a dial, not a word on a screen — and asks for the
bottom fifth of every beat to stay clear, because that is where the captions
land.

## One background, and the drawing is it

The bug worth naming, because it was invisible to me and instant to the user:
a drawn scene was painting the look's decorative ground AND the illustration's
own backdrop on top of it, inset. Two backgrounds, so the art read as a panel
floating on somebody else's wallpaper — *"there's a background on the
background, this looks very low quality"*.

The rule now: **a drawn scene has exactly one background and the drawing owns
it.** `Scenes.tsx` paints a flat fill of the guide's `ground` colour instead of
the look's ground, and the illustration renders `cover` at full frame size, so
it reaches every edge. Beats are asked for at **1000 × 1778** — the frame's own
aspect — because a square beat mathematically cannot cover a 9:16 frame, which
is what left a margin for a second background to show through in the first
place.

Consequences to hold onto:

- The backdrop group must reach all four edges of the strip. Any gap it leaves
  is a hole, not a margin.
- The caption is an overlay on the art, anchored to the lower part of the frame
  the drawing was told to keep clear — not a sibling sitting under a picture.
- Art drawn before this change is square-banded and crops at the sides. It
  still renders; it just wastes width.

## One style guide per look

`src/lib/scenes/style-guides.ts` is the single description of a visual world,
and three readers depend on it: Opus when it draws a scene, Seedance when it
animates one, and the picker somebody chooses a style from in the app. Three
descriptions of one style is three styles — the drawing prompt's palette had
already drifted from the renderer's, and a test caught `studio` being violet
in one file and green in the other.

A guide is written in terms a model can act on, never in adjectives: named
colours with hex values ("#1A1F44 — the body of an object, nearly black"), a
rendering rule, a lighting rule, a ground rule, a motion character, a camera
language, and a list of what this world never contains. "Warm and cinematic"
gives a different picture every run; the guide gives the same one.

`guideAsPrompt()` trims it per reader — an SVG has no camera, a video has no
stroke weight. `LOOK_META` takes its swatch from the guide rather than
declaring its own, so there is one number.

**Adding a style is adding an entry here.** The prompts, the renderer and the
picker all pick it up.

## The picture comes first

The mistake this feature made on its first two passes, both times: it filled
the frame with **type**. Every kind arranged words, the looks styled words
beautifully, and the result was a video whose animated inserts were title
cards. The user's correction was blunt and right — *"we want icons and
illustrations, not just text."*

So there are now two ways a scene can be drawn, and the first one wins:

1. **Illustrated** (`scene.art`). The motion model draws the thing being
   described as an SVG, in `<g id="part-N">` groups, and the renderer brings
   the parts in one at a time. The picture fills the frame; the words become a
   caption under it. `Drawn` in `Scenes.tsx`, ahead of the kind switch.
2. **Icons and type** (no `art`). The original slot layout. It is the FALLBACK
   — what a scene looks like when the drawing pass failed — and it must stay
   good, because it is what ships when the model is down.

Rules that came out of getting this wrong:

- **Words are labels, not content.** headline ≤ 6 words, items 1–2 words each,
  enforced in `sanitiseScenes` rather than asked for in the prompt. A model
  that has just read a transcript will hand back the whole sentence.
- **At least one scene per video should have no words at all.**
- **Nothing arrives alongside the drawing.** The art assembles, and the type
  comes in after it settles (`artSettlesAt`). Two things at once on a
  full-screen insert gives the eye nowhere to go.
- **Under a drawing, items are plain labels.** Not the look's icon chips: an
  icon beside an illustration of the same thing is a second, worse drawing of
  it, and an unresolved one is a grey dot that reads as a loading state.

### Animating a beat instead of playing it back

Five models went through the same frame of the neon look. Every one animated
it well and every one destroyed rendered type within two seconds. That settles
the shape of the video path rather than leaving it a preference: Opus draws
the beat, it is rendered to a plate **with no words on it**, Seedance animates
the plate, and Remotion draws the caption on top afterwards. The model never
sees a letter, so it never gets the chance to melt one.

The prompt (`director/animate.ts`) says four things and nothing else:

- **MOTION** — one or two physical changes, and it comes from Opus, via a
  `<desc data-stage="N">` in the drawing. Only the illustrator knows which
  group is a clock hand and which is a background.
- **CAMERA** — one named move, from the style guide.
- **STYLE** — the guide's own words, so the world cannot drift.
- **NEVER** — the specific failures these models have, not generic negatives.

The thing NOT to do is describe the subject. The model can already see it, and
restating it is what made Seedance draw a second figure beside ours.

Pricing: Seedance bills per five-second block and the catalogue's `base_price`
is the **480p** rate. At 720p it is double — $1.00 per 5s for 2.0 Fast, $1.80
for 2.5. `billableSeconds()` rounds up to the block and the renderer trims,
which is both cheaper and better: the last half second is where drift shows.

### Look at it before using it

*"Make sure to render the icons before, so they actually make sense"* — the
complaint was a clock whose hands were not attached to it. We cannot see the
picture, but most of what goes wrong is structural and IS visible in the
markup, so `auditIllustration()` checks and one repair round fixes it:

- a beat drawn outside its own band
- a beat that does not fill its square
- **a beat that is nearly empty** — the one that shipped: a third beat holding
  only the backdrop and a plinth, so the camera panned down to an empty room.
  It passes every other check, which is why the count is of the beat's OWN
  shapes, in front of the backdrop
- anything that spins, ticks or sways without a `data-pivot`
- no connector between beats
- too few shapes to be an illustration

The repair sends the original, the brief and the fault list back, and **keeps
the first drawing unless the second one has fewer faults**. A second attempt is
not automatically an improvement.

Things that pivot need drawing so they CAN pivot, and the prompt says so
explicitly: a clock hand is a tapered solid shape starting AT the pin, in its
own group, with a cap circle over the join — not a pie wedge, not a thin line
the colour of the dial.

### What the drawing pass needs to be told

Measured over several rounds with `scripts/draw-scene.ts`:

- **"Fill the canvas"** is the single highest-value instruction. Left to
  itself the model composes small and centred, which on a phone is a postage
  stamp in an empty frame. Give it a number: the bounding box spans ≥800 of
  1000 units.
- **Ask for parts, explicitly and with a reason.** Without "the renderer brings
  them in one at a time" it returns one group and the drawing can only fade.
- **Ban `<text>`.** Otherwise it letters the drawing itself, in a different
  typeface, and the scene ends up saying everything twice.
- **Hand it a literal palette**, five hex values. "Warm and cinematic" produces
  a different palette every call and four scenes in one video then look like
  four different videos.
- **Inside a world, the world's colour wins.** The brand accent goes to
  `studio` only; everywhere else the look's own swatch is the accent, or you
  get a violet arrow in a gold documentary frame.
- **Ask for `<defs>` and keep them.** `<defs>` is a top-level child of the
  `<svg>` but it is not a `<g>`, so the part splitter walks past it and every
  `fill="url(#…)"` then refers to nothing. It does not error — the shape just
  renders wrong. Ids are namespaced per scene, or two scenes in one video both
  define `#wall` and the second one fills with the first one's gradient.
- **40–110 shapes, and say so.** That number is the line between a clipart
  symbol and an illustration, and asking for it visibly doubles the detail.
- Cost is real and has grown with the detail: roughly **$0.30–$0.50 and two to
  four minutes per drawing**, including the repair round. `MAX_DRAWN_SCENES`
  caps it at the first four scenes of a video and the rest fall back to the
  icon layout, which bounds one upload at about two dollars.

## A scene is a SEQUENCE, not a picture that moves

The third correction, and the structural one: *"it's just an animated picture.
It should make an arrow go down, and the thing that was on screen swipes up and
away, and down there is the next thing."*

So a drawing is a **tall strip with its beats stacked down it** — beat 0 in the
top 1000 units, beat 1 in the next 1000 — and the camera travels down it as the
voice moves on. Nothing fades out: the previous beat leaves upward because the
camera left it behind. Three beats is the default.

A dashed connector leads from each beat into the next, drawn just BEFORE the
camera follows it (`partStartsAt` puts it at 62% of its beat). It is the piece
that turns two beats into one sequence, and the audit fails a drawing without
one.

What the prompt has to say, or the model returns a picture anyway:

- **Describe the sequence as a progression**, not a layout. `sequenceFor()`
  does this per kind — "the first thing alone, then an arrow down, then the
  second thing alone — **never the two side by side**". Without that last
  clause a `compare` comes back as two objects in one square.
- **Each beat is drawn inside its own square**, with explicit y ranges.
- **One backdrop spans the WHOLE strip.** The camera crosses the boundary
  between two squares, so a backdrop that stops at the end of a beat leaves
  the screen blank for half a second mid-pan.
- Keep the pan short (10 frames) and start the next beat's pieces 3 frames
  into it, so the beat is already forming as it arrives.

Where the scene has one item per beat, the **caption follows the beat** —
"it's not about money", then, further down the board, "it's all about timing".
A fixed caption over a travelling sequence undoes most of what it was for.

## Borrowed art direction

The `editorial` guide came from a reference edit the user supplied with a
written breakdown. Three things in that breakdown were worth taking whole,
and they generalise past that one style:

- **The signature is never the colour.** "Purple text with an icon" is not the
  reference; near-black with ONE localised violet pool, oversized cropped
  curves in the foreground, and rim-lit metal is. When a style reads as cheap,
  the missing thing is usually structure, not saturation.
- **Three depth planes, deliberately different.** Cropped foreground, focal
  group, dim satellites — distinct in scale, sharpness and how much they
  respond to the camera. The drawing prompt now asks for this by `data-depth`
  band, because three groups at the same depth waste the parallax and the
  flatness shows at once.
- **"Do not treat glow as a substitute for design."** If it would not read in
  flat grey, more bloom will not save it.

## It must never stop moving

The second correction, after the picture one: *"it should not be like a still
image. It's just an animation, and then it's sitting there until the motion
graphics finish."* Exactly right, and it is what a naive assemble-then-hold
gives you — every piece lands in the first second and the remaining three are
a PNG.

Read the reference edits frame by frame and NOTHING in them is ever still. Over
four seconds of a wallet on a desk: the camera pushes in the whole time, notes
slide out one at a time, a dashed arrow draws itself across the board, and a
clock's hands turn. There is no hold anywhere.

So a drawn scene has three layers of motion, and only the first one ends:

1. **Entry** — each part arrives, five frames after the last.
2. **Camera** — a slow push and drift across the whole scene, first frame to
   last, with no keyframes and no settle. The instant it stops, the frame reads
   as a photograph. Paced against the scene's DURATION, not per-frame, or a
   six-second insert ends up twice as close as a three-second one.
3. **Idle** — once a part has landed it keeps moving on its own: bob, sway,
   pulse, drift, or spin.

**Parallax ties the first two together.** Each part carries a `data-depth`, and
the camera's drift is multiplied by it, so near things travel further than far
things. That is what makes a flat SVG read as a space rather than a sticker.

Numbers, after watching renders rather than reasoning: **14% push and 10%
drift** over the scene, idle periods of **38–64 frames**. At half those values
the move was real and still read as a still frame. The reference edits travel
much further than feels reasonable written down — that is the point.

Two traps, both of which cost a render to find:

- **Everything pivots on the PART, not the canvas.** A `spin` pivoting on the
  drawing's centre does not turn the object, it swings it around the picture in
  a wide circle. `data-pivot` exists for this, and because the model forgets it
  constantly, `estimatePivot()` measures one off the shapes' own coordinates
  and the hint only overrides.
- **Idle periods are seeded per part.** A shared clock makes four pieces bob in
  unison, which looks far worse than no idle at all.

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
5. Add its palette to `PALETTES` in `src/lib/director/illustrate.ts`, or the
   model will draw it in the default world's colours.
6. Render stills and look at them before claiming it works:
   `npx tsx scripts/scene-sheet.ts [look] [kind] [frame]`.

## The icon card is a different instrument

A scene replaces the frame. An **icon card** does not: it is one illustrated
object on a plain tile that slides up on the word that earns it, holds dead
still, and fades. No type on it, ever. It is punctuation for a noun, and the
whole effect is timing — a card three frames late reads as lag.

Measured off the user's reference clip at 1080x1920, 30fps. These numbers are
not preferences:

| | |
|---|---|
| card | 325 x 298 px, centred → **0.30 of the SHORT edge** |
| travel | 602 px, from below a floor → **2x the card's own height** |
| rise | 19 frames, **quadratic ease-out**, no overshoot |
| scale | **none** — the width is constant to the pixel |
| hold | absolute stillness. Not a drift, not a breath |
| exit | 15 frames, **linear** opacity, and it does not move |

Three mistakes are one reflex each, and all three were in the first draft of
the idea:

- **A pop.** Anything arriving wants to scale in. A card that scales is a
  sticker; what makes this read as an object is that it is already full size
  before you see it, and it is moving.
- **A spring.** Overshoot-and-settle is a thing LANDING. This is a thing
  rising into view, so the ease decelerates and creeps the last few pixels.
- **A fade-in.** The reference never fades in, it is hidden by an edge. Each
  card gets its own invisible floor one card-height below where it lands and
  climbs out of it, clipped, exactly as the reference climbs out of the bottom
  of the screen. Fade plus slide is a web animation, not an edit.

**The floor is why the clip box is bigger than the card.** It extends a card's
height below and a sixth of a card all round, so the tile's shadow is not
sliced down its sides.

### Where the row sits

**Two fixed bands, and they cannot be wrong about each other.** Cut the frame
into quarters: the captions own the second one up from the bottom
(`CAPTION_BAND`, which `framedPositionY` clamps every preset into), and the
icon cards own the first (`iconRowPlacement`).

That is a rule, not a calculation, and the version before it was a calculation.
It measured the caption block and placed the row under whatever it found —
which sounds more careful and was worse, because a caption block's rendered
height does not follow from its `lineHeight` or its `maxLines`; it depends on
how many lines the words actually made. The model was out by up to eight per
cent of the frame in both directions: too small and the words sat on the
cards, too large and the card shrank to a sixth of the frame to make room for
space nothing occupied.

Numbers, measured off renders of every preset:

| | |
|---|---|
| caption band | `positionY` clamped to 0.63–0.70 |
| ink vs `positionY` | within 0.05 — no correction factor needed |
| deepest a block reaches | about 0.768, from a block centred at 0.70 |
| cards' band | 0.77 to 0.93 |
| card | that band's height, capped at the reference 0.30 of the short edge |

Two things that look like details and are not. The presets had drifted from
0.54 — the middle of the frame — to 0.87, hard against the bottom edge; where
a video's words live must not change when somebody tries a different caption
look, which is why this is a clamp on the style rather than a rewrite of
twenty presets. And the cards' bottom margin is 0.07 rather than 0.03: at 0.03
the tile read as a thing that fell rather than a thing placed. The card gives
up size before it gives up that margin.

A split layout is exempt from all of it. `LayoutPlan.captionY` hands the words
the one strip covering neither the face above nor the picture below, and that
strip is the whole point of the layout.

### Rows### Rows

Nouns said within 2.5s are ONE row: they arrive one at a time and leave
together, because that is what "bananas and apples" does. The row is laid out
for its final width from the first frame, so the banana does not slide left
when the apple appears. Grouping happens in the builder, never in the
director — it is bookkeeping with an exact answer.

### The icons themselves

Full-colour illustrated icons from Iconify's emoji sets, not the tinted
monochrome glyphs the graphics layer uses: a flat pictogram blown up to a
third of the frame reads as a missing asset. No image model — it would cost
money per card, take seconds, and come back with a background to key out.

`resolveCardIcons()` takes the WHOLE video's queries at once, because the
choice of icon set is a property of the set of queries: every set is asked
about every word and the one that answers the most wins the video. Resolving
per card gives you a Noto banana beside an OpenMoji apple, which is two
illustrators on screen in the same second.

Two things do the quality work inside it, and both came from real wrong
answers:

- **Ranking, not first-hit.** Searching "money" returns a money-mouth face
  ahead of the money bag. Exact name beats a compound, a compound that starts
  with the word beats one that contains it, shortest breaks the tie.
- **`CARD_OBJECTS`.** Emoji sets have no "revenue" and no "growth"; they have
  a money bag and a chart. The mapped object goes SECOND in the search ladder,
  right after the phrase — at the bottom it is never reached, because a single
  word out of the query almost always matches something. That is how "video
  editing" resolved to a games console.

### On the timeline

An icon row is a clip like any other: `icons` is in `CLIP_TRACKS`, so move,
trim and delete come from the generic code. That is the whole reason a row
spells its span `outStartSec`/`outEndSec` and keeps each card's time as an
`offsetSec` from the row — with absolute card times, dragging the row would
leave its cards behind and the second one would arrive before the first.

Editing a card needs its own operation (`icon.set`, `icon.remove`), because
`clip.update` carries a flat patch of primitives and cannot express "the
second card in this row". The inspector looks the icon up through
`/api/icons` as you type, so you find out you asked for a games console
before you re-render rather than after.

Verify with a real clip in both tones. A still cannot show you whether it
lands on the word:

    npx tsx scripts/icon-clip.ts light 6
    npx tsx scripts/icon-clip.ts dark 6

## How a full-frame clip arrives and leaves

A B-roll insert or a scene that simply appears reads as a dropped frame, and
no amount of effect painted over that moment fixes it — **the picture has to
travel.** That is the difference between `remotion/lib/clip-transition.tsx`
and `remotion/components/Transitions.tsx`: the latter decorates a CUT with an
effect and nothing underneath it moves; this one moves the clip.

Two families in one list, because the person picking does not care which:

- **Moves** — `slide-left/right/up/down`, `zoom`. Named by the direction the
  clip TRAVELS, so `slide-left` comes in from the RIGHT edge and leaves past
  the left one. An insert given the same value at both ends therefore crosses
  the frame in one continuous direction over its whole life, which is what
  makes a run of them feel edited rather than like a slideshow.
- **Flavours** — `glitch`, `film-burn`, `light-leak`, `flash`, `whip`. The
  clip SNAPS in at full opacity and the effect plays over it. Fading it in
  underneath is the mistake: a glitch over a half-faded picture looks like a
  rendering fault, which is the one thing a glitch must not look like.

Moves take 0.34s, flavours 0.22s. Both ends are measured from their own edge
and applied together (transforms composed, opacities multiplied), so a clip
too short to finish arriving before it must leave degrades rather than jumps.

**Composing, not picking.** `transform: a b` is ONE declaration — writing
`${a} ${b}` where either is undefined discards the whole thing, and the insert
silently does not transition at all in exactly the case where both ends are
animating. Filter, then join.

**Where they come from.** Each style declares a `clipTransitions` vocabulary.
The builder cycles it per insert, so consecutive inserts differ inside one
coherent set and re-running the same footage gives the same edit; a scene gets
the style's FIRST entry as its signature, because the two or three scenes in a
video should arrive the same way as each other. A layout whose B-roll has a
permanent half gets `cut` — that slot is on screen from frame one, so there is
nothing to transition into. Every clip is overridable from the editor.

Watch the whole set on one strip; twelve of these cannot be judged one at a
time, and none of them can be judged from a still:

    npx tsx scripts/transition-clip.ts              # all of them, labelled
    npx tsx scripts/transition-clip.ts glitch,whip  # just these

The strip uses flat colour plates rather than footage for the inserts. Its
first version used the same fixture for the speaker AND the inserts, which
made it impossible to see where one ended and the other began — the exact
thing the strip exists to show.

## Verifying

Render stills, do not reason about it. Every failure this layer has had was
invisible in the diff and obvious in a PNG: a dial that positioned itself
against the whole frame, a rule scaled by a string's length running off the
edge, a headline stacked one word per line, a flex `gap` in `em` resolving
against the container's font size so a headline rendered as one unbroken word.

    npx tsx scripts/draw-scene.ts ["a line"] [look]      # ask the model to draw
    npx tsx scripts/scene-sheet.ts [look] [kind] [frame] # every look x every kind
    npx tsx scripts/scene-clip.ts [look] [kind] [secs]   # a real mp4

**A still cannot catch a motion bug.** "The drawing lands and then sits there
for three seconds" looks identical to a good scene in any single frame, so
anything about pacing, camera or idle is judged from `scene-clip.ts` output,
not from the sheet.

`scene-sheet` picks up whatever `draw-scene` left in `out/drawings/`, so the
sheet shows illustrated scenes rather than only the icon fallback.

**Read the output, do not grep it for failures.** A bundling error kills the
script before it renders anything, so a run that reported "0 failures" was
once a run that rendered nothing at all and left yesterday's PNGs in place.
The specific trap: `src/` modules imported by the Remotion bundle must use
RELATIVE imports — Remotion's webpack config does not carry the `@/` alias,
and one `@/` import in a shared file fails the whole composition silently.
