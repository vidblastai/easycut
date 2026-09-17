import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

/**
 * The gate.
 *
 * Marketing and the health check stay public; everything that touches a project
 * requires a session. Auth is optional at the deployment level — with no Clerk
 * keys the app runs open, which keeps `git clone && npm run dev` working — but
 * that is a mode you choose, not one you fall into: /api/health reports it, and
 * a deployment without keys is saying "anyone can see anyone's video".
 *
 * `/api/health` is deliberately outside the gate. A load balancer has no
 * session, and a health check that 401s reads as a dead container.
 */
const isPublic = createRouteMatcher([
  '/',
  '/api/health',
  '/sign-in(.*)',
  '/sign-up(.*)',
]);

const authEnabled = Boolean(process.env.CLERK_SECRET_KEY);

export default authEnabled
  ? clerkMiddleware(async (auth, request) => {
      if (!isPublic(request)) await auth.protect();
    })
  : () => NextResponse.next();

export const config = {
  matcher: [
    '/((?!_next|api/projects/[^/]+/upload|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|mp4|webm|wav|mp3)).*)',
    /*
     * Every API route EXCEPT the source upload.
     *
     * Next buffers a request body before handing it to middleware, and caps
     * that buffer at 10 MB. An upload route behind middleware therefore
     * receives a SILENTLY TRUNCATED file — 30 MB in, 10 MB out, HTTP 200 —
     * which on a video app means every real piece of footage arrives broken
     * and the failure surfaces four stages later as "moov atom not found".
     *
     * The route is not unguarded: it calls `guardProject(id)` itself, which is
     * the same check with the same session, done after the body has streamed
     * past rather than before it was allowed to exist.
     */
    '/(api|trpc)((?!/projects/[^/]+/upload).*)',
  ],
};
