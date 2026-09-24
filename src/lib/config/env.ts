/**
 * Every external dependency is optional. The whole pipeline runs end-to-end with
 * zero keys configured — stages fall back to stub providers and the finished
 * video simply has fewer layers. Adding a key upgrades a stage in place.
 *
 * `capabilities()` is what the UI and the /doctor script read to show the user
 * exactly what is and isn't switched on.
 */

function str(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * How many cores this process can actually use, floored at one.
 *
 * `navigator.hardwareConcurrency` rather than `os.cpus()`, and the difference
 * is not cosmetic: this module is imported by `src/instrumentation.ts`, which
 * Next.js compiles for the EDGE runtime as well as Node. Edge has no
 * `node:os`, and webpack resolves the import whether or not the code path can
 * run — so a `require('node:os')` in here, however carefully guarded at
 * runtime, fails the production build outright.
 *
 * `navigator.hardwareConcurrency` is the cross-runtime spelling. Node has had
 * it since 21, Edge runtimes have it, and browsers have had it for a decade.
 */
function coreCount(): number {
  try {
    const n = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
    return Math.max(1, Number.isFinite(n) ? (n as number) : 1);
  } catch {
    return 1;
  }
}

function num(name: string, fallback: number): number {
  const v = str(name);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = str(name)?.toLowerCase();
  if (v === undefined) return fallback;
  return v === '1' || v === 'true' || v === 'yes';
}

export const env = {
  appUrl: str('APP_URL') ?? 'http://localhost:3000',
  nodeEnv: process.env.NODE_ENV ?? 'development',

  database: { url: str('DATABASE_URL') ?? 'file:./dev.db' },

  storage: {
    driver: (str('STORAGE_DRIVER') ?? 'local') as 'local' | 's3',
    localDir: str('STORAGE_LOCAL_DIR') ?? '.storage',
    bucket: str('S3_BUCKET'),
    region: str('S3_REGION') ?? 'auto',
    endpoint: str('S3_ENDPOINT'),
    accessKeyId: str('S3_ACCESS_KEY_ID'),
    secretAccessKey: str('S3_SECRET_ACCESS_KEY'),
    publicBaseUrl: str('S3_PUBLIC_BASE_URL'),
  },

  queue: {
    /**
     * Default `db`, not `memory`.
     *
     * The README tells you to run `npm run dev` and `npm run worker` in two
     * terminals, which is right — but an in-process queue means those two
     * processes each have their OWN queue and neither ever sees the other's
     * jobs. The symptom is an upload that sits at "queued" for ever with
     * nothing in either log, which is about the worst first five minutes this
     * product could give somebody.
     *
     * The database queue works fine for one process too, so it is the safe
     * default. `memory` stays available for tests, where a shared table between
     * parallel runs is the problem rather than the solution.
     */
    driver: (str('QUEUE_DRIVER') ?? 'db') as 'memory' | 'db' | 'redis',
    redisUrl: str('REDIS_URL'),
    concurrency: num('QUEUE_CONCURRENCY', 2),
  },

  transcription: {
    // Order matters: first configured provider wins.
    preferred: (str('ASR_PROVIDER') ?? 'auto') as
      | 'auto' | 'deepgram' | 'groq' | 'assemblyai' | 'stub' | 'fixture',
    deepgramKey: str('DEEPGRAM_API_KEY'),
    groqKey: str('GROQ_API_KEY'),
    assemblyaiKey: str('ASSEMBLYAI_API_KEY'),
    /**
     * A transcript on disk, for the demo seed and for tests. Reachable only by
     * naming `ASR_PROVIDER=fixture` as well — never through `auto`, because a
     * provider that can substitute prepared words for someone's real speech
     * must not be something you can fall into.
     */
    fixturePath: str('ASR_FIXTURE'),
  },

  llm: {
    // `auto` picks whichever key is present, preferring Anthropic when both are.
    provider: (str('LLM_PROVIDER') ?? 'auto') as 'auto' | 'anthropic' | 'gemini' | 'stub',
    anthropicKey: str('ANTHROPIC_API_KEY'),
    model: str('LLM_MODEL') ?? 'claude-opus-5',
    geminiKey: str('GEMINI_API_KEY'),
    geminiModel: str('GEMINI_MODEL') ?? 'gemini-3-flash',
    /**
     * Set once you've linked a billing account. It changes two things: cost
     * stops being reported as zero, and Google stops using your prompts to
     * improve its products — which on this product means your unpublished
     * script.
     */
    geminiPaid: bool('GEMINI_PAID_TIER', false),
    maxOutputTokens: num('LLM_MAX_OUTPUT_TOKENS', 8000),
  },

  stock: {
    pexelsKey: str('PEXELS_API_KEY'),
    pixabayKey: str('PIXABAY_API_KEY'),
  },

  imagegen: {
    provider: (str('IMAGEGEN_PROVIDER') ?? 'auto') as 'auto' | 'replicate' | 'fal' | 'none',
    replicateToken: str('REPLICATE_API_TOKEN'),
    replicateModel: str('REPLICATE_IMAGE_MODEL') ?? 'black-forest-labs/flux-schnell',
    falKey: str('FAL_KEY'),
    falModel: str('FAL_IMAGE_MODEL') ?? 'fal-ai/flux/schnell',
  },

  render: {
    driver: (str('RENDER_DRIVER') ?? 'local') as 'local' | 'lambda',
    lambdaFunctionName: str('REMOTION_LAMBDA_FUNCTION'),
    lambdaServeUrl: str('REMOTION_SERVE_URL'),
    lambdaRegion: str('REMOTION_LAMBDA_REGION') ?? 'us-east-1',
    /**
     * Browser tabs rendering frames in parallel.
     *
     * Was a flat 4, which is two too many on the single-vCPU container this is
     * most likely to be deployed to — four headless Chromes contending for one
     * core is slower than one, not faster. Derived from the CPUs actually
     * present, capped so a large build machine does not open sixteen.
     */
    concurrency: num('RENDER_CONCURRENCY', Math.max(1, Math.min(4, coreCount() - 1))),
    /**
     * Which OpenGL backend the headless browser uses, or none.
     *
     * Remotion's default on Linux is `swangle` — software GL through ANGLE —
     * and it is the single most expensive setting in this whole file. Measured
     * on a four-core box with `npm run bench:render`, over a real ten-minute
     * edit:
     *
     *     swangle   2.29 fps   111 min
     *     (unset)   9.37 fps    27 min     ← 4.1× faster
     *
     * All of that goes into a GPU process rasterising through SwiftShader,
     * which on a machine with no GPU is a software renderer emulating hardware
     * so that Skia can draw through it, instead of Skia simply drawing. It
     * earns its keep for WebGL and 3D; this composition is video, text and
     * boxes, so it buys nothing.
     *
     * Left unset, which passes no GL flag at all. Set it to `swangle`, `angle`,
     * `angle-egl` or `vulkan` if a composition ever does need WebGL.
     */
    gl: (str('RENDER_GL') ?? null) as 'swangle' | 'angle' | 'angle-egl' | 'vulkan' | 'swiftshader' | null,
    /**
     * Ceiling on Remotion's decoded-frame cache, in megabytes.
     *
     * Left unset, Remotion sizes this from the host's free memory. That is a
     * sensible default for a workstation and a trap for a product: the same
     * render takes ~6 GB on a 12 GB machine and a fraction of that on a small
     * container, so behaviour — speed, and whether the OOM killer arrives —
     * becomes a property of the box rather than of the video. Pinning it makes
     * a render reproducible, and makes 'it worked locally' mean something.
     */
    offthreadCacheMb: num('RENDER_OFFTHREAD_CACHE_MB', 512),
    /**
     * Path to a Chromium/Chrome binary for local rendering. Remotion downloads
     * its own headless shell by default, which fails on locked-down hosts and
     * in containers that already ship a browser. Point this at the one you have.
     */
    browserExecutable: str('BROWSER_EXECUTABLE'),
    /**
     * For render hosts behind a TLS-intercepting proxy, where the headless
     * browser does not trust the proxy's CA and every remote asset (fonts,
     * stock B-roll, generated images) fails to load.
     */
    ignoreCertificateErrors: bool('RENDER_IGNORE_CERT_ERRORS', false),
    /** Frames rendered per Lambda invocation — the main cost/speed dial. */
    framesPerLambda: num('RENDER_FRAMES_PER_LAMBDA', 80),
  },

  /**
   * Transactional email.
   *
   * One message: your video is ready. Without a key the sender logs and reports
   * failure, which the worker treats as "fine" — a render must never be marked
   * failed because a notification did not go out.
   */
  email: {
    resendKey: str('RESEND_API_KEY'),
    from: str('EMAIL_FROM') ?? 'EasyCut <hello@easycut.ai>',
  },

  /**
   * Payment.
   *
   * Optional like everything else: with no key the plans still exist and are
   * still enforced, they simply cannot be bought, which is also how a free
   * beta looks. The price ids are per-Stripe-account and per-mode, so they
   * live here rather than in the plan definitions.
   */
  stripe: {
    secretKey: str('STRIPE_SECRET_KEY'),
    webhookSecret: str('STRIPE_WEBHOOK_SECRET'),
    prices: {
      starter: str('STRIPE_PRICE_STARTER'),
      creator: str('STRIPE_PRICE_CREATOR'),
      studio: str('STRIPE_PRICE_STUDIO'),
    },
    /*
     * The same three plans billed once a year, which in Stripe is a separate
     * Price on the same Product. Optional: a deployment with none of these set
     * sells monthly only, the annual toggle says so on the card, and nothing
     * charges the wrong interval because it could not find a price.
     */
    annualPrices: {
      starter: str('STRIPE_PRICE_STARTER_ANNUAL'),
      creator: str('STRIPE_PRICE_CREATOR_ANNUAL'),
      studio: str('STRIPE_PRICE_STUDIO_ANNUAL'),
    },
  },

  /**
   * Deletion, on a timer.
   *
   * The plans promise both halves — "kept for a year", "deleted after seven
   * days" — and neither is true unless the sweeper runs. See src/worker/sweep.ts.
   */
  retention: {
    sweepIntervalMinutes: num('RETENTION_SWEEP_MINUTES', 60),
  },

  /**
   * Being told when it breaks.
   *
   * Optional like everything else, and the console sink is always on — so an
   * unconfigured clone still gets consistent, deduplicated failure lines. With
   * a webhook URL (Slack, Discord, anything that takes JSON) or a Sentry DSN,
   * the same failures also reach a human who is not reading the log.
   */
  errors: {
    /** Slack/Discord/generic incoming webhook. The thirty-second option. */
    webhookUrl: str('ERROR_WEBHOOK_URL'),
    /** `https://PUBLIC_KEY@oNNN.ingest.sentry.io/PROJECT_ID`. No SDK needed. */
    sentryDsn: str('SENTRY_DSN'),
    /**
     * How long one kind of failure stays quiet after it has been reported.
     *
     * The number that decides whether the alerting survives its first bad
     * night: too short and a queue retrying one broken job buries the channel,
     * too long and a second, different incident hides behind the first. Fifteen
     * minutes is about one fix-and-deploy cycle.
     */
    cooldownMinutes: num('ERROR_COOLDOWN_MINUTES', 15),
    /** A ceiling across all fingerprints, so a storm of DISTINCT errors cannot flood either. */
    maxPerHour: num('ERROR_MAX_PER_HOUR', 20),
    /** Which machine sent it, when several are running. */
    serverName: str('ERROR_SERVER_NAME') ?? str('HOSTNAME') ?? 'easycut',
  },

  limits: {
    /** Hard budget guard. A job that would exceed this is degraded, not billed. */
    maxCostShortUsd: num('MAX_COST_SHORT_USD', 1),
    maxCostLongUsd: num('MAX_COST_LONG_USD', 5),
    maxUploadMb: num('MAX_UPLOAD_MB', 4096),
    maxShortDurationSec: num('MAX_SHORT_DURATION_SEC', 90),
    maxLongDurationSec: num('MAX_LONG_DURATION_SEC', 600),
  },

  features: {
    reframe: bool('FEATURE_REFRAME', true),
    generatedImages: bool('FEATURE_GENERATED_IMAGES', true),
    broll: bool('FEATURE_BROLL', true),
    music: bool('FEATURE_MUSIC', true),
  },
} as const;

export interface Capability {
  key: string;
  label: string;
  configured: boolean;
  /** What the user loses if this stays unconfigured. */
  fallback: string;
  envVars: string[];
  /** Where to sign up — surfaced in the setup screen and docs. */
  signupUrl?: string;
}

export function capabilities(): Capability[] {
  return [
    {
      key: 'asr',
      label: 'Transcription',
      configured: Boolean(env.transcription.deepgramKey || env.transcription.groqKey || env.transcription.assemblyaiKey),
      fallback: 'Silence-only edit with no captions — the single biggest quality drop. Configure one.',
      envVars: ['DEEPGRAM_API_KEY', 'GROQ_API_KEY', 'ASSEMBLYAI_API_KEY'],
      signupUrl: 'https://console.deepgram.com/signup',
    },
    {
      key: 'llm',
      label: 'AI director',
      configured: Boolean(env.llm.anthropicKey || env.llm.geminiKey),
      fallback: 'Rule-based director: hook = first strong sentence, B-roll on noun-dense spans. Usable, less clever.',
      envVars: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY'],
      signupUrl: 'https://console.anthropic.com/',
    },
    {
      key: 'stock',
      label: 'B-roll library',
      configured: Boolean(env.stock.pexelsKey || env.stock.pixabayKey),
      fallback: 'No stock B-roll; generated images and graphics cover the cues instead.',
      envVars: ['PEXELS_API_KEY', 'PIXABAY_API_KEY'],
      signupUrl: 'https://www.pexels.com/api/',
    },
    {
      key: 'imagegen',
      label: 'Image generation',
      configured: Boolean(env.imagegen.replicateToken || env.imagegen.falKey),
      fallback: 'Icons come from the free Iconify set only; no bespoke illustrations.',
      envVars: ['REPLICATE_API_TOKEN', 'FAL_KEY'],
      signupUrl: 'https://replicate.com/account/api-tokens',
    },
    {
      key: 'storage',
      label: 'Cloud storage',
      configured: env.storage.driver === 's3' && Boolean(env.storage.bucket && env.storage.accessKeyId),
      fallback: 'Files stay on local disk. Fine for development, not for multiple workers.',
      envVars: ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_ENDPOINT'],
      signupUrl: 'https://dash.cloudflare.com/?to=/:account/r2',
    },
    {
      key: 'render',
      label: 'Cloud rendering',
      configured: env.render.driver === 'lambda' && Boolean(env.render.lambdaFunctionName),
      fallback: 'Renders on this machine. Correct, but a ten-minute video takes ~27 min on four cores instead of ~2.5.',
      envVars: ['REMOTION_LAMBDA_FUNCTION', 'REMOTION_SERVE_URL', 'AWS_ACCESS_KEY_ID'],
      signupUrl: 'https://www.remotion.dev/docs/lambda/setup',
    },
    {
      key: 'billing',
      label: 'Payments',
      configured: Boolean(env.stripe.secretKey && env.stripe.webhookSecret),
      fallback: 'Plans are enforced but cannot be bought — everyone stays on whatever plan their account says. That is a free beta, if you want one.',
      envVars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_STARTER'],
      signupUrl: 'https://dashboard.stripe.com/apikeys',
    },
    {
      key: 'queue',
      label: 'Durable job queue',
      configured: env.queue.driver === 'redis' && Boolean(env.queue.redisUrl),
      fallback: 'In-process queue. Jobs are lost if the server restarts mid-run.',
      envVars: ['REDIS_URL'],
      signupUrl: 'https://upstash.com/',
    },
    {
      key: 'alerts',
      label: 'Error alerts',
      configured: Boolean(env.errors.webhookUrl || env.errors.sentryDsn),
      fallback:
        'Failures are logged and deduplicated but nothing reaches you. A render that breaks at 2am ' +
        'waits in a log file until somebody looks. A Slack or Discord webhook URL is thirty seconds of setup.',
      envVars: ['ERROR_WEBHOOK_URL', 'SENTRY_DSN'],
      signupUrl: 'https://api.slack.com/messaging/webhooks',
    },
  ];
}

export function missingCriticalCapabilities(): Capability[] {
  return capabilities().filter((c) => !c.configured && (c.key === 'asr' || c.key === 'llm'));
}
