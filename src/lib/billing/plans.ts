/**
 * The three plans, and the arithmetic they rest on.
 *
 * Everything the product enforces about a subscription lives here — the
 * allowance, the retention clocks, the limits — so there is exactly one place
 * to change a price and exactly one place to check what somebody is allowed to
 * do. The API, the worker, the sweeper and the pricing page all read this file.
 *
 * ── Why the allowance is measured in MINUTES OF FOOTAGE ──────────────────
 *
 * "Three videos a month" is how a customer thinks, so that is how the pricing
 * page says it. But it is not a thing we can sell: almost all of what a job
 * costs scales with how much footage went IN, not how many videos came out. A
 * plan sold as "3 videos" that accepts a two-hour podcast loses money on one
 * customer and cannot be repaired without taking something away from everyone.
 *
 * So the meter is source minutes, and the page translates: 60 minutes is about
 * three long-form videos, or a dozen shorts. Both numbers are true, and the one
 * a person recognises is the one they see.
 *
 * ── Why there are TWO retention clocks ───────────────────────────────────
 *
 * The footage you upload is enormous — roughly 90 MB per minute — and after the
 * edit exists it is only good for one thing: re-cutting. The finished video is
 * a twentieth of the size and is the thing people come back for. Deleting them
 * on the same schedule would be either wasteful or cruel, so they get separate
 * clocks: the source goes early, the video stays.
 *
 * The consequence has to be honest in the interface, not just in a policy: once
 * the source is gone you can still watch and download your video, but you can
 * no longer re-edit it or export another aspect ratio. `canReEdit` below is
 * what the editor asks.
 */

export const PLAN_IDS = ['free', 'starter', 'creator', 'studio'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly price in US dollars. 0 is the signed-up-but-not-paying state. */
  priceUsd: number;
  tagline: string;
  /** Who it is for, in one line, on the pricing page. */
  bestFor: string;

  /** Minutes of uploaded footage per billing month. The meter. */
  footageMinutes: number;
  /**
   * The longest single upload.
   *
   * Separate from the monthly allowance because they protect against different
   * things: the allowance protects the month's margin, this protects against
   * one four-hour file eating it in a single click before anyone can react.
   */
  maxMinutesPerUpload: number;

  /** How long we keep the file you uploaded. After this, no more re-editing. */
  sourceRetentionDays: number;
  /** How long we keep the finished video. `null` = as long as you subscribe. */
  renderRetentionDays: number | null;

  /** Jobs this account may have in flight at once. */
  concurrentJobs: number;
  /**
   * Tallest render. 1080 = Full HD, 2160 = 4K.
   *
   * Every plan is 1080 today, because 1080 is everything the renderer
   * produces. The field is not decoration: it is read by
   * `src/lib/billing/entitlements.ts` at render time, so the day 4K ships it is
   * one number here and nothing else. Until then nothing on the pricing page
   * may claim it — see docs/LAUNCH.md for what 4K would cost in render time
   * and in margin.
   */
  maxRenderHeight: 1080 | 2160;
  /** Whether finished videos carry an EasyCut mark. */
  watermark: boolean;
  /** Jumps the queue when the workers are busy. */
  priorityQueue: boolean;
}

/**
 * How much footage a person films to get one finished video.
 *
 * These two numbers are the entire translation between what we meter and what
 * the pricing page promises, so they are named and visible rather than buried
 * in a template string.
 *
 * They are deliberately PESSIMISTIC. Somebody who films five minutes for a
 * sixty-second short gets twelve out of Starter, not six — and being handed
 * twice what the page promised is a good surprise. The opposite error, where
 * the page says twelve and the footage only stretches to six, is the one that
 * costs trust and refunds. So the page under-promises on purpose.
 */
export const SOURCE_MINUTES_PER_SHORT = 10;
export const SOURCE_MINUTES_PER_LONG = 20;

/**
 * Billing interval, and what committing to a year is worth.
 *
 * A fifth off, which is the discount the card shows and the one the annual
 * Stripe Price has to be created at. The two are not connected by anything but
 * this constant and whoever sets the price up — Stripe is the authority on what
 * is charged — so `annualTotal` below is what the page is allowed to claim and
 * the number to type into Stripe, not a number we compute from a live price.
 */
