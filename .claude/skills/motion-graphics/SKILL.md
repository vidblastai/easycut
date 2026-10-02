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
| caption band | `positionY` clamped to 0.60–0.66 |
| ink vs `positionY` | within 0.05 — no correction factor needed |
| block depth | varies by ~0.08 of the frame between presets |
| cards' band | starts at 0.70, floor margin 0.07 |
| card | 0.22 of the short edge — two thirds of the reference |

Two things that look like details and are not. The presets had drifted from
0.54 — the middle of the frame — to 0.87, hard against the bottom edge; where
a video's words live must not change when somebody tries a different caption
look, which is why this is a clamp on the style rather than a rewrite of
twenty presets. And the row hangs from the TOP of its band rather than up from the
floor margin. Anchoring to the margin ties the row's position to the card's
size, so every time the card got smaller the gap under the captions grew and
the tile drifted toward the bottom edge on its own; from the top, a smaller
card is simply a smaller card in the same place.

The card is 0.22 of the short edge, not the reference clip's 0.30. That clip
had no captions over it and nothing competing for the lower frame. Against a
line of words the tile has to read as punctuation under them rather than as
the subject.

**The cards' band deliberately does not clear the deepest caption block.**
How far a block runs depends on how many lines the words actually made, which
nothing here can know, and a value that guaranteed clearance for the deepest
preset left a 167px hole under the shallow ones. At 0.70 the common case sits
about 90px under the last line and the deepest blocks overlap the top of the
tile — which costs nothing, because the cards render UNDER the captions and
the tile's top seventh is padding, so what ends up behind the text is blank
tile.

A split layout is exempt from all of it. `LayoutPlan.captionY` hands the words
the one strip covering neither the face above nor the picture below, and that
strip is the whole point of the layout.

### And then somebody drags them somewhere else

The band is a rule about PRESETS, not about people. Held as the only truth it
meant the product offered exactly six per cent of the frame's height to put
captions in, which is not a position control, and no horizontal control at all.

So `CaptionStyle.placement` is `{x, y} | null`, and null — the default, on
every preset — means the rule above still applies, unchanged. A value means
somebody dragged the words on the picture in the editor and it outranks
everything, including a split layout's own band: they are looking at the frame
while they do it, and a drag that silently does nothing on one layout is worse
than a caption somewhere the layout would not have chosen. `framedPositionY`
holds both branches; `framedPositionX` returns null rather than 0.5 when
unplaced, because "centred" and "never touched" are not the same thing and a
number there would quietly replace `align`'s layout on every existing video.

Three things fall out of the anchor being the column's CENTRE rather than its
left edge — which it has to be, or a caption moves when its words change
length:

- The column narrows near an edge (`framedWidthRatio`), to twice the distance
  to the nearer edge, less a gutter. Without the gutter a line exactly fits,
  and a line that exactly fits reads as a line that was cut off.
- The TYPE has to shrink with it. A narrower column does not shrink a word —
  flex only wraps between words — so "everything" at a 111px weight is 600
  pixels wide whatever `maxWidth` says, and it overflowed off the frame.
  Floored at 0.6 of the style's size.
- `placement` survives a change of caption preset. Where a video's words live
  must not change when somebody tries a different LOOK; that is the same
  sentence the band is built on, and it applies to a drag even harder.

The handle is `components/editor/CaptionDragLayer.tsx`, laid over the preview
box — which already carries the composition's aspect and which the Player fills
exactly, so a fraction of that element IS a fraction of the frame and nothing
has to know the video's pixel size. It writes through the caption picker's
existing draft channel, so a drag is live in the frame under your finger and is
committed by the same "Apply captions" button.

Check the EXPORT agrees, because a drag the renderer ignores is the worst kind
of bug — right while you work, different in the file:

    npx tsx scripts/caption-sheet.ts out/fixture.mp4 bold-pop 0.26,0.3

The icon cards do NOT follow a dragged caption. Their `y` is computed at build
time and stored on the cue, so it is a different mechanism with a different
answer, and moving it would need the row's stored position recomputed.

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

### What made them look broken

A slide crosses the whole frame in the time it is given. At ten frames that is
**293 pixels of horizontal travel in one frame, and 520 vertical** — which is
why `slide-up` was the one that looked worst. Nothing about it was a bug in
the maths; it is what a hard cut between two positions 520px apart looks like
thirty times a second, and the eye reads it as strobing.

Two fixes, and they are the two things a camera does for free:

1. **Time proportional to distance.** `clipTransitionSec` reads the frame. A
   vertical slide in 9:16 travels 1.78× as far as a horizontal one and gets
   1.78× as long, so both move at roughly the same pixels per second instead
   of the same per cent per second. 0.42s to 0.72s, then `fitTransitions`
   shrinks the pair to at most 60% of a short clip — a 1.5s insert cannot
   afford two full slides, and arriving and immediately leaving reads as a
   wobble.
2. **Motion blur, modelled on a shutter.** A real shutter is open for half the
   frame, so a moving subject smears across half its per-frame displacement;
   a gaussian approximating a box of length L wants σ ≈ L/3.5, hence σ =
   step/7, capped at 48px. Derived from the distance actually covered since
   the last frame, so fast frames smear and the settle is sharp.

**The preview runs the same code, and this is not negotiable.** It briefly did
not: the glitch had a `cheap` branch that gave the editor a jump and an
exposure lift with the OLD coloured bands still painted over it, so the preview
showed the previous transition and the export showed the new one. The only way
to find out what a glitch looked like was to render the file and watch it, and
the reasonable conclusion from inside the app was that nothing had shipped.

A preview may be CHEAPER than the render. It may not be a DIFFERENT effect.
`tests/clip-transition.test.ts` pins that for the glitch by asserting the two
branches return the same style. The number, since it was assumed rather than
measured for a while: the whole shatter chain costs ~45ms a frame at a full
1080x1920 with no GPU at all, and the preview draws the composition scaled to a
few hundred pixels — for nine frames at each end of an insert. `cheap` still
governs the motion blur, which is a full-frame gaussian on EVERY frame of every
move and a genuinely different order of cost.

