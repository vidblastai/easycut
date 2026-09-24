/**
 * The `at …` lines of a stack, and nothing else.
 *
 * `error.stack` in V8 is the message followed by the frames, so the usual
 * `stack.split('\n').slice(1)` assumes the message is exactly one line. Zod
 * breaks that assumption immediately — its message is a pretty-printed JSON
 * document, so the first several "frames" are `{`, `"received": "8k",` and so
 * on, and an alert's code block ends up quoting the message back instead of
 * saying where it happened.
 *
 * Matching the frames rather than counting past the message is the fix, and it
 * is right for every error rather than for the ones whose message is short.
 *
 * A leaf module on purpose: both `report.ts` and `webhook.ts` need it, and
 * `webhook.ts` importing a value from `report.ts` would close an import cycle.
 */
export function stackFrames(stack: string | undefined, limit: number): string[] {
  if (!stack) return [];
  return stack
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .slice(0, limit);
}
