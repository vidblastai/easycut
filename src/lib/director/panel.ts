import { env } from '@/lib/config/env';
import { packFor } from '@/lib/lang';
import { languageBrief } from './prompt';
import { PANEL_KINDS, PanelSceneSchema, type PanelScene } from '@/lib/edl/types';
import type { Transcript } from '@/lib/transcribe/types';
import { wavespeedPriceFor } from './wavespeed';

/**
 * The explainer panel's script.
 *
 * ── What it is writing ──────────────────────────────────────────────────
 *
 * The top 42.5% of the frame, for the whole video, as a run of 1.5–2.5s
 * exhibits above a speaker who never stops talking. Measured off two
 * reference edits: 43 and 44 seconds, 20 and 25 panel scenes respectively —
 * roughly one every other second, which is far denser than anything else
 * this product places and is the single thing that makes the format work.
 *
 * ── Why a model and not a rule ──────────────────────────────────────────
 *
 * Every other placement pass here is bookkeeping with an exact answer —
 * which sentence gets the zoom, which nouns group into a row. This one is
 * not. "Er holt sich direkt alle Zahlen von den Reels" has to become a
 * dashboard card with three stat columns and the eyebrow "DIE ZAHLEN · AUS
 * DEINEN REELS", and no rule gets from the sentence to the exhibit. It is
 * the one genuinely creative decision in the edit.
 *
 * ── The one thing it must not do ────────────────────────────────────────
 *
 * Invent a figure. The reference edits show their own analytics, so their
 * numbers are true; a product that generates "19.718 views" over somebody
 * else's claim has put a fabricated statistic on screen in their voice.
 * Every number on the panel comes from the transcript, and a scene with no
 * number in the speech shows the interface without one.
 */

const API_BASE = 'https://llm.wavespeed.ai/v1';

/** How long one exhibit holds, before and after the model's own judgement. */
const MIN_SEC = 1.2;
const MAX_SEC = 3.2;

export interface PanelPassResult {
  scenes: PanelScene[];
  costUsd: number;
  model: string;
  error?: string;
}

const SYSTEM = `You write the top half of a vertical explainer video.

The frame is split. The bottom 57% is the person talking, the whole way through. The top 42% is a panel you are writing: a run of small exhibits, each on screen for about two seconds, each one a MOCK OF AN INTERFACE or a measurement that shows what the voice is describing right now.

This is the format that AI-news creators use and it works for one reason: a viewer believes a claim about a product when they are looking at the product. A drawn icon of a chart says "statistics". A card counting up to a real number while the voice says that number says the thing happened.

## The exhibits you can write

- "icon-hub" — a hub with app icons around it and a line drawn to each in turn, a green tick landing on each as it connects. For "it plugs into Instagram, LinkedIn, YouTube". \`icons\` are the brand names, in English.
- "counter" — one figure running up, a label under it, a grid of cells filling behind it. For a quantity the voice states: "1500 more apps", "700 people".
- "stat-card" — a card of two or three stat columns counting from zero. \`label\` is the card's title, \`items\` are the column names, \`values\` the figures. For "it pulls all the numbers".
- "rank-list" — rows with bars and a figure each; one of them fills with the accent colour and wins. \`winner\` is its index. For "it tells you which format is working".
- "chat-card" — a compose window writing itself a line at a time. \`label\` is the tool's name, \`items\` are the lines it writes. For "it drafts the next post".
- "list-panel" — a list that grows under a count: comments, files, takes, messages. \`figure\` is the count, \`label\` what they are, \`items\` the rows.
- "toggle-pair" — two things and a switch between them that flips on. \`items\` are their two names. For "connect A to B".
- "hero-image" — one generated picture, held still. Use for a physical thing with no interface: a brain, a crowd, a machine.

## Rules

1. **The panel is never empty.** Your scenes must cover the whole runtime end to end with no gaps. The first starts at 0.
2. **One scene per idea, 1.5 to 2.5 seconds.** A 40-second video wants about 18 to 22 scenes. Fewer than 15 and the panel reads as a slideshow.
3. **A number said out loud is a "counter" or a "stat-card".** It is the format's loudest moment and the easiest to waste: if the voice says "1500 more apps" and the panel is showing a list, the one thing the viewer could have been shown is the thing they were told. Scan the transcript for figures first and place those exhibits before anything else.
4. **Write a figure the way that language writes it** — "1.500" in German, "1,500" in English — or write it with no separator at all. It is rendered exactly as given.
5. **Every number comes from the speech.** If the speaker says no number in a passage, the exhibit has no number in it — write the interface without one. Never invent a statistic, a view count or a price.
6. **The eyebrow is two parts**, in the speaker's language, each two or three words, and it names what the viewer is looking at: ["DIE ZAHLEN", "AUS DEINEN REELS"], ["DER SCHNITT", "UND DER UPLOAD"]. Not a sentence, not a summary of the speech.
7. **The chip is a verdict**, three or four words, and most scenes have one: "HOLT SICH ALLES SELBST", "KEINE BLEIBT LIEGEN". Leave it empty when nothing is worth saying.
8. **Short words.** An item is one to four words. These are labels inside a mock interface, not sentences.
9. **\`icons\` are English brand or object names** — "instagram", "linkedin", "youtube", "facebook", "figma", "notion". They are looked up in an icon library, so a German word finds nothing.
10. **Vary the kind.** Across the whole video use at least five of the eight. Three "list-panel" in a row is a slideshow of one card. The reference never repeats a kind twice running.`;

