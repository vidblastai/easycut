# EasyCut AI — Architecture

> Upload talking-head footage → get a finished, postable video.
> No editing knowledge required. Fast. Under $1 / short, under $5 / long-form.

---

## 1. The core idea

Every automated editor that tries to "render with AI" is slow and expensive.
EasyCut inverts it: **AI writes an edit plan, deterministic renderers execute it.**

```
footage ──► analyse (cheap, fast) ──► EDL (JSON) ──► render (deterministic) ──► MP4
                    ▲                    │
                    └──── user tweaks ───┘   (re-render from EDL, no re-analysis)
```

The **EDL (Edit Decision List)** is the spine of the whole product. It is a plain
JSON document that fully describes the finished video: which slices of source
footage survive, where every caption word lands, every B-roll insert, every icon
animation, every whoosh, the music bed, the crop path for vertical reframing.

Consequences that matter:

| Property | Why the EDL gives it to us |
| --- | --- |
| **Cheap** | AI is only ever asked to produce ~4 KB of JSON, never pixels. |
| **Fast** | Analysis is ~10 s. Rendering is parallel and deterministic. |
| **Tweakable** | "More B-roll", "different music" = patch JSON + re-render. No re-analysis, no re-upload. |
| **Debuggable** | Every output is explained by a diffable artifact. |
| **Portable** | Same EDL renders 9:16, 1:1 and 16:9 without re-thinking the edit. |

---

## 2. Pipeline

Twelve stages. Stages 3–7 are the "brain", 8–11 are the "hands".

```
 1. INGEST        upload → object storage → ffprobe → normalised proxy (540p) 
 2. TRANSCRIBE    word-level timestamps + filler-word flags + speaker turns
 3. SILENCE       acoustic + transcript-gap analysis → dead-air map
 4. CLEANUP       filler words, false starts, repeated takes, stammers → cut list
 5. DIRECT        LLM "director" → hook, structure, B-roll cues, graphics, SFX, emphasis
 6. TIMELINE      cut list + director plan → TimeMapper → segment list (source→output)
 7. REFRAME       face track → smoothed crop keyframes (only if aspect changes)
 8. ASSETS        B-roll fetch, icon/image generation, music pick, SFX pick (parallel)
 9. EDL           assemble + validate the final document
10. RENDER        Remotion composition → frames → MP4 (+ audio mix via ffmpeg)
11. DELIVER       thumbnail, caption text, hashtags, platform variants
12. FEEDBACK      user tweaks → EDL patch → re-render only what changed
```

Full detail per stage: [`PIPELINE.md`](./PIPELINE.md).

---

## 3. The two input modes

The user picks one thing on upload (and we auto-detect a suggestion for them).

### `raw` — completely unedited footage
The camera ran the whole time. There are pauses, "umm", restarts, the bit where
they walked back to the tripod.

Stages 3 + 4 run at full strength:
- **Dead air** removed with an attack/release envelope so cuts breathe.
- **Filler words** (`um`, `uh`, `like`, `you know`) removed when they sit alone in
  a gap — never when they're load-bearing inside a sentence.
- **Repeated takes** detected by fuzzy-matching consecutive sentences. When
  someone says the same line three times, we keep the **last** one (people retry
  until they get it right) unless the last is truncated.
- **False starts** — a clause abandoned mid-way and restarted — dropped.

### `roughcut` — already trimmed
The user cut their own fails and pauses. We do **not** re-cut their edit.
Stages 3+4 downgrade to a light "micro-tighten" (only >600 ms of true silence,
no sentence-level surgery), and all the effort goes into the enhancement layers.

Auto-detection: measure silence density. >12 % dead air ⇒ suggest `raw`.

---

## 4. Short-form vs long-form

Not a resolution switch — a **different edit grammar**.

