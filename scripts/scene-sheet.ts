import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { EdlSchema, SCENE_KINDS, SCENE_LOOKS, type SceneKind, type SceneLook } from '../src/lib/edl/types';
import { env } from '../src/lib/config/env';
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
};

function edlFor(look: SceneLook, kind: SceneKind) {
  const content = CONTENT[kind];
  return EdlSchema.parse({
    ...SAMPLE_EDL,
    projectId: `scene-${look}-${kind}`,
    source: { ...SAMPLE_EDL.source, url: SOURCE },
    segments: [{ ...SAMPLE_EDL.segments[0], sourceStartSec: 0, sourceEndSec: 5, outStartSec: 0, outEndSec: 5 }],
    scenes: [
      {
        id: 'sc-1',
        outStartSec: 0,
        outEndSec: 5,
        kind,
        look,
        backdrop: 'gradient',
        headline: content.headline,
        items: content.items,
        iconQueries: content.items.map(() => ''),
        iconSvgs: content.items.map(() => null),
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
  const looks = (process.argv[2] ? [process.argv[2] as SceneLook] : [...SCENE_LOOKS]);
  const kinds = (process.argv[3] ? [process.argv[3] as SceneKind] : [...SCENE_KINDS]);
  // Late enough that every stagger has landed, early enough to be inside the
  // shortest scene anyone would place.
  const frame = Number(process.argv[4] ?? 60);

  // The programmatic API, not the CLI: `remotion still` runs a version check
  // that trips over this repo's zod pin, and the renderer itself is fine.
  const assets = await startAssetServer(process.cwd());
  SOURCE = assets.urlFor(resolve(SOURCE_FILE)) ?? '';
  if (!SOURCE) throw new Error(`Cannot serve ${SOURCE_FILE}`);

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
          output: join(OUT, `${look}-${kind}.png`),
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
