# What is left before launch

Written after the plan, retention, email and privacy work landed. Everything
below is either not built, or built but waiting on a decision or a key that only
you can supply.

---

## The plans, and where the numbers came from

Defined in [`src/lib/billing/plans.ts`](../src/lib/billing/plans.ts), which is
the single source of truth — the API meters against it, the sweeper deletes by
it, and the pricing and privacy pages are generated from it. Change a price
there and every one of those follows.

| | Starter | Creator | Studio |
| --- | --- | --- | --- |
| **Price** | $30 | $74.99 | $190 |
| **Footage** | 1 hour | 3 hours | 8 hours |
| ≈ long-form videos | 3 | 9 | 24 |
| ≈ shorts | 12 | 36 | 96 |
| Longest single upload | 30 min | 90 min | 240 min |
| **Footage kept** | 7 days | 30 days | 90 days |
| **Videos kept** | 30 days | 1 year | while subscribed |
| At once | 1 | 3 | 10 |
| Export | 1080p | 4K | 4K |

Plus a **Free** tier — 10 minutes, watermarked, gone in a week. Not one of the
three you asked for; it is the state an account is in before it pays, which has
to exist for the rest to have a starting point. Delete it if you would rather
force a card up front.

### The margins

`npx tsx scripts/plan-economics.ts` prints this live:

```
plan       price   minutes  pipeline storage  stripe    total   profit  margin   $/min
Starter   $30.00        60     $4.74   $0.03   $1.17    $5.95   $24.05  80.2%   $0.500
Creator   $74.99       180    $14.23   $0.81   $2.47   $17.52   $57.47  76.6%   $0.417
Studio   $190.00       480    $37.96   $3.42   $5.81   $47.19  $142.81  75.2%   $0.396
```

Two things to know about those figures:

1. **They are the worst case, twice over.** They assume the customer burns
   every last minute of the allowance, and that they spend it all on *shorts* —
   the pattern with the most jobs per minute and therefore the most fixed cost.
   Real utilisation in this category runs 30–60 %, so expect materially better.
2. **They assume Claude Opus as the director.** Switching `LLM_MODEL` to Sonnet
   cuts the biggest line item by about 60 % and pushes every margin past 85 %,
   at some cost in the taste of the hook and B-roll choices.

The ladder gets cheaper per minute as it goes up ($0.500 → $0.417 → $0.396),
which is what makes upgrading feel rational rather than punitive.

### Why the meter is minutes and not videos

You asked for "three videos" at $30 — and that is exactly what Starter is, if a
long-form video is about twenty minutes of raw footage. But a plan *sold* in
videos cannot be enforced: nearly everything a job costs scales with footage in,
not clips out, so "3 videos" would have to either refuse an hour-long podcast or
lose money on it. So the meter is minutes and the page says both numbers. The
pricing page explains this in two sentences rather than leaving people to
discover it at the point of refusal.

### Why footage is deleted before videos

Uploaded footage is ~90 MB a minute; a finished video is about a twentieth of
that. Once the edit exists, the source is only good for re-cutting. So there are
two clocks. The consequence is honest in the interface, not just in the policy:
once the source is swept, **Open editor** and the extra aspect ratios are
disabled with an explanation, because re-rendering genuinely needs the original.
There is a warning in the three days before it goes.

---

## Built in this pass

- **Plans, allowances and retention** — `src/lib/billing/plans.ts`
- **The meter** — `src/lib/billing/usage.ts`. Lazy monthly period (no cron),
  quota refusal before upload, metered on ffprobe's duration after ingest.
- **The sweeper** — `src/worker/sweep.ts`, runs hourly in the worker.
- **"Your video is ready" email** — `src/lib/email/`, sent once per project.
- **Privacy policy** — `/privacy`, retention table generated from the plans.
- **Pricing page** — `/pricing`, every number from the plans.
- **Usage meter in the sidebar**, warning at 80 % and again at zero.
- **Pricing on the homepage** and in the top nav, not only on /pricing.
- **A real site footer** carrying the privacy policy, the terms and pricing,
  on every marketing page.
- **Terms of service** at `/terms`.
- **Two bugs fixed on the way**: `DELETE /api/projects/[id]` had no ownership
  check (anyone signed in could delete anyone's project) and left every file on
  disk; and an absolute `STORAGE_LOCAL_DIR` was being joined onto the working
  directory, so pointing storage at a mounted volume silently wrote into the
  app directory instead.

---

## Still to build

### 1. Stripe — the plans do not charge anyone yet

Everything a subscription *does* is built and enforced; what is missing is
taking the money and setting `user.plan`. Needed:

- Products and prices in Stripe, ids into the `Plan` records
- Checkout session route, and a customer portal link in settings
- Webhook handler for `checkout.session.completed`,
  `customer.subscription.updated` and `.deleted` → write `plan`
- What happens on downgrade or lapse. My recommendation: drop to `free`
  immediately for *new* work, but leave existing projects' retention dates
  alone — they were bought under the old plan and the code already stores
  `planAtUpload` so this is a one-line policy, not a migration.

**Decision needed from you:** free beta first, or paid from day one?

### 2. Error reporting

If a render breaks for a customer at 2am, nothing tells you. Sentry or similar,
wired into the worker and the API.

### 3. Both policies need a lawyer's pass

`/privacy` and `/terms` are accurate descriptions of what the software does,
written in plain English and generated from the live plan data where they quote
numbers. Neither is legal advice and neither has been reviewed. The commercial
calls in the terms — no part-month refunds as a rule, a liability cap at last
month's payment — are the policy the code currently implements, which is the
honest starting point for that conversation rather than the end of it.

---

## Keys you still need to supply

| | Why | Without it |
| --- | --- | --- |
| **Deepgram** | Transcription | No captions, silence-only edit. The one that matters most. |
| **Cloudflare R2** | Storage | Files sit on local disk; a second worker cannot see them. |
| **Clerk** | Accounts | The app runs open — every visitor sees every video, and nothing is metered. |
| **Resend** | Email | The ready email logs instead of sending. |
| Anthropic or Gemini | AI director | Falls back to the rule-based director. Works, less clever. |
| Pexels | B-roll | Generated images and graphics only. |
| Remotion Lambda | Rendering | Renders locally: ~27 min for a 10-minute video instead of ~2.5. |

`npm run doctor` prints which of these are live for the current configuration.