export const BILLING_INTERVALS = ['monthly', 'annual'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
export const ANNUAL_DISCOUNT = 0.2;

/** What a year on this plan works out at per month, rounded to the cent. */
export function annualMonthly(plan: Plan): number {
  return Math.round(plan.priceUsd * (1 - ANNUAL_DISCOUNT) * 100) / 100;
}

/**
 * What the customer is actually charged, once, for a year.
 *
 * Derived from the rounded monthly figure rather than from the list price, so
 * the two numbers on the card agree with each other: a card that says
 * "$59.99 / month" and "$719.90 billed once a year" is out by two cents and
 * somebody will notice.
 */
export function annualTotal(plan: Plan): number {
  return Math.round(annualMonthly(plan) * 12 * 100) / 100;
}

/** The figure the big number on a card shows, for the interval on screen. */
export function priceFor(plan: Plan, interval: BillingInterval): number {
  return interval === 'annual' ? annualMonthly(plan) : plan.priceUsd;
}

/** `$24`, `$59.99`, `$1,824` — no trailing `.00`, thousands grouped. */
export function usd(amount: number): string {
  return `$${Number.isInteger(amount)
    ? amount.toLocaleString('en-US')
    : amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The shortest job we plan margins against, in source minutes.
 *
 * Deliberately NOT the marketing figure above, because the two numbers answer
 * opposite questions. The page wants the fewest videos an allowance could
 * yield, so it never over-promises. The margin model wants the MOST jobs an
 * allowance could produce — every job pays a fixed toll, so more of them is
 * the expensive case — and pinning that to a generous marketing number would
 * quietly flatter every figure in the table.
 */
const WORST_CASE_SOURCE_MINUTES_PER_JOB = 5;

export const PLANS: Record<PlanId, Plan> = {
  /*
   * Not one of the three that were asked for — it is the state a new account is
   * in before it pays, which has to exist for the rest of this to have anywhere
   * to start. Deliberately small: one video, watermarked, gone in two days. It
   * is a demonstration, not a tier.
   */
  free: {
    id: 'free',
    name: 'Free',
    priceUsd: 0,
    tagline: 'One video, on us.',
    bestFor: 'Seeing what it does to your own footage before you pay for it.',
    footageMinutes: 10,
    maxMinutesPerUpload: 10,
    sourceRetentionDays: 2,
    renderRetentionDays: 7,
    concurrentJobs: 1,
    maxRenderHeight: 1080,
    watermark: true,
    priorityQueue: false,
  },

  starter: {
    id: 'starter',
    name: 'Starter',
    priceUsd: 30,
    tagline: 'An hour of footage a month.',
    bestFor: 'One video a week, posted and done.',
    footageMinutes: 60,
    maxMinutesPerUpload: 30,
    sourceRetentionDays: 7,
    renderRetentionDays: 30,
    concurrentJobs: 1,
    maxRenderHeight: 1080,
    watermark: false,
    priorityQueue: false,
  },

  creator: {
    id: 'creator',
    name: 'Creator',
    priceUsd: 74.99,
    tagline: 'Three hours, and a year to keep it.',
    bestFor: 'Posting several times a week across more than one channel.',
    footageMinutes: 180,
    maxMinutesPerUpload: 90,
    sourceRetentionDays: 30,
    renderRetentionDays: 365,
    concurrentJobs: 3,
    maxRenderHeight: 1080,
    watermark: false,
    priorityQueue: true,
  },

  studio: {
    id: 'studio',
    name: 'Studio',
    priceUsd: 190,
    tagline: 'Eight hours a month, kept for as long as you stay.',
    bestFor: 'An agency or a team cutting for several people at once.',
    footageMinutes: 480,
    maxMinutesPerUpload: 240,
    sourceRetentionDays: 90,
    renderRetentionDays: null,
    concurrentJobs: 10,
    maxRenderHeight: 1080,
    watermark: false,
    priorityQueue: true,
  },
};

/** Paid plans, cheapest first — the order the pricing page shows them in. */
export const PAID_PLANS: Plan[] = [PLANS.starter, PLANS.creator, PLANS.studio];

export function getPlan(id: string | null | undefined): Plan {
  return PLANS[(id ?? 'free') as PlanId] ?? PLANS.free;
}

/* ------------------------------------------------------ what a plan buys */

/** "about 12 shorts, or 3 long-form videos" — the sentence under the price. */
export function videosFor(plan: Plan): { shorts: number; long: number } {
  return {
    shorts: Math.floor(plan.footageMinutes / SOURCE_MINUTES_PER_SHORT),
    long: Math.floor(plan.footageMinutes / SOURCE_MINUTES_PER_LONG),
  };
}

/** When a project's source footage is due for deletion. */
export function sourceExpiresAt(plan: Plan, uploadedAt: Date): Date {
  return new Date(uploadedAt.getTime() + plan.sourceRetentionDays * 86_400_000);
}

/** When a finished video is due for deletion. Null means "while subscribed". */
export function renderExpiresAt(plan: Plan, finishedAt: Date): Date | null {
  if (plan.renderRetentionDays === null) return null;
  return new Date(finishedAt.getTime() + plan.renderRetentionDays * 86_400_000);
}

/**
 * Can this project still be re-cut?
 *
 * Restyling, changing the aspect ratio and every timeline edit all replay the
 * cached analysis — which is free — but they still have to RENDER, and that
 * needs the original footage. Once it has been swept the video is finished in
 * the literal sense.
 */
export function canReEdit(plan: Plan, uploadedAt: Date, now = new Date()): boolean {
  return now < sourceExpiresAt(plan, uploadedAt);
}

/* --------------------------------------------------------- the economics */

/*
 * The unit costs below are fitted to the two figures the cost model already
 * publishes and `tests/cost.test.ts` already guards:
 *
 *     a 60-second short from 1 minute of footage   $0.1234
 *     a 10-minute long-form from 10 minutes        $0.7354
 *
 * Two points, one straight line: every job pays a fixed toll (one director
 * call's worth of prompt, one render invocation, one thumbnail) and then a
 * per-minute rate for transcription, director input tokens and rendered
 * frames. Solving gives the two constants below, which reproduce both figures
 * exactly — see tests/plans.test.ts, which checks that they still do.
 */
export const COGS_PER_JOB_USD = 0.0554;
export const COGS_PER_SOURCE_MINUTE_USD = 0.068;

/** Cloudflare R2: $0.015 per GB-month, no egress charge. */
const STORAGE_USD_PER_GB_MONTH = 0.015;
/** Uploaded footage, at the 12 Mbps the cost model assumes. */
const SOURCE_GB_PER_MINUTE = (60 * 12) / 8 / 1024;
/** Our 1080p H.264 output, at 8 Mbps. */
const RENDER_GB_PER_MINUTE = (60 * 8) / 8 / 1024;
/** Finished video length as a share of footage uploaded, blended short/long. */
const OUTPUT_SHARE_OF_SOURCE = 0.3;
/**
 * How far ahead to model "we keep it while you subscribe".
 *
 * Unbounded retention has unbounded cost, so the honest thing is to pick a
 * horizon and say so. A year is roughly the point at which a customer who has
 * not churned is not going to.
 */
const UNLIMITED_RETENTION_HORIZON_MONTHS = 12;

/** Stripe's standard card rate. */
const STRIPE_PERCENT = 0.029;
const STRIPE_FIXED_USD = 0.3;

export interface PlanEconomics {
  plan: Plan;
  /** Jobs implied by spending the whole allowance on shorts — the worst case. */
  jobs: number;
  pipelineUsd: number;
  storageUsd: number;
  paymentFeeUsd: number;
  totalCostUsd: number;
  grossProfitUsd: number;
  /** 0..1. */
  grossMargin: number;
  /** What one minute of footage costs the customer on this plan. */
  pricePerMinuteUsd: number;
}

/**
 * What a plan earns if the customer uses every last minute of it.
 *
 * Worst case on purpose, twice over: it assumes the allowance is spent on the
 * shortest jobs anybody plausibly submits — the pattern with the most fixed
 * toll per minute — and it assumes 100 % utilisation, which essentially nobody
 * reaches. A plan that is healthy here is healthy.
 */
export function planEconomics(plan: Plan): PlanEconomics {
  const jobs = plan.footageMinutes / WORST_CASE_SOURCE_MINUTES_PER_JOB;

  const pipelineUsd = jobs * COGS_PER_JOB_USD + plan.footageMinutes * COGS_PER_SOURCE_MINUTE_USD;

  // Steady state, not first month: how much is on disk once the retention
  // window has filled up and deletions have caught up with uploads.
  const sourceMonths = plan.sourceRetentionDays / 30;
  const renderMonths =
    plan.renderRetentionDays === null
      ? UNLIMITED_RETENTION_HORIZON_MONTHS
      : plan.renderRetentionDays / 30;

  const sourceGb = plan.footageMinutes * SOURCE_GB_PER_MINUTE * sourceMonths;
  const renderGb =
    plan.footageMinutes * OUTPUT_SHARE_OF_SOURCE * RENDER_GB_PER_MINUTE * renderMonths;
  const storageUsd = (sourceGb + renderGb) * STORAGE_USD_PER_GB_MONTH;

  const paymentFeeUsd = plan.priceUsd > 0 ? plan.priceUsd * STRIPE_PERCENT + STRIPE_FIXED_USD : 0;

  const totalCostUsd = pipelineUsd + storageUsd + paymentFeeUsd;
  const grossProfitUsd = plan.priceUsd - totalCostUsd;

  return {
    plan,
    jobs,
    pipelineUsd,
    storageUsd,
    paymentFeeUsd,
    totalCostUsd,
    grossProfitUsd,
    grossMargin: plan.priceUsd > 0 ? grossProfitUsd / plan.priceUsd : 0,
    pricePerMinuteUsd: plan.priceUsd / plan.footageMinutes,
  };
}