**Directional, via an SVG `feGaussianBlur`** — CSS `blur()` is isotropic, and
a horizontal slide blurred equally in both axes reads as out of focus rather
than as moving. Two details that are not details: `colorInterpolationFilters`
must be `sRGB` or every blurred edge lightens into a glow, and `overflow` goes
to `visible` while the smear is on, because a blur has to paint outside the
element it came from and clipping it cuts the trailing edge off square.

The curve is `cubic-bezier(0.4, 0.6, 0.3, 1)`, not `easeOutCubic` — the latter
puts 27% of the journey in the first frame of a ten-frame move. This one peaks
near 15% and is still three quarters home at 40% of the time, so it loses no
snap. It costs roughly 140ms per blurred frame at 1080×1920, and it is off in
the editor, where a preview has to keep time.

Both ends are measured from their own edge and applied together (transforms
composed, opacities multiplied), so a clip too short to finish arriving before
it must leave degrades rather than jumps.

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
nothing to transition into.

**The vocabulary is overridable, and so is every clip.** Three places, and they
are three different questions:

1. **The upload wizard** (`components/transitions/TransitionPicker.tsx`) picks
   the SET, before anything is cut. It is a multi-select and the ORDER is kept,
   because the builder cycles the list — glitch-then-zoom and zoom-then-glitch
   are two different edits, so nothing between the picker and `placeBroll` is
   allowed to sort it. Empty means the style's own. It rides through as a JSON
   array on `Project.clipTransitions`, sanitised on the way in by
   `sanitiseTransitions`, so a name a later build drops costs a preference and
   not a render.
2. **Badges on the timeline**, one at each edge of every B-roll and scene clip,
   which open a menu. This is where you go when you are READING the edit —
   whether these four inserts all slide the same way is a question about a
   track, and an inspector that shows one clip at a time cannot answer it.
3. **The inspector's picker**, for when a clip is already selected and you are
   working down its settings.

Every tile in the wizard plays its own transition on a CSS loop, because twelve
words is not a picker: nobody can tell `whip` from `slide-left`, or `film-burn`
from `light-leak`, from the name, and choosing one you have never seen and
finding out after a render is the whole failure mode.

Two CSS traps, both of which cost a round of screenshots. `steps(1, end)` holds
the START of every keyframe interval, which froze four tiles on frame zero for
the entire loop — a hard cut is two keyframes a tenth of a per cent apart, with
`linear`. And a property named at 8% and again at 88% and nowhere in between
does NOT hold across the gap; it interpolates, which had the glitch tile at 6%
opacity during its own exit. Restate it on every keyframe.

Watch the whole set on one strip; twelve of these cannot be judged one at a
time, and none of them can be judged from a still:

    npx tsx scripts/transition-clip.ts              # all of them, labelled
    npx tsx scripts/transition-clip.ts glitch,whip  # just these

And then LOOK AT THE PREVIEW, which is a second renderer with its own code
path. A strip out of `renderMedia` proves the export; it proves nothing about
what somebody sees in the editor, and the editor is where they will judge it.

The strip uses flat colour plates rather than footage for the inserts. Its
first version used the same fixture for the speaker AND the inserts, which
made it impossible to see where one ended and the other began — the exact
thing the strip exists to show.

## What a transition sounds like

A transition makes a sound, and which sound is a table — `src/lib/edl/sfx-cues.ts`
— not a prompt. A whoosh under a slide is the same decision every editor makes
every time; asking a model to make it again per video buys variance and latency
and nothing else. Slides get `swipe`, zoom and whip and the two optical ones get
`whoosh`, `glitch` gets its own sound, `flash` gets `impact`. `fade` and `cut`
get **silence**: a dissolve that whooshes is the most recognisable sign of
somebody who has just found sound effects, and a cut has no movement to sell.

Three things about placement:

1. **An exit sound starts one transition-length before the clip ENDS**, not at
   its end, where the movement is over and the whoosh scores the shot that
   replaced it. The number that decides this is the same number the composition
   animates with, which is why `clipTransitionSec` moved out of the renderer into
   `src/lib/edl/transition-timing.ts`. Two copies of it drift apart; one cannot.
2. **One sound per icon CARD, not per row.** A row of two arrives one at a time,
   and a single swipe on the first leaves the second looking broken.
3. **Cues within 120ms of each other are thinned**, keeping the earlier. Two
   swipes 80ms apart is one sound with a flam on it. The gap is measured from the
   last cue KEPT, not the last one seen, or a busy stretch silences itself.

Every cue carries a `reason` (`"slide-left in · coffee"`, `"icon card · banana"`),
shown in the editor's inspector. Sound lives on its own track, so deleting a cue
leaves the transition, the insert and the icon exactly where they were — and the
`reason` is what tells somebody that before they click.

### The gains are only comparable because the files are normalised

`defaultGainDb` in `src/lib/assets/sfx.ts` reads as a mix level: −7 for a swipe
against −5 for an impact says the impact sits two decibels above it. That is only
true if the files are equally loud to begin with, and synthesis recipes are
nothing of the kind — a square wave runs to full scale on its own while a
filtered noise sweep comes out twenty decibels down. `alimiter` in the generator
does not fix it: it caps a loud peak and leaves a quiet one exactly where it was.

So `generate-sfx.ts` renders, reads the file's real level back, and applies the
gain that brings it to −20 dBFS **RMS**, with a −1 dBFS ceiling. Energy, not
peak: a noise swish and a square wave at the same PEAK differ by fifteen
decibels of crest factor and the swish is the one nobody hears. Peak-normalising
first was a real wrong turn here — every file measured −1.0 dBFS and looked
correct while `swipe` still played audibly under `glitch`.

Against speech levelled to −14 LUFS the arithmetic is then simple: a sound plays
`gain − 6` dB relative to the voice. Transitions sit 12–14 dB under, accents
11–12, punctuation 16–22. `tests/sfx-library.test.ts` reads the shipped bytes and
pins all of it.

