import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { env } from '../src/lib/config/env';
import { EdlSchema, type PanelScene } from '../src/lib/edl/types';
import { writePanel } from '../src/lib/director/panel';
import { dressPanel } from '../src/lib/assets/panel-assets';
import { startAssetServer } from '../src/lib/render/asset-server';
import { SAMPLE_EDL } from '../remotion/sample-edl';
import type { Transcript } from '../src/lib/transcribe/types';

/**
 * The explainer style, end to end, on real footage.
 *
 *   npx tsx scripts/explainer-demo.ts <speaker.mp4> <transcript.json> [out.mp4]
 *
 * Writes the panel with the model, fetches the brand icons, cuts the speech
 * into one-word captions and renders the whole thing. It goes through the
 * real EDL schema and the real composition, so what comes out is what the
 * pipeline would make.
 */

const OUT = 'out/explainer';

async function main() {
  const [sourcePath, transcriptPath, outName = 'explainer.mp4'] = process.argv.slice(2);
  if (!sourcePath || !transcriptPath) {
    console.log('usage: npx tsx scripts/explainer-demo.ts <speaker.mp4> <transcript.json> [out.mp4]');
    return;
  }
  await mkdir(OUT, { recursive: true });

  const transcript = JSON.parse(await readFile(transcriptPath, 'utf8')) as Transcript;
  const durationSec = Number(process.env.DEMO_SECONDS ?? transcript.durationSec ?? 40);

  /* ------------------------------------------------------------- the panel */

  const cached = process.env.PANEL_JSON;
  let scenes: PanelScene[];
  if (cached) {
    scenes = JSON.parse(await readFile(cached, 'utf8')) as PanelScene[];
    console.log(`panel: ${scenes.length} scenes (cached)`);
  } else {
    process.stdout.write('writing the panel… ');
    const pass = await writePanel(transcript, durationSec);
    if (pass.error) console.log(`\n  ${pass.error}`);
    scenes = pass.scenes;
    console.log(`${scenes.length} scenes · $${pass.costUsd.toFixed(4)} · ${pass.model}`);
    await writeFile(join(OUT, 'panel.json'), JSON.stringify(scenes, null, 1));
  }
  for (const s of scenes) {
    console.log(
      `  ${s.outStartSec.toFixed(1)}–${s.outEndSec.toFixed(1)} ${s.kind.padEnd(11)} ` +
        `${s.eyebrow.join(' · ').padEnd(42)} ${s.reason.slice(0, 48)}`,
    );
  }

  /* ------------------------------------------------- the icons and pictures */

  /*
   * The same call the pipeline makes, deliberately.
   *
   * An earlier version of this script fetched its own icons and drew its own
   * heroes, which meant the thing being demonstrated and the thing that ships
   * were two implementations of one idea — and the demo is the only place
   * anybody looks.
   */
  process.stdout.write('fetching icons and drawing heroes… ');
  const dressed = await dressPanel(scenes);
  const withPanel = dressed.scenes;
  console.log(
    `${withPanel.filter((s) => s.imageUrl).length} heroes · $${dressed.costUsd.toFixed(4)}` +
      (dressed.missing.length ? ` · no icon for ${[...new Set(dressed.missing)].join(', ')}` : ''),
  );

  /* ---------------------------------------------------------- the captions */

  const words = transcript.words.filter((w) => w.startSec < durationSec);
  const captions = words.map((w, i) => {
    const next = words[i + 1];
    const until = next ? next.startSec : w.endSec + 0.3;
    return {
      id: `cap-${i}`,
      startSec: w.startSec,
      // The word holds until the next one arrives — the reference panel never
      // has an empty caption band — but not across a real pause.
      endSec: Math.min(until, w.endSec + 0.8, durationSec),
      words: [{ text: w.text.replace(/[,.]$/, ''), startSec: w.startSec, endSec: w.endSec, emphasis: false }],
    };
  });

  /* --------------------------------------------------------------- the EDL */

  const assets = await startAssetServer(process.cwd());
  const source = assets.urlFor(resolve(sourcePath)) ?? '';
  if (!source) throw new Error(`Cannot serve ${sourcePath}`);

  const inputProps = {
    edl: EdlSchema.parse({
      ...SAMPLE_EDL,
      projectId: 'explainer',
      styleId: 'clean',
      format: { aspect: '9:16', width: 576, height: 1024, fps: 30, durationSec, layout: 'explainer' },
      source: { ...SAMPLE_EDL.source, url: source, durationSec, width: 576, height: 588 },
      segments: [
        {
          ...SAMPLE_EDL.segments[0],
          sourceStartSec: 0,
          sourceEndSec: durationSec,
          outStartSec: 0,
          outEndSec: durationSec,
        },
      ],
      captions,
      captionStyle: {
        ...SAMPLE_EDL.captionStyle,
        preset: 'one-word',
        animation: 'typewriter',
        fontFamily: 'Plus Jakarta Sans',
        fontWeight: 800,
        fontSizeRatio: 0.062,
        letterSpacing: -0.02,
        uppercase: true,
        maxWordsPerCue: 1,
        maxLines: 1,
        align: 'center',
        widthRatio: 0.9,
        color: '#FFFFFF',
        emphasisColor: '#C96442',
        stroke: { width: 9, color: '#000000' },
        shadow: { offsetX: 0, offsetY: 3, blur: 18, color: 'rgba(0,0,0,0.55)' },
        background: null,
        wordBox: null,
        gradient: null,
        glow: null,
      },
      panel: withPanel,
      broll: [], scenes: [], graphics: [], icons: [], overlays: [], annotations: [],
      punchIns: [], sfx: [], transitions: [], music: null, reframe: null,
      deliverable: { ...SAMPLE_EDL.deliverable, durationSec },
    }),
    previewAudio: false,
  };

  await writeFile(join(OUT, 'edl.json'), JSON.stringify(inputProps.edl, null, 1));

  /* ------------------------------------------------------------ the render */

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

  const output = join(OUT, outName);
  await renderMedia({
    composition,
    serveUrl,
    inputProps,
    codec: 'h264',
    outputLocation: output,
    audioCodec: 'aac',
    browserExecutable: env.render.browserExecutable,
    chromiumOptions: { gl: env.render.gl, ignoreCertificateErrors: env.render.ignoreCertificateErrors },
    onProgress: ({ progress }) => process.stdout.write(`\r  ${Math.round(progress * 100)}%   `),
  });

  await assets.close();
  console.log(`\n${output}`);
}

/** One icon, as markup, straight from the library the icon cards already use. */
async function iconify(name: string): Promise<string | null> {
  const id = name.includes(':') ? name : `logos:${name}`;
  const [set, icon] = id.split(':');
  for (const candidate of [icon, `${icon}-icon`, `${icon}-logo`]) {
    const response = await fetch(`https://api.iconify.design/${set}/${candidate}.svg`).catch(() => null);
    if (!response?.ok) continue;
    const markup = await response.text();
    if (markup.includes('<svg')) return markup;
  }
  return null;
}

void main();
