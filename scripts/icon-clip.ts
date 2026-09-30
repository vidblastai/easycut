import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { resolveCardIcons } from '../src/lib/assets/icon-cards';
import { EdlSchema, iconRowPlacement } from '../src/lib/edl/types';
import { env } from '../src/lib/config/env';
import { startAssetServer } from '../src/lib/render/asset-server';
import { SAMPLE_EDL } from '../remotion/sample-edl';

/**
 * A real clip of the icon cards, because this effect cannot be judged as a still.
 *
 * The whole thing IS the timing: whether the card arrives on the word, whether
 * the ease reads as a rise or a bounce, whether the second card appears without
 * shoving the first one sideways. A contact sheet shows none of that.
 *
 *   npx tsx scripts/icon-clip.ts [light|dark] [seconds]
 */

const OUT = 'out/icon-clips';
const SOURCE_FILE = 'out/fixture.mp4';

/** The sentence from the brief, so the two-card row is what gets tested. */
const LINE = 'The best two fruits are bananas and apples'.split(' ');
const CARDS = [
  { word: 'bananas', query: 'banana', atSec: 1.6 },
  { word: 'apples', query: 'red apple', atSec: 2.6 },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const args = process.argv.slice(2);
  const wide = args.includes('--wide');
  const positional = args.filter((a) => !a.startsWith('--'));
  const tone = (positional[0] as 'light' | 'dark') ?? 'light';
  const seconds = Number(positional[1] ?? 6);
  // `--wide` renders at 16:9. The row's size is limited by the WIDTH in a wide
  // frame and by the height in a tall one, so the two shapes exercise opposite
  // sides of `iconRowPlacement` and a row that fits one can overflow the other.
  const shape = wide
    ? { aspect: '16:9' as const, width: 1920, height: 1080 }
    : { aspect: '9:16' as const, width: 1080, height: 1920 };

  process.stdout.write('resolving icons… ');
  const icons = await resolveCardIcons(CARDS.map((c) => c.query), '#9B7BFF');
  console.log(icons.map((i, k) => `${CARDS[k].query}→${i?.id ?? 'none'}`).join(', '));
  if (icons.some((i) => !i)) throw new Error('An icon did not resolve; the clip would be misleading.');

  const assets = await startAssetServer(process.cwd());
  const source = assets.urlFor(resolve(SOURCE_FILE)) ?? '';
  if (!source) throw new Error(`Cannot serve ${SOURCE_FILE}`);

  const perWord = (seconds - 0.6) / LINE.length;
  const inputProps = {
    edl: EdlSchema.parse({
      ...SAMPLE_EDL,
      projectId: `icon-${tone}`,
      // The composition's length comes from `format`, not from the
      // deliverable — setting only the latter renders the sample's ten
      // seconds and silently truncates the strip.
      format: { ...SAMPLE_EDL.format, ...shape, durationSec: seconds },
      source: { ...SAMPLE_EDL.source, url: source },
      segments: [
        { ...SAMPLE_EDL.segments[0], sourceStartSec: 0, sourceEndSec: seconds, outStartSec: 0, outEndSec: seconds },
      ],
      scenes: [],
      graphics: [],
      broll: [],
      overlays: [],
      punchIns: [],
      sfx: [],
      transitions: [],
      music: null,
      reframe: null,
      icons: [
        {
          id: 'icon-0',
          outStartSec: CARDS[0].atSec,
          outEndSec: 4.8,
          // From the frame being rendered, not from a constant: passing
          // portrait dimensions while rendering widescreen put the row where it
          // would have gone in the other shape.
          y: iconRowPlacement(CARDS.length, shape.width, shape.height).y,
          tone,
          cards: CARDS.map((card, k) => ({
            offsetSec: card.atSec - CARDS[0].atSec,
            word: card.word,
            query: card.query,
            markup: icons[k]!.markup,
            iconId: icons[k]!.id,
          })),
        },
      ],
      // The captions run underneath the cards, because in a real video they
      // always will — and "does the card collide with the words" is one of the
      // two things this clip exists to answer.
      captions: [
        {
          id: 'cue-0',
          startSec: 0.3,
          endSec: seconds,
          words: LINE.map((text, i) => ({
            text,
            startSec: 0.3 + i * perWord,
            endSec: 0.3 + (i + 1) * perWord,
            emphasis: text === 'bananas' || text === 'apples',
          })),
        },
      ],
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
    serveUrl,
    id: 'EasyCutVideo',
    inputProps,
    browserExecutable: env.render.browserExecutable,
    chromiumOptions: { ignoreCertificateErrors: env.render.ignoreCertificateErrors },
  });

  const output = join(OUT, `icons-${tone}${wide ? "-wide" : ""}.mp4`);
  await renderMedia({
    composition,
    serveUrl,
    inputProps,
    codec: 'h264',
    outputLocation: output,
    audioCodec: null,
    browserExecutable: env.render.browserExecutable,
    chromiumOptions: { gl: env.render.gl, ignoreCertificateErrors: env.render.ignoreCertificateErrors },
    onProgress: ({ progress }) => process.stdout.write(`\r  ${Math.round(progress * 100)}%   `),
  });

  await assets.close();
  console.log(`\n${output}`);
}

void main();