None of that was found by reading. It was found by rendering a clip and measuring
the mix, which showed the transition sounds 20–28 dB under the voice — inaudible.
`scripts/sfx-clip.ts` is that clip; it renders the picture through Remotion and
the mix through the same ffmpeg graph the export uses, so the sounds can be
heard against the cuts they are on.

## J and L cuts

`concat` butts every segment's audio hard against the next, which puts the audio
join on the same frame as the picture join, every time, all the way down a video.
That is precisely what makes an automated edit sound automated.

So in `src/lib/media/audio-mix.ts` each segment is trimmed WIDER than its picture
and placed absolutely with `adelay`, overlapping its neighbours by
`edl.audio.jCutSec` (0.14s) with fades across the overlaps — one segment's
fade-out and the next one's fade-in span the same moment, which is a crossfade.
Only the placement moved, not the length, so the timeline is exactly as long as
it was; `tests/jl-cut.test.ts` renders both ways and compares durations, because
a J cut that desynced the video would be a catastrophe dressed as a polish pass.

Four things it has to get right, each of which is a bug if it does not:

- **Widen in SOURCE seconds** (`leadIn * speed`), or a sped-up segment leads by
  the wrong amount and drifts off its own picture.
- **Never more than 40% of a segment from either end**, or a 0.3s segment is
  fading in until it starts fading out and a run of them turns to mush.
- **Never reach back before the start of the source file**, which is a negative
  timestamp.
- **`amix` needs `normalize=0`**, or mixing N streams divides every one by N and
  the whole voice track drops through the floor.

Past `J_CUT_MAX_SEGMENTS` (160) the hard concat comes back: the effect is worth a
few milliseconds of polish, not a filter graph that takes longer to parse than
the render.

The cleanup chain — highpass, denoise, compressor, `loudnorm` — runs whichever
way the segments were joined. It lived inside the concat branch at first, which
left `[speech]` (the label the music duck and the final mix both read) undefined
the moment the overlap turned on, so ffmpeg refused the whole graph.

## A row is laid out twice, and the second time is the one that ships

The builder places icon rows before anything has been fetched, so it places
them for the cards the DIRECTOR asked for. By the time the icons come back some
of those words have no icon, and the row arrives at the asset stage a different
size from the one that was laid out. `relayoutIconRows` is where that is
resolved, and it has to do two things:

- **Re-place for the cards that survived, IN THE SHAPE IT ENDED UP.** Passing
  `side` matters as much as passing the count. Without it every row was
  recomputed with the below-row geometry, which dragged a side column's `y`
  from the middle of the frame down into the caption band while leaving its `x`
  out in the margin — so it rendered in the bottom corner.
- **Not let a failed lookup break the three-card rule.** A floor row that loses
  a card would otherwise become the exact pair the rule exists to prevent, and
  here it would literally be "a third that failed to load". It moves out to the
  side instead, and is dropped only where the frame has no margin to move it
  into. Both outcomes are reported through `degraded`.

The same trap applies in the editor: `side` is not the position. The renderer
reads `x` and `y`, and those were computed for the layout the row used to have,
so `placeIconRow` recomputes them alongside the flag. And `side` has to be on
the `clip.update` whitelist — a field left off it is dropped in silence, so the
control looks like it worked and the row does not move.

## Figures, and the scene built on one

`shapeOf` in `scene-fallback.ts` decides whether a sentence is worth a
full-frame scene. Speech-to-text writes what was SAID, so every figure arrives
as words, and four things there were quietly wrong at once — each one reaching
the screen at the size a big-number scene draws:

- **A scale word multiplies the number before it.** The matcher found the first
  number word and stopped, so "one hundred dollars" was the figure 1 and "three
  thousand users" was 3. The word doing all the work was never looked at.
