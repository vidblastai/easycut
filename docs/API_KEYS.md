# What to sign up for

**Nothing is required.** Clone the repo, run `npm run setup`, and the whole
pipeline works — silence-based cuts, rule-based structure, subject tracking,
synthesised sound design, a real rendered MP4. That exists so you can watch the
system work before spending anything.

But a keyless run has no captions and no creative judgement, which are the two
things that make the output look edited rather than merely trimmed. So here is
the honest order.

Run `npm run doctor` at any point to see exactly what is on and what each
missing key would add.

---

## Tier 1 — the two that change everything

Total to start: **$0**. Both are pay-as-you-go with free credit.

### 1. Deepgram — transcription

**This is the highest-value key in the product.** It buys captions, and captions
are what most social video is actually consumed through — the majority of
viewers watch muted. It also buys filler removal, because Deepgram is the only
provider at this price that returns `um` and `uh` as real tokens with
timestamps rather than silently discarding them.

- Sign up: **https://console.deepgram.com/signup**
- Free credit: **$200**, no card required
- Then: **$0.0043 per minute** — a 60-second video costs about half a cent
- Set: `DEEPGRAM_API_KEY`

*Alternatives, if you prefer:* [Groq](https://console.groq.com/keys) hosts
Whisper large-v3-turbo at **$0.04/hour** — about 6× cheaper and just as fast, but
Whisper discards disfluencies, so filler removal degrades to cutting the silence
where the `um` was. [AssemblyAI](https://www.assemblyai.com/dashboard/signup)
($0.12/hour) is the most accurate on accented English and noisy rooms, and the
slowest. Set any or all — the pipeline fails over between them automatically.

### 2. The AI director — Anthropic, or Gemini

This is the part that makes it feel like an editor rather than a script. It
picks the hook, decides what to cut for content reasons, chooses what each
B-roll insert should show, turns numbers into stat cards and lists into builds,
and marks the words worth emphasising.

Two providers are supported. They share the prompt, the plan schema and the
validation, so the only difference between them is the model — run the same
footage through both and judge it yourself. `LLM_PROVIDER=auto` (the default)
uses whichever key is set and prefers Anthropic when both are.

**Anthropic**

- Sign up: **https://console.anthropic.com/**
- Cost: **~$0.10 per short, ~$0.50 per 10-minute video** on Claude Opus 5
- Set: `ANTHROPIC_API_KEY`

*Cost lever:* `LLM_MODEL=claude-sonnet-5` cuts that by roughly 60 % and is
perfectly good for most footage. `LLM_EFFORT` (`low`/`medium`/`high`) trades
depth for speed; the default is `medium` because this path is latency-sensitive.

**Gemini** — free, with two real costs that are not money

- Sign up: **https://aistudio.google.com/apikey**
- Cost: **$0** on the free tier
- Set: `GEMINI_API_KEY`, optionally `GEMINI_MODEL` (default `gemini-3-flash`)

The first cost is your script. On Google's free tier prompts and responses may
be used to improve Google's products, and the prompt here is your entire
transcript — footage you have not published yet. `GEMINI_PAID_TIER=true` with a
linked billing account opts out of that; `npm run doctor` keeps printing the
warning until you do.

The second is throughput. The free tier allows a handful of requests a minute,
so long-form runs its 3-minute analysis windows one at a time instead of
concurrently — a 10-minute video takes minutes rather than seconds. For a 45-
second short it makes no practical difference.

Model ids move faster than this document. `npm run doctor` asks your key which
models it can actually reach and says whether `GEMINI_MODEL` is one of them —
a wrong id otherwise shows up as a director that silently falls back to the
rule-based editor.

---

## Tier 2 — the visual layers

Both free. Five minutes of signup for a visibly richer edit.

### 3. Pexels — B-roll

Free stock video, commercial use, no attribution required. This is what fills
the "illustrate what they just said" cues.

- Sign up: **https://www.pexels.com/api/** — instant, no card
- Cost: **free — there is no paid tier.** 200 requests/hour and 20,000/month by
  default, and Pexels will lift those free of charge if you ask and attribute
  properly. Photos and videos draw on the same quota.
- Set: `PEXELS_API_KEY`

One short spends two or three requests, so the hourly limit is the one you could
plausibly hit — by running ~70 videos in an hour, or by re-running a job in a
loop while debugging. The monthly one is not reachable at any sane volume.

Add [Pixabay](https://pixabay.com/api/docs/) too (`PIXABAY_API_KEY`, also free)
— the pipeline searches both and picks the better match, which meaningfully
improves hit rate on unusual queries.

### 4. Replicate — generated illustrations

Only for the one or two cues per video where no stock clip and no icon can show
the thing. Icons come from [Iconify](https://iconify.design/) — 200,000
open-source icons, free, no key needed — and cover the other 95 %.

- Sign up: **https://replicate.com/account/api-tokens**
- Cost: **~$0.003 per image** (Flux Schnell), hard-capped at 1 per short and
  2 per long-form in code
- Set: `REPLICATE_API_TOKEN`

*Alternative:* [fal.ai](https://fal.ai/dashboard/keys) (`FAL_KEY`), same model,
same price, often slightly faster.

---

## Tier 3 — when you have real users

You do not need any of these to make videos. You need them to make videos *for
other people, at the same time*.

### 5. Cloudflare R2 — storage

The default writes to `./.storage`, which is fine for one machine and impossible
for two.

R2 rather than S3 for one reason: **zero egress fees**. Every finished video
gets downloaded, often several times. On S3 that is ~$0.09/GB and becomes the
largest line on the bill; on R2 it is free.

- Sign up: **https://dash.cloudflare.com/** → R2
- Cost: **$0.015 per GB-month**, **$0 egress**. Free tier covers 10 GB.
- Set: `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`

Any S3-compatible provider works (Backblaze B2, Wasabi, S3 itself).

### 6. AWS Lambda — cloud rendering

The default renders on whatever machine runs the worker: correct, and roughly 8×
slower for long-form. Remotion Lambda fans frame ranges across many workers.

- Setup: **https://www.remotion.dev/docs/lambda/setup** (~15 minutes)
- Cost: **~$0.014 per short, ~$0.15 per 10-minute video**
- Set: `RENDER_DRIVER=lambda`, `REMOTION_LAMBDA_FUNCTION`, `REMOTION_SERVE_URL`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

Concurrency buys latency, not money — cost is proportional to total frames.
Lower `RENDER_FRAMES_PER_LAMBDA` for faster turnaround at the same price.

> **Remotion licensing.** Remotion is free for individuals and companies under
> four people, and requires a paid company licence above that. Check
> https://remotion.dev/license before you launch.

### 7. Redis — durable job queue

The default queue is in-process: jobs are lost if the server restarts mid-run,
and you cannot run two workers.

- Sign up: **https://upstash.com/** (free tier is plenty) or run Redis anywhere
- Set: `QUEUE_DRIVER=redis`, `REDIS_URL`, and `npm install redis`

---

## Not an API: the music library

Music is the one layer that is deliberately **not** an API call. Every music API
worth using is either paid per track, licence-restricted in ways that make "the
creator posts this to TikTok" legally murky, or slow.

Instead, drop royalty-free tracks into `public/audio/music/` and describe them in
[`content/music/manifest.json`](../content/music/manifest.json) with mood tags,
an energy rating and a licence. Selection is then instant, free, and — the part
that matters — **auditable**: every track in a shipped video traces back to a
manifest entry with a stated licence.

Good sources: [Pixabay Music](https://pixabay.com/music/) (Content License),
[Free Music Archive](https://freemusicarchive.org/) (Creative Commons),
[Uppbeat](https://uppbeat.io/) and [Epidemic Sound](https://www.epidemicsound.com/)
(paid, but their licences cover client work).

An empty library is a supported state — videos render without music and the job
reports it as a skipped layer.

---

## Summary

| | Service | Cost | What you lose without it |
| --- | --- | --- | --- |
| **1** | [Deepgram](https://console.deepgram.com/signup) | $200 free, then $0.0043/min | Captions and filler removal |
| **2** | [Anthropic](https://console.anthropic.com/) *or* [Gemini](https://aistudio.google.com/apikey) | ~$0.10/short, or free | The hook, and every creative decision |
| **3** | [Pexels](https://www.pexels.com/api/) | Free | B-roll |
| **4** | [Replicate](https://replicate.com/account/api-tokens) | ~$0.003/image | Bespoke illustrations (icons still work) |
| **5** | [Cloudflare R2](https://dash.cloudflare.com/) | $0.015/GB-mo | Multi-worker deployment |
| **6** | [Remotion Lambda](https://www.remotion.dev/docs/lambda/setup) | ~$0.15/10min | 8× render speed |
| **7** | [Upstash](https://upstash.com/) | Free tier | Job durability |

**All-in cost per video with everything configured: $0.12 for a 60-second short,
$0.74 for a 10-minute long-form** — against ceilings of $1 and $5.

Copy `.env.example` to `.env`, fill in what you have, and run `npm run doctor`.

## Seeing it work with none of them

```bash
npm run db:seed
```

Sample footage, the real pipeline, a real render — no keys and no network. The
transcript comes from a file (`content/fixtures/demo.transcript.json`) and
everything downstream of it is the production code path, so what lands on the
dashboard is a genuine EDL and a genuine MP4.

That fixture provider is opt-in by name: it needs `ASR_PROVIDER=fixture` **and**
an explicit `ASR_FIXTURE` path. There is no discovery, no default location and
no fallback to a bundled sample, because a transcription provider that could
silently substitute prepared words for someone's real speech is a product that
puts words in their mouth.
