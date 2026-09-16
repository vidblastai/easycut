import '../src/lib/config/load-env';
import { capabilities, env } from '../src/lib/config/env';
import { loadMusicLibrary } from '../src/lib/assets/music';
import { CAPTION_FONTS } from '../src/lib/captions/fonts';
import { FONT_MANIFEST_PATH } from '../src/lib/captions/local-fonts';
import { FFMPEG, FFPROBE, run } from '../src/lib/media/ffmpeg';
import { estimateCost } from '../src/lib/pricing/cost';
import { selectedProvider } from '../src/lib/director';
import { isGeminiFreeTier, listGeminiModels } from '../src/lib/director/gemini';

/**
 * `npm run doctor` — one place that answers "why is my output missing X?" and
 * "what will this cost me per video?".
 */

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const dim = (text: string) => `${DIM}${text}${RESET}`;

async function main() {
  console.log(`${BOLD}EasyCut — system check${RESET}\n`);

  /* ------------------------------- binaries ------------------------------ */
  for (const [label, binary] of [['ffmpeg', FFMPEG], ['ffprobe', FFPROBE]] as const) {
    try {
      const { stdout, stderr } = await run(binary, ['-version']);
      const version = (stdout || stderr).split('\n')[0];
      console.log(`  ${GREEN}✓${RESET} ${label.padEnd(20)} ${DIM}${version.slice(0, 60)}${RESET}`);
    } catch {
      console.log(`  ${YELLOW}!${RESET} ${label.padEnd(20)} not found — run npm install`);
    }
  }

  /* ----------------------------- capabilities ---------------------------- */
  console.log(`\n${BOLD}Capabilities${RESET}`);
  for (const capability of capabilities()) {
    const mark = capability.configured ? `${GREEN}✓${RESET}` : `${YELLOW}!${RESET}`;
    console.log(`  ${mark} ${capability.label.padEnd(20)}${capability.configured ? '' : DIM + capability.fallback + RESET}`);
    if (!capability.configured) {
      console.log(`    ${DIM}set ${capability.envVars.join(' or ')}${capability.signupUrl ? ` — ${capability.signupUrl}` : ''}${RESET}`);
    }
  }

  // The two things `npm run setup` puts on disk. Both degrade rather than fail,
  // which is exactly why they are worth printing — a video that came out in the
  // wrong typeface with no music looks like a bad edit, not a missing step.
  const library = await loadMusicLibrary();
  line(
    library.tracks.length > 0,
    'Music library',
    library.tracks.length
      ? `${library.tracks.length} track${library.tracks.length === 1 ? '' : 's'}`
      : 'empty — run `npm run music`, or add your own to content/music/manifest.json',
  );

  const fonts = await countLocalFonts();
  line(
    fonts > 0,
    'Caption typefaces',
    fonts
      ? `${fonts}/${CAPTION_FONTS.length} families on disk`
      : 'none on disk — run `npm run fonts`, or every render waits on Google',
  );

  /* -------------------------------- costs -------------------------------- */
  console.log(
    `\n${BOLD}Projected cost per video${RESET} ${DIM}(priced against Remotion Lambda; local rendering costs time, not money)${RESET}`,
  );

  const scenarios = [
    { name: '60s short (1080×1920)', mode: 'short' as const, sourceSec: 90, outSec: 55, width: 1080, height: 1920, chars: 1500, windows: 1, images: 1, broll: 7 },
    { name: '10m long (1920×1080)', mode: 'long' as const, sourceSec: 780, outSec: 600, width: 1920, height: 1080, chars: 16000, windows: 5, images: 2, broll: 18 },
  ];

  for (const scenario of scenarios) {
    // Quote the cloud renderer: local rendering is free in dollars, so pricing
    // it would flatter the numbers and hide the line that actually scales.
    const estimate = estimateCost({
      renderDriver: 'lambda',
      mode: scenario.mode,
      sourceDurationSec: scenario.sourceSec,
      outputDurationSec: scenario.outSec,
      width: scenario.width,
      height: scenario.height,
      fps: 30,
      transcriptChars: scenario.chars,
      directorWindows: scenario.windows,
      generatedImageCount: scenario.images,
      brollClipCount: scenario.broll,
    });

    const verdict = estimate.withinBudget ? `${GREEN}within budget${RESET}` : `${YELLOW}OVER BUDGET${RESET}`;
    console.log(`\n  ${BOLD}${scenario.name}${RESET} — budget $${estimate.budgetUsd.toFixed(2)} — ${verdict}`);
    for (const [line, usd] of Object.entries(estimate.lines)) {
      if (usd <= 0) continue;
      console.log(`    ${line.padEnd(18)} $${usd.toFixed(4)}`);
    }
    console.log(`    ${BOLD}${'total'.padEnd(18)} $${estimate.totalUsd.toFixed(4)}${RESET}  ${DIM}(${(estimate.budgetUsd / Math.max(estimate.totalUsd, 1e-6)).toFixed(1)}× headroom)${RESET}`);
  }

  console.log(`\n${BOLD}Runtime${RESET}`);
  console.log(`  storage  ${env.storage.driver}`);
  console.log(`  queue    ${env.queue.driver}`);
  console.log(`  renderer ${env.render.driver}`);
  const provider = selectedProvider();
  const directorLine =
    provider === 'anthropic' ? `anthropic · ${env.llm.model}`
    : provider === 'gemini' ? `gemini · ${env.llm.geminiModel}${isGeminiFreeTier() ? ' (free tier)' : ''}`
    : 'rule-based (no key)';
  console.log(`  director ${directorLine}`);

  if (provider === 'gemini' && isGeminiFreeTier()) {
    // Worth saying out loud rather than burying in a doc: the transcript is the
    // user's unpublished script, and on the free tier it is training data.
    console.log(dim('           free tier — Google may use your prompts to improve its products.'));
    console.log(dim('           Link a billing account and set GEMINI_PAID_TIER=true to opt out.'));
  }

  // Model ids move faster than any table in this repo, so ask rather than assert.
  if (env.llm.geminiKey) {
    try {
      const models = await listGeminiModels();
      const reachable = models.includes(env.llm.geminiModel);
      console.log(dim(`           GEMINI_MODEL=${env.llm.geminiModel} ${reachable ? 'is available' : 'NOT in this key\'s model list'}`));
      if (!reachable && models.length) {
        console.log(dim(`           available: ${models.filter((m) => m.startsWith('gemini')).slice(0, 6).join(', ')}`));
      }
    } catch (error) {
      console.log(dim(`           could not list Gemini models: ${(error as Error).message}`));
    }
  }
  console.log('');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/** A status line in the same shape as the capability rows above it. */
function line(ok: boolean, label: string, detail: string): void {
  console.log(`  ${ok ? GREEN + '✓' : YELLOW + '!'}${RESET} ${label.padEnd(20)}${DIM}${detail}${RESET}`);
}

/** How many caption families `npm run fonts` has put in public/. */
async function countLocalFonts(): Promise<number> {
  try {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const raw = await readFile(join(process.cwd(), 'public', FONT_MANIFEST_PATH), 'utf8');
    return Object.keys(JSON.parse(raw) as Record<string, unknown>).length;
  } catch {
    return 0;
  }
}
