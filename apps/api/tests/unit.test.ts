import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, generateRecoveryCode, randomToken, safeEqual, sha256 } from '../src/lib/crypto.js';
import { sanitizeRichText } from '../src/lib/sanitize.js';
import { scopeCovers, scopeWhere, widest } from '../src/lib/scope.js';
import { toPage } from '../src/lib/pagination.js';

describe('scope', () => {
  it('widest scope wins', () => {
    expect(widest('own', 'all')).toBe('all');
    expect(widest('assigned', 'own')).toBe('assigned');
  });
  it('only "all" covers other scopes; narrow scopes cover only themselves', () => {
    expect(scopeCovers('all', 'own')).toBe(true);
    expect(scopeCovers('own', 'all')).toBe(false);
    expect(scopeCovers('own', 'assigned')).toBe(false);
    expect(scopeCovers('assigned', 'assigned')).toBe(true);
  });
  it('builds where fragments and fails closed for unsupported "assigned"', () => {
    expect(scopeWhere('all', { userId: 'u1', ownField: 'createdById' })).toEqual({});
    expect(scopeWhere('own', { userId: 'u1', ownField: 'createdById' })).toEqual({ createdById: 'u1' });
    expect(scopeWhere('assigned', { userId: 'u1', ownField: 'x' })).toEqual({ id: { in: [] } });
    expect(scopeWhere('assigned', { userId: 'u1', ownField: 'x', assigned: (id) => ({ brand: { managers: { some: { id } } } }) })).toEqual({ brand: { managers: { some: { id: 'u1' } } } });
  });
});

describe('crypto', () => {
  const key = Buffer.alloc(32, 3).toString('base64');
  it('round-trips AES-256-GCM and rejects tampering and wrong keys', () => {
    const sealed = encrypt('totp-secret', key);
    expect(sealed).not.toContain('totp-secret');
    expect(decrypt(sealed, key)).toBe('totp-secret');
    expect(() => decrypt(sealed.slice(0, -2) + 'AA', key)).toThrow();
    expect(() => decrypt(sealed, Buffer.alloc(32, 4).toString('base64'))).toThrow();
  });
  it('produces unique tokens, stable hashes and constant-time compare', () => {
    expect(randomToken()).not.toBe(randomToken());
    expect(sha256('a')).toBe(sha256('a'));
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(generateRecoveryCode()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });
});

describe('sanitizeRichText', () => {
  it('removes scripts, event handlers and javascript: links but keeps basic formatting', () => {
    const out = sanitizeRichText('<p onclick="x()">Hi <strong>there</strong></p><script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="https://ok.test">ok</a><img src=x onerror=alert(1)>');
    expect(out).toContain('<strong>there</strong>');
    expect(out).toContain('href="https://ok.test"');
    expect(out).not.toMatch(/script|onclick|onerror|javascript:|<img/i);
  });
});

describe('toPage', () => {
  it('returns nextCursor only when there is another page', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(toPage(rows, 2, (r) => r.id)).toEqual({ items: ['a', 'b'], nextCursor: 'c' });
    expect(toPage(rows.slice(0, 2), 2, (r) => r.id)).toEqual({ items: ['a', 'b'] });
  });
});
