<div align="center">

# EasyCut AI

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
npm run setup     # database, sound-effect library, system check

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
each a different pacing profile, caption style, transition palette and sound
design density. Switch after the edit and re-render for free.

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

Design targets, from the per-stage budget in
[ARCHITECTURE.md](docs/ARCHITECTURE.md) — measured locally for analysis, modelled
for the cloud render.

| Stage | 60 s short | 10 min long |
| --- | --- | --- |
| Upload → probe → proxy | 9 s | 65 s |
| Transcribe | 4 s | 25 s |
| Analysis (silence, cleanup, director) | 9 s | 38 s |
| Reframe + assets | 11 s | 20 s |
| Render (Lambda) | 35 s | 150 s |
| **Total** | **~72 s** | **~5 min** |

---

## Editing after the fact is free

Transcription and the director are the only stages that cost money, and both
outputs are cached on the project. So all of this replays the deterministic half
of the pipeline and costs one render:

- change the style, turn any layer off, resize or move the captions
- shuffle the music, delete a clip
- export 1:1 and 16:9 alongside the 9:16
- **cut a short out of a long-form video you already made**

Every change writes a new EDL version, so the history is a free undo stack.

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
npm test                 # 55 tests across the logic that would silently corrupt output
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
