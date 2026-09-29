import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { EdlSchema } from '../src/lib/edl/types';
import { env } from '../src/lib/config/env';
import { startAssetServer } from '../src/lib/render/asset-server';
import { SAMPLE_EDL } from '../remotion/sample-edl';
import { makeBrollAsset, moveForStill, type BrollSource } from '../src/lib/assets/ai-broll';

/**
 * B-roll that was made, on a real timeline, moving.
 *
 *   npx tsx scripts/ai-broll-clip.ts ai-image "a calculator on a desk" "a city at night"
 *
 * The question a still cannot answer is the one that matters: a generated
 * picture is a PICTURE, and the whole claim here is that it reads as B-roll
 * because it never stops moving. So this generates the assets for real, puts
 * them on a real timeline with the move the pipeline would give them, and
 * renders the mp4 — the same path the export takes.
 */

const OUT = 'out/ai-broll';
const HOLD_SEC = 2.6;

async function main() {
  const source = (process.argv[2] ?? 'ai-image') as BrollSource;
  const subjects = process.argv.slice(3);
  if (source === 'stock' || !subjects.length) {
    throw new Error('usage: ai-broll-clip.ts <ai-image|ai-video> "subject" ["subject" …]');
  }

  await mkdir(OUT, { recursive: true });
  const assets = await startAssetServer(process.cwd());
  const speaker = assets.urlFor(resolve('out/fixture.mp4')) ?? '';
  if (!speaker) throw new Error('Cannot serve out/fixture.mp4');

  console.log(`generating ${subjects.length} × ${source}…`);
  const made = await Promise.all(
    subjects.map((subject, index) =>
      makeBrollAsset(source, subject, { orientation: 'portrait', durationSec: HOLD_SEC, index }),
    ),
  );

  made.forEach((clip, i) => {
    console.log(
      clip
        ? `  ${subjects[i]} → ${clip.kind} $${clip.costUsd.toFixed(3)} ${clip.kenBurns ?? ''}`
        : `  ${subjects[i]} → FAILED`,
    );
  });

  const usable = made.map((clip, i) => ({ clip, subject: subjects[i] })).filter((m) => m.clip);
  if (!usable.length) throw new Error('nothing generated — is the key set?');

  const step = HOLD_SEC + 0.8;
  const seconds = 0.8 + usable.length * step;

  const inputProps = {
    edl: EdlSchema.parse({
      ...SAMPLE_EDL,
      projectId: 'ai-broll',
      format: { ...SAMPLE_EDL.format, durationSec: seconds },
      source: { ...SAMPLE_EDL.source, url: speaker },
      segments: [
        { ...SAMPLE_EDL.segments[0], sourceStartSec: 0, sourceEndSec: seconds, outStartSec: 0, outEndSec: seconds },
      ],
      broll: usable.map(({ clip, subject }, i) => ({
        id: `ai-${i}`,
        outStartSec: 0.8 + i * step,
        outEndSec: 0.8 + i * step + HOLD_SEC,
        kind: clip!.kind,
        url: clip!.url,
        clipStartSec: 0,
        scale: 1,
        // The move the pipeline would have given it — the whole point of the strip.
        kenBurns: clip!.kenBurns ?? moveForStill(i),
        audioGainDb: -60,
        opacity: 1,
        intent: subject,
        query: subject,
        enter: 'fade',
        exit: 'fade',
      })),
      captions: usable.map(({ subject }, i) => ({
        id: `cue-${i}`,
        startSec: 0.8 + i * step,
        endSec: 0.8 + i * step + HOLD_SEC,
        words: [{ text: subject, startSec: 0.8 + i * step, endSec: 0.8 + i * step + HOLD_SEC, emphasis: false }],
      })),
      scenes: [], graphics: [], icons: [], overlays: [], punchIns: [], sfx: [], transitions: [],
      music: null, reframe: null,
      deliverable: { ...SAMPLE_EDL.deliverable, durationSec: seconds },
    }),
    previewAudio: false,
  };

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
  const output = join(OUT, `${source}.mp4`);
  await renderMedia({
    composition, serveUrl, inputProps, codec: 'h264', outputLocation: output, audioCodec: null,
    browserExecutable: env.render.browserExecutable,
    chromiumOptions: { gl: env.render.gl, ignoreCertificateErrors: env.render.ignoreCertificateErrors },
    onProgress: () => {},
  });

  await assets.close();
  const spent = made.reduce((sum, c) => sum + (c?.costUsd ?? 0), 0);
  console.log(`\n${output}  (${usable.length} inserts, $${spent.toFixed(3)})`);
}

void main();
