# The pipeline

Twelve stages, from an uploaded file to a postable video. Implemented in
[`src/lib/pipeline/run.ts`](../src/lib/pipeline/run.ts).

**The governing rule: no stage may fail the job unless the job genuinely cannot
produce a video.** Only `ingest` and `render` are fatal. Everything else
degrades, records what was lost in `edl.degraded`, and carries on. The user
always gets a finished video; a degraded run simply has fewer layers, and the
editor tells them which.

---

## 1. Ingest

Pull the source local, `ffprobe` it, and derive three things **in parallel**:

| Artifact | What for | Why this shape |
| --- | --- | --- |
| `proxy.mp4` — 540p H.264 | browser scrubbing, subject tracking | Seeking a 4K H.265 file in a `<video>` element is painful; seeking a 540p proxy is instant |
| `asr.wav` — 16 kHz mono PCM | transcription | Every ASR provider resamples to roughly this anyway. A 10-minute video becomes a 19 MB upload instead of 1 GB |
| `mix.wav` — 48 kHz stereo PCM | the final audio mix | Full quality, because this one ends up in the export |

Rotation metadata is resolved here too — phone footage is routinely stored
1920×1080 and tagged 90°, and getting this wrong means reframing a video that
is secretly portrait.

**Fatal if:** there is no audio track (this edits talking heads — it needs a
voice to work from), or the footage is wildly over the format's length limit.

## 2. Transcribe

Word-level timestamps, with automatic failover down a provider chain:
Deepgram → Groq Whisper → AssemblyAI → stub.

Deepgram leads because of one feature nothing else has at this price:
`filler_words=true` returns `um` and `uh` as real tokens with timestamps.
Removing fillers is half of what makes raw footage watchable, and guessing where
they were is hopeless.

**The stub does not invent a transcript.** It returns an empty word list with
the real duration. Fabricating words would produce captions saying something the
person never said, which is the single worst failure this product could ship.

**Degrades to:** a silence-only edit with no captions.

## 3. Silence

Two signals, deliberately combined:

- **transcript gaps** know where words aren't — but a gap can contain a laugh, a
  sigh, a prop reveal, or the beat that carries the joke;
- **acoustic silence** (ffmpeg `silencedetect` at −50 dB) knows where there is
  genuinely no sound.

**We only cut where both agree** (≥60 % of the gap is acoustically silent). That
one rule is what stops an automated editor from butchering delivery, and it
costs nothing.

Cuts are shrunk by a padding on each side so the edit breathes. Presets range
from `aggressive` (220 ms threshold, short-form raw footage) to `micro` (1.1 s,
for footage the user already trimmed).

## 4. Cleanup

Four detectors, each with a confidence score. Only findings above the preset's
floor are applied; the rest are reported to the UI.

| Detector | Rule | Why it's careful |
| --- | --- | --- |
| **Fillers** | An `um` is cut only when it's isolated between pauses | One wedged tight inside a sentence is part of the rhythm; removing it makes an audible click |
| **Stammers** | `the the the point` → keep the last | Only when the repeats are tight. "very, very good" is deliberate emphasis and comes with a comma-sized pause |
| **False starts** | A short fragment whose opening words the next sentence repeats | Requires the restart to follow within ~2 s — a longer pause means a new thought, not a retry |
| **Retakes** | Near-duplicate sentences within 25 s → **keep the last** | People retry until they get it right. Unless the last attempt is truncated, in which case the earlier complete one wins |

In `roughcut` mode, false-start and retake detection are **off entirely** and the
confidence floor rises to 0.85. The user already made those decisions;
second-guessing their edit is the fastest way to make the product feel like it
is fighting them.

## 5. Direct

The creative judgement, as one LLM call per 3-minute window, run concurrently.

The director sees the transcript with sentence timestamps and returns a
`DirectorPlan`: the hook, content-level cuts, emphasis words, B-roll cues with
search queries, graphics, sound effects, punch-ins, chapters, and the social
caption. All in **source time**.

Windows exist for three reasons, in order of importance: **latency** (they run
in parallel, so a 10-minute video is analysed in about the time one window
takes), **attention** (a model asked to place 40 cues across 10 minutes reliably
front-loads them and forgets the last third), and **cost** (the cached system
prompt is shared).

The prompt's substance is in
[`src/lib/director/prompt.ts`](../src/lib/director/prompt.ts). The rule that
matters most:

> **B-roll illustrates the noun, never the vibe.** "I was flying to Berlin" →
> `airplane window clouds`. "Growth has been incredible" → nothing, because that
> is a feeling, not an object, and generic stock over abstract claims is exactly
> what makes videos look auto-generated.

**Degrades to:** a rule-based director that finds a hook by scoring sentences,
marks numbers and proper nouns for emphasis, and paces layers from the style's
profile. Competent; less clever.

## 6. Timeline

Three independent removal sets — mechanical silence, mechanical cleanup, and the
director's content judgement — merged into one keep list, then laid out into
`Segment`s with output timestamps.

**Hook relocation** happens here: for short form, the hook's source range is
played first and subtracted from the body, so the line isn't heard twice.

**The length ceiling** is applied by accumulating segments until the format's
maximum, taking a partial segment only if more than 1.2 s of it fits.

This stage assigns output time. Every cue authored in source time is mapped
through [`TimeMapper`](../src/lib/timeline/time-mapper.ts) from here on — the
most safety-critical arithmetic in the product, and the reason captions don't
drift.

## 7. Reframe

Turning landscape footage into vertical without beheading anyone.

A centre crop works right up until the speaker sits off-centre, gestures out of
frame, or stands on the left third because that's where the light was.

