import { pacingFor } from '@/lib/styles/presets';
import { normalizeWord } from '@/lib/transcribe/types';
import type { TranscriptSentence } from '@/lib/transcribe/types';
import type { DirectorBrief } from './prompt';
import { DirectorPlanSchema, type DirectorPlan } from './schema';

/**
 * The keyless director.
 *
 * It is genuinely useful, not a placeholder: it finds a hook, marks emphasis,
 * paces B-roll and graphics, and writes a social caption — just without taste.
 * Two reasons it exists:
 *
 *  1. The product must produce a finished video with zero API keys configured,
 *     so a developer can clone the repo and watch the whole pipeline run.
 *  2. When the LLM is down or returns garbage, a worse edit beats no edit.
 */

const STOPWORDS = new Set([
  'the','a','an','and','or','but','so','if','then','than','that','this','these','those','it','its',
  'i','you','he','she','we','they','me','him','her','us','them','my','your','his','their','our',
  'is','are','was','were','be','been','being','am','do','does','did','have','has','had','will','would',
  'can','could','should','shall','may','might','must','to','of','in','on','at','by','for','with','from',
  'about','into','over','after','before','just','like','really','very','actually','basically','okay','right',
  'what','when','where','who','how','why','not','no','yes','up','down','out','all','one','because','get','got',
]);

/** Words that signal a sentence is doing rhetorical work. */
const HOOK_SIGNALS = [
  'never','always','nobody','everyone','secret','mistake','wrong','truth','actually','stop','biggest',
  'worst','best','fastest','only','why','how','if you','most people','here is','here\'s','the problem',
];

const WEAK_ENDINGS = [
  'thanks for watching','that\'s it','that is it','so yeah','see you','subscribe','like and subscribe',
  'hope that helps','hope this helps','peace','bye',
];

