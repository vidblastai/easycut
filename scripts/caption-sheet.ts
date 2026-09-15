import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { CAPTION_PRESETS } from '../src/lib/captions/presets';
import { EdlSchema } from '../src/lib/edl/types';
import { env } from '../src/lib/config/env';
import { startAssetServer } from '../src/lib/render/asset-server';
import { SAMPLE_EDL } from '../remotion/sample-edl';

/**
 * A contact sheet of every caption preset, rendered by the real renderer.
 *
 *   npx tsx scripts/caption-sheet.ts [sourceVideo]
 *
 * Screenshots of a CSS mock would prove nothing — the thing worth checking is
 * that Remotion draws what the preset describes, with the real font, the real
 * stroke geometry and the real animation state at a real frame. So this builds
 * a minimal EDL per preset and renders one still each.
 */

// Remotion fetches source over http, and the sample EDL's own S3 clip is not
// reachable from every network — so the footage is served off the same
// loopback asset server a real render uses.
const SOURCE_FILE = process.argv[2] ?? 'out/fixture.mp4';
let SOURCE = '';
const OUT = 'out/caption-sheet';

/** A line with a bit of everything: short words, a long one, an emphasis. */
const LINE = [
  { text: 'This', emphasis: false },
  { text: 'changes', emphasis: true },
  { text: 'everything', emphasis: false },
  { text: 'about', emphasis: false },
  { text: 'how', emphasis: false },
  { text: 'you', emphasis: false },
  { text: 'price', emphasis: false },
  { text: 'it', emphasis: false },
];

function edlFor(presetId: string) {
  const preset = CAPTION_PRESETS.find((p) => p.id === presetId)!;
  const words = LINE.slice(0, preset.style.maxWordsPerCue);
  // Spread the line across the whole cue so the still's frame always lands on a
  // word that is being spoken — otherwise karaoke and word-box photograph with
  // nothing lit and the sheet shows a look the preset does not have.
  const perWord = 3.4 / words.length;

  // Built from the sample EDL rather than hand-typed, so this sheet cannot
  // drift out of shape when the schema grows. Every layer but captions is
  // stripped: the point is the type, and B-roll would cover it.
  return EdlSchema.parse({
    ...SAMPLE_EDL,
    projectId: `sheet-${presetId}`,
    source: { ...SAMPLE_EDL.source, url: SOURCE },
    segments: [
      { ...SAMPLE_EDL.segments[0], sourceStartSec: 2, sourceEndSec: 6, outStartSec: 0, outEndSec: 4 },
    ],
    captions: [
      {
        id: 'cue-0',
        startSec: 0,
        endSec: 4,
        words: words.map((w, i) => ({
          text: w.text,
          // Frame 70 lands mid-line, so karaoke and word-box have an active
          // word and the pop animations have both arrived and unarrived ones.
          startSec: 0.25 + i * perWord,
          endSec: 0.25 + (i + 1) * perWord,
          emphasis: w.emphasis,
        })),
      },
    ],
    captionStyle: preset.style,
    broll: [],
    graphics: [],
    overlays: [],
    punchIns: [],
    sfx: [],
    transitions: [],
    music: null,
    reframe: null,
    deliverable: { ...SAMPLE_EDL.deliverable, durationSec: 4 },
  });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const ids = process.argv[3] ? [process.argv[3]] : CAPTION_PRESETS.map((p) => p.id);

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

  for (const id of ids) {
    process.stdout.write(`  ${id.padEnd(16)}`);
    try {
      const inputProps = { edl: edlFor(id), previewAudio: false };
      const composition = await selectComposition({
        serveUrl, id: 'EasyCutVideo', inputProps,
        browserExecutable: env.render.browserExecutable,
        chromiumOptions: { ignoreCertificateErrors: env.render.ignoreCertificateErrors },
      });
      await renderStill({
        composition,
        serveUrl,
        inputProps,
        output: join(OUT, `${id}.png`),
        frame: 70,
        browserExecutable: env.render.browserExecutable,
        chromiumOptions: {
          gl: 'swangle',
          ignoreCertificateErrors: env.render.ignoreCertificateErrors,
        },
      });
      console.log('ok');
    } catch (error) {
      console.log('FAILED');
      console.error('   ', String(error).split('\n')[0].slice(0, 200));
    }
  }
  await assets.close();
  console.log(`\nStills in ${OUT}/`);
}

void main();
