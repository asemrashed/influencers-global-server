import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp, signInWithTwoFactor, type TestApp } from './helpers.js';

let t: TestApp;
let admin: Client;

beforeAll(async () => {
  t = await createTestApp({
    STORAGE_PROVIDER: 'local',
    STORAGE_LOCAL_DIR: './storage_test',
  });
  admin = (await signInWithTwoFactor(t, 'admin_storage@example.test', 'admin')).client;
}, 60_000);

afterAll(async () => {
  if (t) await t.close();
});

describe('Storage & File Upload Endpoints', () => {
  it('allows authenticated user to upload a file and retrieve its URL', async () => {
    const fileContent = 'Hello World from Influencer Platform!';
    const base64Data = Buffer.from(fileContent).toString('base64');

    const uploadRes = await admin.post('/api/v1/storage/upload', {
      filename: 'sample-doc.txt',
      mimeType: 'text/plain',
      base64Data,
      folder: 'portfolio',
    });

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.key).toMatch(/^portfolio\/[0-9]+-[a-f0-9]+\.txt$/);
    expect(uploadRes.body.size).toBe(Buffer.from(fileContent).length);
    expect(uploadRes.body.mimeType).toBe('text/plain');

    const key = uploadRes.body.key;

    // Guest cannot get URL
    const guest = new Client(t.app);
    const guestUrlRes = await guest.get(`/api/v1/storage/url/${encodeURIComponent(key)}`);
    expect(guestUrlRes.status).toBe(401);

    // Signed-in user can get URL
    const urlRes = await admin.get(`/api/v1/storage/url/${encodeURIComponent(key)}`);
    expect(urlRes.status).toBe(200);
    expect(urlRes.body.key).toBe(key);
    expect(urlRes.body.url).toBeTruthy();
  });

  it('validates file content and does not trust client MIME type', async () => {
    // Client sends mimeType: image/png but sends plain text data
    const fileContent = 'plain text claiming to be PNG';
    const base64Data = Buffer.from(fileContent).toString('base64');

    const uploadRes = await admin.post('/api/v1/storage/upload', {
      filename: 'malicious.png',
      mimeType: 'image/png',
      base64Data,
      folder: 'products',
    });

    expect(uploadRes.status).toBe(201);
    // Detected MIME must be text/plain, extension .txt, NOT image/png
    expect(uploadRes.body.mimeType).toBe('text/plain');
    expect(uploadRes.body.key.endsWith('.txt')).toBe(true);
  });

  it('rejects uploads that exceed the 10MB limit', async () => {
    // 11MB payload
    const bigBuf = Buffer.alloc(11 * 1024 * 1024, 'a');
    const base64Data = bigBuf.toString('base64');

    const uploadRes = await admin.post('/api/v1/storage/upload', {
      filename: 'huge.txt',
      mimeType: 'text/plain',
      base64Data,
      folder: 'products',
    });

    expect(uploadRes.status === 400 || uploadRes.status === 413).toBe(true);
  });

  it('returns 503 when storage capability is disabled', async () => {
    const disabledApp = await createTestApp({ STORAGE_PROVIDER: '' });
    try {
      const { client: authClient } = await signInWithTwoFactor(disabledApp, 'test_disabled@example.test', 'admin');
      const res = await authClient.post('/api/v1/storage/upload', {
        filename: 'test.jpg',
        mimeType: 'image/jpeg',
        base64Data: Buffer.from('abc').toString('base64'),
        folder: 'products',
      });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('CAPABILITY_DISABLED');
    } finally {
      await disabledApp.close();
    }
  }, 60_000);
});
