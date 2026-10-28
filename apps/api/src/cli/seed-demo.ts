import { bootstrap } from '../bootstrap.js';
import { buildContainer } from '../container.js';
import { hashPassword } from '../modules/auth/auth.service.js';
import { loadEnvOrExit } from './context.js';

/**
 * DEMO seed: sample users and a custom role so a UI developer has something to sign in with.
 * NEVER runs in production. Extended by each module as it is built.
 */
const env = loadEnvOrExit();
if (env.NODE_ENV === 'production') {
  console.error('✖ Refusing to seed demo data in production.');
  process.exit(1);
}
const c = buildContainer({ ...env, JOBS_ENABLED: false });
await bootstrap(c);

const PASSWORD = 'Demo-Password-123!';
const passwordHash = await hashPassword(PASSWORD);
const roles = new Map((await c.db.role.findMany({ where: { key: { not: null } } })).map((r) => [r.key as string, r]));

const inviter = await c.db.role.upsert({
  where: { name: 'Inviter' },
  create: { name: 'Inviter', description: 'Demo custom role: can invite and see only their own invitations' },
  update: {},
});
const inviteScope = await c.db.permission.findUniqueOrThrow({ where: { key: 'users.invite' } });
await c.db.rolePermission.upsert({
  where: { roleId_permissionId: { roleId: inviter.id, permissionId: inviteScope.id } },
  create: { roleId: inviter.id, permissionId: inviteScope.id, scope: 'OWN' },
  update: { scope: 'OWN' },
});

const demo = [
  { email: 'owner@demo.test', name: 'Demo Owner', role: roles.get('super_admin')! },
  { email: 'admin@demo.test', name: 'Demo Admin', role: roles.get('admin')! },
  { email: 'manager@demo.test', name: 'Demo Manager', role: roles.get('manager')! },
  { email: 'inviter@demo.test', name: 'Demo Inviter', role: inviter },
];
for (const u of demo) {
  const user = await c.db.user.upsert({ where: { email: u.email }, create: { email: u.email, name: u.name, passwordHash }, update: {} });
  await c.db.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: u.role.id } }, create: { userId: user.id, roleId: u.role.id }, update: {} });
}
console.log('✔ Demo users ready (password for all: %s)', PASSWORD);
for (const u of demo) console.log(`  ${u.email.padEnd(20)} ${u.role.name}`);
console.log('  Owner and Admin must set up two-factor on first sign-in.');
await c.db.$disconnect();
