import { env } from '@/lib/config/env';

/**
 * WaveSpeed's media API: one submit, then poll.
 *
 * Shared by generated images and generated B-roll video because the protocol
 * is identical and only the model path and the parameters differ — two copies
 * of a polling loop is two places for a timeout to be wrong.
 *
 * Note this is a DIFFERENT host from the LLM side (`llm.wavespeed.ai`), on the
 * same key. The director and the pictures are one account and one bill, which
 * is most of why this provider was chosen at all.
 */

const API_BASE = 'https://api.wavespeed.ai/api/v3';

export interface MediaJob {
  /** The model path, e.g. `lightricks/ltx-2-fast/text-to-video`. */
  model: string;
  input: Record<string, unknown>;
  /**
   * How long to wait before giving up.
   *
   * Images land in about six seconds and video in about two minutes, so one
   * shared timeout would either abandon video or leave a stuck image request
   * holding a pipeline slot for minutes. Callers pass their own.
   */
  timeoutMs: number;
  pollMs?: number;
}

export interface MediaResult {
  urls: string[];
  /** Server-reported inference time, which is the honest number for a budget. */
  inferenceMs: number | null;
}

export function isWavespeedMediaConfigured(): boolean {
  return Boolean(env.llm.wavespeedKey);
}

/**
 * Submit and wait. Throws on failure — every caller here treats a missing
 * asset as "use the next source", never as a reason to fail the job.
 */
export async function runMediaJob(job: MediaJob): Promise<MediaResult> {
  const key = env.llm.wavespeedKey;
  if (!key) throw new Error('WAVESPEED_API_KEY is not set');

  const submit = await fetch(`${API_BASE}/${job.model}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(job.input),
  });

  const submitted = (await submit.json().catch(() => ({}))) as {
    data?: { id?: string };
    message?: string;
  };

  if (!submit.ok || !submitted.data?.id) {
    throw new Error(
      `WaveSpeed ${job.model} refused the job: ${submitted.message ?? `${submit.status} ${submit.statusText}`}`,
    );
  }

  const id = submitted.data.id;
  const pollMs = job.pollMs ?? 2500;
  const deadline = Date.now() + job.timeoutMs;

  // A fixed interval rather than a fixed count: the two media types differ by
  // twenty times in duration, and a count that suits one is wrong for the other.
  while (Date.now() < deadline) {
    const response = await fetch(`${API_BASE}/predictions/${id}/result`, {
      headers: { authorization: `Bearer ${key}` },
    });
    const body = (await response.json().catch(() => ({}))) as {
      data?: {
        status?: string;
        outputs?: string[];
        error?: string;
        timings?: { inference?: number };
      };
    };
    const data = body.data;

    if (data?.status === 'completed') {
      const urls = data.outputs ?? [];
      if (!urls.length) throw new Error(`WaveSpeed ${job.model} completed with no output`);
      return { urls, inferenceMs: data.timings?.inference ?? null };
    }
    if (data?.status === 'failed') {
      throw new Error(`WaveSpeed ${job.model} failed: ${data.error ?? 'no reason given'}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(`WaveSpeed ${job.model} did not finish within ${Math.round(job.timeoutMs / 1000)}s`);
}
