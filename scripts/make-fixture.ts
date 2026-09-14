import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import '../src/lib/config/load-env';
import { ffmpeg } from '../src/lib/media/ffmpeg';

/**
 * Builds a synthetic "talking head": a subject that moves around the frame, on
 * an audio track with speech-like bursts separated by real silence.
 *
 * It exists so the whole pipeline can be exercised — cuts, reframing, rendering,
 * the audio mix — without anyone needing to film themselves first.
 *
 *   npx tsx scripts/make-fixture.ts out/fixture.mp4 [durationSec]
 */
async function main() {
  const [output = 'out/fixture.mp4', durationArg = '20'] = process.argv.slice(2);
  const duration = Number(durationArg);
  await mkdir(dirname(output), { recursive: true });

  // A "head" and shoulders that drift horizontally, so the subject tracker has
  // something real to follow.
  //
  // This uses `overlay` rather than `drawbox`: drawbox evaluates its geometry
  // once, so an expression in `x` silently produces a STATIC box — which looks
  // fine in a thumbnail and quietly invalidates any tracking test built on it.
  const drift = `860+420*sin(t/3)`;
  const video = [
    `color=c=0x141418:s=1920x1080:d=${duration}:r=30[bg]`,
    `color=c=0xE8C89A:s=200x200:d=${duration}:r=30[head]`,
    `color=c=0x3A3A52:s=340x300:d=${duration}:r=30[body]`,
    `[bg][head]overlay=x='${drift}':y=300:eval=frame[a]`,
    `[a][body]overlay=x='${drift}-70':y=500:eval=frame[v]`,
  ].join(';');

  // Speech bursts at 2–4s, 6–9s, 12–17s; silence in between and at both ends.
  // Two tones mixed so it reads as voice-like rather than a test signal.
  const speech =
    `sin(2*PI*180*t)*0.32*sin(2*PI*4.5*t)` +
    `+sin(2*PI*320*t)*0.18*sin(2*PI*7*t)`;
  const gate = `(between(t,2,4)+between(t,6,9)+between(t,12,17))`;
  const audio = `aevalsrc='(${speech})*${gate}':s=48000:d=${duration}[a]`;

  await ffmpeg([
    '-y',
    '-filter_complex', `${video};${audio}`,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-t', String(duration),
    output,
  ]);

  console.log(`Wrote ${output} — ${duration}s, 1920×1080, speech at 2-4s, 6-9s, 12-17s`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
