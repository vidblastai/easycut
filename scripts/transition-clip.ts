import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { CLIP_TRANSITIONS, EdlSchema, type ClipTransition } from '../src/lib/edl/types';
import { env } from '../src/lib/config/env';
import { startAssetServer } from '../src/lib/render/asset-server';
import { SAMPLE_EDL } from '../remotion/sample-edl';

/**
 * Every clip transition, back to back, on one strip.
 *
 * A transition is a third of a second. It cannot be judged from a still and it
 * cannot be judged one at a time either — what matters is whether they read as
 * one family, and whether any of them reads as a rendering fault rather than
 * as an edit.
 *
 *   npx tsx scripts/transition-clip.ts [only,these] [--wide]
 *
 * `--wide` renders at 16:9 instead of 9:16. Not a nicety: a transition's travel
 * is proportional to the distance it has to cross, so a slide in a widescreen
 * frame moves 1920px where a vertical one moves 1080, and the clamp on that
 * duration means the two are NOT the same animation at a different size. Long
 * form has to be watched in its own shape.
 */

const OUT = 'out/transition-clips';
const SOURCE = 'out/fixture.mp4';

/** Long enough to see the insert land, short enough to keep the strip watchable. */
const HOLD_SEC = 2.2;

async function main() {
  await mkdir(OUT, { recursive: true });
  const args = process.argv.slice(2);
  const wide = args.includes('--wide');
  const only = args.find((a) => !a.startsWith('--'))?.split(',').filter(Boolean) as ClipTransition[] | undefined;
  const types = (only?.length ? only : CLIP_TRANSITIONS.filter((t) => t !== 'cut')) as ClipTransition[];
  const shape = wide
    ? { aspect: '16:9' as const, width: 1920, height: 1080 }
    : { aspect: '9:16' as const, width: 1080, height: 1920 };

  const assets = await startAssetServer(process.cwd());
  const source = assets.urlFor(resolve(SOURCE)) ?? '';
  if (!source) throw new Error(`Cannot serve ${SOURCE}`);

  const plates = Array.from({ length: 12 }, (_, i) => assets.urlFor(resolve(`out/transition-plates/plate-${i}.png`)) ?? '');
  if (plates.some((p) => !p)) {
    throw new Error('Run the plate generator first — see the comment on `plates` in this file.');
  }

  // One insert per transition, with a gap of speaker between them so each
  // entrance and exit is visible against the footage rather than against the
  // insert before it.
  const step = HOLD_SEC + 0.9;
  const seconds = 1 + types.length * step;

  const broll = types.map((type, i) => ({
    id: `broll-${i}`,
    outStartSec: 1 + i * step,
    outEndSec: 1 + i * step + HOLD_SEC,
    kind: 'stock-photo' as const,
    /*
     * A flat colour plate, not the footage.
     *
     * The first version of this strip used the fixture for both the speaker
     * and the inserts, which made it impossible to see where one ended and the
     * other began — the very thing the strip exists to show. A plate that
     * looks nothing like the footage makes every edge of the move visible.
     */
    url: plates[i % plates.length],
    clipStartSec: 0,
    scale: 1,
    kenBurns: 'none' as const,
    audioGainDb: -60,
    opacity: 1,
    intent: type,
    query: type,
    enter: type,
    exit: type,
  }));

  const inputProps = {
    edl: EdlSchema.parse({
      ...SAMPLE_EDL,
      projectId: 'transitions',
      // The composition's length comes from `format`, not from the
      // deliverable — setting only the latter renders the sample's ten
      // seconds and silently truncates the strip.
      format: { ...SAMPLE_EDL.format, ...shape, durationSec: seconds },
      source: { ...SAMPLE_EDL.source, url: source },
      segments: [
        { ...SAMPLE_EDL.segments[0], sourceStartSec: 0, sourceEndSec: seconds, outStartSec: 0, outEndSec: seconds },
      ],
      broll,
      scenes: [], graphics: [], icons: [], overlays: [], punchIns: [], sfx: [], transitions: [],
      music: null, reframe: null,
      // The word on screen names the transition you are watching, which is the
      // only way to tell twelve of them apart on one strip.
      captions: types.map((type, i) => ({
        id: `cue-${i}`,
        startSec: 1 + i * step,
        endSec: 1 + i * step + HOLD_SEC,
        words: [{ text: type, startSec: 1 + i * step, endSec: 1 + i * step + HOLD_SEC, emphasis: false }],
      })),
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

  const output = join(OUT, wide ? 'transitions-wide.mp4' : 'transitions.mp4');
  await renderMedia({
    composition, serveUrl, inputProps, codec: 'h264', outputLocation: output, audioCodec: null,
    browserExecutable: env.render.browserExecutable,
    chromiumOptions: { gl: env.render.gl, ignoreCertificateErrors: env.render.ignoreCertificateErrors },
    onProgress: ({ progress }) => process.stdout.write(`\r  ${Math.round(progress * 100)}%   `),
  });

  await assets.close();
  console.log(`\n${output}  (${types.length} transitions, ${seconds.toFixed(1)}s, ${shape.width}×${shape.height})`);
}

void main();
