import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/p6_test';

/**
 * Builds the test database from the REAL migration files, so the tests also prove the migrations apply cleanly.
 * Runs once per `vitest run`.
 */
export default async function setup(): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DB_URL });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.query('DROP SCHEMA IF EXISTS pgboss_test CASCADE;');
  const dir = path.join(here, '../prisma/migrations');
  for (const name of readdirSync(dir).filter((n) => /^\d/.test(n)).sort()) {
    await client.query(readFileSync(path.join(dir, name, 'migration.sql'), 'utf8'));
  }
  await client.end();
}
