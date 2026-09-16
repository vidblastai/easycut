import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import '../src/lib/config/load-env';
import { ffmpeg } from '../src/lib/media/ffmpeg';

/**
 * A ten-minute talking head, and the transcript that matches it.
 *
 * Both come out of this one script because they have to agree to the
 * millisecond: the pipeline cuts on silence found in the AUDIO and times
 * captions from the TRANSCRIPT, so a fixture whose words drift from its sound
 * tests nothing except whether the two drifted.
 *
 * `make-fixture.ts` cannot be used for this. Its speech is hardcoded to bursts
 * at 2-4s, 6-9s and 12-17s, so a 600-second version is 583 seconds of silence —
 * the silence detector would cut the lot and hand the renderer a 17-second
 * video. The pattern here is periodic instead, which keeps the ffmpeg gate to
 * one expression and lets the transcript be derived from the same two numbers.
 *
 *   npx tsx scripts/make-long-fixture.ts out/long.mp4 600
 */

/** Speech for the first SPEAK seconds of every PERIOD seconds. */
const PERIOD = 8;
const SPEAK = 6.4;
const WORDS_PER_SEC = 3.1;

/** Sentences a person might actually say to a camera, cycled in order. */
const LINES = [
  'The first thing nobody tells you about pricing is that it is a positioning decision.',
  'We doubled our price and churn went down, which sounds like a paradox until you look at who left.',
  'Every founder I know has shipped something they were embarrassed by and it did fine.',
  'You are not competing on features, you are competing on how quickly someone understands you.',
  'The onboarding email that works is the one that gets them to the thing they came for.',
  'I spent four months building a dashboard that three people opened.',
  'Talk to ten customers before you write a line of code, and write down what they actually said.',
  'Growth is boring when it works. It is one channel, done properly, for longer than feels reasonable.',
  'The landing page is not where you explain the product, it is where you name the problem.',
  'We tried paid ads for a quarter and learned exactly one useful thing, which was worth it.',
  'If your demo needs narration then the product needs a rethink, not a better script.',
  'Hiring too early nearly killed us because we hired for a company we did not have yet.',
];

interface Word {
  text: string;
  startSec: number;
  endSec: number;
  isFiller?: boolean;
}

/** Fillers, at roughly the rate people actually produce them. */
const FILLERS = ['um,', 'uh,', 'you know,'];

function buildTranscript(durationSec: number): Word[] {
  const words: Word[] = [];
  let line = 0;
  let queue: string[] = [];

  for (let start = 0; start + SPEAK <= durationSec; start += PERIOD) {
    const count = Math.round(SPEAK * WORDS_PER_SEC);
    const gap = SPEAK / count;

    for (let i = 0; i < count; i++) {
      if (queue.length === 0) queue = LINES[line++ % LINES.length].split(' ');

      // A filler every ~40 words, and only at the start of a burst where a
      // real speaker hesitates. The cleanup stage is supposed to remove these,
      // so the fixture has to contain some or that stage is never exercised.
      const filler = i === 0 && words.length > 0 && (words.length / 40) % 3 < 1;
      const text = filler ? FILLERS[words.length % FILLERS.length] : queue.shift()!;
      if (filler) queue.unshift();

      const at = start + i * gap;
      words.push({
        text,
        startSec: +at.toFixed(3),
        endSec: +(at + gap * 0.82).toFixed(3),
        ...(filler ? { isFiller: true } : {}),
      });
    }
  }
  return words;
}

async function main() {
  const [output = 'out/long.mp4', durationArg = '600'] = process.argv.slice(2);
  const duration = Number(durationArg);
  await mkdir(dirname(output), { recursive: true });

  // Same drifting subject as the short fixture, so the face tracker has
  // something real to follow across ten minutes rather than a static box.
  const drift = `860+420*sin(t/3)`;
  const video = [
    `color=c=0x141418:s=1920x1080:d=${duration}:r=30[bg]`,
    `color=c=0xE8C89A:s=200x200:d=${duration}:r=30[head]`,
    `color=c=0x3A3A52:s=340x300:d=${duration}:r=30[body]`,
    `[bg][head]overlay=x='${drift}':y=300:eval=frame[a]`,
    `[a][body]overlay=x='${drift}-70':y=500:eval=frame[v]`,
  ].join(';');

  const speech =
    `sin(2*PI*180*t)*0.32*sin(2*PI*4.5*t)` +
    `+sin(2*PI*320*t)*0.18*sin(2*PI*7*t)`;
  // One periodic gate rather than seventy-five `between()` terms.
  const gate = `lt(mod(t,${PERIOD}),${SPEAK})`;
  const audio = `aevalsrc='(${speech})*${gate}':s=48000:d=${duration}[a]`;

  console.log(`Encoding ${duration}s — this takes a few minutes...`);
  await ffmpeg([
    '-y',
    '-filter_complex', `${video};${audio}`,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-t', String(duration),
    output,
  ]);

  const words = buildTranscript(duration);
  const transcriptPath = 'content/fixtures/long.transcript.json';
  await mkdir(dirname(transcriptPath), { recursive: true });
  await writeFile(
    transcriptPath,
    JSON.stringify(
      {
        language: 'en',
        _note: `Generated by scripts/make-long-fixture.ts for a ${duration}s fixture. Speech runs for the first ${SPEAK}s of every ${PERIOD}s, which is exactly the gate in the audio filter above, so words never land in silence.`,
        words,
      },
      null,
      1,
    ),
  );

  const fillers = words.filter((w) => w.isFiller).length;
  console.log(`Wrote ${output} — ${duration}s, 1920×1080`);
  console.log(`Wrote ${transcriptPath} — ${words.length} words (${fillers} fillers), speech ${SPEAK}s every ${PERIOD}s`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