- **`\b` after an optional unit group drops a `%`.** The boundary has to fall
  between "%" and a space, and both are non-word characters, so there is no
  boundary there — the group backtracked to empty. "40%" rendered as a bare
  **40** with the "%" stranded in the line underneath ("revenue grew % this
  quarter"). Use a `(?![a-z])` lookahead instead: it does the job the boundary
  was for — stop "day" matching inside "daylight" — without needing one to
  exist.
- **"one" is a pronoun far more often than a quantity.** "the one you picked",
  "no one showed up" — each produced a full-frame scene shouting a figure that
  carried none of the sentence's meaning, with the word torn out of the middle
  of the line beneath it. A bare 1 needs a unit ("one minute") or a digit ("1%")
  to earn the scene.
- **A suffix unit hugs its figure.** "40 %" and "2.5 x" read as typos at that
  size; "40 minutes" needs the space.

The sentence under the figure is the line with the figure removed, and it gets
`trimToWords`, not `slice` — see below.

## Cutting prose to length

`slice` is the reflex and it is wrong everywhere the result is read as words.
It put "…but the you picke" on screen under a scene, and cut the social caption
a creator pastes under their video the same way. `src/lib/text.ts` has
`trimToWords`: whole words, an ellipsis so the cut reads as deliberate, no
punctuation left hanging before it, and a mid-word break only for a single word
longer than the whole budget, where there is no earlier boundary to fall back
to.

Log lines and error bodies can keep using `slice` — nobody reads those as
prose. Anything a viewer or a creator sees cannot.

## Cuts on the beat

Every track in the music library carries a `bpm`, the asset stage has always
copied it onto the document, and for a long time nothing read it.
`src/lib/edl/beat-sync.ts` is what it was for.

Only the layers that sit ON TOP of the speech move — a B-roll insert arriving, a
graphic appearing. Those are free to land a frame or two either side of where
the director put them, because what they illustrate is a whole sentence.
Anything tied to a syllable stays exactly where it is: an icon card rises on the
word it names and a caption IS the word, so a grid would break the one
relationship that makes them work. The speech segments are the edit and are not
touched at all.

Three things this has to get right:

- **The grid is offset by `startAtSec`.** The bed is trimmed from there and laid
  at video zero, so a track entered part-way through a bar arrives part-way
  through a bar. Assuming video zero is a beat is the obvious mistake and puts
  every "aligned" cue a fraction of a beat out — worse than not aligning.
- **The nudge is small, and capped twice.** A quarter beat keeps it musically
  small at any tempo; 0.15s keeps it imperceptible at slow ones, where a quarter
  beat is nearly a third of a second. Measured across 90–160bpm this moves about
  45% of inserts by at most four frames; the rest stay where the director put
  them, which is the right answer for those. The point is to remove a wrongness,
  not to impose a rhythm.
- **A clip slides, it does not stretch.** Moving the start and leaving the end
  changes how long the viewer looks at it, which is a different decision.

A move is abandoned when it would collide or overrun, and the collision check is
against where the neighbours STILL are rather than where they are going — two
clips nudging toward each other would otherwise each see a gap the other is
about to vacate.

It runs in the asset stage, not the builder, and it has to: the builder runs
before a track is chosen, so `music` is null and the BPM does not exist yet.

## `transform` — one thing becoming another

Two photographs with an arrow between them. The seventh scene kind, and the
first one that puts a PHOTOGRAPH on screen rather than drawing an idea.

**Why photographs.** Every other kind draws a concept — a path, a ring, a
figure — and an icon is the right weight for that. This one makes a claim about
the world: a seedling turns into a tree, raw footage turns into a cut video.
The evidence for a claim like that is a picture of the thing, and two line icons
either side of an arrow reads as a diagram of a process rather than the before
and after it is. `photoUrls` sits parallel to `items` the way `iconSvgs` does,
and holds URLs rather than inlined markup because these are raster and `<Img>`
decodes those fine — it is only the SVG icons that cannot be loaded that way.

**The order is the animation.** Both panels arriving together is a comparison.
One, then the arrow reaching across, then the other is a SEQUENCE, and the
sequence is what says the left thing caused the right one. The timing is the
sentence, not decoration.

**Detection is narrow on purpose.** `transformPair` takes "becomes", "turns
into", "grows into", "from X to Y" and a few siblings — verbs that genuinely
mean transformation. Something looser like "and then" would catch every
sequential sentence in the video. Two further refusals matter as much:

- **Both sides have to be things you could photograph.** "Doubt becomes
  confidence" is a real sentence and a terrible pair of stock searches — the
  library answers anyway, with a mood.
- **A trailing clause is normal speech, not a different sentence.** "A seedling
  becomes a banana tree IN ABOUT NINE MONTHS" is the same transformation.
  Anchoring the match to the end missed every one that said how long it took,
  and the leftover clause then went to the figure matcher, so the sentence came
  out as a scene about the number nine.

It is checked ahead of the list detector, which otherwise sees the two nouns
either side of the verb and makes an orbit — and an orbit of two chips says the
things belong together, where the sentence claims one BECAME the other.

**No headline.** Every other kind takes one because its picture is a diagram
and a diagram needs saying what it is of. This one is already a claim — that
thing turned into this thing — so a line of type over it repeats the pictures
in words, and it costs the photographs the height they are the evidence in.
The renderer simply never draws one, and the director is told not to write one.

**Two layout traps, both found by rendering it.** Every size in a scene is
written in `unit`, a thousandth of the frame HEIGHT, so a look composes
identically in either aspect. That is exactly wrong here: this is the one scene
limited by room ACROSS, and sizing the panels in `unit` made them 576px each in
a frame 1080 wide. And clamping only the height turned them landscape in a
widescreen frame, because there was width to spare. So both limits are measured
as a width, the tighter wins, and the height follows from a fixed portrait
ratio.

The other trap is colour: the first version hardcoded near-white type on a 4%
white plate, which is right in `neon` and invisible in `studio`. Half these
worlds are LIGHT, and an empty panel is a normal state here — the photographs
are searched for and a search can come back empty — so the fallback colour is
the one that must never be wrong. It comes from the look's own style guide.

## The photo kinds, and the floor they rise from

Three kinds beyond `transform` that put PHOTOGRAPHS on the frame, and they
partition by COUNT so the director picks by counting rather than by taste:

| | |
|---|---|
| `photo-hero` | one picture, blurred behind itself and sharp in front |
| `photo-point` | one picture, one line of type beside it |
| `photo-row` | two or three pictures, side by side |
| `photo-grid` | four to six pictures, in reading order |

`photoSlotsFor(scene)` is the single place that says which kinds want pictures
and how many, and every caller takes it from there — the asset stage searches
for exactly that many, `sceneIsDrawn` refuses a drawing for anything above
zero. The alternative is the same list of kinds written out in three files,
which is how `transform` was wired and how the drawn-scene bug got in.

**Why a photograph and not an icon.** The other kinds explain a SHAPE — a
path, a ring, a figure — and a drawing is the right weight for a shape. These
point at things in the world, and the evidence for a thing in the world is a
picture of it. Which is also the limit: both the prompt and this file say the
test out loud, because the failure is silent. *Could you point a camera at
each thing named?* A hiking boot, yes. "Confidence", no — and a stock library
answers anyway, with a model looking thoughtful, so nothing errors and the
video just gets worse.

**The entrance is the icon card's, which means a floor and not a fade.** Each
plate has a clip box reaching below where it lands, sits under it at full
size, and climbs out: 19 frames, quadratic out, no scale and no opacity. The
same three reflexes to refuse as the cards — a pop makes a photograph into a
sticker, an overshoot is a thing landing rather than rising, and fade plus
slide is a web animation. `riseProgress` moved to `remotion/lib/motion.ts` so
both can use the one measured curve.

The stagger is **seven** frames, not the four the looks use for chips. A chip
is one item in a set and the set is the point; each of these is a thing you
are meant to look at before the next one lands.

**A gap written in `unit` is not a gap.** `unit` is a thousandth of the frame
HEIGHT, so `unit * 34` between three plates is 65px against a 280px plate in a
vertical frame and 37px against a 573px one in widescreen — a quarter of a
plate in one shape and a fifteenth in the other. Solve for the PLATE first and
take the gap as a fraction of it. Same family as the `transform` trap: these
are the layouts limited by room across, and `unit` is the wrong ruler for
every one of them.

**Search in the shape the plate will crop to.** `photoOrientationFor` asks the
library for portrait where the plate is portrait and square where the cell is
square, because `cover` throws away the sides of a landscape photograph in a
portrait plate — and for a stock photo that is usually where the subject is.
It costs nothing and it is the difference between a tree and a trunk.

**An empty plate is a normal state, not a failure.** The search can miss, and
the editor shows the scene before anything has been fetched at all — including
when somebody switches a scene to a photo kind by hand, after the asset stage
has run. So the plate names its thing in type instead, and the caption that
would have sat under the picture is not drawn: one word on screen either way
rather than the same noun twice.

**`photo-hero` is the one that breaks the no-full-frame-filter rule, and it
is worth knowing why it is allowed to.** A single photograph has three
possible grounds: letterboxed on a flat colour, which leaves two dead bands;
cropped to fill, which throws away its sides, where a stock photo usually
keeps half its subject; or the same picture blurred up to full bleed, which
is guaranteed to agree with the card in front of it because it IS the card in
front of it. The third is right, and it needs a blur.

The house rule — no `filter` on anything full-frame — exists because an
effect repainted every frame is what made the editor stutter. Two things buy
this one its exemption, the same two that bought `bloom` its
`backdrop-filter` on an insert: it is on screen for seconds rather than for
the video, and once the radius stops changing the layer is rasterised once
and never again. Which is why the move and the blur are on two NESTED
elements rather than one: a transform on the same element re-runs the filter,
a transform on its parent moves a cached surface.

The one stretch where it is genuinely filtering is the first fourteen frames,
where the picture lands sharp and goes soft as the card climbs out of it.
That costs what a transition effect costs at a cut, and it is what makes the
two layers read as one picture rather than as a card on a background.

There is no scrim over the blur. The first version washed it with the look's
ground at 0.42 to give the card an edge, which is exactly the wrong fix: it
turns the back layer into a pale field with a photograph printed on it, so it
reads as a card on a BACKGROUND rather than as a picture on itself. The card's
edge comes from its shadow, the way it does in every edit that uses this — so
the shadow is what gets bigger, not the ground that gets lighter.

**The counts do not degrade into each other.** A `photo-row` of one is a
single picture adrift in a layout built for three; a `photo-grid` of two is a
grid with four holes in it. `sanitiseScenes` falls a wrong count back to
`kinetic-text`, the shape that always works, rather than to the neighbouring
photo kind.

## The surface a scene is printed on

`remotion/looks/surface.tsx`. `scene.backdrop` was a dead field for a long
time — the director picked one on every scene and not a single look read it,
so every scene in a look sat on that look's one ground. The surfaces are what
it now means.

**Texture here, tone from the look.** Every colour in `Surface` comes out of
`styleGuideFor(scene.look)`; none is written down. That is the whole design.
A backdrop that chose its own tone could put a dark surface inside a light
look, and then that look's ink — which is dark, because its ground is light —
lands on near-black and every title in the scene disappears. So the backdrop
picks the MATERIAL and the look picks the tone: `paper` is cream in `studio`
and charcoal in `neon`, and both of those are reachable, by choosing the look.
`surfaceTone(look)` is that decision on its own, so it can be checked against
every look without a renderer.

**Ink reads differently on each side.** The eye is reading a contrast ratio,
not an opacity, so one alpha tuned on white turns to mud on black and one
tuned on black is invisible on white. Hence two figures for the tooth and two
for the ruling rather than one each, and light marks on a dark ground rather
than the same dark marks turned up.

**It replaces the look's ground, it does not sit on it.** A background drawn
over a background is two backgrounds — the same mistake the drawn scenes
already document, and it reads as a panel floating on someone else's
wallpaper.

**None of it is an image.** Paper is normally a photograph of paper. Here it is
stacked CSS gradients, because a full-frame bitmap is a decode on every frame
of every scene while a video plays underneath. The tooth is two dot lattices at
different sizes and offsets: one lattice alone is a halftone, which is a
printing effect rather than a stock, and two that never line up give fibre the
eye cannot lock onto. The ruling makes every fifth line heavier the way squared
paper is printed — an even mesh with no hierarchy reads as a diagram overlay
instead of the page under one.

**`auto` is the default, and the default is not a surface.** A named surface on
every scene is a video of textures. `auto` hands the frame back to the look's
own ground, which is what most scenes want; the schema also `.catch`es its way
back to `auto`, because a model inventing a backdrop should cost a texture, not
a render.

## Seven ways to zoom in on somebody talking

A single-take talking head is one locked-off shot, and the punch-in is the
second camera that is not there — a zoom standing in for a cut to a tighter
lens. One curve for that is not enough: the move IS the punctuation, so a
video where every emphasis arrives the same way reads as one effect applied
eight times.

| | |
|---|---|
| `push` | a creep so slow you do not see it start. The long-form move |
| `ramp` | in, hold, out. The plain punch-in |
| `speed-ramp` | slow, then fast, then slow again. The modern push |
| `snap` | a crash zoom — four frames, and it lands like a hit |
| `bounce` | overshoots the mark and settles back into it |
| `handheld` | a push with an operator's drift on it |
| `pull` | starts tight and opens out. A reveal, not an emphasis |

**What distinguishes them is where the TIME goes**, far more than how far the
camera travels — which is why they are all written as windows into the one
`ramp(from, to)` the renderers already hand in. The export and the editor
preview need no idea the vocabulary grew, and cannot drift apart as it does.

**Every move ends back at 1, and that is not a style choice.** A punch-in is a
window on a continuous shot, so a scale that is not 1 at `outEndSec` pops back
to the un-punched framing on the very next frame, in the middle of a sentence.
Even `push`, whose whole character is that it never settles, releases over its
last stretch — which is what an operator does anyway when the line lands.

**Two bugs that a still could never have shown, both found by a test that
measured the curve:**

- **`push` was eased out**, like everything else in this renderer. An ease-out
  puts two thirds of the travel in the first third of the time, which is a
  punch-in that then coasts — the exact opposite of a creep. It is the one
  place here where a LINEAR ramp is right: a constant rate is what makes the
  move impossible to notice.
- **`bounce` had its overshoot clipped off exactly.** Every other move takes
  `min(enter, exit)`, which is right when both curves run 0→1. This one goes
  ABOVE 1 — that is the move — so a `min` against an `exit` sitting at 1
  through the hold produced a slightly fast ramp and nothing in the code
  looked wrong. It multiplies instead.

**`easeInOutQuint` is the only in-out curve in `motion.ts`**, and the house
rule against them still holds for everything that ARRIVES. A camera is the
physical exception: a zoom that starts at full speed is a cut and one that
stops dead is a jolt, where a real operator winds a lens up and lets it down.
Quintic rather than cubic because the point is a middle that is conspicuously
faster than the ends.

**The style names the moves, not the intensity.** Intensity already decides
how FAR the camera goes; letting it also pick the curve meant a documentary's
one emphatic line got a crash zoom, which is a different genre of video.
`PacingProfile.punchMoves` is a short list, cycled per punch-in exactly as
`clipTransitions` is, so consecutive punches differ inside one vocabulary and
the same footage re-cuts the same way. The split is by FORMAT rather than by
style, because what decides which moves work is how long the shot is: long
form holds on one face for minutes and leans on `push`, the only zoom you can
use eight times in twenty minutes without it becoming a tic; a sixty-second
vertical has no room for a ten-second creep, so there it is `speed-ramp` and
`snap`, which land. A move written twice in a list is weighted twice, because
cycling picks them in order.

**`easing` was the field name**, back when there were two curves and both were
easings. `push` and `handheld` are not easings of anything, so it is `move`
now — and `PunchInSchema` preprocesses the old key across, because dropping it
would silently flatten every punch-in in a saved project to the default.

**The editor offers two of them by name**, not a move picker on one generic
item: a quick zoom is punctuation on a line and a slow push is the shot
getting tighter over a paragraph, and the second one needs eight seconds to
disappear into. The move rides in on `clip.add`'s `value` — the field that
already carries a B-roll query and a sound's name — rather than as an add
followed by a patch, which would be two operations for one gesture and the
second would have to know the id the first invented.

And `move` has to be on the `clip.update` whitelist, or the picker looks like
it worked and the camera keeps doing the old thing.

    npx tsx scripts/zoom-clip.ts --wide        # all seven, labelled
    npx tsx scripts/zoom-clip.ts push,snap     # just these

A zoom is the one thing here that CANNOT be judged from a still: a push and a
snap at their tightest are the same frame. Give the strip six seconds a move —
at two and a half, `push` renders as a plain ramp, because a creep's whole
character is having more time than you are paying attention for.

## The frame has edges you cannot use

`src/lib/edl/safe-area.ts`. Two different things, worth keeping apart because
only one of them is about the video.

**Title safe** is the broadcast convention: anything that has to be READ stays
inside the middle 80%, anything that matters visually inside the middle 90%. It
comes from CRT overscan, which no panel does any more, and survives because
every delivery spec still enforces it and because type hard against an edge
looks wrong regardless. Two overlays were drawing at `left: 0.07` — inside the
margin, which is the one place type should never be.

**Player chrome** is not a convention, it is where the buttons are. A widescreen
video is watched inside a player that draws its scrubber and controls OVER the
bottom ~8% of the picture, on every hover. A vertical short has no equivalent
band — the feed apps put their UI over the sides and lower corners in a shape
that differs per app — so `hasPlayerChrome` reads the SHAPE and claims the band
only where it is known.

Two things followed from it:

- **The burned-in progress bar is short-form only.** It exists because a
  vertical feed has no scrubber, so drawing one buys real retention. In long
  form it is a second bar directly under YouTube's own, over the same pixels,
  covered the instant the controls fade in. Six of the ten long-form styles
  asked for one.
- **A row of icon cards rests on the control band, not on the frame.** Resting
  on its own 7% margin put the bottom edge at 0.93 — inside the strip
  guaranteed to be covered.

## Chapter cards are the long-form device

A section break is how somebody navigates twenty minutes, and the machinery was
already there: `plan.chapters` → a `chapter-card` overlay, title-safe at the top
left with an accent rule and a wipe. Three things were wrong with it.

It drew in SHORTS too. The rule-based director only emits chapters for long
form, but the schema the AI director answers against does not care, so the guard
belongs at placement.

And the card is one line by design — `whiteSpace: nowrap` is what stops a
heading stacking into a paragraph — with nothing bounding its width, so a long
title ran off the right of the frame. The director writes these and nothing
capped their length. Capped with `trimToWords` at the builder, with a
`maxWidth` and an ellipsis in the renderer as the backstop.

## Where things go depends on where the subject is

A talking head is framed centrally whatever the aspect, so a widescreen picture
has two empty columns beside them and a vertical one has none. `hasSideRoom`
reads that off the FRAME, not off the format, because it is a claim about the
subject's position rather than about which platform the video is for.

**Numbers go out to the margin in a wide frame.** `positionFor` used to return
`x: 0.5` for everything, which is right when the subject fills a vertical frame
and is a number sitting on the speaker's face when they do not. The compact
self-contained ones — stat, counter, progress ring, badge, bar chart — move to
`x: 0.79`. A list, a quote and a checklist do not: those are blocks of TEXT
whose line length is what makes them readable, and a third of the frame sets
them four words to a line. An underline has to stay with its word, and a title
card is the whole frame by definition.

A side-placed graphic also needs its width bounded by the room it actually has.
The box is centred on `x`, so a flat `maxWidth: width * 0.8` at `x: 0.79` runs
off the edge; doubling the smaller side is what keeps it inside wherever it is
put, and it still leaves a centred graphic the 80% it always had.

**How many cards there are decides where they go — the aspect only decides
whether the side exists at all.**

A full set of three is a GROUP, and a group belongs on the horizontal: side by
side, centred, rising out of the floor under the words, in either aspect. Three
across the middle is balanced, and stacking them in a column beside the subject
makes a list out of something that is not one.

One or two cards are not a group, and from the floor they look like a group that
failed to arrive — one on its own reads as something that happened rather than
something designed, and two read as a third that did not load. Those go out to
the side, where a single big card in an empty margin is deliberate-looking on
its own, and where it can be up to 0.30 of the short edge: the reference clip's
size, which the band under the captions had to give up to avoid competing with a
line of words. Short rows alternate left and right, counted over the rows that
actually take a side so a group in between does not eat a turn and leave two
singles stacked in the same margin.

Which leaves the case with nowhere to go: a vertical frame has no margin,
because the subject fills it. There a short row is dropped — that throws away
real cues, and it is the trade. The grouping window went from 2.5s to 5s so
three nouns in the same breath actually land in the same row.

`ICON_ROW_BELOW_COUNT` is therefore a hard count, not a maximum, and a row
carries its `side` on the cue rather than deriving it at paint time — for the
same reason `tone` does: somebody can move a row, and a rule recomputed from the
aspect would put it straight back.

**A side column is measured from the MIDDLE outwards, not from the edge in.** A
talking head takes up roughly the central 40% of a widescreen picture, so the
band that is both empty and still part of the composition is the one just
outside them — `ICON_SIDE_OFFSET` puts it at 0.22 and 0.78. Pinned to the edge
instead, the column drifted to 0.86 and read as something that had slid off the
frame rather than something placed beside the subject. It is deliberately not
further in: the face is at 0.5.

**A row leaves before anything takes the frame off it.** Each CARD was already
kept out of a B-roll insert or a scene, but the row outlives its last card by
`ICON_HOLD_SEC` and nothing checked where that hold ended — so a row whose cards
all landed in the clear sat on top of the shot that came next and held through
it. Clamp `outEndSec` to the start of the next insert or scene.

That last one is also the trap in the demo scripts, and it wastes an hour every
time. A card whose word is spoken while an insert, a scene or a graphic owns the
frame is dropped, correctly. So a fixture that scatters cues at round fractions
of the runtime lands them on the nouns about half the time and renders an empty
margin — which is indistinguishable from the column being broken until you go
and look. `long-clip.ts` finds the icon words first and places everything else
around them, and puts its three-noun breath at the END, because the builder's
animated scene sits near the top of the video.

## Long form is not short form scaled up

Everything above applies to both formats — there is no `mode` branch in the
transition code, the overlays, the icon row or the cue placement, and there
should not be. What differs is carried by data: every style has a `short` and a
`long` pacing profile, and the long one asks for roughly half the sfx density
and two to four times the gap between inserts.

Four things nearly broke on that, and none of them showed up in short form:

1. **A pacing interval of zero means NEVER, not "every instant."** Commentary,
   news, tutorial and essay all write `punchInEverySec: [0, 0]`, and the loop
   that read it stepped by the cadence — so `t` stopped advancing and the array
   grew until the heap died. Guard every `t += step` and every
   `Math.floor(x / interval)` against a zero interval. `tests/pacing-guards.test.ts`
   builds the whole catalogue, because a unit test on the guard passes while
   the styles stay broken.

2. **The sound density has to reach the transitions.** `transitionCues` put a
   sound on every move regardless of style, which gave a restrained long-form
   edit a short-form soundtrack. Cues now declare a tier — `move` (the frame
   travels or breaks) is never dropped, `soft` (zoom, burn, leak) goes below
   0.15, an icon `accent` below 0.30 — and `cuesForDensity` filters before
   `thinCues`, so the 120ms gap rule runs on what actually survives.

3. **Restraint must never mean silence.** The floors alone zeroed documentary
   long: every transition it uses is soft or silent, so the filter removed every
   sound in the video, which looks from outside like the feature was never
   built. When the floors take everything, the best tier present stays.

4. **A filter graph is one argument, and Linux caps one argument at 128KB.** A
   fifty-minute lecture cut on every pause builds a ~204KB graph, so `spawn`
   failed with E2BIG before ffmpeg was reached — on the plain concat as well as
   the J cut. Hand it over with `-filter_complex_script` instead.

The visual strips take `--wide`, and it is not a nicety. A transition travels a
distance proportional to the frame, so a slide crosses 1920px widescreen where
it crosses 1080 vertical and the duration clamp means those are not the same
animation at a different size. The grain's feature size is tied to the width and
the scanline pitch to the height. The icon row is width-limited in a wide frame
and height-limited in a tall one. None of it can be judged in the wrong shape:

    npx tsx scripts/transition-clip.ts --wide
    npx tsx scripts/broll-overlay.ts out/plates/real.png --wide
    npx tsx scripts/icon-clip.ts light 6 --wide
    npx tsx scripts/long-clip.ts documentary 42   # all layers at once, with sound

`long-clip.ts` is the one that answers what the others cannot: whether the
layers are right TOGETHER at 16:9. It goes through `buildEdl`, so what comes out
is what the pipeline would have made.

### The price on the tile is per insert, so it depends on the format

The B-roll source picker quotes what this video will cost, and the insert count
is the style's cut-away cadence against the length of the file: four for a
minute of `explainer`, seventy-five for ten minutes of `commentary`. The wizard
used to send one finished price computed from a hardcoded four inserts of two
and a half seconds, which under-quoted a long-form AI-video edit by more than an
order of magnitude — and by nearly three with a fast video model configured.

The server sends RATES (`brollSourceRates`) because only it knows which keys are
set and the billing catalogue belongs there; the browser multiplies, because
only it knows the file's length and the chosen style. Keep that split. The count
goes on the tile next to the price — without it a long-form quote reads as the
software having got the sum wrong.

## What an insert wears

Eleven treatments plus `none`, scoped to the B-roll clip, in two groups that
the pickers keep apart because it is the only split that helps somebody
choose:

- **Subtle** — `dust`, `grain`, `light-leak`, `scanlines`, `prism`, `vignette`.
  The video looks better and nobody notices a filter was applied.
- **Strong** — `bloom`, `bokeh`, `crt`, `vhs`, `super8`. Unmistakable, and
  every one of them a look somebody would actually choose: a diffusion filter,
  an old television, a worn tape, 8mm stock.

Chosen in three places: the style declares the default
(`StylePreset.brollOverlay`), the upload wizard overrides it for the video, and
the editor overrides it per clip — because it is a property of the SHOT as much
as of the look, and grain suits the archive photo where scanlines suit the
screen capture two inserts later.

**All three show the same pictures, from `components/broll/OverlaySwatch.tsx`.**
Briefly the wizard showed tiles and the editor showed a flat row of eleven
words, which is the same question answered two different ways in one product —
and the words are the half that does not work, because nobody can tell "prism"
from "bloom" without having watched them. One `OverlayGrid`, so a treatment
added to the list appears everywhere with no further work. The tile paints its
own stand-in photograph rather than loading an image, so the pickers ship no
assets and cannot show a broken thumbnail.

**A treated insert wears its swatch on the timeline**, bottom-left, opening the
same grid as a menu. Bottom-left because the two top corners belong to the
transition badges, and an edge is a different kind of property from a surface:
those are about the clip's two ENDS, this is about all of it. Drawn only when
there is something to show — an empty square on every untreated insert is noise
on a track that is mostly untreated. The menu flips above the swatch when there
is no room below, which there usually is not: the B-roll track sits low in a
docked timeline and the swatch is on a clip's bottom edge.

**Visible means TREATED, never replaced.** An earlier pass read "more extreme"
as "more destructive" and shipped datamosh, duotone and halftone — inverted
bands, a two-colour posterise, a print screen. All certainly visible, and all
things nobody puts on their own video, because each one throws the footage
away and the footage is what the insert is for. They are gone, and a test pins
them gone by name: the only thing that stops a judgement call recurring is
writing it down somewhere that fails.

**Nothing flashes.** A hard strobe is the obvious way to make an overlay
unmissable and it is a photosensitivity risk. `super8`'s gate flicker is a few
per cent of exposure at about four hertz, which is the film tell and nowhere
near the threshold.

**`overlay` parses with `.catch('none')`.** The set gets tuned, and a stored
document naming a treatment that no longer exists must degrade to an untreated
insert rather than failing — a whole project that will not open because a
treatment was renamed is not a trade worth making for stricter typing.

**What makes each screen look read as itself**, since three of the five are
screens and they must not blur together:

- `crt` is the GLASS, not the lines. Radiused corners the picture stops short
  of, an aperture grille (vertical RGB stripes) under the horizontal scan, and
  phosphor bloom. The mask does more than any amount of line work.
- `vhs` is a worn tape, not a broken one — the first version had five tracking
  tears jumping 9% of the width every third frame, which is a cassette the
  machine has given up on. The look lives in the chroma smear (to the RIGHT of
  an edge only, because that is the direction the subcarrier lags) and the
  head-switch hash along the very bottom; the tearing is punctuation.
- `bloom` is the only one that reads the picture: `backdrop-filter` is the one
  CSS property that can see what is UNDER a layer, so the halation is the
  shot's own highlights spreading rather than a glow painted on.

**Blend modes are the only door to the picture**, because the overlay is a
SIBLING of the image and not a filter on it — it has no source pixels.
`screen` adds light, `soft-light` grades, `multiply` darkens, and
`backdrop-filter` reads. They cost more per frame than a plain layer — a blend
forces a readback — which is affordable for a 2.5s insert and would not be for
a whole video.

**A resolved `accent` lives on the clip.** Nothing reads it since duotone was
dropped, and it stays because the next recolouring treatment will — reaching across to `src/lib/styles/presets.ts` for it cost a build: that module
uses `@/` imports, Remotion's webpack carries no such alias, and the bundle
simply failed. The composition draws the document and never imports the style
presets — that is the rule, and this is the second time it has been learned.

**Drawn, never a plate.** The industry way is a library of 4K ProRes overlays
screen-blended over the picture: gigabytes to store and serve, a licence each,
a fixed length that has to be looped into a 2.4-second insert, and a look
nobody can adjust afterwards. Drawn from the clip's seed they cost nothing,
they are exactly as long as the insert, they scale to any aspect, and their
strength is a number.

**Inside the clip's frame, under the transition effect.** Over the B-roll and
not over the speaker is an EDIT; over both is a filter, and `Overlays` is where
a filter on the whole video belongs. Under the transition because a glitch
tears the shot, and a shot with grain on it should tear with its grain —
painting the grain after the tear puts a clean layer on top of the damage.

Three things this got wrong on the first pass, all invisible in the diff and
obvious in a render:

- **Grain is not a sparse field of dots.** Copying the full-frame layer's 220
  drawn circles gave one speck per nine thousand pixels at 1080×1920 — invisible
  at native resolution and gone entirely on a phone. Grain is a property of
  every pixel, and `feTurbulence` says that in one primitive. `fractalNoise`,
  not `turbulence`: the latter takes the absolute value, which biases dark and
  clumps into smoke.
- **Every frequency and size scales off the frame.** A fixed `baseFrequency`
  gives a 4K export four times finer grain than a 1080 one, which is exactly
  the bug where an effect tuned in preview vanishes in the export.
- **Everything was too weak to see.** Judged on flat colour plates first, which
  proved nothing — they have no highlights for a leak to bloom in and no
  texture for grain to sit on. Use a photograph.

A permanent split-screen slot gets `none`: that is not an insert, it is the
other half of the video for four minutes.

    npx tsx scripts/broll-overlay.ts out/plates/real.png        # all six
    npx tsx scripts/broll-overlay.ts out/plates/real.png dust   # just one

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
