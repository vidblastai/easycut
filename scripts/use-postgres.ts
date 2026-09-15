import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Flip the Prisma datasource to Postgres.
 *
 *   npm run db:postgres
 *
 * Prisma resolves `provider` at generate time from the schema file and will not
 * read it from an environment variable, so a deployment that wants Postgres has
 * to rewrite the line. Doing it in a script rather than by hand means the
 * Dockerfile and the deploy guide can both call it, and nobody ships a
 * container whose database lives on a filesystem that is wiped on restart.
 */
const PATH = 'prisma/schema.prisma';
const schema = readFileSync(PATH, 'utf8');

if (schema.includes('provider = "postgresql"')) {
  console.log('Already on Postgres.');
  process.exit(0);
}

const next = schema.replace('provider = "sqlite"', 'provider = "postgresql"');
if (next === schema) {
  console.error('Could not find the sqlite provider line — has the schema changed?');
  process.exit(1);
}

writeFileSync(PATH, next);
console.log('prisma/schema.prisma now targets Postgres.');
console.log('Next: DATABASE_URL=postgres://... npx prisma db push');
