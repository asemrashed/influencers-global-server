import { clientConfigSchema, type ClientConfig } from '@platform/config';

/** Same rule as resolveDatabaseUrl in @platform/config: DB_PROVIDER picks the URL variable, blank falls back to DATABASE_URL. */
const DB_URL_FROM_ENV =
  'case "${DB_PROVIDER:-}" in neon) DB_URL="$NEON_DATABASE_URL";; mydb) DB_URL="$MYDB_DATABASE_URL";; local) DB_URL="$LOCAL_DATABASE_URL";; "") DB_URL="${DATABASE_URL:-}";; *) echo "unknown DB_PROVIDER" >&2; exit 1;; esac && test -n "$DB_URL"';

export interface Step {
  name: string;
  /** Runs on the machine invoking the deploy script. */
  local?: string[];
  /** Runs over SSH on the client's server (and only that server). */
  remote?: string;
}

export interface PlanOptions {
  releaseId: string; // e.g. v0.1.0-20261026T101500Z
  archive: string; // local path of the packed release
}

/** Shell-quote a value for use inside a remote command. */
const q = (v: string): string => `'${v.replace(/'/g, `'\\''`)}'`;

export function parseClientConfig(raw: string, folderName: string): ClientConfig {
  const cfg = clientConfigSchema.parse(JSON.parse(raw));
  if (cfg.name !== folderName) throw new Error(`Config name "${cfg.name}" must match its folder "clients/${folderName}"`);
  return cfg;
}

/**
 * The full deployment for ONE client. Every remote step targets `config.server.host` and nothing else, so a mistake
 * in one client's config can never reach another client's server. Rollback is automatic if the health check fails.
 */
export function buildPlan(config: ClientConfig, opts: PlanOptions): Step[] {
  const { sshUser, host, path: root, service } = config.server;
  const target = `${sshUser}@${host}`;
  const rel = `${root}/releases/${opts.releaseId}`;
  const health = `curl -fsS --max-time 10 http://127.0.0.1:\${PORT:-4000}/ready | grep -q '"status":"ready"'`;

  return [
    { name: 'Check the working tree is clean and HEAD is the release tag', local: ['bash', '-c', `test -z "$(git status --porcelain)" && test "$(git describe --tags --exact-match)" = ${q(config.release)}`] },
    { name: 'Install and build', local: ['bash', '-c', 'npm ci && npm run build && npm test'] },
    {
      name: 'Pack the release',
      local: ['tar', '-czf', opts.archive, 'package.json', 'package-lock.json', 'apps/api/package.json', 'apps/api/dist', 'apps/api/prisma', 'apps/api/prisma.config.ts', 'packages/shared-types/package.json', 'packages/shared-types/dist', 'packages/config/package.json', 'packages/config/dist'],
    },
    { name: 'Upload', local: ['scp', '-o', 'BatchMode=yes', opts.archive, `${target}:/tmp/${opts.releaseId}.tgz`] },
    { name: 'Unpack and install production dependencies', remote: `mkdir -p ${q(rel)} && tar -xzf /tmp/${q(opts.releaseId)}.tgz -C ${q(rel)} && rm /tmp/${q(opts.releaseId)}.tgz && cd ${q(rel)} && npm ci --omit=dev --workspace @platform/api --include-workspace-root` },
    { name: 'Back up the database before touching it', remote: `set -a && . ${q(root + '/.env')} && set +a && mkdir -p ${q(root + '/backups')} && ${DB_URL_FROM_ENV} && pg_dump --format=custom --file=${q(`${root}/backups/pre-${opts.releaseId}.dump`)} "$DB_URL"` },
    { name: 'Apply database migrations (expand-only; see deployment skill)', remote: `set -a && . ${q(root + '/.env')} && set +a && cd ${q(rel + '/apps/api')} && npx prisma migrate deploy` },
    { name: 'Switch to the new release', remote: `cd ${q(root)} && (readlink current > previous 2>/dev/null || true) && ln -sfn ${q(rel)} current && echo ${q(config.release)} > RELEASE` },
    { name: 'Restart the service', remote: `sudo systemctl restart ${q(service)}` },
    {
      name: 'Health check; roll back this client on failure',
      remote: `set -a && . ${q(root + '/.env')} && set +a && sleep 4 && (${health} || { echo "health check failed: rolling back"; cd ${q(root)} && test -s previous && ln -sfn "$(cat previous)" current && sudo systemctl restart ${q(service)}; exit 1; })`,
    },
    { name: 'Keep the 5 newest releases', remote: `cd ${q(root + '/releases')} && ls -1t | tail -n +6 | xargs -r rm -rf` },
  ];
}

export const hostsTouched = (steps: Step[], config: ClientConfig): string[] =>
  steps.some((s) => s.remote) ? [`${config.server.sshUser}@${config.server.host}`] : [];
