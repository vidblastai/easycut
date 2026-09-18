import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { EdlSchema, type Layout } from '../src/lib/edl/types';
import { env } from '../src/lib/config/env';
import { startAssetServer } from '../src/lib/render/asset-server';
import { SAMPLE_EDL } from '../remotion/sample-edl';

/**
 * Every layout, rendered by the real renderer, at the moments that matter.
 *
 *   npx tsx scripts/layout-sheet.ts [sourceVideo] [brollVideo]
 *
 * A layout is a claim about where things end up on screen, and the only thing
 * that can settle it is a frame out of the actual compositor — a CSS mock in a
 * picker proves nothing about what Remotion draws.
 *
 * The reaction layout needs three frames rather than one, because it is the
 * only layout whose geometry is a function of time: full frame before the
 * insert, the corner during it, full frame again after. A single still would
 * photograph one of those and tell you nothing about the other two.
 */

const SOURCE_FILE = process.argv[2] ?? 'out/fixture.mp4';
const BROLL_FILE = process.argv[3] ?? SOURCE_FILE;
const OUT = 'out/layout-sheet';

/** `--wide` renders the sheet at 16:9 instead of 9:16. */
const WIDE = process.argv.includes('--wide');
const FRAME = WIDE
  ? { aspect: '16:9' as const, width: 1920, height: 1080 }
  : { aspect: '9:16' as const, width: 1080, height: 1920 };

let SOURCE = '';
let BROLL = '';

/** A B-roll insert from 3s to 7s, in a ten-second edit. */
const INSERT = { in: 3, out: 7 };

function edlFor(layout: Layout) {
  return EdlSchema.parse({
    ...SAMPLE_EDL,
    projectId: `layout-${layout}`,
    format: { ...SAMPLE_EDL.format, ...FRAME, layout, durationSec: 10 },
    source: { ...SAMPLE_EDL.source, url: SOURCE },
    segments: [
      { ...SAMPLE_EDL.segments[0], sourceStartSec: 2, sourceEndSec: 12, outStartSec: 0, outEndSec: 10 },
    ],
    broll: [
      {
        id: 'broll-0',
        outStartSec: INSERT.in,
        outEndSec: INSERT.out,
        kind: 'stock-video',
        url: BROLL,
        clipStartSec: 0,
        scale: 1,
        kenBurns: 'in',
        audioGainDb: -60,
        opacity: 1,
        intent: 'the thing being reacted to',
        query: 'reaction subject',
      },
    ],
    // Everything else off: the question is where the two pictures land, and a
    // caption across the middle of the still only makes it harder to measure.
    captions: [],
    graphics: [],
    overlays: [],
    punchIns: [],
    sfx: [],
    transitions: [],
    music: null,
    deliverable: { ...SAMPLE_EDL.deliverable, durationSec: 10 },
  });
}

/** Before the insert, in the middle of it, and after it has gone. */
const MOMENTS: Array<{ name: string; sec: number }> = [
  { name: 'before', sec: 1.5 },
  { name: 'during', sec: 5.0 },
  { name: 'after', sec: 8.5 },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const named = process.argv.slice(4).filter((a) => !a.startsWith('--'));
  const layouts = (named.length ? named : ['full', 'reaction', 'split', 'side']) as Layout[];

  const assets = await startAssetServer(process.cwd());
  SOURCE = assets.urlFor(resolve(SOURCE_FILE)) ?? '';
  BROLL = assets.urlFor(resolve(BROLL_FILE)) ?? '';
  if (!SOURCE || !BROLL) throw new Error(`Cannot serve ${SOURCE_FILE} / ${BROLL_FILE}`);

  const { bundle } = await import('@remotion/bundler');
  const { renderStill, selectComposition } = await import('@remotion/renderer');

  process.stdout.write('bundling… ');
  const serveUrl = await bundle({
    entryPoint: join(process.cwd(), 'remotion', 'index.ts'),
    publicDir: join(process.cwd(), 'public'),
  });
  console.log('ok\n');

  for (const layout of layouts) {
    const inputProps = { edl: edlFor(layout), previewAudio: false };
    const composition = await selectComposition({
      serveUrl,
      id: 'EasyCutVideo',
      inputProps,
      browserExecutable: env.render.browserExecutable,
      chromiumOptions: { ignoreCertificateErrors: env.render.ignoreCertificateErrors },
    });

    for (const moment of MOMENTS) {
      process.stdout.write(`  ${layout.padEnd(10)} ${moment.name.padEnd(7)}`);
      await renderStill({
        composition,
        serveUrl,
        inputProps,
        output: join(OUT, `${layout}-${moment.name}${WIDE ? '-wide' : ''}.png`),
        frame: Math.round(moment.sec * composition.fps),
        browserExecutable: env.render.browserExecutable,
        chromiumOptions: { ignoreCertificateErrors: env.render.ignoreCertificateErrors },
      });
      console.log('ok');
    }
  }

  console.log(`\n${OUT}/`);
  await assets.close();
}

void main();
