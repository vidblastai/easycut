import { PrismaClient } from '@prisma/client';

/**
 * A single Prisma client per process. Next.js hot-reloads modules in
 * development, which would otherwise open a new connection pool on every edit
 * until the database refuses connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;

/* ------------------------------ JSON helpers ------------------------------ */

/**
 * SQLite has no JSON column type, and Postgres's would still need a cast here,
 * so JSON-ish fields are stored as text and go through these two functions.
 * Parsing is total: a corrupt row degrades to the fallback rather than throwing
 * inside a page render.
 */
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}
