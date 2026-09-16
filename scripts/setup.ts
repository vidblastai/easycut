import { execSync } from 'node:child_process';

/**
 * One command to get from `git clone` to a working app.
 *
 *   npm run setup
 */
function step(label: string, command: string) {
  console.log(`\n▸ ${label}`);
  try {
    execSync(command, { stdio: 'inherit' });
  } catch {
    console.warn(`  (skipped — "${command}" failed, continuing)`);
  }
}

console.log('EasyCut setup');
step('Generating the Prisma client', 'npx prisma generate');
step('Creating the database', 'npx prisma db push --skip-generate');
step('Synthesising the sound-effect library', 'npx tsx scripts/generate-sfx.ts');
// Keeps a font CDN out of the render path. Failing here is survivable — the
// renderer falls back to fetching them at render time — so `step` swallowing
// the error is the behaviour we want.
step('Fetching the caption typefaces', 'npx tsx scripts/fetch-fonts.ts');
step('Synthesising the music beds', 'npx tsx scripts/generate-music.ts');
step('Checking the system', 'npx tsx scripts/doctor.ts');

console.log(`
Done. Two terminals:

  npm run dev       the web app      → http://localhost:3000
  npm run worker    the pipeline     (must be running for edits to happen)

With no API keys at all this still produces a finished video — silence-based
cuts, rule-based structure, procedural sound design. See docs/API_KEYS.md for
what each key adds.
`);
