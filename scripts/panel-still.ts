/**
 * One frame of a finished EDL, at a chosen canvas size.
 *
 *   npx tsx scripts/panel-still.ts <edl.json> <source.mp4> <outDir> <frame...>
 *   PREVIEW_SCALE=0.375 npx tsx scripts/panel-still.ts ...   # the editor's canvas
 *
 * `PREVIEW_SCALE` exists for one reason. The editor's Player composes on a
 * smaller canvas than the export (PREVIEW_LONG_EDGE = 720, so a 1080x1920
 * video previews at 406x720), and a component that takes its geometry from
 * `edl.format` instead of `useVideoConfig()` is then wrong by that ratio —
 * correct in every export and broken in the only place anybody looks. The
 * panel shipped that way. Rendering a still at the preview scale is how you
 * see it without opening a browser.
 */
import '../src/lib/config/load-env';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EdlSchema } from '../src/lib/edl/types';
import { env } from '../src/lib/config/env';
import { startAssetServer } from '../src/lib/render/asset-server';

async function main() {
  const [edlPath, sourcePath, outDir, ...frames] = process.argv.slice(2);
  const raw = JSON.parse(readFileSync(edlPath, 'utf8'));
  const assets = await startAssetServer(process.cwd());
  raw.source.url = assets.urlFor(resolve(sourcePath)) ?? raw.source.url;
  const edl = EdlSchema.parse(raw);
  const inputProps = { edl, previewAudio: false };

  const { bundle } = await import('@remotion/bundler');
  const { renderStill, selectComposition } = await import('@remotion/renderer');
  const serveUrl = await bundle({
    entryPoint: join(process.cwd(), 'remotion', 'index.ts'),
    publicDir: join(process.cwd(), 'public'),
  });
  const base = await selectComposition({
    serveUrl, id: 'EasyCutVideo', inputProps,
    browserExecutable: env.render.browserExecutable,
    chromiumOptions: { ignoreCertificateErrors: env.render.ignoreCertificateErrors },
  });
  // Same canvas the editor's Player composes on (PREVIEW_LONG_EDGE = 720).
  const previewScale = Number(process.env.PREVIEW_SCALE ?? 1);
  const even = (n: number) => Math.max(2, Math.round((n * previewScale) / 2) * 2);
  const composition = { ...base, width: even(base.width), height: even(base.height) };
  console.log('composition', composition.width + 'x' + composition.height, composition.durationInFrames + 'f');
  for (const f of frames) {
    const out = join(outDir, `frame-${f}.png`);
    await renderStill({
      composition, serveUrl, inputProps, frame: Number(f), output: out,
      browserExecutable: env.render.browserExecutable,
      chromiumOptions: { gl: env.render.gl, ignoreCertificateErrors: env.render.ignoreCertificateErrors },
    });
    console.log(out);
  }
  await assets.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
