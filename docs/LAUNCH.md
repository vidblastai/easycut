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
| ≈ shorts | 6 | 18 | 48 |
| Longest single upload | 30 min | 90 min | 240 min |
| **Footage kept** | 7 days | 30 days | 90 days |
| **Videos kept** | 30 days | 1 year | while subscribed |
| At once | 1 | 3 | 10 |
| Export | 1080p | 1080p | 1080p |

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
   the pattern with the most jobs per minute and therefore the most fixed cost
   (the model keeps its own pessimistic five-minutes-a-job figure rather than
   the cautious ten the pricing page advertises). Real utilisation in this
   category runs 30–60 %, so expect materially better.
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
lose money on it. So the meter is minutes and the page says both numbers.

The advertised counts are deliberately pessimistic — ten minutes of footage per
short, twenty per long-form — so Starter reads "3 long-form videos, or 6
shorts". Somebody who films tighter gets more than the page promised, which is
the only direction this error is safe to make.

### Why footage is deleted before videos

Uploaded footage is ~90 MB a minute; a finished video is about a twentieth of
that. Once the edit exists, the source is only good for re-cutting. So there are
two clocks. The consequence is honest in the interface, not just in the policy:
once the source is swept, **Open editor** and the extra aspect ratios are
disabled with an explanation, because re-rendering genuinely needs the original.
There is a warning in the three days before it goes.

---

## Built since

- **Payments** — `src/lib/billing/stripe.ts`, `subscription.ts`, and the three
  routes under `/api/billing`. 26 tests, including forged webhooks.
- **The watermark** — the free tier's mark now actually renders
  (`remotion/components/Watermark.tsx`), applied at render time from
  `planAtUpload` rather than from the EDL, so it cannot be deleted in the
  browser editor.
- **Priority queue** — "first in the queue" is now a real thing the queue does,
  on all three drivers.
- **A bug that would have cost sign-ups**: `/pricing`, `/privacy` and `/terms`
  were behind the sign-in gate. A pricing page you need an account to read
  cannot do its job, and a privacy policy behind a login wall is worse than
  that.
- **A test that catches this class of bug**: every plan feature is now checked
  against the code that enforces it, which is what caught both the 4K claim and
  the priority one.

## Built in the pass before

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

### 1. Stripe — built; needs your account

Checkout, the customer portal and the webhook are all in, and so is everything
they feed: `user.plan` moves only through the webhook, and the plan is what the
meter, the sweeper, the queue and the renderer read.

What is left is yours, and it is about twenty minutes in the Stripe dashboard:

1. Three recurring monthly **products and prices** — $30, $74.99, $190.
2. Put the ids in `.env`: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_STARTER`,
   `STRIPE_PRICE_CREATOR`, `STRIPE_PRICE_STUDIO`.
3. A **webhook endpoint** at `https://your-domain/api/billing/webhook`,
   subscribed to `checkout.session.completed`,
   `customer.subscription.created`, `.updated` and `.deleted`. Its signing
   secret goes in `STRIPE_WEBHOOK_SECRET`.
4. Turn the **customer portal** on, once, at
   dashboard.stripe.com/settings/billing/portal. Without it the "Manage
   subscription" button opens nothing.

Settings tells you which of those four is missing, in words, on the page.

**Free beta is now a setting, not a decision.** With no Stripe keys the plans
are still enforced and simply cannot be bought — set somebody's `plan` column
by hand and everything behaves as if they had paid. So you can launch either
way and change your mind without a deploy.

Three policy calls the code has already made, so you can overrule them:

- **A failed card does not lock anyone out.** `past_due` keeps the plan;
  Stripe dunning usually collects within a few days, and cutting somebody off
  at the first decline loses the customer as well as the money. Only an actual
  cancellation drops them to free.
- **A downgrade does not reach backwards.** Retention dates are stamped at
  upload from `planAtUpload`, so work bought on Studio keeps Studio's
  retention, and a video made on the free tier keeps its watermark even after
  an upgrade unless it is re-rendered.
- **An unrecognised Stripe price changes nothing.** A legacy price, or one
  created in the dashboard and never put in the environment, is logged and
  ignored rather than silently downgrading a paying customer to free.

### 1b. 4K — a priced decision, not a missing feature

The pricing page used to say Creator and Studio export in 4K. Nothing produced
it: every composition is laid out at 1080 and there is no path that scales
them. The page now says 1080p, which is what the software does.

Shipping 4K is not hard — Remotion's `renderMedia` takes a `scale`, so the
compositions need no layout changes at all — but it costs:

- **Render time roughly 3–4×.** A ten-minute video renders in ~27 minutes on
  four cores today; at 4K that is an hour and a half. On Lambda it is money
  instead of time, at about the same multiple.
- **Margin.** Rendering is 11–20 % of pipeline cost, so 4× on that line takes
  Studio from ~75 % to about 68 % if everyone uses it.

My recommendation: ship it as an **opt-in export** on Creator and Studio rather
than the default, with the wait stated on the button. Then the multiple is paid
only on the videos that need it, which is a small minority of them. Say the
word and it is a day's work — `maxRenderHeight` in `plans.ts` is already read at
render time, so the plumbing is waiting for it.

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
| **Stripe** | Payments | Plans are enforced but cannot be bought — a free beta. |
| Anthropic or Gemini | AI director | Falls back to the rule-based director. Works, less clever. |
| Pexels | B-roll | Generated images and graphics only. |
| Remotion Lambda | Rendering | Renders locally: ~27 min for a 10-minute video instead of ~2.5. |

`npm run doctor` prints which of these are live for the current configuration.
