import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';
import { resolveDatabaseUrl } from '@platform/config';

// Same resolver the API uses at boot, so migrations always run against the database DB_PROVIDER selects.
// The runtime config is fully validated by @platform/config; this is only for the Prisma CLI.
if (existsSync('.env')) process.loadEnvFile('.env');
const db = resolveDatabaseUrl(process.env);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: 'url' in db ? db.url : 'postgresql://localhost:5432/placeholder' },
});
