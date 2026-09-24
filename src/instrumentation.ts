import type { Instrumentation } from 'next';

/**
 * Next.js's hook for "something threw on the server".
 *
 * ── Why this and not a try/catch in every route ──────────────────────────
 *
 * There are thirteen route handlers, and the errors worth hearing about are
 * exactly the ones nobody predicted — a Zod parse that throws on a body shape
 * we did not consider, a database that went away mid-request, a null deref in
 * a server component. A `try/catch` per route only catches the failures
 * somebody already thought of, and adds a wrapper to every file for the
 * privilege.
 *
 * `onRequestError` fires for every uncaught server-side error in the app:
 * route handlers, server components, server actions, middleware. One file,
 * complete coverage, and nothing to remember when the fourteenth route is
 * written.
 *
 * ── Why the import is dynamic ────────────────────────────────────────────
 *
 * This module is loaded in every server runtime Next.js has, including the
 * Edge one. Importing the reporter at the top level would drag `env`, and
 * through it Node's `os` module, into a bundle that has no Node. Importing it
 * inside the handler means the cost is paid only when something has already
 * gone wrong, where a few milliseconds do not matter.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  const { reportError } = await import('@/lib/errors/report');

  await reportError(error, {
    where: `web.${context.routerKind === 'App Router' ? 'app' : 'pages'}`,
    // The path, never the query string: `?token=…` on a failing download is
    // exactly the kind of thing that must not be posted to a chat channel.
    // (`redact` would catch it too — this is the belt to that's braces.)
    path: typeof request.path === 'string' ? request.path.split('?')[0] : undefined,
    method: request.method,
    route: context.routePath,
    // 'render' vs 'action': a server action failing is a user who clicked
    // something, a render failing is a page that is down for everybody.
    phase: context.renderSource ?? context.routeType,
  });
};

/**
 * Runs once when a server process starts.
 *
 * Empty of side effects on purpose — the in-process worker is started by
 * `npm run start:all`, not from here, because a Next.js dev server reloads
 * this file and two copies of the worker loop would reserve each other's jobs.
 */
export async function register(): Promise<void> {
  // Nothing yet. Present so `onRequestError` is picked up: Next.js only treats
  // a file as instrumentation when it exports `register`.
}
