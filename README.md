<div align="center">

# EasyCut AI

## Run it

```bash
bash start.sh
```

Installs what is missing, asks for three free API keys the first time, and opens
http://localhost:3000. Safe to run again.

Needs Node 20 or newer. ffmpeg comes from npm — nothing to install by hand.

**On Windows**, `start.sh` needs a bash — right-click the folder and pick
"Git Bash here" (it comes with [Git for Windows](https://git-scm.com/download/win)).
Or skip it and use the two cross-platform commands instead:

```
npm run setup       # installs, builds the database, fetches fonts and music
npm run start:all   # web server and worker together
```

Everything else is the same. The binaries ffmpeg, ffprobe and the headless
browser all come from npm, so there is nothing to install by hand there either.

**Want to see a finished video before signing up for anything?**

```bash
npm run db:seed
```

Builds sample footage, runs the real pipeline over a written transcript, renders
a real MP4, and leaves it on the dashboard. No keys, no network. Nothing is faked
at the boundary — the EDL comes out of the same builder a paying job uses. The one
substitution is the transcript, and it is opt-in by name: `ASR_PROVIDER=fixture`
plus an explicit `ASR_FIXTURE` path, because a transcriber that could quietly
swap prepared words for someone's real speech must not be something you can fall
into.

To put it online instead, see [docs/DEPLOY.md](docs/DEPLOY.md).


**Upload your footage. Get a finished video.**

Talking-head footage goes in. A postable video comes out — cut, captioned,
with B-roll, motion graphics, sound design, music and the right crop for
wherever it's going.

No timeline. No keyframes. No editing knowledge of any kind.

</div>

---

## The idea

Every automated editor that tries to "render with AI" is slow and expensive.
EasyCut inverts it: **the AI writes an edit plan, deterministic renderers
execute it.**

```
footage ──► analyse (cheap, fast) ──► EDL (JSON) ──► render ──► MP4
                    ▲                    │
                    └──── user tweaks ───┘   re-render, no re-analysis
```

That one decision is where everything else comes from. The AI is never asked to
produce pixels — only ~4 KB of JSON describing which slices of footage survive,
where every caption word lands, every B-roll insert, every whoosh, the crop path
for vertical reframing. So it is cheap ($0.12 a short), fast (~90 seconds), and
every tweak afterwards is free.

**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — the full design
**[docs/PIPELINE.md](docs/PIPELINE.md)** — all twelve stages, and why each is careful
**[docs/COST_MODEL.md](docs/COST_MODEL.md)** — where every cent goes
**[docs/API_KEYS.md](docs/API_KEYS.md)** — what to sign up for, in priority order

---

## Quick start

```bash
npm install
npm run setup     # database, sound effects, caption fonts, music beds, system check

npm run dev       # the web app      → http://localhost:3000
npm run worker    # the pipeline     (needs to be running for edits to happen)
```

**No API keys needed to start.** The whole pipeline runs keyless and produces a
real MP4 — silence-based cuts, rule-based structure, subject tracking,
synthesised sound design. Adding a key upgrades a stage in place; `npm run
doctor` tells you exactly what each missing one would add.

Want to see it work without filming yourself?

```bash
npx tsx scripts/make-fixture.ts out/fixture.mp4 20   # synthetic talking head
npx tsx scripts/smoke.ts out/fixture.mp4 short punchy
```

---

## What it does

You make three choices. Everything else is inferred.

**1 · How finished is the footage?**

- **Completely raw** — dead air, `um`s, false starts and the takes you redid all
  come out. Retake detection keeps the *last* attempt, because people retry
  until they get it right.
- **Already trimmed** — we treat your cut as intentional and only add layers.

**2 · Short or long?** Not a resolution switch — a different edit grammar.

| | Short (≤90 s, 9:16) | Long (≤10 min, 16:9) |
| --- | --- | --- |
| Opening | Hook **relocated** to frame 0 if the best line is buried | Cold open + title card |
| Pacing | Punch-in every 3–6 s | Every 12–25 s |
| Captions | Full-screen, 2–4 words, word-pop | Lower-third, restrained |
| B-roll | 1 per ~8 s | 1 per ~35 s |
| Sound | Dense | Section transitions only |
| Framing | Face-tracked vertical crop | Unchanged |

**3 · Which look?** Clean, Punchy, Documentary, Explainer, Podcast or Vlog —
each a different pacing profile, transition palette and sound design density.
Switch after the edit and re-render for free.

### Captions are their own decision

Most short-form is watched with the sound off, which makes the captions the
video. So the typography is not welded to the pacing: an edit style *names* a
caption look, and you can change it without touching anything else. "That
energy, quieter type" is a thing people want, and it used to be unsayable.

**Sixteen finished looks** across four families — quiet, punchy, loud,
editorial — each a complete style rather than a variation on one. **Sixteen
typefaces**, curated against three tests most faces fail: survives being small
on a phone over moving footage, has a real 700–900 weight, and is actually
distinct from its neighbours here. Then font, weight, size, position, colour,
highlight colour, alignment, caps, outline, plate, shadow and nine motion
treatments on top.

The picker previews each look **at the video's real scale**, drawn by the
renderer's own paint module (`src/lib/captions/paint.ts`) — the preview and the
render share one implementation precisely so a look cannot be advertised as one
thing and exported as another. Every caption change replays cached analysis: no
transcription, no AI call, no re-upload.

### The layers it adds

| Layer | How | Cost |
| --- | --- | --- |
| **Captions** | Word timestamps, animated, with emphasis words picked out | $0 |
| **B-roll** | Stock footage matched to concrete nouns you actually said | $0 |
| **Graphics** | Numbers → stat cards, lists → builds, concepts → animated icons | $0 |
| **Sound design** | Whooshes on cuts, pops on graphics — synthesised, not licensed | $0 |
| **Music** | Mood-matched bed, sidechain-ducked under your voice | $0 |
| **Transitions** | Whip pans, zoom punches, glitches — only on real cuts | $0 |
| **Reframing** | Subject-tracked crop so you never lose your head going vertical | $0 |
| **Punch-ins** | The second camera you never had | $0 |

The music is six beds synthesised by `npm run music` from the recipes in
`src/lib/assets/music-beds.ts` — royalty-free by construction, licence-auditable,
and tuned for the one job a bed has: sitting under a voice for ten minutes
without competing with it. They are scooped at 1.9 kHz where consonants live, and
they loop seamlessly because every pitch is snapped to a whole number of cycles
per loop. Drop real licensed tracks into `content/music/manifest.json` and they
take precedence by matching better, not by being special-cased.

The expensive things are the ones it refuses to do: no generative video, no
voice cloning, no frame-by-frame AI. You bring the pixels; it brings the edit.

---

## Cost

Measured, not estimated — `npm run doctor` prints these for your config.

| | 60-second short | 10-minute long-form |
| --- | --- | --- |
| Transcription | $0.0065 | $0.0559 |
| AI director | $0.0974 | $0.4975 |
| Generated images | $0.0030 | $0.0060 |
| Render | $0.0138 | $0.1500 |
| Storage + egress | $0.0028 | $0.0259 |
| **Total** | **$0.12** | **$0.74** |
| Budget | $1.00 | $5.00 |
| Headroom | 8.1× | 6.8× |

The ceilings are enforced in code, not hoped for. A job projected to overrun
**degrades** — dropping generated images, then B-roll, then resolution — rather
than overspending. Captions are never on that list at any budget.

---

## Speed

Analysis is measured. The Lambda render is modelled from its per-frame cost; the
local render is measured, because that is what you get before you configure
anything.

| Stage | 60 s short | 10 min long |
| --- | --- | --- |
| Upload → probe → proxy | 9 s | 65 s |
| Transcribe | 4 s | 25 s |
| Analysis (silence, cleanup, director) | 9 s | 38 s |
| Reframe + assets | 11 s | 20 s |
| Render (Lambda) | 35 s | 150 s |
| **Total** | **~72 s** | **~5 min** |

**Rendering on your own machine instead.** A real ten-minute edit — 75 segments,
301 captions, 47 sound cues, 1080p — took **27 minutes** on four cores, at 9.4
rendered frames per second, end to end including the 51-second analysis. A
sixty-second short is about a hundred seconds. `npm run bench:render` measures
your machine rather than trusting this table.

That number used to be 111 minutes. Remotion's Linux default puts a software
OpenGL stack (SwANGLE) under the headless browser, which for video, text and
boxes means a hardware emulator sitting between Skia and a bitmap Skia can
already write. Turning it off is 4.1×, and is now the default — see `RENDER_GL`.

---

## Editing after the fact is free

Transcription and the director are the only stages that cost money, and both
outputs are cached on the project. So all of this replays the deterministic half
of the pipeline and costs one render:

- change the style, change the caption look, turn any layer off
- shuffle the music, delete a clip
- export 1:1 and 16:9 alongside the 9:16
- **cut a short out of a long-form video you already made**

Every change writes a new EDL version, so the history is a free undo stack.

### And when you want the controls, they're there

"You never have to open a timeline" is a promise about the default, not a
refusal. Switch the editor to **Fine-tune** and you get a real multi-track
timeline over the AI's cut:

- drag clips to move them, drag their edges to trim, **S** splits at the playhead
- tracks for video, captions, B-roll, graphics, punch-ins and sound
- retype any caption, click a word to emphasise it, re-word a B-roll search,
  change a sound effect, set a clip's speed
- snapping to cuts, caption boundaries and the playhead
- undo/redo, and nothing re-renders until you hit Apply

Every gesture is an operation on the EDL, which is what makes the hard part
correct: trim four seconds out of clip one and every caption, insert, graphic
and sound cue after it moves by exactly four seconds, because each is
re-anchored through its source timestamp rather than nudged. Cues belonging to
footage you deleted are dropped rather than left pointing at words nobody said.

---

## Stack

```
Next.js 15 + React 19 + Tailwind     web app, API, editor
Remotion                             the video renderer
ffmpeg                               cutting, audio mix, probing
Prisma + SQLite / Postgres           projects, jobs, versioned EDLs
Deepgram / Groq / AssemblyAI         transcription   (pluggable, auto-failover)
Claude                               the AI director  (falls back to rules)
Pexels / Pixabay / Iconify / Flux    B-roll, icons, illustrations
```

Every external dependency sits behind an adapter with a working fallback, so the
system runs with zero keys and degrades honestly rather than failing.

```
src/lib/edl/          the EDL schema — the spine of everything
src/lib/timeline/     time mapping, silence detection, cleanup
src/lib/director/     the LLM director, prompt, and rule-based fallback
src/lib/pipeline/     the twelve stages, and rebuild-from-cache
src/lib/reframe/      subject tracking and crop smoothing
src/lib/render/       Remotion drivers, local and Lambda
remotion/             the composition: captions, graphics, overlays, transitions
```

---

## Commands

```bash
npm run dev              # web app
npm run worker           # pipeline worker
npm run doctor           # what's configured, and what each video will cost
npm run fonts            # put the caption typefaces on disk (no CDN at render time)
npm run music            # synthesise the music beds
npm run bench:render     # frames per second on this machine
npm test                 # 133 tests across the logic that would silently corrupt output
npm run remotion:studio  # iterate on the renderer's look
npm run build
```

---

## Status

The pipeline, renderer, web app, editor and cost guard are implemented and
tested end to end. `scripts/smoke.ts` takes a real file through every stage and
asserts the output's dimensions, duration and audio track.

Not yet built: authentication, billing, and a hosted deployment. See
[docs/API_KEYS.md](docs/API_KEYS.md) for what to configure before putting this
in front of users.
