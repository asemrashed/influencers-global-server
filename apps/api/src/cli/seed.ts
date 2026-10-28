import { bootstrap } from '../bootstrap.js';
import { buildContainer } from '../container.js';
import { INVITE_TTL } from '../modules/auth/auth.service.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { uiLink } from '../lib/mailer.js';
import { loadEnvOrExit } from './context.js';

/**
 * REQUIRED seed: runs in every environment, safe to repeat.
 * Creates roles, permissions and module toggles, then an invitation for the first Super Admin.
 */
const env = loadEnvOrExit();
const c = buildContainer({ ...env, JOBS_ENABLED: false });

await bootstrap(c);
console.log('✔ Roles, permissions and module toggles are in place');

const existing = await c.db.user.count({ where: { status: 'ACTIVE', deletedAt: null, roles: { some: { role: { isLocked: true } } } } });
if (existing > 0) {
  console.log(`✔ ${existing} active Super Admin already exists; no invitation created`);
} else if (!env.SUPER_ADMIN_EMAIL) {
  console.error('✖ No Super Admin yet. Set SUPER_ADMIN_EMAIL and run this again.');
  process.exitCode = 1;
} else {
  const role = await c.db.role.findFirstOrThrow({ where: { isLocked: true } });
  const token = randomToken(32);
  await c.db.$transaction([
    c.db.invitation.updateMany({ where: { email: env.SUPER_ADMIN_EMAIL.toLowerCase(), acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } }),
    c.db.invitation.create({
      data: { email: env.SUPER_ADMIN_EMAIL.toLowerCase(), tokenHash: sha256(token), roleIds: [role.id], expiresAt: new Date(Date.now() + INVITE_TTL) },
    }),
  ]);
  console.log(`✔ Super Admin invitation created for ${env.SUPER_ADMIN_EMAIL} (valid 7 days, single use)`);
  console.log('  Open this link (shown once) or POST the token to /api/v1/auth/invitations/accept:');
  console.log(`  ${uiLink(c, '/accept-invite', token)}`);
}
await c.db.$disconnect();
