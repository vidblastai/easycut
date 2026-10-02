import { env } from '@/lib/config/env';

/**
 * Kie's job API: one createTask, then poll recordInfo.
 *
 * ── Why a second generation provider at all ─────────────────────────────
 *
 * Because the two things this product wants to generate have completely
 * different economics, and no single catalogue is best at both.
 *
 * A generated STILL is the cheap one and the fast one. Z-Image Turbo is
 * fractions of a cent and lands in seconds, and a still that pushes and drifts across
 * the frame for two and a half seconds reads as B-roll — which is the whole
 * job. Four of them is twelve cents inside a one-dollar short.
 *
 * A generated CLIP is neither. The same four inserts from Seedance 2.0 Fast at
 * 720p are $2.48 and about four minutes EACH, against a product that promises
 * a finished short in ninety seconds. Seedance 1.0 Pro Fast is the usable end
 * of that — sixteen credits for five seconds at 720p, eight cents — and even
 * that is a minute a clip.
 *
 * So the catalogue below carries the real price of everything, the caller
 * picks, and nothing here decides on anybody's behalf.
 *
 * ── The protocol ────────────────────────────────────────────────────────
 *
 * POST createTask with `{model, input}` and you get a `taskId`; GET recordInfo
 * with it until `state` leaves `waiting`/`queuing`/`generating`. The one trap
 * is that `resultJson` is a JSON STRING inside the JSON, not an object, so it
 * has to be parsed a second time.
 */

const API_BASE = 'https://api.kie.ai/api/v1/jobs';

export interface KieJob {
  /** The model id, e.g. `bytedance/v1-pro-text-to-video`. */
  model: string;
  input: Record<string, unknown>;
  /** Stills land in seconds and clips in minutes; callers pass their own. */
  timeoutMs: number;
  pollMs?: number;
}

export interface KieResult {
  urls: string[];
}

export function isKieConfigured(): boolean {
  return Boolean(env.kie.apiKey);
}

/**
 * Submit and wait. Throws on failure — every caller treats a missing asset as
 * "use the next source", never as a reason to fail the job.
 */
export async function runKieJob(job: KieJob): Promise<KieResult> {
  const key = env.kie.apiKey;
  if (!key) throw new Error('KIE_API_KEY is not set');

  const submit = await fetch(`${API_BASE}/createTask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: job.model, input: job.input }),
  });

  const submitted = (await submit.json().catch(() => ({}))) as {
    code?: number;
    msg?: string;
    data?: { taskId?: string };
  };

  // Kie answers 200 with a non-200 `code` for a rejected job, so the HTTP
  // status alone is not the answer — a submission that failed this way used to
  // fall through and poll a taskId of `undefined` until the deadline.
  const taskId = submitted.data?.taskId;
  if (!submit.ok || submitted.code !== 200 || !taskId) {
    throw new Error(
      `Kie ${job.model} refused the job: ${submitted.msg ?? `${submit.status} ${submit.statusText}`}`,
    );
  }

  const pollMs = job.pollMs ?? 2500;
  const deadline = Date.now() + job.timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));

    const response = await fetch(`${API_BASE}/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    const body = (await response.json().catch(() => ({}))) as {
      data?: { state?: string; resultJson?: string; failMsg?: string };
    };
    const data = body.data;

    if (data?.state === 'success') {
      const urls = parseResultUrls(data.resultJson);
      if (!urls.length) throw new Error(`Kie ${job.model} succeeded with no output`);
      return { urls };
    }
    if (data?.state === 'fail') {
      throw new Error(`Kie ${job.model} failed: ${data.failMsg || 'no reason given'}`);
    }
    // waiting | queuing | generating — and anything unrecognised, which is
    // treated as "still going" rather than as an error: a new state name
    // should slow a job down, not abandon it.
  }

  throw new Error(`Kie ${job.model} did not finish within ${Math.round(job.timeoutMs / 1000)}s`);
}

/**
 * `resultJson` is a JSON string INSIDE the JSON body.
 *
 * Not a quirk worth working around — it is what the API returns — but it is
 * worth isolating, because a malformed one should read as "no asset" and take
 * the next source, not throw a SyntaxError out of a polling loop.
 */
function parseResultUrls(resultJson?: string): string[] {
  if (!resultJson) return [];
  try {
    const parsed = JSON.parse(resultJson) as { resultUrls?: unknown };
    return Array.isArray(parsed.resultUrls)
      ? parsed.resultUrls.filter((u): u is string => typeof u === 'string')
      : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------- catalogue */

export interface KieVideoModel {
  id: string;
  label: string;
  /** USD per second of output, at the resolution below. */
  usdPerSec: number;
  resolution: '480p' | '720p' | '1080p';
  /** Roughly how long one clip takes to come back, for the time budget. */
  typicalSec: number;
  /** Durations the model will accept. A request off this list is refused. */
  durations: readonly number[];
  note: string;
}

/**
 * What a clip actually costs, per second, read off Kie's own model pages.
 *
 * These are the numbers the picker shows and the ledger charges, so they are
 * worth keeping honest: a price that drifts here is a budget that silently
 * stops meaning anything. Every one is for TEXT to video with no input clip —
 * Kie charges less per second when you hand it footage to work from, and none
 * of these do.
 */
export const KIE_VIDEO_MODELS: readonly KieVideoModel[] = [
  {
    id: 'bytedance/v1-lite-text-to-video',
    label: 'Seedance 1.0 Lite',
    usdPerSec: 0.0225,
    resolution: '720p',
    typicalSec: 45,
    durations: [5, 10],
    note: 'Cheapest. Softer detail, but it moves like footage.',
  },
  {
    id: 'bytedance/v1-pro-text-to-video',
    label: 'Seedance 1.0 Pro',
    usdPerSec: 0.03,
    resolution: '720p',
    typicalSec: 70,
    durations: [5, 10],
    note: 'The usable middle: better subjects, still about a minute.',
  },
  {
    id: 'bytedance/seedance-2-fast',
    label: 'Seedance 2.0 Fast',
    usdPerSec: 0.124,
    resolution: '720p',
    typicalSec: 240,
    durations: [4, 5, 6, 7, 8, 9, 10],
    note: 'Best picture by a distance. Four minutes and four times the price.',
  },
];

export function kieVideoModel(id: string): KieVideoModel {
  return KIE_VIDEO_MODELS.find((m) => m.id === id) ?? KIE_VIDEO_MODELS[1];
}

/**
 * Z-Image Turbo, which is the cheap one.
 *
 * It replaced GPT Image 2 at three cents a picture, and the saving is not
 * marginal: a ten-minute edit wants seventy-odd inserts, which is $2.10 of
 * stills against nine cents. For a B-roll insert — composited into one frame
 * of a 1080-wide video and then panned across — the extra detail three cents
 * buys is downscaled away before anybody sees it.
 *
 * Six billion parameters at eight steps, so it is also faster: measured at
 * nine seconds against twelve.
 *
 * It takes no `resolution`, unlike the model it replaced. Sending one is not
 * an error, which is the problem — the extra field is ignored in silence, so
 * a leftover would look like it was doing something.
 */
export const KIE_IMAGE_MODEL = 'z-image';
export const KIE_IMAGE_COST_USD = 0.004;
/** Measured in seconds, not minutes; this is the give-up point. */
export const KIE_IMAGE_TIMEOUT_MS = 120_000;