const jsonSchema = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startSec: { type: 'number' },
          endSec: { type: 'number' },
          kind: { type: 'string', enum: [...PANEL_KINDS] },
          eyebrowA: { type: 'string' },
          eyebrowB: { type: 'string' },
          chip: { type: 'string' },
          label: { type: 'string' },
          figure: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
          values: { type: 'array', items: { type: 'string' } },
          icons: { type: 'array', items: { type: 'string' } },
          winner: { type: 'integer' },
          imagePrompt: { type: 'string' },
          reason: { type: 'string' },
        },
        required: [
          'startSec', 'endSec', 'kind', 'eyebrowA', 'eyebrowB', 'chip', 'label',
          'figure', 'items', 'values', 'icons', 'winner', 'imagePrompt', 'reason',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['scenes'],
  additionalProperties: false,
} as const;

export function isPanelPassConfigured(): boolean {
  return Boolean(env.llm.wavespeedKey && env.llm.motionModel);
}

export async function writePanel(
  transcript: Transcript,
  durationSec: number,
): Promise<PanelPassResult> {
  const model = env.llm.motionModel;
  if (!isPanelPassConfigured()) {
    return { scenes: [], costUsd: 0, model, error: 'no model configured' };
  }

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
          { role: 'user', content: briefFor(transcript, durationSec) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'explainer_panel', strict: true, schema: jsonSchema },
        },
        max_tokens: 16000,
        temperature: 0.4,
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
    if (choice?.finish_reason === 'length') throw new Error('ran out of output tokens');
    const text = choice?.message?.content ?? '';
    if (!text.trim()) throw new Error('empty response');

    if (process.env.PANEL_DEBUG) console.log('\n---RAW---\n' + text.slice(0, 1500));
    const raw = JSON.parse(unfence(text)) as { scenes?: unknown[] };
    const scenes = sanitisePanel((raw.scenes ?? []) as RawScene[], durationSec);

    const pricing = wavespeedPriceFor(model);
    const costUsd =
      ((body.usage?.prompt_tokens ?? 0) / 1_000_000) * pricing.inputPerMTok +
      ((body.usage?.completion_tokens ?? 0) / 1_000_000) * pricing.outputPerMTok;

    return { scenes, costUsd, model };
  } catch (error) {
    return {
      scenes: [],
      costUsd: 0,
      model,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * What comes back, in either of the two shapes it comes back in.
 *
 * `strict: true` on a json_schema is honoured by the Gemini models through
 * this endpoint and is NOT honoured by Opus through it: asked for
 * `startSec`/`eyebrowA`/`eyebrowB` it returned `start`/`end` and a two-item
 * `eyebrow` array, which is a better shape than the one the schema asked
 * for and parsed to nothing at all. Every field here therefore has its
 * aliases, because a pass that silently yields zero scenes is the most
 * expensive kind of wrong — the panel is simply absent and the render
 * succeeds.
 */
interface RawScene {
  startSec?: number;
  endSec?: number;
  start?: number;
  end?: number;
  atSec?: number;
  kind?: string;
  eyebrow?: unknown;
  eyebrowA?: string;
  eyebrowB?: string;
  chip?: string;
  label?: string;
  figure?: string | number;
  items?: unknown;
  values?: unknown;
  icons?: unknown;
  winner?: number;
  imagePrompt?: string;
  reason?: string;
}

function num(...values: Array<unknown>): number | null {
  for (const v of values) {
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return null;
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v ?? '').trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

/** The two halves of the eyebrow, however they arrived. */
function eyebrowOf(s: RawScene): [string, string] {
  const pair = list(s.eyebrow);
  const a = s.eyebrowA ?? pair[0] ?? '';
  const b = s.eyebrowB ?? pair[1] ?? '';
  return [words(a, 3).toUpperCase(), words(b, 4).toUpperCase()];
}

/**
 * Make the run continuous, and cut the words to label length.
 *
 * Two different jobs and both have to happen here rather than in the prompt.
 * A model asked for scenes that abut will hand back a gap of 0.3s somewhere
 * in the middle, and a gap in this layout is not a pause — it is the top
 * four tenths of the frame going blank, which reads as a bug. And a model
 * that has just read a transcript writes items as sentences however many
 * times it is told they are labels.
 */
export function sanitisePanel(raw: RawScene[], durationSec: number): PanelScene[] {
  const ordered = raw
    .map((s) => ({
      ...s,
      startSec: Math.max(0, num(s.startSec, s.start, s.atSec) ?? 0),
      endSec: num(s.endSec, s.end) ?? 0,
    }))
    .filter((s) => s.endSec > s.startSec)
    .sort((a, b) => a.startSec - b.startSec);

  const out: PanelScene[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i];
    // Butt each scene against the next, and the last one against the end.
    const start = i === 0 ? 0 : out[out.length - 1].outEndSec;
    const nextStart = i + 1 < ordered.length ? Math.max(ordered[i + 1].startSec, start + MIN_SEC) : durationSec;
    const end = Math.min(durationSec, Math.max(start + MIN_SEC, Math.min(nextStart, start + MAX_SEC)));
    if (end <= start + 0.2) continue;

    /*
     * A hub with nothing to connect to is a logo on its own.
     *
     * The model fills `icons` most of the time and not every time, and the
     * failure is silent: `icon-hub` still renders, as one tile in an empty
     * panel with no lines going anywhere. Demote rather than drop — the
     * passage still needs something above it, and two named things are a
     * toggle while a list of them is a list.
     */
    let kind = PANEL_KINDS.includes(s.kind as never) ? (s.kind as PanelScene['kind']) : 'list-panel';
    const icons = list(s.icons).slice(0, 4).map((t) => t.toLowerCase());
    const items = list(s.items).slice(0, 4).map((t) => words(t, 4)).filter(Boolean);
    const values = list(s.values).slice(0, 4).map((t) => t.slice(0, 10));
    const figure = String(s.figure ?? '').trim().slice(0, 14);
    const imagePrompt = (s.imagePrompt ?? '').trim();
    const can = renderable({ icons, items, values, figure, imagePrompt });

    if (!can.includes(kind)) kind = can[0] ?? 'list-panel';

    /*
     * Never the same exhibit twice running.
     *
     * Counted off the references: neither repeats a kind back to back in 45
     * scenes. Left to itself the model does — seventeen of thirty-eight
     * scenes came back as `list-panel` on an English transcript, which is a
     * slideshow of one card rather than a panel. Rotating to the next kind
     * the scene's own data can actually render is deterministic, costs
     * nothing, and cannot produce an exhibit with nothing in it.
     */
    const previous = out[out.length - 1]?.kind;
    if (kind === previous) kind = can.find((k) => k !== previous) ?? kind;

    out.push(
      PanelSceneSchema.parse({
        id: `panel-${i}`,
        outStartSec: Number(start.toFixed(2)),
        outEndSec: Number(end.toFixed(2)),
        kind,
        eyebrow: eyebrowOf(s),
        chip: words(s.chip, 5).toUpperCase(),
        label: words(s.label, 4),
        figure,
        items,
        values,
        icons,
        iconSvgs: [],
        imageUrl: '',
        imagePrompt: imagePrompt.slice(0, 300),
        winner: typeof s.winner === 'number' && s.winner >= 0 ? s.winner : -1,
        reason: (s.reason ?? '').slice(0, 120),
      }),
    );
  }

  // Nothing may be left uncovered: the panel going blank reads as a fault.
  if (out.length) out[out.length - 1].outEndSec = durationSec;
  return out;
}

/**
 * The JSON out of whatever the model wrapped it in.
 *
 * `response_format: json_schema` is a request, not a guarantee: the same
 * model and the same endpoint returned bare JSON on one call and a ```json
 * fence on the next. Both are easy to read and a parser that handles only
 * the first loses the whole panel to a pair of backticks.
 */
function unfence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

/**
 * Which exhibits this scene's own data could actually draw, best first.
 *
 * Not a preference list: a `counter` with no figure is a blank panel and a
 * `toggle-pair` with one item is half a switch. Everything that reaches the
 * renderer has something to render.
 */
function renderable(data: {
  icons: string[];
  items: string[];
  values: string[];
  figure: string;
  imagePrompt: string;
}): Array<PanelScene['kind']> {
  const out: Array<PanelScene['kind']> = [];
  if (data.figure && data.items.length && data.values.length) out.push('stat-card');
  if (data.figure) out.push('counter');
  if (data.icons.length >= 2) out.push('icon-hub');
  if (data.imagePrompt) out.push('hero-image');
  if (data.items.length >= 2 && data.values.length >= 2) out.push('rank-list');
  if (data.items.length === 2) out.push('toggle-pair');
  if (data.items.length >= 2) out.push('rank-list');
  if (data.items.length) out.push('chat-card', 'list-panel');
  return [...new Set(out)];
}

function words(text: string | undefined, max: number): string {
  return (text ?? '').trim().split(/\s+/).filter(Boolean).slice(0, max).join(' ');
}

function briefFor(transcript: Transcript, durationSec: number): string {
  const lines = transcript.sentences
    .map((s) => `[${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)}] ${s.text}`)
    .join('\n');

  /*
   * Hand it the figures rather than asking it to find them.
   *
   * Told in the system prompt that a spoken number is the loudest moment in
   * the format, the model wrote twenty-three scenes over a transcript with a
   * figure in it and not one counter. Finding numbers in a transcript is
   * bookkeeping with an exact answer — the same reasoning that keeps the
   * camera-move script out of a prompt — so it is done here and passed in as
   * a list of moments that are already spoken for.
   */
  const figures = figuresIn(transcript);
  const figureBrief = figures.length
    ? `\nFIGURES THE SPEAKER SAYS — each of these is a "counter" or a "stat-card", at that moment, showing that number:\n${figures
        .map((f) => `  ${f.atSec.toFixed(1)}s — "${f.text}"`)
        .join('\n')}\n`
    : '\nThe speaker says no figures, so no exhibit carries a number.\n';

  return `The video is ${durationSec.toFixed(1)} seconds long. Write about ${Math.round(durationSec / 2)} panel scenes covering all of it, starting at 0.
${languageBrief(transcript.language)}${figureBrief}
TRANSCRIPT:
${lines}

Return {"scenes": [...]} and nothing else. Fill "reason" with the half-sentence of speech each exhibit is showing.`;
}

/** Where a number is actually said, and what was said around it. */
function figuresIn(transcript: Transcript): Array<{ atSec: number; text: string }> {
  const pack = packFor(transcript.language);
  const out: Array<{ atSec: number; text: string }> = [];
  for (const word of transcript.words) {
    if (!pack.punch.figure.test(word.text)) continue;
    if (out.length && word.startSec - out[out.length - 1].atSec < 1.2) continue;
    const sentence = transcript.sentences.find(
      (s) => word.startSec >= s.startSec && word.startSec <= s.endSec,
    );
    out.push({ atSec: word.startSec, text: sentence?.text ?? word.text });
  }
  return out.slice(0, 8);
}
