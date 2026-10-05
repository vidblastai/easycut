import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { EdlSchema } from '../src/lib/edl/types';
import { env } from '../src/lib/config/env';
import { startAssetServer } from '../src/lib/render/asset-server';
import { SAMPLE_EDL } from '../remotion/sample-edl';

/**
 * The checklist, building beside the speaker.
 *
 * The device the whole layer exists for, and the one thing a still cannot
 * show anything useful about: the point is that the lines ACCUMULATE, each
 * landing on the word that names it, so the frame at the end looks like a
 * static list and the frame at the start looks like nothing.
 *
 *   npx tsx scripts/annotation-clip.ts [--wide] [--left]
 */

const OUT = 'out/annotation-clips';
const SOURCE = 'out/fixture.mp4';

const ITEMS = ['Reads your inbox', 'Checks the calendar', 'Plans your day', 'Gives you the time back'];

async function main() {
  await mkdir(OUT, { recursive: true });
  const args = process.argv.slice(2);
  const wide = args.includes('--wide');
  const side = args.includes('--left') ? ('left' as const) : ('right' as const);
  const seconds = 8;

  const assets = await startAssetServer(process.cwd());
  const source = assets.urlFor(resolve(SOURCE)) ?? '';
  if (!source) throw new Error(`Cannot serve ${SOURCE}`);

  const inputProps = {
    edl: EdlSchema.parse({
      ...SAMPLE_EDL,
      projectId: 'annotations',
      format: {
        ...SAMPLE_EDL.format,
        durationSec: seconds,
        ...(wide ? { aspect: '16:9' as const, width: 1920, height: 1080 } : {}),
      },
      source: { ...SAMPLE_EDL.source, url: source },
      segments: [
        { ...SAMPLE_EDL.segments[0], sourceStartSec: 0, sourceEndSec: seconds, outStartSec: 0, outEndSec: seconds },
      ],
      annotations: [
        {
          id: 'note-0',
          outStartSec: 0.6,
          outEndSec: seconds - 0.4,
          kind: 'checklist' as const,
          side,
          x: side === 'right' ? 0.62 : 0.38,
          y: 0.24,
          title: 'Coordination agent',
          items: ITEMS.map((text, i) => ({ offsetSec: 0.6 + i * 1.3, text })),
          reason: 'demo',
        },
      ],
      captions: [], broll: [], scenes: [], graphics: [], icons: [], overlays: [], punchIns: [], sfx: [], transitions: [],
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

  const output = join(OUT, `checklist-${side}${wide ? '-wide' : ''}.mp4`);
  await renderMedia({
    composition, serveUrl, inputProps, codec: 'h264', outputLocation: output, audioCodec: null,
    browserExecutable: env.render.browserExecutable,
    chromiumOptions: { gl: env.render.gl, ignoreCertificateErrors: env.render.ignoreCertificateErrors },
    onProgress: ({ progress }) => process.stdout.write(`\r  ${Math.round(progress * 100)}%   `),
  });

  await assets.close();
  console.log(`\n${output}`);
}

void main();
