import { env } from '@/lib/config/env';
import { wavespeedPriceFor } from './wavespeed';

/**
 * The second look at a pair of sentences that might be the same line twice.
 *
 * `timeline/paraphrase` settles most pairs on the words alone, and it is
 * right to: the verbatim retake, the tightened retake, the enumerated list
 * that only looks like a retake. What it cannot settle is the band in the
 * middle —
 *
 *     "We grew forty percent."   /   "We grew fifty percent."
 *     "Shoot it at f/2.8."       /   "Shoot it wide open."
 *
 * — where the answer is not in the vocabulary. The first pair is either a
 * speaker correcting himself or two real figures; the second is the same
 * instruction twice in different language, or two different instructions.
 * A reader knows instantly. A bag of words never will.
 *
 * So the ambiguous pairs, and only those, go to the model in one batched
 * call. Everything about the call is built to keep the edit reproducible:
 *
 *  - `temperature: 0`, because someone re-running the same footage expects
 *    the same cut.
 *  - verdicts cached by the exact pair of sentences, so the same pair asked
 *    twice in one run cannot come back two different ways.
 *  - a failure is not an error. No key, no credit, no network: the pass
 *    returns nothing, the deterministic score stands, and a `maybe` sits
 *    below the preset's confidence floor — flagged in the review panel,
 *    not cut. The one thing this must never do is turn a flaky request into
 *    a lost sentence.
 */

const API_BASE = 'https://llm.wavespeed.ai/v1';

/** Pairs per request. Small enough to stay sharp, big enough to be one call. */
const BATCH = 24;

export interface RestatementQuestion {
  id: string;
  earlier: string;
  later: string;
  /** Silence between the two, in seconds — a correction comes immediately. */
  gapSec: number;
  /** What the deterministic pass already worked out, as context. */
  reasons: string[];
}

export interface RestatementAnswer {
  id: string;
  verdict: 'restated' | 'different' | 'unsure';
  /** Which take to keep. Only meaningful when `verdict` is `restated`. */
  keep: 'earlier' | 'later';
  why: string;
}

export interface RestatementReview {
  answers: Map<string, RestatementAnswer>;
  costUsd: number;
  model: string;
  /** Set when the pass could not run; the deterministic verdict then stands. */
  error?: string;
}

const SYSTEM = `You are a video editor's assistant, reading a transcript of someone talking to camera.

Creators flub a line and say it again. Usually the second go is reworded, not repeated — "so the point is you have to start" becomes "what I'm saying is you just need to begin". Both are in the footage; only one belongs in the edit.

For each pair of consecutive sentences, decide:

- "restated" — the same single thought said twice. The second one is a retake of the first, or the first was a run-up to the second. Cutting one of them loses NOTHING the viewer needs.
- "different" — two things worth saying. A list of steps, two figures, a claim and then its reason, a question and its answer. Cutting either one loses information.
- "unsure" — you genuinely cannot tell from the words.

Then say which take to keep:
- "later" by default: people retry until they get it right, so the last attempt is the one they meant.
- "earlier" when the later one is clearly worse: cut off mid-sentence, trailing away, or garbled.

Be conservative. "different" is the safe answer and a wrongly cut sentence is far worse than a repetition left in. Specifically, mark "different" when:
- the two carry different numbers and the speaker had moved on (not an immediate correction),
- one adds a condition, an exception, or a consequence the other does not,
- they are two items in a sequence ("first… then…"),
- the second one answers or builds on the first instead of replacing it.

Mark "restated" when the two sentences would be interchangeable to a viewer who heard only one of them.

Keep "why" under 12 words.`;

const schema = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['restated', 'different', 'unsure'] },
          keep: { type: 'string', enum: ['earlier', 'later'] },
          why: { type: 'string' },
        },
        required: ['id', 'verdict', 'keep', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
} as const;

/** Verdicts already settled this process, keyed by the exact pair. */
const cache = new Map<string, RestatementAnswer>();

function cacheKey(q: RestatementQuestion): string {
  return `${q.earlier.trim()}\u0000${q.later.trim()}`;
}

export function isRetakeReaderConfigured(): boolean {
  return Boolean(env.llm.wavespeedKey);
}

