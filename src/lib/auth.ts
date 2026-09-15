import { NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { db } from '@/lib/db';

/**
 * Who is asking.
 *
 * Auth is optional at the config level so a clone still runs with no Clerk keys
 * — but that has to be an explicit, visible mode rather than an accident. When
 * `CLERK_SECRET_KEY` is unset the app runs open and says so on /api/health;
 * when it is set, every project is owned and the ownership check is real.
 *
 * The important half is `requireOwner`. A logged-in user asking for someone
 * else's project is not an authentication failure, it is an authorisation one,
 * and the two want different answers: 401 tells the client to log in, 404 tells
 * a stranger nothing at all. Returning 403 here would confirm the project
 * exists, which is exactly what someone enumerating ids wants to know.
 */

export function isAuthEnabled(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY);
}

/** The Clerk user id for this request, or null when signed out or auth is off. */
export async function currentUserId(): Promise<string | null> {
  if (!isAuthEnabled()) return null;
  const { userId } = await auth();
  return userId;
}

/**
 * The local User row for the signed-in Clerk user, created on first sight.
 *
 * Clerk owns identity; we keep a row so projects have something to hang off and
 * so a future quota or billing column has a home. Upsert rather than a webhook:
 * a webhook that has not fired yet would mean a signed-in user whose first
 * upload fails, and this costs one indexed query.
 */
export async function ensureUser(): Promise<string | null> {
  const clerkId = await currentUserId();
  if (!clerkId) return null;

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? `${clerkId}@clerk.local`;

  const row = await db.user.upsert({
    where: { id: clerkId },
    update: {},
    create: {
      id: clerkId,
      email,
      name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || null,
    },
  });
  return row.id;
}

/**
 * The one-liner every project route starts with.
 *
 * Returns a response to send when the caller may not have this project, or null
 * when they may. A guard that returns a value the caller must check beats one
 * that throws, because a forgotten try/catch fails open and a forgotten `if`
 * fails to compile the moment the route returns the wrong type.
 */
export async function guardProject(projectId: string): Promise<NextResponse | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, userId: true },
  });

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (!isAuthEnabled()) return null;

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Sign in to continue' }, { status: 401 });

  // Someone else's project, or an ownerless row from before auth was switched
  // on, is indistinguishable from one that does not exist. 403 would confirm
  // the id is real, which is exactly what an enumerator wants to learn.
  if (project.userId !== userId) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  return null;
}

/** Same rule, for a server component that renders a page rather than JSON. */
export async function canAccessProject(projectId: string): Promise<boolean> {
  return (await guardProject(projectId)) === null;
}
