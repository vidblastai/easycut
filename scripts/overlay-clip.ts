import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { EdlSchema, OVERLAY_TYPES } from '../src/lib/edl/types';

type OverlayType = (typeof OVERLAY_TYPES)[number];
import { env } from '../src/lib/config/env';
import { startAssetServer } from '../src/lib/render/asset-server';
import { SAMPLE_EDL } from '../remotion/sample-edl';

/**
 * The frame overlays, moving.
 *
 * The same gap the captions had until `caption-clip.ts`: a chapter card is a
 * label that ARRIVES, and an entrance cannot be judged from a still — in a
 * still a lower-third wipe and a pill that opens from a rule are the same
 * rectangle with the same words in it.
 *
 *   npx tsx scripts/overlay-clip.ts chapter-card [--wide]
 *   npx tsx scripts/overlay-clip.ts --all
 */

const OUT = 'out/overlay-clips';
const SOURCE = 'out/fixture.mp4';

/** Long enough to see it arrive, settle and leave. */
const HOLD_SEC = 3.4;

const TEXT: Partial<Record<OverlayType, { text: string; subtext: string }>> = {
  'chapter-card': { text: 'Coordination', subtext: '' },
  'lower-third': { text: 'Sofia Rossi', subtext: 'Head of production' },
  'end-card': { text: 'Subscribe for more', subtext: 'New every Tuesday' },
};

async function main() {
  await mkdir(OUT, { recursive: true });
  const args = process.argv.slice(2);
  const wide = args.includes('--wide');
  const only = args.filter((a) => !a.startsWith('--')) as OverlayType[];
  const types = args.includes('--all')
    ? OVERLAY_TYPES.filter((t) => t in TEXT)
    : only.length ? only : (['chapter-card'] as OverlayType[]);

  const assets = await startAssetServer(process.cwd());
  const source = assets.urlFor(resolve(SOURCE)) ?? '';
  if (!source) throw new Error(`Cannot serve ${SOURCE}`);

  const step = HOLD_SEC + 0.8;
  const seconds = 0.6 + types.length * step;

  const inputProps = {
    edl: EdlSchema.parse({
      ...SAMPLE_EDL,
      projectId: 'overlays',
      format: {
        ...SAMPLE_EDL.format,
        durationSec: seconds,
        ...(wide ? { aspect: '16:9' as const, width: 1920, height: 1080 } : {}),
      },
      source: { ...SAMPLE_EDL.source, url: source },
      segments: [
        { ...SAMPLE_EDL.segments[0], sourceStartSec: 0, sourceEndSec: seconds, outStartSec: 0, outEndSec: seconds },
      ],
      overlays: types.map((type, i) => ({
        id: `ov-${i}`,
        type,
        outStartSec: 0.6 + i * step,
        outEndSec: 0.6 + i * step + HOLD_SEC,
        ...(TEXT[type] ?? { text: type, subtext: '' }),
        color: '#9B7BFF',
        opacity: 1,
      })),
      captions: [], broll: [], scenes: [], graphics: [], icons: [], punchIns: [], sfx: [], transitions: [],
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

  const output = join(OUT, `${types.join('-')}${wide ? '-wide' : ''}.mp4`);
  await renderMedia({
    composition, serveUrl, inputProps, codec: 'h264', outputLocation: output, audioCodec: null,
    browserExecutable: env.render.browserExecutable,
    chromiumOptions: { gl: env.render.gl, ignoreCertificateErrors: env.render.ignoreCertificateErrors },
    onProgress: ({ progress }) => process.stdout.write(`\r  ${Math.round(progress * 100)}%   `),
  });

  await assets.close();
  console.log(`\n${output}  (${types.join(', ')}, ${seconds.toFixed(1)}s)`);
}

void main();