The tracker samples the proxy at **4 fps and 64×36 greyscale** — a 10-minute
video becomes ~5 MB of raw pixels through a pipe, with no model download and no
vision library. Per frame it scores motion against a running background plus
local contrast, thresholds at 35 % of the peak (the crucial step: without it, a
weak signal spread over 2,304 pixels averages to dead centre no matter where the
subject is), and takes the weighted centroid.

Confidence comes from **both motion and shape**. Motion alone is the wrong
signal, because the normal shot is a person on a tripod who barely moves —
background subtraction says "nothing is happening" on exactly the footage that
most needs reframing. A tight, high-contrast blob is evidence wherever it sits.

Smoothing is three passes, each fixing a distinct failure: exponential smoothing
(jitter), a **dead zone** (the crop does not move at all until the subject drifts
past a threshold — without this the frame breathes constantly and looks like a
drunk camera operator), and a **rate limit** (when it does move, no faster than a
real operator would pan).

The track is then **re-timed onto output time** through the same `TimeMapper`.
Skipping that step makes the crop drift further behind the picture the longer
the video runs — fine at the start, subject out of frame by the end.

**Degrades to:** a centre crop.

## 8. Assets

Resolve every placeholder into a real URL. All of it concurrent — a stock
search, an icon lookup and an image generation have nothing to do with each
other. Nothing here may throw; an unresolvable cue is dropped and recorded.

- **B-roll** → Pexels/Pixabay, re-ranked on the three things that matter for an
  insert: usable length, matching orientation, resolution headroom.
- **Graphics** → Iconify first (free, instant, right most of the time), then
  generated illustration for the one or two cues that need one, then text-only.
- **Music** → mood-matched from the local library.
- **SFX** → the synthesised library.

## 9. EDL

Assemble and validate. This is where the director's plan, the style preset and
the cut list are reconciled, and where every collision is resolved
deterministically:

- No two B-roll inserts overlap.
- No B-roll in the first 1.2 s — the viewer has to see who is talking before we
  cut away from them.
- No graphic on top of B-roll; no two graphics at once.
- No punch-in during or immediately after an insert; no back-to-back punch-ins.
- No two sound effects within 150 ms (that's a click, not punctuation).
- **Decorated transitions only on visible cuts** — seams where the source
  timestamps actually jump. A whip pan on continuous footage is the clearest
  possible tell of an automated edit.

The budget guard runs at the end of this stage, before any render spend.

## 10. Render

Video frames and the audio mix are produced **concurrently** and muxed with
`-c:v copy`. This is the single biggest speed win in the pipeline: the audio mix
is the fiddliest part of the edit and it finishes in seconds while the frames
are still going.

```
 VIDEO   Remotion composition → H.264, CRF 21, muted
 AUDIO   ffmpeg: segments → concat → HPF → denoise → compress → loudnorm −14 LUFS
                 ⊕ music ducked by sidechaincompress keyed on the speech itself
                 ⊕ SFX placed with adelay
                 → limiter
 MUX     ffmpeg -c:v copy — instant
```

Sidechain ducking is what separates "music under a video" from "music fighting
the voice", and it is why the browser preview (which has no compressor) plays a
pre-ducked approximation rather than pretending to be the final mix.

On the local driver, the renderer starts a **loopback asset server** on an
ephemeral port to serve the source. Remotion will not read `file://`, and
routing the source through the web app would make the worker depend on the app
being up and add an HTTP round trip per frame.

## 11. Deliver

Thumbnail (chosen at a punch-in, where the speaker is large and unobstructed),
upload, database update, social caption and hashtags.

## 12. Feedback

Every tweak in the editor writes a **new EDL version** and re-renders. Because
the transcript and director plan are cached on the project, structural changes —
a different style, a different aspect ratio, a short cut out of a long-form
video — replay the deterministic half of the pipeline and cost only a render.

Nothing is ever destroyed, so the version list is a free undo history.

### Manual fine-tuning

The editor has a second mode with a real multi-track timeline
([`TimelineEditor.tsx`](../src/components/TimelineEditor.tsx)), for the cases
where the AI got something nearly right and re-rolling the whole edit is the
wrong tool.

Every gesture is an **operation** on the EDL
([`operations.ts`](../src/lib/edl/operations.ts)) rather than a direct mutation,
which buys three things:

- **Undo is truncating a list**, not snapshotting documents per keystroke.
- **What you previewed is what the server recomputes** — the client applies the
  same `applyOperations` the API does, so there is no second implementation to
  drift.
- **Edits are local until you commit**, so a fine-tuning session is one version
  and one render rather than forty.

The hard part is re-timing. Trimming 400 ms off a clip moves everything after
it, and a caption three cuts later is anchored to words spoken at a fixed moment
in the *source*. So `relayout` reads every cue's anchor back into source time
through the OLD segment layout and forward through the NEW one — the same
`TimeMapper` the rest of the pipeline uses. Anything anchored to footage that no
longer exists is **dropped rather than clamped**, because a caption for deleted
words is a lie.

Two collision rules, because they should feel different:

- **Dragging** a clip onto a neighbour on the same track pushes it clear, to
  whichever side it was heading (decided by comparing centres, which is the only
  thing that stays right when the drop overlaps almost entirely).
- **Trimming** clamps only the dragged edge — moving the whole clip because its
  edge met something would feel like the timeline fighting you.

Cross-track stacking (a label over a B-roll shot) is allowed. The director
avoids it unattended because two focal points usually fight, but a person doing
it deliberately is ordinary editing, and manual mode does not overrule the
person editing.