export function runHeuristicDirector(brief: DirectorBrief): DirectorPlan {
  const { transcript, style, mode, windowStartSec, windowEndSec } = brief;
  const pacing = pacingFor(style, mode);

  const sentences = transcript.sentences.filter(
    (s) => s.endSec > windowStartSec && s.startSec < windowEndSec,
  );
  if (!sentences.length) return DirectorPlanSchema.parse({});

  const isFirstWindow = windowStartSec <= 0.01;
  const windowSec = Math.max(1, windowEndSec - windowStartSec);

  /* ---- hook: the highest-scoring standalone sentence in the first half ---- */
  let hook: DirectorPlan['hook'] = null;
  if (isFirstWindow && mode === 'short') {
    const candidates = sentences.slice(0, Math.max(1, Math.ceil(sentences.length * 0.6)));
    const scored = candidates
      .map((s, i) => ({ s, i, score: hookScore(s) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    // Only relocate if it's meaningfully better than simply starting at the top.
    if (best && best.i > 0 && best.score > hookScore(sentences[0]) + 1.5) {
      hook = { startSec: best.s.startSec, endSec: best.s.endSec, note: 'Strongest standalone line' };
    }
  }

  /* ------------------------- removals: weak sign-offs ------------------------- */
  const removals: DirectorPlan['removals'] = [];
  const last = sentences[sentences.length - 1];
  if (last && WEAK_ENDINGS.some((w) => last.text.toLowerCase().includes(w))) {
    removals.push({
      startSec: last.startSec,
      endSec: last.endSec,
      reason: 'weak-ending',
      confidence: 0.75,
      note: 'Trailing sign-off',
    });
  }

  /* ------------ emphasis: numbers, capitalised names, charged words ----------- */
  const emphasis: DirectorPlan['emphasis'] = [];
  for (const word of transcript.words) {
    if (word.startSec < windowStartSec || word.endSec > windowEndSec) continue;
    const raw = word.text.replace(/[^\w%$.-]/g, '');
    const isNumber = /\d/.test(raw);
    const isProperNoun = /^[A-Z][a-z]{2,}$/.test(raw);
    const isCharged = HOOK_SIGNALS.includes(normalizeWord(raw));
    if (isNumber || isProperNoun || isCharged) {
      emphasis.push({ startSec: word.startSec, endSec: word.endSec });
    }
  }

  /* ------------------ B-roll: one per pacing interval, on nouns --------------- */
  const broll: DirectorPlan['broll'] = [];
  const brollCount = Math.floor(windowSec / pacing.brollEverySec);
  for (let i = 0; i < brollCount; i++) {
    const targetSec = windowStartSec + pacing.brollEverySec * (i + 0.6);
    const sentence = sentenceAt(sentences, targetSec);
    if (!sentence) continue;
    const query = concreteQuery(sentence);
    if (!query) continue;
    broll.push({
      atSec: Math.max(sentence.startSec + 0.2, targetSec),
      durationSec: (pacing.brollDurationSec[0] + pacing.brollDurationSec[1]) / 2,
      query,
      intent: `Illustrates "${query}"`,
      kind: 'stock-video',
    });
  }

  /* ------------------- graphics: stats from numbers, else icons --------------- */
  const graphics: DirectorPlan['graphics'] = [];
  const graphicCount = Math.floor(windowSec / pacing.graphicEverySec);
  const usedSentences = new Set<number>();
  for (let i = 0; i < graphicCount; i++) {
    const targetSec = windowStartSec + pacing.graphicEverySec * (i + 0.45);
    const index = sentences.findIndex((s) => targetSec >= s.startSec && targetSec <= s.endSec);
    if (index < 0 || usedSentences.has(index)) continue;
    usedSentences.add(index);

    const sentence = sentences[index];
    const number = sentence.text.match(/\b(\d[\d,.]*\s?(?:%|x|k|m|bn|billion|million|thousand|hours?|days?|years?|dollars?)?)\b/i);

    if (number) {
      graphics.push({
        atSec: sentence.startSec + 0.25,
        durationSec: pacing.graphicDurationSec,
        type: 'stat',
        text: number[1].trim(),
        subtext: shortLabel(sentence),
        items: [],
        iconQuery: '',
        imagePrompt: '',
      });
    } else {
      const keyword = topKeyword(sentence);
      if (!keyword) continue;
      graphics.push({
        atSec: sentence.startSec + 0.25,
        durationSec: pacing.graphicDurationSec,
        type: 'icon',
        text: keyword,
        subtext: '',
        items: [],
        iconQuery: keyword,
        imagePrompt: '',
      });
    }
  }

  /* ------------------------------ sfx + punch-ins ----------------------------- */
  const sfx: DirectorPlan['sfx'] = [];
  for (const g of graphics) {
    if (Math.random() < pacing.sfxDensity) sfx.push({ atSec: g.atSec, sound: 'pop' });
  }
  for (const b of broll) {
    if (Math.random() < pacing.sfxDensity) sfx.push({ atSec: b.atSec, sound: 'whoosh' });
  }

  const punchIns: DirectorPlan['punchIns'] = [];
  const cadence = (pacing.punchInEverySec[0] + pacing.punchInEverySec[1]) / 2;
  for (let t = windowStartSec + cadence; t < windowEndSec - 2; t += cadence) {
    const sentence = sentenceAt(sentences, t);
    if (!sentence) continue;
    // Never punch in during a B-roll insert — the viewer can't see the camera move.
    if (broll.some((b) => t >= b.atSec - 0.5 && t <= b.atSec + b.durationSec + 0.5)) continue;
    punchIns.push({ atSec: sentence.startSec, durationSec: Math.min(3.5, sentence.endSec - sentence.startSec), intensity: 'medium' });
  }

  /* -------------------------------- chapters ---------------------------------- */
  const chapters: DirectorPlan['chapters'] = [];
  if (mode === 'long') {
    const every = 120;
    for (let t = windowStartSec + every; t < windowEndSec; t += every) {
      const sentence = sentenceAt(sentences, t);
      if (sentence) chapters.push({ atSec: sentence.startSec, title: shortLabel(sentence) });
    }
  }

  const headline = sentences[0] ? shortLabel(sentences[0]) : '';
  const keywords = Array.from(
    new Set(sentences.flatMap((s) => (topKeyword(s) ? [topKeyword(s)!] : []))),
  ).slice(0, 5);

  return DirectorPlanSchema.parse({
    hook,
    removals,
    emphasis,
    broll,
    graphics,
    sfx,
    punchIns,
    chapters,
    titleCard: mode === 'long' && isFirstWindow ? { text: headline, subtext: '' } : null,
    lowerThird: null,
    musicMood: style.musicMood,
    deliverable: isFirstWindow
      ? {
          title: headline,
          socialCaption: sentences.slice(0, 2).map((s) => s.text).join(' ').slice(0, 220),
          hashtags: keywords.map((k) => `#${k.replace(/\s+/g, '')}`),
        }
      : { title: '', socialCaption: '', hashtags: [] },
    reasoning: 'Rule-based edit (no AI director configured): paced layers with keyword-driven cues.',
  });
}

/* --------------------------------- helpers --------------------------------- */

function hookScore(sentence: TranscriptSentence): number {
  const text = sentence.text.toLowerCase();
  const words = text.split(/\s+/).length;
  let score = 0;

  if (/\d/.test(text)) score += 2;
  if (text.includes('?')) score += 1.5;
  if (HOOK_SIGNALS.some((sig) => text.includes(sig))) score += 2.5;
  // A hook needs to be a whole thought, but not a paragraph.
  if (words >= 6 && words <= 22) score += 2;
  else if (words > 30) score -= 2;
  // Anything opening with a connective depends on what came before it.
  if (/^(and|but|so|because|then|also|which|that's why)\b/.test(text)) score -= 4;

  return score;
}

function sentenceAt(sentences: TranscriptSentence[], sec: number): TranscriptSentence | null {
  return (
    sentences.find((s) => sec >= s.startSec && sec <= s.endSec) ??
    sentences.find((s) => s.startSec >= sec) ??
    null
  );
}

/** Two content words, which is about as specific as a stock query should be. */
function concreteQuery(sentence: TranscriptSentence): string | null {
  const words = contentWords(sentence);
  if (!words.length) return null;
  return words.slice(0, 2).join(' ');
}

function topKeyword(sentence: TranscriptSentence): string | null {
  return contentWords(sentence)[0] ?? null;
}

function contentWords(sentence: TranscriptSentence): string[] {
  return sentence.text
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w))
    // Longer words are, crudely but reliably, more specific.
    .sort((a, b) => b.length - a.length);
}

function shortLabel(sentence: TranscriptSentence): string {
  const words = sentence.text.replace(/[.!?]+$/, '').split(/\s+/);
  return words.slice(0, 6).join(' ');
}
