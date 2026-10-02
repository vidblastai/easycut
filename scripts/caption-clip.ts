import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { CAPTION_ANIMATIONS, EdlSchema, type CaptionAnimation } from '../src/lib/edl/types';
import { findCaptionPreset } from '../src/lib/captions/presets';
import { env } from '../src/lib/config/env';
import { startAssetServer } from '../src/lib/render/asset-server';
import { SAMPLE_EDL } from '../remotion/sample-edl';

/**
 * Captions, moving.
 *
 * The caption sheet renders a still per preset, which answers what the type
 * LOOKS like and nothing about what it does — and captions are the layer on
 * screen for the whole video, so "what it does" is most of what there is. A
 * missing tool is why `karaoke` sat for months stepping each word from 0.45 to
 * 1 on a single frame: in a still that is a correct-looking line of type.
 *
 *   npx tsx scripts/caption-clip.ts word-fill [--wide] [--preset=bold-pop]
 *   npx tsx scripts/caption-clip.ts --all
 */

const OUT = 'out/caption-clips';
const SOURCE = 'out/fixture.mp4';

/** Long enough for a sentence to land and short enough to step through. */
const LINE = 'This is the sentence the captions have to carry'.split(' ');
const HOLD_SEC = 4.5;

async function main() {
  await mkdir(OUT, { recursive: true });
  const args = process.argv.slice(2);
  const wide = args.includes('--wide');
  const presetId = args.find((a) => a.startsWith('--preset='))?.split('=')[1] ?? 'bold-pop';
  const only = args.filter((a) => !a.startsWith('--')) as CaptionAnimation[];
  const animations = args.includes('--all') ? [...CAPTION_ANIMATIONS] : only.length ? only : ['word-fill' as const];

  const assets = await startAssetServer(process.cwd());
  const source = assets.urlFor(resolve(SOURCE)) ?? '';
  if (!source) throw new Error(`Cannot serve ${SOURCE}`);

  const step = HOLD_SEC + 0.6;
  const seconds = 0.5 + animations.length * step;
  const preset = findCaptionPreset(presetId);
  if (!preset) throw new Error(`Unknown caption preset ${presetId}`);

  const inputProps = {
    edl: EdlSchema.parse({
      ...SAMPLE_EDL,
      projectId: 'captions',
      format: {
        ...SAMPLE_EDL.format,
        durationSec: seconds,
        ...(wide ? { aspect: '16:9' as const, width: 1920, height: 1080 } : {}),
      },
      source: { ...SAMPLE_EDL.source, url: source },
      segments: [
        { ...SAMPLE_EDL.segments[0], sourceStartSec: 0, sourceEndSec: seconds, outStartSec: 0, outEndSec: seconds },
      ],
      // One cue per animation, back to back. The animation is a property of
      // the STYLE, which is per video — so this renders the style once and
      // the comparison is across clips rather than within one.
      captions: animations.map((animation, i) => {
        const from = 0.5 + i * step;
        const per = (HOLD_SEC - 1) / LINE.length;
        return {
          id: `cue-${i}`,
          startSec: from,
          endSec: from + HOLD_SEC,
          words: LINE.map((text, w) => ({
            text,
            startSec: from + w * per,
            endSec: from + (w + 1) * per,
            emphasis: text === 'carry',
          })),
          animation,
        };
      }),
      captionStyle: { ...preset.style, animation: animations[0] },
      broll: [], scenes: [], graphics: [], icons: [], overlays: [], punchIns: [], sfx: [], transitions: [],
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

  const output = join(OUT, `${animations.join('-')}${wide ? '-wide' : ''}.mp4`);
  await renderMedia({
    composition, serveUrl, inputProps, codec: 'h264', outputLocation: output, audioCodec: null,
    browserExecutable: env.render.browserExecutable,
    chromiumOptions: { gl: env.render.gl, ignoreCertificateErrors: env.render.ignoreCertificateErrors },
    onProgress: ({ progress }) => process.stdout.write(`\r  ${Math.round(progress * 100)}%   `),
  });

  await assets.close();
  console.log(`\n${output}  (${animations.join(', ')}, ${seconds.toFixed(1)}s)`);
}

void main();
