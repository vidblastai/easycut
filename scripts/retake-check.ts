import '../src/lib/config/load-env';
import { restatementEvidence, coreOf } from '../src/lib/timeline/paraphrase';
import { isRetakeReaderConfigured, reviewRestatements } from '../src/lib/director/retakes';

/**
 * `npm run retakes` — does the retake detector agree with a human?
 *
 * Every pair below is one a creator actually produces, with the answer an
 * editor would give. Two kinds of mistake are possible and they are not
 * equally bad: leaving a repetition in is a blemish, cutting a real sentence
 * is a hole in the video. So `want` is the editorial answer, and a pair that
 * lands in `maybe` instead of `restated` is a near miss, while one that
 * lands in `restated` instead of `different` is a failure.
 *
 * The `maybe` band is then sent to the reader, which is the only part of this
 * that costs anything (a fraction of a cent for the lot).
 */

type Want = 'restated' | 'different' | 'either';

const PAIRS: Array<{ a: string; b: string; gap: number; want: Want; note: string }> = [
  {
    a: 'So the point is you have to start.',
    b: "What I'm saying is you just need to begin.",
    gap: 0.8,
    want: 'restated',
    note: 'the reworded retake — two shared words',
  },
  {
    a: 'We grew about forty percent last year, I think.',
    b: 'We grew forty percent.',
    gap: 1.2,
    want: 'restated',
    note: 'tightened on the second go',
  },
  {
    a: 'You should always shoot in log.',
    b: 'You always want to film in log.',
    gap: 1,
    want: 'restated',
    note: 'every content word swapped',
  },
  {
    a: 'This completely changed how I edit.',
    b: 'This changed my entire editing process.',
    gap: 0.5,
    want: 'restated',
    note: 'same claim, different nouns',
  },
  {
    a: 'Most people quit in the first month.',
    b: 'Let me rephrase: almost everybody gives up within thirty days.',
    gap: 1.4,
    want: 'restated',
    note: 'announced reword, figures restated as words',
  },
  {
    a: 'Then you add the music.',
    b: 'Then you add the captions.',
    gap: 2,
    want: 'different',
    note: 'two steps of a list',
  },
  {
    a: 'First you need a tripod.',
    b: 'Second you need a light.',
    gap: 2,
    want: 'different',
    note: 'enumeration',
  },
  {
    a: 'Set the shutter to fifty.',
    b: 'Set the shutter to one hundred.',
    gap: 4,
    want: 'different',
    note: 'two real settings',
  },
  {
    a: 'We shoot everything on the Sony A7.',
    b: 'We edit everything in Premiere Pro.',
    gap: 1,
    want: 'different',
    note: 'parallel shape, unrelated facts',
  },
  {
    a: 'This is the best camera under a thousand dollars.',
    b: 'In other words, nothing else at this price comes close.',
    gap: 0.6,
    want: 'different',
    note: 'announced, but the second one earns its place',
  },
  {
    a: 'It takes about ten minutes.',
    b: 'It takes ten minutes if your footage is already organised.',
    gap: 0.8,
    want: 'restated',
    note: 'the second qualifies the first — the qualified take is the keeper',
  },
  {
    a: 'It takes ten minutes if your footage is already organised.',
    b: 'It takes about ten minutes.',
    gap: 0.8,
    want: 'either',
    note: 'the same pair backwards — cutting the condition needs a reader',
  },
  {
    a: 'We grew forty percent.',
    b: 'We grew fifty percent.',
    gap: 0.4,
    want: 'either',
    note: 'a correction, or the next figure — only a reader can say',
  },
  {
    a: 'Shoot it at f/2.8.',
    b: 'Shoot it wide open.',
    gap: 0.6,
    want: 'either',
    note: 'the same instruction in two languages',
  },
];

function fail(want: Want, got: string): boolean {
  if (want === 'either') return false;
  if (want === 'restated') return got === 'different';
  return got === 'restated';
}

async function main() {
  const questions: Array<{ id: string; earlier: string; later: string; gapSec: number; reasons: string[] }> = [];
  let misses = 0;

  console.log('\n  the words alone\n');
  PAIRS.forEach((pair, i) => {
    const evidence = restatementEvidence(pair.a, pair.b, pair.gap);
    const bad = fail(pair.want, evidence.verdict);
    if (bad) misses++;
    const mark = bad ? '  WRONG' : evidence.verdict === pair.want ? '      ✓' : '      ·';
    console.log(`${mark} ${evidence.verdict.padEnd(9)} ${evidence.score.toFixed(2)}  ${pair.note}`);
    console.log(`          want ${pair.want}  ·  ${evidence.reasons.join('; ') || 'nothing notable'}`);
    console.log(`          A [${coreOf(pair.a).tokens.join(' ')}]`);
    console.log(`          B [${coreOf(pair.b).tokens.join(' ')}]`);
    if (evidence.verdict === 'maybe') {
      questions.push({
        id: String(i),
        earlier: pair.a,
        later: pair.b,
        gapSec: pair.gap,
        reasons: evidence.reasons,
      });
    }
  });

  console.log(`\n  ${PAIRS.length - misses}/${PAIRS.length} judged safely without a model\n`);

  if (!questions.length) return;
  if (!isRetakeReaderConfigured()) {
    console.log('  no LLM key — the unsettled pairs stay in the video, flagged\n');
    return;
  }

  console.log(`  asking a reader about ${questions.length}\n`);
  const read = await reviewRestatements(questions);
  for (const q of questions) {
    const answer = read.answers.get(q.id);
    const pair = PAIRS[Number(q.id)];
    console.log(`      ${(answer?.verdict ?? 'no answer').padEnd(9)} keep ${answer?.keep ?? '—'}  ${pair.note}`);
    if (answer?.why) console.log(`          "${answer.why}"`);
  }
  console.log(`\n  ${read.model} · $${read.costUsd.toFixed(5)}${read.error ? ` · ${read.error}` : ''}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
