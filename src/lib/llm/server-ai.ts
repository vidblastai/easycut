/**
 * Whether EasyCut's own paid AI may run for the work in hand.
 *
 * A project made through the MCP server is edited by the person's own Claude:
 * it writes the scenes, reads the transcript, makes the creative calls. The
 * pipeline still does everything mechanical — transcription, silence and
 * filler cuts, captions, reframing, rendering — but none of the passes that
 * call a model on EasyCut's account. That is the whole point of the mode: the
 * expensive half of a video is paid for by a subscription the person already
 * has.
 *
 * Scoped with AsyncLocalStorage rather than threaded through as a parameter
 * because the gate has to hold in thirty places that each ask "is a model
 * configured?" — every one of them already falls back to a rule-based answer
 * when the answer is no, so making the answer no for one job is the entire
 * change, and a pass added next month inherits it without anyone remembering.
 */

interface Scope {
  run<T>(store: { serverAi: boolean }, work: () => T): T;
  getStore(): { serverAi: boolean } | undefined;
}

/*
 * Loaded through `process.getBuiltinModule` rather than imported, because the
 * upload page — a browser component — imports the B-roll modules that read
 * this switch, and a static `node:async_hooks` import breaks that bundle. In
 * a browser there is no job to scope, so the switch simply reads "on".
 */
const scope: Scope | null = (() => {
  const load = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule;
  const hooks = load?.('node:async_hooks') as { AsyncLocalStorage: new () => Scope } | undefined;
  return hooks ? new hooks.AsyncLocalStorage() : null;
})();

/** Runs `work` with EasyCut's paid model calls switched off (or on). */
export function withServerAi<T>(enabled: boolean, work: () => T): T {
  if (!scope) throw new Error('withServerAi needs Node.js 22.3 or later');
  return scope.run({ serverAi: enabled }, work);
}

/** False inside a client-AI job; true everywhere else. */
export function serverAiAllowed(): boolean {
  return scope?.getStore()?.serverAi ?? true;
}

/** Who does the creative AI work on a project. */
export type AiMode = 'server' | 'client';

export function isClientAi(mode: string | null | undefined): boolean {
  return mode === 'client';
}
