import { spawn } from 'node:child_process';

/**
 * Web server and worker, one container.
 *
 * Two processes rather than one, because the worker pulls in ffmpeg and
 * Remotion's native binaries and Next's bundler refuses to build them into the
 * server bundle — correctly, they are platform binaries, not JavaScript. They
 * share work through the database queue instead of memory, which is why this
 * needs no Redis.
 *
 *   QUEUE_DRIVER=db npm run start:all
 *
 * If either process exits, so does this one: a container that is half-alive
 * looks healthy to the host and silently stops rendering.
 */
const procs = [
  { name: 'web', cmd: 'npm', args: ['run', 'start'] },
  { name: 'worker', cmd: 'npm', args: ['run', 'worker'] },
].map(({ name, cmd, args }) => {
  const child = spawn(cmd, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => {
    console.error(`[start-all] ${name} exited with ${code} — shutting down`);
    process.exit(code ?? 1);
  });
  return child;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    for (const child of procs) child.kill(signal);
  });
}

if (process.env.QUEUE_DRIVER === 'memory') {
  console.warn(
    '[start-all] QUEUE_DRIVER=memory — the two processes cannot see each other\'s jobs. Use QUEUE_DRIVER=db.',
  );
}