| | Short (≤90 s, 9:16) | Long (≤10 min, 16:9) |
| --- | --- | --- |
| Opening | Hook is **relocated** to frame 0 if the best line is buried | Cold open + title card |
| Pacing | Punch-in every 3–6 s, cut on every breath | Punch-in every 12–25 s |
| Captions | Full-screen, 2–4 words, word-pop, huge | Lower-third, line-by-line, restrained |
| B-roll | 1 insert per ~8 s, 1.5–3 s each | 1 insert per ~35 s, 3–6 s each |
| Graphics | Big animated icons/stats, 1 per ~10 s | Lower thirds, chapter cards, list builds |
| SFX | Dense (whoosh/pop on nearly every beat) | Sparse (section transitions only) |
| Music | Present, ducked −16 dB under speech | Present, ducked −20 dB, drops out in intense moments |
| Reframe | Face-tracked crop, mandatory | None (source is already wide) |
| Extras | Auto progress bar, loop-friendly ending | Chapters, end card |

Both grammars are expressed as **PacingProfiles** — plain data, not code paths.

---

## 5. Enhancement layers

| Layer | How it's produced | Cost |
| --- | --- | --- |
| **Captions** | Word timestamps from ASR, styled by preset, emphasis words chosen by the director | $0 (already have the transcript) |
| **B-roll** | Director emits a search query per cue → Pexels/Pixabay stock video, semantically reranked, cached | $0 (free APIs) |
| **Icons / graphics** | Two-tier: **Iconify** (200k free SVG icons, instant) for standard concepts; **Flux Schnell** image-gen only for bespoke visuals | $0 / ~$0.003 ea |
| **Animations** | Remotion spring/interpolate presets — code, not AI | $0 |
| **Transitions** | GPU-free shader-ish compositing in Remotion (whip pan, glitch, zoom, dissolve) | $0 |
| **SFX** | Curated bundled library, cue-matched by the director | $0 |
| **Music** | Curated royalty-free library, mood-matched, auto-ducked & beat-aligned to cuts | $0 |
| **Reframe** | Face detection on sampled frames → Kalman-smoothed crop path | $0 (local) |
| **Punch-ins** | Director marks emphasis beats → scale ramps | $0 |

**The expensive things are the ones we refuse to do:** no generative video, no
voice cloning, no frame-by-frame AI. The user brings the pixels; we bring the edit.

---

## 6. Rendering strategy

Rendering is where naive implementations burn money. We use a **three-track split**:

```
 ┌── VIDEO ─────────────────────────────────────────────────┐
 │  Remotion composition                                     │
 │   • <OffthreadVideo> slices of the source (no re-encode   │
 │     of untouched footage thanks to segment seeking)       │
 │   • caption / graphic / overlay / B-roll layers            │
 │   • reframe crop transform                                 │
 └───────────────────────────────────────────────────────────┘
 ┌── AUDIO ─────────────────────────────────────────────────┐
 │  ffmpeg filter graph, rendered in parallel with video:     │
 │   speech (concat + loudnorm −14 LUFS) ⊕ music (ducked via  │
 │   sidechaincompress) ⊕ SFX (adelay + amix)                 │
 └───────────────────────────────────────────────────────────┘
 ┌── MUX ────────────────────────────────────────────────────┐
 │  ffmpeg -c:v copy — instant                                │
 └───────────────────────────────────────────────────────────┘
```

Why it's fast: video frames and the audio mix are independent, so they run
concurrently; and the audio mix (the part with the most fiddly DSP) is essentially
free in ffmpeg.

Why it's cheap: Remotion Lambda fans out frame ranges across N workers. A 10-minute
1080p30 video at concurrency 60 finishes in ~2 minutes for roughly $0.40.

**Preview vs final.** The editor previews at 540p with `<Player>` — client-side,
zero render cost, instant scrubbing. A cloud render only happens when the user
hits Export. Tweaking is therefore free.

---

## 7. Cost per video

Measured against the two ceilings: **$1 / short**, **$5 / long-form**.

These are the numbers `npm run doctor` prints, priced against Remotion Lambda
and Claude Opus 5.

### 60-second short (1080×1920)
| Item | Cost |
| --- | --- |
| Transcription (Deepgram Nova-3) | $0.0065 |
| Director (Claude Opus 5, one window) | $0.0974 |
| Icons (Iconify) | $0.0000 |
| Generated image (1 × Flux Schnell) | $0.0030 |
| B-roll (Pexels / Pixabay) | $0.0000 |
| Music + SFX (bundled) | $0.0000 |
| Render (Remotion Lambda) | $0.0138 |
| Storage + egress (R2) | $0.0028 |
| **Total** | **$0.1234** |

