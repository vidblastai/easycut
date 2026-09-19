# Where the time goes

Measured, on a four-core container, against a real ten-minute 1080p edit
(`out/long.mp4`, 507s of output, 75 segments, 301 captions). Every number below
came out of the actual renderer, not a model. Re-run any of it with
`npm run bench:render`.

The reason this file exists is that three of the obvious optimisations are
worth nothing, and knowing which three saves someone a day.

---

## The headline

| | time |
| --- | --- |
| Analysis (probe, transcribe, cut, direct, plan) | **37s** |
| Render | **~30 min** |

Everything is the render. Analysis is 2% of the wait even before any provider
key is configured, and with real providers it is still minutes against half an
hour.

---

## What a rendered frame costs

| | fps | per frame |
| --- | --- | --- |
| Blank frame, nothing drawn | 19.6 | 51 ms |
| The speaker, no layers | 9.6 | 104 ms |
| The finished edit | 8.3 | 121 ms |

**87% of a render is the video track** — decoding a frame of the source and
painting it. Captions, graphics, overlays, transitions and punch-ins together
are 13%. So optimising the React components is not where the time is, and the
floor (51 ms for a blank frame, which is Chromium's screenshot and JPEG encode)
is most of what is left.

## Things that do not help

Each of these sounds like it should, and each was measured:

| | result |
| --- | --- |
| `imageFormat: 'jpeg'` | 8.49 vs 8.45 fps — it is already the default |
| `x264Preset: 'faster'` | 8.12 fps — **slower**; encoding is not the bottleneck |
| `offthreadVideoThreads: 4` / `8` | 8.35 / 8.41 fps |
| `hardwareAcceleration` | 8.65 fps, and there is no GPU to accelerate onto |
| Rendering at half size (`scale: 0.5`) | 11.4 fps — only **1.46×**, and it plateaus below that |

That last one is worth dwelling on, because "ship a fast low-res preview first"
is the obvious product answer and the numbers do not support it: a quarter of
the pixels buys less than half the time, because the cost is per frame, not per
pixel.

## Things that did help, already taken

| | |
| --- | --- |
| Not passing a GL flag (was `swangle`) | **4.1×** — 2.29 → 9.37 fps |
| Concurrency, 1 → 4 tabs | **1.93×** — 4.34 → 8.37 fps |

The concurrency curve is 4.34 / 7.02 / 8.05 / 8.37 fps for 1 / 2 / 3 / 4 tabs
on four cores: most of the win is the second tab and it is nearly flat by the
fourth. `RENDER_CONCURRENCY` overrides the default if a bigger machine has more
to give — untested above four cores.

## What is actually left

**Lambda.** ~2.5 minutes instead of ~27 for a ten-minute video, because the
work is embarrassingly parallel and fifty functions do it at once. That is the
only remaining order of magnitude, and it is a deployment decision rather than
a code one — see `docs/DEPLOY.md`.

---

## Re-rendering: the part that was worth fixing

A render is dominated by frames, so the question that matters is not "how fast
is a render" but "how many renders". Every edit in the timeline used to cost a
full one: retyping a word in a caption on a ten-minute talk redrew all fifteen
thousand frames, half an hour for a keystroke.

It now redraws the stretch that changed and copies the rest.

| | |
| --- | --- |
| 13s fixture, one caption edited (2.7s of 13.1s) | 39.7s → **12.7s**, 3.1× (measured) |
| 10-minute edit, one caption edited (~3s of 517s) | ~30 min → **~1 min** (projected) |

The second row is arithmetic, not a stopwatch: the change spans about 0.6% of
the frames, so what is left is the fixed cost — bundling the composition,
probing for keyframes, and the splice itself. The short fixture is the
measured one, and it understates the win badly, because three seconds of change
is a fifth of a thirteen-second video and a hundredth of a ten-minute one. The
longer the video, the bigger the saving.

Three pieces:

- **`src/lib/render/diff.ts`** decides what changed. It answers "all" unless it
  is certain, because being conservative costs a render that would have
  happened anyway and being clever ships a video with a seam in it. Anything
  touching the cuts, the format, the caption style, the framing track, the
  watermark or the audio is "all" by construction.
- **`src/lib/render/splice.ts`** does the joinery in frames rather than
  seconds, for reasons listed in that file: `-t` cuts land where they like,
  the concat demuxer eats a frame at every join unless told to renumber, and
  `-shortest` quietly truncates the video to the audio.
- **`renderVideo`** checks the frame count of the result against the original
  and falls back to a full render if it does not match. Every failure this can
  have is silent, so that check is the difference between an optimisation and
  a liability. It has already caught one: a tail copy that started at the
  keyframe *before* the one asked for and emitted 406 frames where 392 were
  wanted.

The audio is never re-cut or re-mixed — an incremental render only happens when
nothing audible changed, so the previous track carries over whole. That is a
saving in itself and it removes drift as a category.

Renders now also put a keyframe every second (`gopSize: fps`). Left to itself
x264 puts them where the picture changes, which on a talking head can be
nowhere for a minute at a time, and a stretch can only be copied up to a
keyframe.
