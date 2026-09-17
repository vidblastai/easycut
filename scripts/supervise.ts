import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Runs the web server and the worker together, and — the part that matters —
 * takes them both down together.
 *
 * Both `npm run dev` and `npm run start:all` used to exit the moment one child
 * died without touching the other, which orphans it. On a dev machine that is
 * worse than it sounds: the orphan is a WORKER, it still holds the database
 * queue, and it is still running the code it was started with. You edit the
 * pipeline, restart, and your change appears not to work — because a process
 * you cannot see is quietly claiming every job with the old build. Ten of them
 * had accumulated here before anyone noticed.
 *
 * Each child gets its own process group (`detached`) so the signal reaches the
 * whole tree: `npx next dev` is a shell that spawns the real server, and
 * killing the shell alone leaves the server behind — the same bug one level
 * down.
 */

export interface Child {
  name: string;
  cmd: string;
  args: string[];
}

export function supervise(children: Child[]): void {
  let stopping = false;

  const running: Array<{ name: string; proc: ChildProcess }> = children.map(({ name, cmd, args }) => {
    const proc = spawn(cmd, args, { stdio: 'inherit', env: process.env, detached: true });
    proc.on('exit', (code, signal) => {
      if (stopping) return;
      console.error(`\n[run] ${name} stopped (${signal ?? code}) — shutting the rest down too`);
      stopAll('SIGTERM');
      // A moment for the siblings to go quietly, then leave regardless.
      setTimeout(() => process.exit(code ?? 1), 800).unref();
    });
    return { name, proc };
  });

  function stopAll(signal: NodeJS.Signals): void {
    stopping = true;
    for (const { proc } of running) {
      if (proc.pid === undefined || proc.exitCode !== null) continue;
      try {
        // Negative pid = the whole group, which is what `detached` bought us.
        process.kill(-proc.pid, signal);
      } catch {
        // Already gone, or never had a group. Either way there is nothing left
        // to signal, and throwing here would abort the other kills.
        try { proc.kill(signal); } catch { /* gone */ }
      }
    }
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      stopAll(signal);
      setTimeout(() => process.exit(0), 800).unref();
    });
  }

  // Covers the cases a signal handler does not: an uncaught throw up here, or
  // the terminal closing. Without it the worker outlives its supervisor again.
  process.on('exit', () => stopAll('SIGKILL'));
}
