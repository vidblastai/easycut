import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { EdlSchema, SCENE_KINDS, SCENE_LOOKS, type SceneBackdrop, type SceneKind, type SceneLook } from '../src/lib/edl/types';
import { env } from '../src/lib/config/env';
import { readFile, readdir } from 'node:fs/promises';
import { parseIllustration, type Illustration } from '../src/lib/assets/illustration';
import { startAssetServer } from '../src/lib/render/asset-server';
import { SAMPLE_EDL } from '../remotion/sample-edl';

/**
 * A still of every look crossed with every scene kind, from the real renderer.
 *
 *   npx tsx scripts/scene-sheet.ts [look] [kind] [frame]
 *
 * This exists because the scene layer is the one part of the renderer that
 * cannot be checked by reading it. Every failure it has actually had — a lost
 * `translate(-50%, -50%)` swallowed by an invalid transform, an icon that
 * headless Chromium would not decode, type running off both edges of a
 * vertical frame — was invisible in the diff and obvious in a PNG. So: render
 * the PNG, look at it, and only then say it works.
 *
 * Footage still has to be served even though a scene covers it completely —
 * the video track is mounted under every composition and Remotion will not
 * render a still with an empty `src`. It is the local fixture over loopback,
 * so this stays runnable offline.
 */

const OUT = 'out/scene-sheet';
const SOURCE_FILE = 'out/fixture.mp4';
let SOURCE = '';

/** Content per kind, chosen so each one exercises the slots it actually uses. */
const CONTENT: Record<SceneKind, { headline: string; items: string[] }> = {
  'kinetic-text': { headline: 'You do not need a team', items: [] },
  journey: { headline: 'How it goes', items: ['Record once', 'Upload it', 'Post everywhere'] },
  compare: { headline: 'Before and after', items: ['Six hours editing', 'Four minutes'] },
  orbit: { headline: 'Everything in one place', items: ['Captions', 'B-roll', 'Music', 'Cuts'] },
  stack: { headline: 'clients', items: ['Noah Martinez', 'Sofia Rossi', 'Rami Khalil', 'Lucas Dupont'] },
  'big-number': { headline: '95% of your ideas', items: ['never get posted'] },
  transform: { headline: 'How a banana gets here', items: ['banana seedling', 'banana tree'] },
  'photo-row': { headline: 'Three things to pack', items: ['hiking boots', 'water bottle', 'paper map'] },
  'photo-point': { headline: 'Shoot it outside', items: ['golden hour'] },
  'photo-hero': { headline: '', items: ['motogp rider cornering'] },
  'photo-grid': {
    headline: 'A week of shots',
    items: ['coffee cup', 'city street', 'open notebook', 'desk lamp', 'camera lens', 'train window'],
  },
};

/** A drawing from `scripts/draw-scene.ts`, when one has been made for this look. */
const ART: Record<string, Illustration | null> = {};

/**
 * `--wide` renders at 16:9 instead of 9:16.
 *
 * Read at module scope because `edlFor` needs it and runs outside `main`. A
 * scene whose layout is limited by the WIDTH — `transform` is two panels and
 * an arrow across the frame — cannot be judged in the other shape.
 */
const wide = process.argv.includes('--wide');

/** `--backdrop=paper-grid` renders the scenes on that surface. */
const backdrop = (process.argv.find((a) => a.startsWith('--backdrop='))?.split('=')[1] ?? null) as
  | SceneBackdrop
  | null;

/**
 * `--photos` fills a photo scene's plates with a real photograph.
 *
 * Without it they fall back to naming their thing in type, which is a real
 * state the renderer has to handle and a useless one to judge the LAYOUT
 * from: an empty plate has no crop, no contrast against the surface and no
 * edge of its own. The stock search needs a key this machine does not have,
 * so it is the local plate, served over the same loopback as the footage.
 */
const withPhotos = process.argv.includes('--photos');
const PHOTO_FILE = 'out/plates/real.png';
let PHOTO = '';

