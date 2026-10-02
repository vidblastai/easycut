import { readFile } from 'node:fs/promises';
import '../src/lib/config/load-env';
import { buildEdl } from '../src/lib/edl/builder';
import { DirectorPlanSchema } from '../src/lib/director/schema';
import { getStyle, STYLE_LIST, type FormatMode } from '../src/lib/styles/presets';
import { layoutSegments } from '../src/lib/timeline/time-mapper';
import { deriveSentences, type TranscriptWord } from '../src/lib/transcribe/types';

/**
 * What the camera would do to a script, printed rather than rendered.
 *
 * Where a punch-in GOES is a question about the words, so it can be answered
 * without a frame — and a render is four minutes where this is one second,
 * which is the difference between checking the placement on fourteen styles
 * and checking it on one.
 *
 * It still goes through `buildEdl`, so what it prints is what the pipeline
 * would make: the same cut, the same inserts taking the frame away, the same
 * budget. A reimplementation here would agree with the product right up until
 * it quietly did not.
 *
 *   npx tsx scripts/punch-plan.ts                    # two styles, the sample script
 *   npx tsx scripts/punch-plan.ts documentary long
 *   npx tsx scripts/punch-plan.ts --all              # every style, long and short
 *   npx tsx scripts/punch-plan.ts --text=my.txt      # one sentence per line
 */

/**
 * A script with every signal in it, and ordinary speech between them.
 *
 * Written rather than lifted from a real transcript because the thing being
 * checked is that the camera moves on the lines that earn it and stays still
 * on the ones that do not — which needs both kinds present and known.
 */
const SAMPLE = [
  'So three years ago I started posting videos from my bedroom.',
  'I had a borrowed camera and absolutely no idea what I was doing.',
  'The first one got eleven views and four of them were my mum.',
  'But here is the thing nobody tells you when you start.',
  'The algorithm does not care how long you spent editing.',
  'It took me about nine months to get to a hundred thousand subscribers.',
  'And ninety per cent of that growth came from three videos.',
  'So what actually made those three different?',
  'The thumbnail did almost all of the work.',
  'I shoot everything in the same corner of the same room.',
  'I use the same lens I bought second hand a few years back.',
  'None of that is what moves the numbers.',
  'The only thing that has ever mattered is the first seven seconds.',
  'If somebody does not stop scrolling, nothing else you did counts.',
  'That is the whole job, really.',
  'Everything else is production value nobody asked for.',
];

/** Roughly conversational: three words a second, a breath between sentences. */
function transcriptFor(lines: string[]) {
  let at = 0;
  const words: TranscriptWord[] = [];
  for (const line of lines) {
    const parts = line.split(/\s+/).filter(Boolean);
    parts.forEach((text, i) => {
      words.push({
        text, startSec: at, endSec: at + 0.3, confidence: 1, speaker: 0,
        isFiller: false, endsSentence: i === parts.length - 1,
      });
      at += 0.34;
    });
    at += 0.35;
  }
  return {
    provider: 'script', language: 'en', durationSec: at,
    text: lines.join(' '), words, sentences: deriveSentences(words),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => a.startsWith('--text='))?.split('=')[1];
  const lines = file
    ? (await readFile(file, 'utf8')).split('\n').map((l) => l.trim()).filter(Boolean)
    : SAMPLE;
  const transcript = transcriptFor(lines);

  const positional = args.filter((a) => !a.startsWith('--'));
  const pairs: Array<[string, FormatMode]> = args.includes('--all')
    ? STYLE_LIST.flatMap((s) => [[s.id, 'short'], [s.id, 'long']] as Array<[string, FormatMode]>)
    : positional.length
      ? [[positional[0], (positional[1] as FormatMode) ?? 'long']]
      : [['documentary', 'long'], ['punchy', 'short']];

  for (const [styleId, mode] of pairs) {
    const edl = buildEdl({
      projectId: 'punch-plan',
      style: getStyle(styleId),
      mode,
      aspect: mode === 'long' ? '16:9' : '9:16',
      fps: 30,
      transcript,
      // Empty on purpose: this is the floor, what the system does with no
      // model at all. The director's cues only ever add a thumb to the scale.
      plan: DirectorPlanSchema.parse({}),
      segments: layoutSegments([{ sourceStartSec: 0, sourceEndSec: transcript.durationSec }]),
      source: {
        assetId: 's', url: 'file://x.mp4', width: 1920, height: 1080,
        fps: 30, durationSec: transcript.durationSec, hasAudio: true,
      },
      reframe: null,
      degraded: [],
    });

    const covered = edl.punchIns.reduce((n, p) => n + (p.outEndSec - p.outStartSec), 0);
    console.log(
      `\n── ${styleId} / ${mode} — ${edl.punchIns.length} punch-in${edl.punchIns.length === 1 ? '' : 's'} ` +
      `over ${transcript.durationSec.toFixed(0)}s (${Math.round((covered / transcript.durationSec) * 100)}% of the video)`,
    );
    for (const p of edl.punchIns) {
      console.log(
        `  ${p.outStartSec.toFixed(1).padStart(6)}–${p.outEndSec.toFixed(1).padStart(5)}s  ` +
        `${p.move.padEnd(11)} ${p.scale.toFixed(3)}×  ${p.reason}`,
      );
    }
    if (!edl.punchIns.length) console.log('  (none — this style wants a locked-off frame)');
  }
}

void main();
