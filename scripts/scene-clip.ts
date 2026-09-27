import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { parseIllustration, type Illustration } from '../src/lib/assets/illustration';
import { EdlSchema, SCENE_LOOKS, type SceneKind, type SceneLook } from '../src/lib/edl/types';
import { env } from '../src/lib/config/env';
import { startAssetServer } from '../src/lib/render/asset-server';
import { SAMPLE_EDL } from '../remotion/sample-edl';

/**
 * A real clip of one animated scene, not a still.
 *
 * The still sheet catches composition bugs — lost centring, clipped type, a
 * part that renders black. It cannot catch the bug this pass was rebuilt to
 * fix, because "the drawing lands and then sits there for three seconds" looks
 * identical to a good scene in any single frame. Motion has to be watched.
 *
 *   npx tsx scripts/scene-clip.ts [look] [kind] [seconds]
 */

const OUT = 'out/scene-clips';
const SOURCE_FILE = 'out/fixture.mp4';

const CONTENT: Partial<Record<SceneKind, { headline: string; items: string[] }>> = {
  'kinetic-text': { headline: 'You do not need a team', items: [] },
  compare: { headline: 'Before and after', items: ['Six hours', 'Four minutes'] },
  'big-number': { headline: '95% of your ideas', items: ['never get posted'] },
};

/** The most recent drawing for a look, whatever `draw-scene.ts` numbered it. */
async function findDrawing(look: SceneLook): Promise<string | null> {
  const files = await readdir('out/drawings').catch(() => [] as string[]);
  const match = files.filter((name) => name.endsWith(`-${look}.svg`)).sort().pop();
  return match ? readFile(`out/drawings/${match}`, 'utf8').catch(() => null) : null;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const look = (process.argv[2] as SceneLook) ?? 'studio';
  const kind = (process.argv[3] as SceneKind) ?? 'kinetic-text';
  const seconds = Number(process.argv[4] ?? 5);
  if (!SCENE_LOOKS.includes(look)) throw new Error(`Unknown look ${look}`);

  // Found by look rather than by index: `draw-scene.ts` numbers its output by
  // the order the jobs finished, so a fixed index silently reads the wrong
  // file — or none, and the clip quietly renders the icon fallback instead.
  const drawing = await findDrawing(look);
  const art: Illustration | null = drawing ? parseIllustration(drawing, look) : null;
  console.log(art ? `drawing: ${art.parts.length} parts` : 'drawing: none (icon fallback)');

  const assets = await startAssetServer(process.cwd());
  const source = assets.urlFor(resolve(SOURCE_FILE)) ?? '';
  if (!source) throw new Error(`Cannot serve ${SOURCE_FILE}`);

  const content = CONTENT[kind] ?? CONTENT['kinetic-text']!;
  const inputProps = {
    edl: EdlSchema.parse({
      ...SAMPLE_EDL,
      projectId: `clip-${look}-${kind}`,
      source: { ...SAMPLE_EDL.source, url: source },
      segments: [
        { ...SAMPLE_EDL.segments[0], sourceStartSec: 0, sourceEndSec: seconds, outStartSec: 0, outEndSec: seconds },
      ],
      scenes: [
        {
          id: 'sc-1',
          outStartSec: 0,
          outEndSec: seconds,
          kind,
          look,
          backdrop: 'gradient',
          headline: content.headline,
          items: content.items,
          iconQueries: content.items.map(() => ''),
          iconSvgs: content.items.map(() => null),
          art,
          accent: '#9B7BFF',
          reason: 'clip',
        },
      ],
      captions: [],
      broll: [],
      graphics: [],
      overlays: [],
      punchIns: [],
      sfx: [],
      transitions: [],
      music: null,
      reframe: null,
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

  const output = join(OUT, `${look}-${kind}.mp4`);
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
