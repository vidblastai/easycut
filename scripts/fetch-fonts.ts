/**
 * Puts the caption typefaces on disk, so a render never depends on a font CDN.
 *
 *   npx tsx scripts/fetch-fonts.ts          every family in the registry
 *   npx tsx scripts/fetch-fonts.ts Anton    just one
 *
 * Why this exists. The renderer used to pull each face from
 * fonts.googleapis.com at render time, which makes a third party a hard
 * dependency for the single most important thing on the screen. Three ways that
 * goes wrong, all of them seen rather than imagined:
 *
 *  - A render host behind a TLS-intercepting proxy. Headless Chrome does not
 *    trust the proxy's CA, every stylesheet fails `ERR_CERT_AUTHORITY_INVALID`,
 *    and a video comes out in Helvetica without anything reporting an error.
 *  - An offline or locked-down host. Same outcome, plus a wait.
 *  - Google being slow. The renderer waits up to twelve seconds per family
 *    before giving up — paid on every cold worker, per video.
 *
 * Fetched here with Node, which honours the system trust store, and served from
 * `public/` at render time. Latin and Latin-Extended only: that is the script
 * this product is for, and all sixteen families in every subset would be some
 * 350 files nobody looks at. Anything not covered falls back to the CDN exactly
 * as before, so a Cyrillic caption still renders when the network allows it.
 *
 * The files are not committed — this is a setup step, like the sound effects.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CAPTION_FONTS, type CaptionFont } from '../src/lib/captions/fonts';

/** Google serves woff2 only to browsers that say they can take it. */
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const SUBSETS = new Set(['latin', 'latin-ext']);
const OUT_DIR = join(process.cwd(), 'public', 'fonts');

export interface LocalFace {
  weight: string;
  /** Path under public/, for `staticFile()`. */
  file: string;
  unicodeRange: string;
}
export type FontManifest = Record<string, LocalFace[]>;

function slug(familyId: string): string {
  return familyId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function cssUrl(font: CaptionFont): string {
  return (
    'https://fonts.googleapis.com/css2?family=' +
    encodeURIComponent(font.id).replace(/%20/g, '+') +
    ':wght@' +
    font.weights.join(';') +
    '&display=block'
  );
}

interface Face {
  subset: string;
  weight: string;
  url: string;
  unicodeRange: string;
}

/**
 * Pull the @font-face blocks out of a css2 response.
 *
 * Google emits one block per (weight, subset) with the subset named in a
 * comment directly above it, which is the only place that name appears.
 */
function parseFaces(css: string): Face[] {
  const faces: Face[] = [];
  const blocks = css.split('@font-face');
  let subset = 'unknown';

  for (const block of blocks) {
    const comment = block.match(/\/\*\s*([a-z0-9-]+)\s*\*\/\s*$/i);
    const nextSubset = comment?.[1];

    const weight = block.match(/font-weight:\s*(\d+)/)?.[1];
    const url = block.match(/src:\s*url\(([^)]+)\)\s*format\('woff2'\)/)?.[1];
    const range = block.match(/unicode-range:\s*([^;]+);/)?.[1];

    if (weight && url && range) faces.push({ subset, weight, url, unicodeRange: range.trim() });
    if (nextSubset) subset = nextSubset;
  }
  return faces;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const wanted = only.length
    ? CAPTION_FONTS.filter((f) => only.some((name) => f.id.toLowerCase() === name.toLowerCase()))
    : CAPTION_FONTS;

  if (!wanted.length) {
    throw new Error(`no such family. Known: ${CAPTION_FONTS.map((f) => f.id).join(', ')}`);
  }

  await mkdir(OUT_DIR, { recursive: true });

  // Merge rather than replace, so fetching one family does not silently drop
  // the other fifteen from the manifest.
  const manifest: FontManifest = await readFile(join(OUT_DIR, 'manifest.json'), 'utf8')
    .then((raw) => JSON.parse(raw) as FontManifest)
    .catch(() => ({}));

  let files = 0;
  let bytes = 0;
  const failed: string[] = [];

  for (const font of wanted) {
    try {
      const css = await fetchText(cssUrl(font));
      const faces = parseFaces(css).filter((f) => SUBSETS.has(f.subset));
      if (!faces.length) throw new Error('no latin faces in the stylesheet');

      const dir = join(OUT_DIR, slug(font.id));
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });

      const local: LocalFace[] = [];
      for (const face of faces) {
        const name = `${face.weight}-${face.subset}.woff2`;
        const response = await fetch(face.url, { headers: { 'User-Agent': UA } });
        if (!response.ok) throw new Error(`${response.status} for ${face.url}`);
        const body = Buffer.from(await response.arrayBuffer());
        await writeFile(join(dir, name), body);
        local.push({
          weight: face.weight,
          file: `fonts/${slug(font.id)}/${name}`,
          unicodeRange: face.unicodeRange,
        });
        files += 1;
        bytes += body.byteLength;
      }
      manifest[font.id] = local;
      console.log(`  ${font.id.padEnd(18)} ${String(local.length).padStart(2)} faces`);
    } catch (error) {
      failed.push(`${font.id}: ${(error as Error).message}`);
      console.log(`  ${font.id.padEnd(18)} skipped — ${(error as Error).message}`);
    }
  }

  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(
    `\n${files} files, ${(bytes / 1024 / 1024).toFixed(2)} MB → public/fonts` +
      `\n${Object.keys(manifest).length}/${CAPTION_FONTS.length} families available locally`,
  );
  if (failed.length) {
    // Not an error. A family that could not be fetched falls back to the CDN at
    // render time, which is where it was before this script existed.
    console.log(`\nstill on the CDN:\n${failed.map((f) => `  - ${f}`).join('\n')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
