import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { BROLL_OVERLAYS, EdlSchema } from '../src/lib/edl/types';
import { env } from '../src/lib/config/env';
import { startAssetServer } from '../src/lib/render/asset-server';
import { SAMPLE_EDL } from '../remotion/sample-edl';

/**
 * Every B-roll overlay, back to back, on one strip.
 *
 *   npx tsx scripts/broll-overlay.ts [out/broll.mp4] [dust,grain]
 *
 * None of these can be judged from a still — dust drifts, grain re-rolls, the
 * leak crosses once and the scanline band rolls down — and none of them can be
 * judged alone either. What matters is whether they read as one set and
 * whether any of them reads as a fault rather than as a treatment.
 */

const OUT = 'out/broll-overlays';
const HOLD_SEC = 2.6;

async function main() {
  const footage = process.argv[2] ?? 'out/broll.mp4';
  const only = process.argv[3]?.split(',').filter(Boolean);
  const types = (only?.length ? only : BROLL_OVERLAYS.filter((t) => t !== 'none')) as string[];

  await mkdir(OUT, { recursive: true });
  const assets = await startAssetServer(process.cwd());
  const speaker = assets.urlFor(resolve('out/fixture.mp4')) ?? '';
  const insert = assets.urlFor(resolve(footage)) ?? '';
  if (!speaker || !insert) throw new Error(`Cannot serve ${footage}`);

  // A photograph is the better plate for judging these: flat colour bars have
  // no highlights for a leak to bloom in and no texture for grain to sit on,
  // so every overlay reads the same on them.
  const isStill = /\.(png|jpe?g|webp)$/i.test(footage);

  const step = HOLD_SEC + 0.7;
  const seconds = 0.6 + types.length * step;

  const inputProps = {
    edl: EdlSchema.parse({
      ...SAMPLE_EDL,
      projectId: 'broll-overlays',
      format: { ...SAMPLE_EDL.format, durationSec: seconds },
      source: { ...SAMPLE_EDL.source, url: speaker },
      segments: [
        { ...SAMPLE_EDL.segments[0], sourceStartSec: 0, sourceEndSec: seconds, outStartSec: 0, outEndSec: seconds },
      ],
      broll: types.map((type, i) => ({
        id: `ov-${i}`,
        outStartSec: 0.6 + i * step,
        outEndSec: 0.6 + i * step + HOLD_SEC,
        kind: isStill ? ('stock-photo' as const) : ('stock-video' as const),
        url: insert,
        // A different second of the same footage each time, so the strip is
        // not six copies of one frame wearing six different coats.
        clipStartSec: isStill ? 0 : i * 1.5,
        scale: 1,
        // A still gets a move, or the only thing travelling in the frame is
        // the overlay and every one of them reads as louder than it is.
        kenBurns: isStill ? ('in' as const) : ('none' as const),
        audioGainDb: -60,
        opacity: 1,
        intent: type,
        query: type,
        enter: 'fade' as const,
        exit: 'fade' as const,
        overlay: type,
      })),
      // The word on screen names the overlay you are watching, which is the
      // only way to tell six of them apart on one strip.
      captions: types.map((type, i) => ({
        id: `cue-${i}`,
        startSec: 0.6 + i * step,
        endSec: 0.6 + i * step + HOLD_SEC,
        words: [{ text: type, startSec: 0.6 + i * step, endSec: 0.6 + i * step + HOLD_SEC, emphasis: false }],
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
  const output = join(OUT, 'overlays.mp4');
  await renderMedia({
    composition, serveUrl, inputProps, codec: 'h264', outputLocation: output, audioCodec: null,
    browserExecutable: env.render.browserExecutable,
    chromiumOptions: { gl: env.render.gl, ignoreCertificateErrors: env.render.ignoreCertificateErrors },
    onProgress: () => {},
  });

  await assets.close();
  console.log(`\n${output}  (${types.length} overlays, ${seconds.toFixed(1)}s)`);
}

void main();
