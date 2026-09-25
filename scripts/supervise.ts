import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

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
 * ── Two operating systems, two ways to kill a tree ───────────────────────
 *
 * The job is always the same: signal the child AND everything it started,
 * because `npm run start` is a shell that spawns the real server and killing
 * the shell alone leaves the server behind.
 *
 * On Unix that is a process group: `detached` puts each child in its own, and
 * `kill(-pid)` signals the lot.
 *
 * Windows has neither. It has no process groups in that sense, `kill(-pid)`
 * is a POSIX-ism that simply throws there, and `detached` means something
 * different again — a new console window per child rather than a new group.
 * The equivalent is `taskkill /T`, which walks the child tree itself.
 *
 * Getting this wrong on Windows is not a crash, which is why it is worth the
 * comment: the throw is caught, the fallback kills the direct child only, and
 * the orphaned worker lives on — exactly the bug this file exists to prevent,
 * silently reintroduced on one platform.
 */

const WINDOWS = process.platform === 'win32';

export interface Child {
  name: string;
  cmd: string;
  args: string[];
}

export function supervise(children: Child[]): void {
  let stopping = false;

  const running: Array<{ name: string; proc: ChildProcess }> = children.map(({ name, cmd, args }) => {
    const proc = spawn(cmd, args, {
      stdio: 'inherit',
      env: process.env,
      /*
       * `shell` on Windows, and it is not optional.
       *
       * `npm` there is `npm.cmd`, and since Node 18.20 `spawn` refuses to run
       * a `.cmd` or `.bat` without a shell — it fails with EINVAL rather than
       * running it. So every caller of this file, `npm run dev` included, dies
       * on the first line on Windows without it.
       *
       * Safe here because every cmd and arg in this file is a literal written
       * above: nothing from a user, a file or the network reaches this call.
       */
      shell: WINDOWS,
      // A process group to signal later. Unix only — on Windows this opens a
      // separate console window per child instead, which is not what we want.
      detached: !WINDOWS,
      windowsHide: true,
    });
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

      if (WINDOWS) {
        // `/T` is the whole point: it takes the child's own children with it.
        // Failure is fine and expected once a process has already gone.
        spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
        continue;
      }

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
