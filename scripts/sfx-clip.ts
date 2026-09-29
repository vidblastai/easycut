import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { EdlSchema } from '../src/lib/edl/types';
import { env } from '../src/lib/config/env';
import { startAssetServer } from '../src/lib/render/asset-server';
import { SAMPLE_EDL } from '../remotion/sample-edl';
import { transitionCues, thinCues } from '../src/lib/edl/sfx-cues';
import { sfxDefaultGain, sfxUrl, type SfxName } from '../src/lib/assets/sfx';
import { muxVideoAudio, renderAudio } from '../src/lib/media/audio-mix';

/**
 * The transition sounds, on a real timeline, audible.
 *
 *   npx tsx scripts/sfx-clip.ts
 *
 * Everything else about this feature can be checked by reading numbers off a
 * test. Whether the swipe lands ON the swipe cannot: 60ms of error passes every
 * assertion here and still sounds wrong, because the ear is far better at this
 * than any tolerance worth writing. So this renders both halves — the picture
 * through Remotion, the mix through the same ffmpeg graph the export uses — and
 * muxes them, which makes the question answerable by listening once.
 *
 * It also exercises the J/L cut, since the timeline is cut into three.
 */

const OUT = 'out/sfx';

async function main() {
  await mkdir(OUT, { recursive: true });
  const assets = await startAssetServer(process.cwd());
  const speaker = assets.urlFor(resolve('out/fixture.mp4')) ?? '';
  if (!speaker) throw new Error('Cannot serve out/fixture.mp4 — run scripts/make-fixture.ts first');

  const durationSec = 12;
  // Three cuts, so the speech has joins for the J/L cut to soften.
  const segments = [
    { sourceStartSec: 0, sourceEndSec: 4 },
    { sourceStartSec: 8, sourceEndSec: 12 },
    { sourceStartSec: 16, sourceEndSec: 20 },
  ].map((seg, i) => ({ ...seg, id: `seg-${i}`, outStartSec: i * 4, outEndSec: i * 4 + 4, speed: 1, reason: 'keep' as const }));

  // One glitch insert and one swipe insert, so the two sounds can be told apart.
  const broll = [
    { start: 2, end: 4.2, enter: 'glitch' as const, exit: 'glitch' as const, query: 'glitch insert' },
    { start: 6.5, end: 8.7, enter: 'slide-up' as const, exit: 'slide-down' as const, query: 'swipe insert' },
  ].map((b, i) => ({
    id: `b-${i}`,
    outStartSec: b.start,
    outEndSec: b.end,
    kind: 'stock-video' as const,
    url: assets.urlFor(resolve('out/broll.mp4')) ?? '',
    clipStartSec: 0,
    scale: 1,
    audioGainDb: -60,
    opacity: 1,
    intent: b.query,
    query: b.query,
    enter: b.enter,
    exit: b.exit,
  }));

  const icons = [{
    id: 'i-0',
    outStartSec: 9.4,
    outEndSec: 11.6,
    y: 0.56,
    tone: 'light' as const,
    cards: [
      { offsetSec: 0, word: 'one', query: 'one', markup: null, iconId: '' },
      { offsetSec: 0.45, word: 'two', query: 'two', markup: null, iconId: '' },
    ],
  }];

  // Parsed first, so the cues are read off exactly the shapes the builder hands
  // them — defaults filled in, transitions validated — rather than off literals
  // that happen to look close enough.
  const bare = EdlSchema.parse({
    ...SAMPLE_EDL,
    projectId: 'sfx',
    format: { ...SAMPLE_EDL.format, durationSec },
    source: { ...SAMPLE_EDL.source, url: speaker },
    segments,
    broll,
    icons,
    sfx: [],
    captions: [], scenes: [], graphics: [], overlays: [], punchIns: [], transitions: [],
    music: null, reframe: null,
    audio: { ...SAMPLE_EDL.audio, jCutSec: 0.14 },
    deliverable: { ...SAMPLE_EDL.deliverable, durationSec },
  });

  const sfx = thinCues(transitionCues(bare.broll, bare.icons, bare.format)).map((cue, i) => ({
    id: `sfx-${i}`,
    atSec: cue.atSec,
    sound: cue.sound,
    gainDb: sfxDefaultGain(cue.sound as SfxName) + cue.gainTrimDb,
    reason: cue.reason,
  }));

  console.log('cues placed:');
  for (const cue of sfx) console.log(`  ${cue.atSec.toFixed(3)}s  ${cue.sound.padEnd(7)} ${cue.reason}`);

  const edl = EdlSchema.parse({ ...bare, sfx });

  const inputProps = { edl, previewAudio: false };

  const { bundle } = await import('@remotion/bundler');
  const { renderMedia, selectComposition } = await import('@remotion/renderer');
  process.stdout.write('bundling… ');
  const serveUrl = await bundle({
    entryPoint: join(process.cwd(), 'remotion', 'index.ts'),
    publicDir: join(process.cwd(), 'public'),
  });
  console.log('ok');

  const composition = await selectComposition({
    serveUrl, id: 'EasyCutVideo', inputProps,
    browserExecutable: env.render.browserExecutable,
    chromiumOptions: { ignoreCertificateErrors: env.render.ignoreCertificateErrors },
  });

  const silent = join(OUT, 'silent.mp4');
  process.stdout.write('rendering picture… ');
  await renderMedia({
    composition, serveUrl, inputProps, codec: 'h264', outputLocation: silent, audioCodec: null,
    browserExecutable: env.render.browserExecutable,
    chromiumOptions: { gl: env.render.gl, ignoreCertificateErrors: env.render.ignoreCertificateErrors },
    onProgress: () => {},
  });
  console.log('ok');

  process.stdout.write('mixing audio… ');
  const audio = await renderAudio(edl, {
    // The cut source, not the served URL: ffmpeg reads the file directly.
    sourceAudioPath: resolve('out/fixture.mp4'),
    sfxPaths: Object.fromEntries(sfx.map((c) => [c.sound, join('public', sfxUrl(c.sound as SfxName))])),
    outputPath: join(OUT, 'mix.m4a'),
  });
  console.log('ok');

  const output = join(OUT, 'sfx.mp4');
  await muxVideoAudio(silent, audio, output);
  await assets.close();
  console.log(`\n${output}`);
}

void main();
