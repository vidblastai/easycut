import { execSync } from 'node:child_process';

/**
 * Bring the database up to the schema before the server accepts traffic.
 *
 * Railway gives you a fresh, empty Postgres. Without this the first request
 * fails on a missing table and the container looks broken for reasons that have
 * nothing to do with the code. `db push` is idempotent, so it costs a second on
 * every subsequent boot and saves a confusing first deploy.
 */
if (!process.env.DATABASE_URL) {
  console.log('[prestart] no DATABASE_URL — skipping schema sync');
  process.exit(0);
}

try {
  console.log('[prestart] syncing database schema…');
  execSync('npx prisma db push --skip-generate --accept-data-loss=false', { stdio: 'inherit' });
} catch {
  // Not fatal: a concurrent deploy may already be doing this, and the health
  // check will catch a database that is genuinely unreachable.
  console.warn('[prestart] schema sync failed — continuing, /api/health will report it');
}
