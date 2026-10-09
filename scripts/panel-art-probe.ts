/**
 * Draw the exhibits of an existing EDL and look at them.
 *
 *   npx tsx scripts/panel-art-probe.ts out/user/verify-edl.json [out/panel-art]
 *
 * Writes one SVG per exhibit so the drawings can be opened, plus a sheet.
 * A panel exhibit cannot be judged from its markup any more than a scene can.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import '../src/lib/config/load-env';
import { drawPanel } from '../src/lib/director/panel-art';
import type { Edl } from '../src/lib/edl/types';

async function main() {
  const [edlPath, outDir = 'out/panel-art'] = process.argv.slice(2);
  const edl = JSON.parse(readFileSync(edlPath, 'utf8')) as Edl;
  await mkdir(outDir, { recursive: true });

  const started = Date.now();
  const pass = await drawPanel(edl.panel, edl.captionStyle.emphasisColor || '#C96442');
  console.log(
    `drew ${pass.drawn.size} of ${edl.panel.length} · $${pass.costUsd.toFixed(4)} · ` +
      `${((Date.now() - started) / 1000).toFixed(0)}s`,
  );
  for (const e of pass.errors) console.log('  !', e);

  const tiles: string[] = [];
  for (const [i, scene] of edl.panel.entries()) {
    const art = pass.drawn.get(scene.id);
    const said = scene.reason || scene.eyebrow.join(' · ');
    if (!art) {
      console.log(`  ${String(i).padStart(2)} —            ${said}`);
      continue;
    }
    const shapes = art.parts.reduce(
      (n, p) => n + (p.markup.match(/<(path|circle|ellipse|rect|line|polyline|polygon)\b/g) ?? []).length,
      0,
    );
    const idles = art.parts.filter((p) => p.idle !== 'none').length;
    console.log(
      `  ${String(i).padStart(2)} ${String(art.parts.length).padStart(2)} parts ` +
        `${String(shapes).padStart(3)} shapes ${idles} moving  ${said}`,
    );
    const svg = `<svg viewBox="${art.viewBox}" xmlns="http://www.w3.org/2000/svg" width="500">` +
      `<rect x="0" y="0" width="1000" height="756" fill="#F1F1F3"/>${art.defs}` +
      art.parts.map((p) => p.markup).join('') + '</svg>';
    await writeFile(`${outDir}/${String(i).padStart(2, '0')}.svg`, svg);
    tiles.push(
      `<figure><figcaption>${i} · ${said.replace(/[<&]/g, '')}</figcaption>${svg}</figure>`,
    );
  }

  await writeFile(
    `${outDir}/sheet.html`,
    `<style>body{background:#0D0D10;color:#A5A5B3;font:13px system-ui;display:flex;flex-wrap:wrap;gap:18px;padding:18px}
     figure{margin:0;width:500px}figcaption{padding:6px 0}svg{display:block;border-radius:8px}</style>` +
      tiles.join('\n'),
  );
  console.log(`\n${outDir}/sheet.html`);
}
main().catch((e) => { console.error(e); process.exit(1); });