function edlFor(look: SceneLook, kind: SceneKind) {
  const content = CONTENT[kind];
  return EdlSchema.parse({
    ...SAMPLE_EDL,
    projectId: `scene-${look}-${kind}`,
    format: wide
      ? { ...SAMPLE_EDL.format, aspect: '16:9' as const, width: 1920, height: 1080 }
      : SAMPLE_EDL.format,
    source: { ...SAMPLE_EDL.source, url: SOURCE },
    segments: [{ ...SAMPLE_EDL.segments[0], sourceStartSec: 0, sourceEndSec: 5, outStartSec: 0, outEndSec: 5 }],
    scenes: [
      {
        id: 'sc-1',
        outStartSec: 0,
        outEndSec: 5,
        kind,
        look,
        backdrop: backdrop ?? 'auto',
        headline: content.headline,
        items: content.items,
        iconQueries: content.items.map(() => ''),
        iconSvgs: content.items.map(() => null),
        photoUrls: content.items.map(() => (withPhotos ? PHOTO : null)),
        art: ART[look] ?? null,
        accent: '#9B7BFF',
        reason: 'sheet',
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
    deliverable: { ...SAMPLE_EDL.deliverable, durationSec: 5 },
  });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const looks = (args[0] ? [args[0] as SceneLook] : [...SCENE_LOOKS]);
  const kinds = (args[1] ? [args[1] as SceneKind] : [...SCENE_KINDS]);
  // Late enough that every stagger has landed, early enough to be inside the
  // shortest scene anyone would place.
  const frame = Number(args[2] ?? 60);

  // The programmatic API, not the CLI: `remotion still` runs a version check
  // that trips over this repo's zod pin, and the renderer itself is fine.
  // Any drawings lying about from `draw-scene.ts` get rendered in place of the
  // icon layout, so the sheet shows what a real scene looks like rather than
  // only the fallback.
  const drawings = await readdir('out/drawings').catch(() => [] as string[]);
  for (const id of SCENE_LOOKS) {
    // Matched by look rather than by index: `draw-scene.ts` numbers its output
    // by the order the jobs finished, so a fixed index reads the wrong file.
    const name = drawings.filter((file) => file.endsWith(`-${id}.svg`)).sort().pop();
    const file = name ? await readFile(`out/drawings/${name}`, 'utf8').catch(() => null) : null;
    ART[id] = file ? parseIllustration(file, id) : null;
  }
  console.log(`drawings found: ${Object.entries(ART).filter(([, a]) => a).map(([k]) => k).join(', ') || 'none'}`);

  const assets = await startAssetServer(process.cwd());
  SOURCE = assets.urlFor(resolve(SOURCE_FILE)) ?? '';
  if (!SOURCE) throw new Error(`Cannot serve ${SOURCE_FILE}`);
  if (withPhotos) {
    PHOTO = assets.urlFor(resolve(PHOTO_FILE)) ?? '';
    if (!PHOTO) throw new Error(`Cannot serve ${PHOTO_FILE}`);
  }

  const { bundle } = await import('@remotion/bundler');
  const { renderStill, selectComposition } = await import('@remotion/renderer');

  process.stdout.write('bundling… ');
  const serveUrl = await bundle({
    entryPoint: join(process.cwd(), 'remotion', 'index.ts'),
    publicDir: join(process.cwd(), 'public'),
  });
  console.log('ok\n');

  for (const look of looks) {
    for (const kind of kinds) {
      process.stdout.write(`  ${look.padEnd(9)} ${kind.padEnd(14)}`);
      try {
        const inputProps = { edl: edlFor(look, kind), previewAudio: false };
        const composition = await selectComposition({
          serveUrl,
          id: 'EasyCutVideo',
          inputProps,
          browserExecutable: env.render.browserExecutable,
          chromiumOptions: { ignoreCertificateErrors: env.render.ignoreCertificateErrors },
        });
        await renderStill({
          composition,
          serveUrl,
          inputProps,
          output: join(OUT, `${look}-${kind}${backdrop ? `-${backdrop}` : ''}${wide ? '-wide' : ''}.png`),
          frame,
          browserExecutable: env.render.browserExecutable,
          chromiumOptions: { gl: env.render.gl, ignoreCertificateErrors: env.render.ignoreCertificateErrors },
        });
        console.log('ok');
      } catch (error) {
        console.log('FAILED');
        console.error('   ', String(error).split('\n')[0].slice(0, 220));
      }
    }
  }
  await assets.close();
  console.log(`\nStills in ${OUT}/`);
}

void main();
