import '../src/lib/config/load-env';
import { capabilities, env } from '../src/lib/config/env';
import { isMusicAvailable } from '../src/lib/assets/music';
import { FFMPEG, FFPROBE, run } from '../src/lib/media/ffmpeg';
import { estimateCost } from '../src/lib/pricing/cost';

/**
 * `npm run doctor` — one place that answers "why is my output missing X?" and
 * "what will this cost me per video?".
 */

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

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

  const music = await isMusicAvailable();
  console.log(
    `  ${music ? GREEN + '✓' : YELLOW + '!'}${RESET} ${'Music library'.padEnd(20)}${
      music ? '' : DIM + 'empty — add tracks to content/music/manifest.json' + RESET
    }`,
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
  console.log(`  director ${env.llm.anthropicKey ? env.llm.model : 'rule-based (no key)'}`);
  console.log('');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
