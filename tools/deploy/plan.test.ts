import { describe, expect, it } from 'vitest';
import { buildPlan, hostsTouched, parseClientConfig } from './plan.js';

const raw = JSON.stringify({
  name: 'aisha', displayName: 'Aisha', domain: 'aisha.com', apiDomain: 'api.aisha.com', release: 'v0.1.0',
  server: { host: '203.0.113.10', sshUser: 'deploy', path: '/srv/platform', service: 'aisha-api' },
});

describe('deploy plan', () => {
  const cfg = parseClientConfig(raw, 'aisha');
  const steps = buildPlan(cfg, { releaseId: 'v0.1.0-20261026T000000Z', archive: '/tmp/x.tgz' });

  it('only ever targets the one server named in the client config', () => {
    expect(hostsTouched(steps, cfg)).toEqual(['deploy@203.0.113.10']);
    const everything = JSON.stringify(steps);
    const ips = (everything.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) ?? []).filter((ip) => ip !== '127.0.0.1'); // localhost health check is fine
    expect(ips.length).toBeGreaterThan(0);
    expect(ips.every((ip) => ip === '203.0.113.10')).toBe(true);
  });

  it('backs up before migrating, migrates before switching, and can roll back', () => {
    const names = steps.map((s) => s.name);
    const idx = (frag: string) => names.findIndex((n) => n.includes(frag));
    expect(idx('Back up')).toBeLessThan(idx('database migrations'));
    expect(idx('database migrations')).toBeLessThan(idx('Switch'));
    expect(idx('Switch')).toBeLessThan(idx('Restart'));
    expect(steps.find((s) => s.name.includes('Health'))?.remote).toContain('ln -sfn "$(cat previous)" current');
  });

  it('refuses to deploy unless the tree is clean and on the release tag, and never ships secrets', () => {
    expect(steps[0]!.local!.join(' ')).toContain('git describe --tags --exact-match');
    expect(JSON.stringify(steps)).not.toMatch(/\.env\b(?!['"` ]*&&)/); // .env is only ever sourced on the server, never packed
    expect(steps.find((s) => s.name === 'Pack the release')!.local!.join(' ')).not.toMatch(/\.env/);
  });

  it('rejects a config whose name does not match its folder, or has unknown modules', () => {
    expect(() => parseClientConfig(raw, 'someone-else')).toThrow(/must match its folder/);
    expect(() => parseClientConfig(raw.replace('"release"', '"modules":["nope"],"release"'), 'aisha')).toThrow();
  });
});