Headroom against the $1 ceiling: **8.1×**.

### 10-minute long-form (1920×1080)
| Item | Cost |
| --- | --- |
| Transcription | $0.0559 |
| Director (5 windows, cached system prompt) | $0.4975 |
| Generated images (2 × Flux Schnell) | $0.0060 |
| Render (Remotion Lambda) | $0.1500 |
| Storage + egress | $0.0259 |
| **Total** | **$0.7354** |

Headroom against the $5 ceiling: **6.8×**.

The director is the dominant line in both, which is the one dial worth knowing
about: `LLM_MODEL=claude-sonnet-5` cuts it by roughly 60 % and takes a short
under $0.07. Full derivation and every lever: [`COST_MODEL.md`](./COST_MODEL.md).

---

## 8. Speed budget

Target: **short in under 90 s, long-form in under 6 min**, wall-clock from upload.

| Stage | 60 s short | 10 min long |
| --- | --- | --- |
| Upload (direct-to-storage, parallel parts) | 6 s | 45 s |
| Probe + proxy extraction | 3 s | 20 s |
| Transcribe | 4 s | 25 s |
| Silence + cleanup | <1 s | 3 s |
| Director LLM | 8 s | 35 s (parallel chunks) |
| Reframe face track | 5 s | — |
| Assets (all parallel) | 6 s | 20 s |
| Render | 35 s | 150 s |
| Mux + thumbnail | 4 s | 15 s |
| **Total** | **≈ 72 s** | **≈ 5 m 13 s** |

Levers: transcription starts while upload is still finishing (chunked), asset
fetching is fully parallel, and the director runs on the transcript, not the video.

---

## 9. System map

```
                      ┌────────────────────────┐
  browser ───────────►│  Next.js (App Router)  │
   • marketing        │  • pages + API routes  │
   • dashboard        │  • Remotion <Player>   │
   • editor           └───────────┬────────────┘
                                  │ enqueue
                      ┌───────────▼────────────┐
                      │   Job queue            │  memory driver (dev)
                      │   (pluggable driver)   │  Redis/BullMQ (prod)
                      └───────────┬────────────┘
                                  │
                      ┌───────────▼────────────┐
                      │   Pipeline worker      │
                      │   12 stages, resumable │
                      └───┬───────┬────────┬───┘
                          │       │        │
              ┌───────────▼─┐ ┌───▼─────┐ ┌▼──────────────┐
              │ Providers   │ │ Storage │ │ Renderer      │
              │ ASR / LLM   │ │ local   │ │ Remotion      │
              │ stock / gen │ │ or S3   │ │ local or λ    │
              └─────────────┘ └─────────┘ └───────────────┘
                                  │
                      ┌───────────▼────────────┐
                      │   Postgres (Prisma)    │
                      │   projects, jobs, EDLs │
                      └────────────────────────┘
```

Every external dependency sits behind an adapter interface with a working
**stub implementation**, so the entire pipeline runs end-to-end with zero API
keys configured. Adding a key upgrades a stage from stub to real.

---

## 10. Data model

```
User ──< Project ──< Asset          (source uploads, proxies, renders)
             │
             ├──< Job              (pipeline run, stage-by-stage status)
             ├──< Edl              (versioned; every tweak creates a new version)
             └──< Render           (one per export; aspect + resolution variant)
```

`Edl` being versioned is what makes undo, A/B variants and "regenerate just the
B-roll" trivial: they are all just new rows pointing at the same source asset.

---

## 11. Failure posture

Nothing in the pipeline is allowed to fail the whole job:

- **ASR down** → fall back to the secondary provider, then to a silence-only edit
  with no captions rather than nothing.
- **Director LLM returns malformed JSON** → schema-repair pass, then a
  deterministic rule-based director (hook = first strong sentence, B-roll on
  noun-dense spans).
- **Stock API empty** → generated image; generation down → solid-colour motion card.
- **Render worker dies** → frame ranges are idempotent, resume from the last chunk.

The user-visible contract is that **you always get a finished video**; degraded
runs simply have fewer layers, and we tell the user which layer was skipped.
