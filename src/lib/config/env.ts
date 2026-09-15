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
    driver: (str('QUEUE_DRIVER') ?? 'memory') as 'memory' | 'db' | 'redis',
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
    concurrency: num('RENDER_CONCURRENCY', 4),
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
      fallback: 'Renders on this machine. Correct, but roughly 8× slower for long-form.',
      envVars: ['REMOTION_LAMBDA_FUNCTION', 'REMOTION_SERVE_URL', 'AWS_ACCESS_KEY_ID'],
      signupUrl: 'https://www.remotion.dev/docs/lambda/setup',
    },
    {
      key: 'queue',
      label: 'Durable job queue',
      configured: env.queue.driver === 'redis' && Boolean(env.queue.redisUrl),
      fallback: 'In-process queue. Jobs are lost if the server restarts mid-run.',
      envVars: ['REDIS_URL'],
      signupUrl: 'https://upstash.com/',
    },
  ];
}

export function missingCriticalCapabilities(): Capability[] {
  return capabilities().filter((c) => !c.configured && (c.key === 'asr' || c.key === 'llm'));
}
