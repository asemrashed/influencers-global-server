import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildPlan, parseClientConfig, type Step } from './plan.js';

/**
 * Usage: npm run deploy -- clients/<name>/client.config.json [--apply]
 * Without --apply it only prints the plan. With --apply it runs it, stopping at the first failing step.
 */
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Usage: npm run deploy -- clients/<name>/client.config.json [--apply]');
  process.exit(2);
}

const folder = path.basename(path.dirname(path.resolve(file)));
const config = parseClientConfig(readFileSync(file, 'utf8'), folder);
const releaseId = `${config.release}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;
const steps = buildPlan(config, { releaseId, archive: `/tmp/${releaseId}.tgz` });

console.log(`Client: ${config.displayName} (${config.name})  Release: ${config.release}  Server: ${config.server.sshUser}@${config.server.host}`);
console.log(apply ? 'Mode: APPLY\n' : 'Mode: dry run (add --apply to execute)\n');

function run(step: Step): number {
  const [cmd, cmdArgs] = step.local
    ? [step.local[0]!, step.local.slice(1)]
    : ['ssh', ['-o', 'BatchMode=yes', `${config.server.sshUser}@${config.server.host}`, 'bash -lc ' + JSON.stringify(step.remote!)]];
  return spawnSync(cmd, cmdArgs, { stdio: 'inherit' }).status ?? 1;
}

for (const [i, step] of steps.entries()) {
  console.log(`${i + 1}. ${step.name}${step.remote ? '  [remote]' : ''}`);
  if (!apply) continue;
  if (run(step) !== 0) {
    console.error(`\n✖ Step ${i + 1} failed: ${step.name}. Nothing after it ran.`);
    process.exit(1);
  }
}
console.log(apply ? '\n✔ Deployed' : '\nDry run only. Nothing was executed.');
