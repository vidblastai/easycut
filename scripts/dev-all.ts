import { spawn } from 'node:child_process';

/**
 * Everything, one command, for working on your own machine.
 *
 *   npm run dev
 *
 * The app is a web server plus a worker that does the actual video work. Two
 * terminals is a thing you forget once and then spend twenty minutes wondering
 * why your upload sits at "queued" forever — so this runs both, and forces the
 * database queue, which is what lets two processes see each other's jobs.
 */
process.env.QUEUE_DRIVER = process.env.QUEUE_DRIVER ?? 'db';

const procs = [
  { name: 'web', args: ['next', 'dev'] },
  { name: 'worker', args: ['tsx', 'src/worker/main.ts'] },
].map(({ name, args }) => {
  const child = spawn('npx', args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => {
    console.error(`\n[dev] ${name} stopped (${code})`);
    process.exit(code ?? 1);
  });
  return child;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { for (const p of procs) p.kill(signal); });
}

setTimeout(() => {
  console.log('\n  \x1b[1mEasyCut is running → http://localhost:3000\x1b[0m\n');
}, 3000);
