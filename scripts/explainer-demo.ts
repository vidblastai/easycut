import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import '../src/lib/config/load-env';
import { env } from '../src/lib/config/env';
import { EdlSchema, type PanelScene } from '../src/lib/edl/types';
import { writePanel } from '../src/lib/director/panel';
import { generateImage } from '../src/lib/assets/images';
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

  /* ------------------------------------------------------------- the icons */

  const wanted = new Set(scenes.flatMap((s) => s.icons));
  const svgs = new Map<string, string>();
  await Promise.all(
    [...wanted].map(async (name) => {
      const markup = await iconify(name);
      if (markup) svgs.set(name, markup);
    }),
  );
  console.log(`icons: ${svgs.size}/${wanted.size} resolved`);
  const withPanel = scenes.map((s) => ({
    ...s,
    iconSvgs: s.icons.map((n) => svgs.get(n) ?? '').filter(Boolean),
  }));

  /* ------------------------------------------------------------ the images */

  /*
   * The reference's hero shots are all one look: a 3D clay render on a pale
   * ground with a soft studio shadow — a brain, a crowd of figures, an MRI
   * machine. It is the one thing in the panel that is not a mock interface,
   * and it is what carries a passage about a physical thing.
   */
  const LOOK =
    'soft 3D clay render, matte plastic materials, centred single subject, ' +
    'pale neutral grey studio background #F1F1F3, soft overhead studio light, ' +
    'gentle contact shadow, muted palette with one warm terracotta accent, ' +
    'no text, no letters, no logos, no watermark, product-render look';

  const heroes = withPanel.filter((s) => s.kind === 'hero-image' && s.imagePrompt && !s.imageUrl);
  if (heroes.length && !process.env.NO_IMAGES) {
    process.stdout.write(`drawing ${heroes.length} hero image${heroes.length === 1 ? '' : 's'}… `);
    await Promise.all(
      heroes.map(async (scene) => {
        const image = await generateImage(`${scene.imagePrompt}. ${LOOK}`, '1:1', { styled: false });
        if (!image) return;
        const file = join(OUT, `hero-${scene.id}.png`);
        await writeFile(file, Buffer.from(await (await fetch(image.url)).arrayBuffer()));
        scene.imageUrl = file;
      }),
    );
    console.log(`${heroes.filter((s) => s.imageUrl).length} drawn`);
  }

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
      panel: withPanel.map((s) => ({
        ...s,
        imageUrl: s.imageUrl ? (assets.urlFor(resolve(s.imageUrl)) ?? '') : '',
      })),
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