export async function reviewRestatements(
  questions: RestatementQuestion[],
): Promise<RestatementReview> {
  const model = env.llm.wavespeedModel;
  const answers = new Map<string, RestatementAnswer>();
  if (!questions.length) return { answers, costUsd: 0, model };

  const unseen: RestatementQuestion[] = [];
  for (const q of questions) {
    const hit = cache.get(cacheKey(q));
    if (hit) answers.set(q.id, { ...hit, id: q.id });
    else unseen.push(q);
  }
  if (!unseen.length) return { answers, costUsd: 0, model };

  if (!isRetakeReaderConfigured()) {
    return { answers, costUsd: 0, model, error: 'no LLM key — kept the cautious verdict' };
  }

  const batches: RestatementQuestion[][] = [];
  for (let i = 0; i < unseen.length; i += BATCH) batches.push(unseen.slice(i, i + BATCH));

  let costUsd = 0;
  const errors: string[] = [];

  const results = await Promise.all(batches.map((batch) => askBatch(batch, model)));
  for (const result of results) {
    costUsd += result.costUsd;
    if (result.error) errors.push(result.error);
    for (const answer of result.answers) {
      answers.set(answer.id, answer);
      const question = unseen.find((q) => q.id === answer.id);
      if (question) cache.set(cacheKey(question), answer);
    }
  }

  return {
    answers,
    costUsd,
    model,
    error: errors.length ? errors[0] : undefined,
  };
}

async function askBatch(
  batch: RestatementQuestion[],
  model: string,
): Promise<{ answers: RestatementAnswer[]; costUsd: number; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.llm.wavespeedKey!}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: briefFor(batch) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'restatement_verdicts', strict: true, schema },
        },
        /*
         * Generous, and deliberately so. A reasoning model spends tokens
         * thinking before it writes, and they come out of the same budget —
         * a tight ceiling cuts the JSON off mid-string, which arrives as
         * "unterminated string" and looks like a parser bug.
         */
        max_tokens: Math.max(2000, 160 * batch.length),
        // Not 0.3, not 0.4: this decides whether a sentence survives, and the
        // same footage has to cut the same way every time it is run.
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(body.error?.message ?? `${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = body.choices?.[0];
    const text = choice?.message?.content ?? '';
    if (choice?.finish_reason === 'length') throw new Error('ran out of output tokens');
    if (!text.trim()) throw new Error('empty response');

    const raw = JSON.parse(text) as { verdicts?: unknown[] };
    const ids = new Set(batch.map((q) => q.id));
    const answers = (raw.verdicts ?? [])
      .map((v) => v as Partial<RestatementAnswer>)
      .filter(
        (v): v is RestatementAnswer =>
          typeof v.id === 'string' &&
          ids.has(v.id) &&
          (v.verdict === 'restated' || v.verdict === 'different' || v.verdict === 'unsure'),
      )
      .map((v) => ({ ...v, keep: v.keep === 'earlier' ? 'earlier' : 'later' }) as RestatementAnswer);

    const pricing = wavespeedPriceFor(model);
    const costUsd =
      ((body.usage?.prompt_tokens ?? 0) / 1_000_000) * pricing.inputPerMTok +
      ((body.usage?.completion_tokens ?? 0) / 1_000_000) * pricing.outputPerMTok;

    return { answers, costUsd };
  } catch (error) {
    return {
      answers: [],
      costUsd: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function briefFor(batch: RestatementQuestion[]): string {
  const pairs = batch.map((q) => {
    const gap =
      q.gapSec < 0.6
        ? 'said back to back, no pause'
        : `${q.gapSec.toFixed(1)}s of silence between them`;
    const noted = q.reasons.length ? `\nnoticed: ${q.reasons.join('; ')}` : '';
    return `id: ${q.id}\nA: "${q.earlier.trim()}"\nB: "${q.later.trim()}"\n(${gap})${noted}`;
  });

  return `${batch.length} pair${batch.length === 1 ? '' : 's'} to judge. A comes first in the footage, B right after.

${pairs.join('\n\n')}

Return one verdict per id.`;
}
