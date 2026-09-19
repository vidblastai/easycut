/**
 * Render a video, change one caption, re-render — and prove the second one is
 * both cheap and correct.
 *
 *   npm run bench:incremental -- out/smoke/<id>.edl.json out/long.mp4
 *
 * A third argument is an existing full render to amend, which skips the half
 * hour of rendering one from scratch. Its frame count is reported either way,
 * so a stale file cannot quietly pass.
 *
 * The two things it checks are the two that matter: how much faster the
 * amended render was, and whether it came out with exactly the same number of
 * frames as the original. The second is not optional — every way this can go
 * wrong is silent, and a frame count is where all of them show up.
 */
import { readFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { EdlSchema, type Edl } from '../src/lib/edl/types';
import { renderVideo } from '../src/lib/render';
import { renderDelta, worthSplicing } from '../src/lib/render/diff';
import { frameCount } from '../src/lib/render/splice';
import { extractAudio } from '../src/lib/media/ffmpeg';

const [EDL_PATH, SRC, EXISTING] = process.argv.slice(2);

async function main() {
  const out = resolve('out/inc');
  // Keep an existing full render if one is being reused.
  if (!EXISTING) await rm(out, { recursive: true, force: true });
  await mkdir(join(out, 'b'), { recursive: true });

  const before = EdlSchema.parse(JSON.parse(await readFile(EDL_PATH, 'utf8')));
  const audio = join(out, 'mix.wav');
  await extractAudio(SRC, audio);

  console.log(`video: ${before.format.durationSec.toFixed(1)}s, ${before.captions.length} captions, ${Math.round(before.format.durationSec * before.format.fps)} frames\n`);

  let fullSec = NaN;
  let fullPath: string;
  if (EXISTING) {
    fullPath = resolve(EXISTING);
    console.log(`full render        (reusing ${EXISTING})   ${await frameCount(fullPath)} frames`);
  } else {
    const t0 = Date.now();
    const full = await renderVideo({
      edl: before, sourceVideoPath: SRC, sourceAudioPath: audio,
      musicPath: null, outputDir: join(out, 'a'),
    });
    fullSec = (Date.now() - t0) / 1000;
    fullPath = full.videoPath;
    console.log(`full render        ${fullSec.toFixed(1)}s   ${await frameCount(fullPath)} frames`);
  }

  // Change one caption in the middle, exactly as the editor would.
  const middle = Math.floor(before.captions.length / 2);
  const cue = before.captions[middle];
  const after: Edl = {
    ...before,
    captions: before.captions.map((c, i) =>
      i === middle ? { ...c, words: c.words.map((w) => ({ ...w, emphasis: true })) } : c,
    ),
  };
  console.log(`\nedited caption ${middle + 1}/${before.captions.length} at ${cue.startSec.toFixed(1)}–${cue.endSec.toFixed(1)}s`);

  const delta = renderDelta(before, after);
  console.log(`delta: ${delta.kind}${delta.kind === 'span' ? ` ${delta.fromSec.toFixed(1)}–${delta.toSec.toFixed(1)}s (${delta.reason})` : ''}`);
  console.log(`worth splicing: ${worthSplicing(delta, after.format.durationSec)}`);
  if (delta.kind !== 'span') { console.log('not a span — nothing to prove'); return; }

  const t1 = Date.now();
  const inc = await renderVideo({
    edl: after, sourceVideoPath: SRC, sourceAudioPath: audio,
    musicPath: null, outputDir: join(out, 'b'),
    incremental: { previousVideoPath: fullPath, fromSec: delta.fromSec, toSec: delta.toSec },
  });
  const incSec = (Date.now() - t1) / 1000;
  const incFrames = await frameCount(inc.videoPath);

  console.log(`\nincremental        ${incSec.toFixed(1)}s   ${incFrames} frames`);
  if (Number.isFinite(fullSec)) console.log(`speed-up           ${(fullSec / incSec).toFixed(1)}×`);
  console.log(`frames match       ${incFrames === (await frameCount(fullPath))}`);
}
void main();
