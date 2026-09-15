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
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|mp4|webm|wav|mp3)).*)',
    '/(api|trpc)(.*)',
  ],
};
