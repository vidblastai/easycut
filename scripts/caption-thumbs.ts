/**
 * Pre-renders one still per caption preset, for the picker's tiles.
 *
 *   npx tsx scripts/caption-thumbs.ts
 *
 * The picker used to draw every tile live: twenty blocks of gradient-filled,
 * drop-shadowed text, each laid out at the video's real pixel size and scaled
 * down. Twenty of those repaint on every hover and every click, and on a laptop
 * that is enough to make the whole machine stutter — for a grid whose only job
 * is to let somebody point at a look they like.
 *
 * A still cannot stutter. These are rendered ONCE, by the real renderer, so
 * they are exactly what the export produces — and then served as ordinary
 * images from the app, which is also what makes the picker feel the same for
 * everybody rather than depending on the machine it is opened on.
 *
 * They are committed, not generated at build: a tile that silently fails to
 * exist in production is worse than a megabyte in the repository.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import '../src/lib/config/load-env';
import { CAPTION_PRESETS } from '../src/lib/captions/presets';
import { EdlSchema } from '../src/lib/edl/types';
import { env } from '../src/lib/config/env';
import { ffmpeg } from '../src/lib/media/ffmpeg';
import { startAssetServer } from '../src/lib/render/asset-server';
import { SAMPLE_EDL } from '../remotion/sample-edl';

/** The same sentence the tiles used to draw live. */
const SAMPLE = 'Captions that look good'.split(' ');
const OUT_DIR = join(process.cwd(), 'public', 'captions');
const PLATE = '#0E0E12';

type Shape = { id: 'short' | 'long'; width: number; height: number };
const SHAPES: Shape[] = [
  { id: 'short', width: 1080, height: 1920 },
  { id: 'long', width: 1920, height: 1080 },
];

function edlFor(presetId: string, shape: Shape, source: string) {
  const preset = CAPTION_PRESETS.find((p) => p.id === presetId)!;
  const words = SAMPLE.slice(0, Math.max(2, preset.style.maxWordsPerCue));
  const per = 1.2 / words.length;

  return EdlSchema.parse({
    ...SAMPLE_EDL,
    projectId: `thumb-${presetId}`,
    format: { ...SAMPLE_EDL.format, aspect: shape.id === 'short' ? '9:16' : '16:9', width: shape.width, height: shape.height, fps: 30, durationSec: 2 },
    source: { ...SAMPLE_EDL.source, url: source, durationSec: 2 },
    segments: [{ ...SAMPLE_EDL.segments[0], sourceStartSec: 0, sourceEndSec: 2, outStartSec: 0, outEndSec: 2 }],
    captions: [
      {
        id: 'cue-0',
        startSec: 0,
        endSec: 2,
        words: words.map((text, i) => ({
          text,
          startSec: i * per,
          endSec: (i + 1) * per,
          // The last word carries the style's emphasis treatment, so a preset
          // whose whole character is what it does to one word shows it.
          emphasis: i === words.length - 1,
        })),
      },
    ],
    // Centred, whatever the preset's own placement: the tile is a band, and a
    // row of tiles comparing vertical placement is comparing the wrong thing.
    captionStyle: { ...preset.style, positionY: 0.5 },
    broll: [], graphics: [], overlays: [], punchIns: [], sfx: [], transitions: [],
    music: null, reframe: null,
    deliverable: { ...SAMPLE_EDL.deliverable, durationSec: 2 },
  });
}


/**
 * A full frame is not a tile.
 *
 * The tile is a 4:3 window on the caption, at a size a browser can paint
 * without thinking — 640×480 rather than a two-megapixel video frame. A
 * portrait frame is cropped to the band around the caption; a landscape one
 * keeps its whole width and is letterboxed on the plate colour, because a
 * caption can run wider than a 4:3 crop of it.
 */
async function crop(input: string, output: string, shape: Shape): Promise<void> {
  const filter =
    shape.id === 'short'
      ? // Centred on the caption, which is at the middle of the frame.
        `crop=${shape.width}:${Math.round(shape.width * 0.75)}:0:${Math.round((shape.height - shape.width * 0.75) / 2)},scale=640:480`
      : `scale=640:360,pad=640:480:0:60:color=${PLATE}`;
  await ffmpeg(['-y', '-i', input, '-vf', filter, output]);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // A plain plate to draw on. The tiles compare TYPE — a different still
  // behind each one would be comparing backgrounds.
  const platePath = join(process.cwd(), 'out', 'plate.mp4');
  await mkdir(join(process.cwd(), 'out'), { recursive: true });
  await ffmpeg([
    '-y', '-f', 'lavfi', '-i', `color=c=${PLATE}:s=1920x1920:d=2:r=30`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', platePath,
  ]);

  const assets = await startAssetServer(process.cwd());
  const source = assets.urlFor(platePath)!;

  const { bundle } = await import('@remotion/bundler');
  const { renderStill, selectComposition } = await import('@remotion/renderer');
  process.stdout.write('bundling… ');
  const serveUrl = await bundle({
    entryPoint: join(process.cwd(), 'remotion', 'index.ts'),
    publicDir: join(process.cwd(), 'public'),
  });
  console.log('ok\n');

  const manifest: Record<string, string[]> = {};

  for (const preset of CAPTION_PRESETS) {
    const shapes = SHAPES.filter(
      (s) => preset.bestFor === 'both' || preset.bestFor === s.id,
    );
    for (const shape of shapes) {
      const name = `${preset.id}-${shape.id}.png`;
      process.stdout.write(`  ${name.padEnd(28)}`);
      try {
        const inputProps = { edl: edlFor(preset.id, shape, source), previewAudio: false };
        const composition = await selectComposition({
          serveUrl, id: 'EasyCutVideo', inputProps,
          browserExecutable: env.render.browserExecutable,
          chromiumOptions: { ignoreCertificateErrors: env.render.ignoreCertificateErrors },
        });
        const full = join(process.cwd(), 'out', `full-${name}`);
        await renderStill({
          composition,
          serveUrl,
          inputProps,
          output: full,
          // Late enough that every word has arrived and settled.
          frame: 45,
          timeoutInMilliseconds: 180000,
          browserExecutable: env.render.browserExecutable,
          chromiumOptions: { gl: env.render.gl, ignoreCertificateErrors: env.render.ignoreCertificateErrors },
        });
        await crop(full, join(OUT_DIR, name), shape);
        await rm(full, { force: true });
        (manifest[preset.id] ??= []).push(shape.id);
        console.log('ok');
      } catch (error) {
        console.log('FAILED');
        console.error('   ', String(error).split('\n')[0].slice(0, 160));
      }
    }
  }

  await assets.close();
  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nTiles in public/captions/`);
}

void main();
