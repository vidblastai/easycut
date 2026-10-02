import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { EdlSchema, PUNCH_MOVES, type PunchMove } from '../src/lib/edl/types';
import { env } from '../src/lib/config/env';
import { startAssetServer } from '../src/lib/render/asset-server';
import { SAMPLE_EDL } from '../remotion/sample-edl';

/**
 * Every camera move, back to back, on one strip.
 *
 * A zoom is the one thing in this renderer that CANNOT be judged from a still:
 * a push and a snap at their tightest are the same frame, and the whole
 * difference between them is where the time went. It also cannot be judged one
 * at a time — the question a vocabulary has to answer is whether seven of them
 * read as one editor, and whether any reads as a rendering fault instead of as
 * a camera.
 *
 *   npx tsx scripts/zoom-clip.ts [only,these] [--wide] [--scale=1.25]
 *
 * `--wide` is not a nicety. Long form is where `push` lives — a creep over ten
 * seconds on a face that fills a third of the frame — and nothing about that
 * reads the same in a vertical crop.
 */

const OUT = 'out/zoom-clips';
const SOURCE = 'out/fixture.mp4';

/**
 * Long enough for the slow ones to be slow.
 *
 * The first version gave each move 2.5 seconds, which is fine for a snap and
 * makes `push` into a plain ramp: a creep's entire character is that it has
 * more time than you are paying attention for. Six seconds is the short end of
 * where it starts working.
 */
const HOLD_SEC = 6;

/** A beat of un-punched footage between them, or each move exits into the next. */
const GAP_SEC = 1.2;

async function main() {
  await mkdir(OUT, { recursive: true });
  const args = process.argv.slice(2);
  const wide = args.includes('--wide');
  const scale = Number(args.find((a) => a.startsWith('--scale='))?.split('=')[1] ?? 1.22);
  const only = args.find((a) => !a.startsWith('--'))?.split(',').filter(Boolean) as PunchMove[] | undefined;
  const moves = (only?.length ? only : [...PUNCH_MOVES]) as PunchMove[];
  const shape = wide
    ? { aspect: '16:9' as const, width: 1920, height: 1080 }
    : { aspect: '9:16' as const, width: 1080, height: 1920 };

  const assets = await startAssetServer(process.cwd());
  const source = assets.urlFor(resolve(SOURCE)) ?? '';
  if (!source) throw new Error(`Cannot serve ${SOURCE}`);

  const step = HOLD_SEC + GAP_SEC;
  const seconds = 1 + moves.length * step;

  const punchIns = moves.map((move, i) => ({
    id: `punch-${i}`,
    outStartSec: 1 + i * step,
    outEndSec: 1 + i * step + HOLD_SEC,
    scale,
    x: 0.5,
    y: 0.4,
    move,
  }));

  const inputProps = {
    edl: EdlSchema.parse({
      ...SAMPLE_EDL,
      projectId: 'zooms',
      // The composition's length comes from `format`, not the deliverable.
      format: { ...SAMPLE_EDL.format, ...shape, durationSec: seconds },
      source: { ...SAMPLE_EDL.source, url: source },
      segments: [
        { ...SAMPLE_EDL.segments[0], sourceStartSec: 0, sourceEndSec: seconds, outStartSec: 0, outEndSec: seconds },
      ],
      punchIns,
      // The word names the move you are watching. Seven of these cannot be
      // told apart afterwards from a filename.
      captions: moves.map((move, i) => ({
        id: `cue-${i}`,
        startSec: 1 + i * step,
        endSec: 1 + i * step + HOLD_SEC,
        words: [{ text: move, startSec: 1 + i * step, endSec: 1 + i * step + HOLD_SEC, emphasis: false }],
      })),
      broll: [], scenes: [], graphics: [], icons: [], overlays: [], sfx: [], transitions: [],
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

  const output = join(OUT, wide ? 'zooms-wide.mp4' : 'zooms.mp4');
  await renderMedia({
    composition, serveUrl, inputProps, codec: 'h264', outputLocation: output, audioCodec: null,
    browserExecutable: env.render.browserExecutable,
    chromiumOptions: { gl: env.render.gl, ignoreCertificateErrors: env.render.ignoreCertificateErrors },
    onProgress: ({ progress }) => process.stdout.write(`\r  ${Math.round(progress * 100)}%   `),
  });

  await assets.close();
  console.log(`\n${output}  (${moves.length} moves, ${seconds.toFixed(1)}s, ${shape.width}×${shape.height})`);
}

void main();
