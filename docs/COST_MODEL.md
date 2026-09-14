# Cost model

The product promise is two hard numbers: **under $1 for a short, under $5 for a
long-form video**. This document is where those numbers come from, and what to
turn when they move.

Everything here is implemented in [`src/lib/pricing/cost.ts`](../src/lib/pricing/cost.ts)
and asserted in [`tests/cost.test.ts`](../tests/cost.test.ts) — the ceilings are
tested, not hoped for. `npm run doctor` prints the live figures for your
configuration.

---

## The shape of the bill

Only five things cost money, and two of them dominate:

```
 short (60s)                         long-form (10m)
 ─────────────────────────────       ───────────────────────────────
 director        $0.0974  79%        director        $0.4975   68%
 render          $0.0138  11%        render          $0.1500   20%
 transcription   $0.0065   5%        transcription   $0.0559    8%
 images          $0.0030   2%        storage         $0.0259    4%
 storage         $0.0028   2%        images          $0.0060    1%
 ─────────────────────────────       ───────────────────────────────
 TOTAL           $0.1234             TOTAL           $0.7354
 budget          $1.00               budget          $5.00
 headroom        8.1×                headroom        6.8×
```

Two observations shape every decision downstream:

1. **The AI is the expensive part, and it is only writing JSON.** Anything that
   makes the model produce pixels — generative video, per-frame anything — moves
   this line by two orders of magnitude and breaks the promise instantly.
2. **Rendering is cheaper than people assume**, because the AI never touches it.
   Deterministic compositing of a talking head is fast.

---

## Line by line

### Transcription — $0.0065 / $0.0559

Deepgram Nova-3 at **$0.0043 per minute** of audio.

We send 16 kHz mono PCM, which is what the model resamples to anyway, so the
upload for a 10-minute video is ~19 MB instead of ~1 GB. That is a latency
saving, not a cost one, but it is the difference between transcription taking
25 seconds and taking three minutes.

**Levers.** Groq's hosted Whisper large-v3-turbo is **$0.04/hour** — about 6×
cheaper — and roughly as fast. The reason it is not the default is that Whisper
discards disfluencies by design, so `um` and `uh` never appear in the transcript
and filler removal degrades to "cut the silence where the um was". On raw
footage that is a visible quality difference. On already-trimmed footage it is
not, so `ASR_PROVIDER=groq` is a reasonable setting for a rough-cut-only product.

### The director — $0.0974 / $0.4975

Claude Opus 5 at **$5 / $25 per MTok**. Short form is one call; long form is one
call per 3-minute window, run concurrently.

Three things keep this bounded:

- **The model reads sentences, not words.** Word-level timestamps would roughly
  triple the input tokens and buy nothing — cues get snapped to word boundaries
  by the EDL builder afterwards anyway.
- **The system prompt is cached.** It is byte-identical across every window and
  every job, so after the first call it bills at 10 % of input rate. On a
  10-minute video that is five windows sharing one cached ~1,200-token prefix.
- **Output is capped by the pacing profile.** The prompt asks for a cue budget
  derived from the style, so a 30-second video cannot come back with 40 B-roll
  cues.

**Levers, in order of how much they save:**

| Change | Effect on a short | Trade-off |
| --- | --- | --- |
| `LLM_MODEL=claude-sonnet-5` | $0.097 → $0.039 | Noticeably less taste in hook selection and B-roll queries |
| `LLM_EFFORT=low` | ~25 % less | Fewer, blunter cues |
| `LLM_MODEL=claude-haiku-4-5` | $0.097 → $0.019 | Usable for rough-cut mode; weak at hook selection |
| No key at all | $0 | The rule-based director takes over |

### Rendering — $0.0138 / $0.1500

Remotion Lambda at 2 GB: **$0.0000166667 per GB-second**.

The model is `frames / throughput × pixelFactor × GB × rate`. Measured
throughput for this composition is about **4 frames per second per worker**,
which matches what we see locally (360 frames of 1080×1920 in ~95 s on one
modest core with software GL).

The key property: **cost is proportional to total frames, not to worker count.**
Concurrency buys latency, not money. `RENDER_FRAMES_PER_LAMBDA=80` splits a
10-minute video across ~225 invocations that run in parallel; dropping it to 40
halves the wall-clock and costs the same, plus $0.00005 in extra invocations.

**Levers.** `RENDER_DRIVER=local` is free in dollars and roughly 8× slower.
720p instead of 1080p is 2.25× cheaper and nearly invisible on a phone — this is
what the budget guard reaches for when a job would otherwise overrun.

### Images — $0.0030 / $0.0060

Flux Schnell at **~$0.003 per image**, 4 steps, ~2 seconds.

The reason this line is negligible rather than significant is the two-tier
graphics system: **Iconify first** (200,000 open-source icons, free, keyless,
instant) and generation only for the one or two cues a year that genuinely need
a bespoke illustration. The director is told to use it sparingly and the
pipeline enforces a hard cap of 1 per short and 2 per long-form independently,
because a prompt-level limit is a suggestion and a code-level limit is a budget.

### B-roll, music and sound effects — $0.0000

- **B-roll**: Pexels and Pixabay are free and permit commercial use.
- **Music**: a local, licence-audited library. No per-track API.
- **Sound effects**: synthesised at setup from ffmpeg expressions
  ([`src/lib/assets/sfx.ts`](../src/lib/assets/sfx.ts)) — royalty-free by
  construction, a few hundred kilobytes, retunable by editing one line.

### Storage — $0.0028 / $0.0259

Cloudflare R2: **$0.015 per GB-month, $0 egress**.

Egress is the line that matters and the reason R2 rather than S3: every finished
video gets downloaded at least once, often several times, and on S3 that would
be roughly $0.09/GB. We keep sources for 30 days so users can re-cut without
re-uploading, which is most of this number.

---

## The budget guard

The ceiling is enforced before anything is spent. When a job is projected to
overrun, it does not fail — it **degrades**, dropping layers in a fixed order:

```
1. generated images      a viewer never notices these are missing
2. reframe precision     a coarser crop path
3. B-roll                noticeable, but the video still works
4. render resolution     1080p → 720p; 2.25× cheaper, near-invisible on a phone
```

Captions are not on the list at all, at any budget. They are the layer most
viewers actually consume — most social video is watched muted — so the video
would sooner ship at 720p with no B-roll than without them.

The order is a product decision, not an arithmetic one. See `DEGRADATION_ORDER`
in [`cost.ts`](../src/lib/pricing/cost.ts).

---

## What is genuinely free

Re-editing. Transcription and the director are the only paid stages, and both
outputs are cached on the project (`transcriptJson`, `directorPlanJson`). So all
of these replay the deterministic half of the pipeline and cost only a render:

- changing the style
- turning any layer off
- resizing captions or moving them up the frame
- shuffling the music
- deleting a clip
- exporting 1:1 and 16:9 alongside the 9:16
- **cutting a short out of a long-form video you already made**

That last one is the reason the cache exists. One upload, one analysis, every
platform.
