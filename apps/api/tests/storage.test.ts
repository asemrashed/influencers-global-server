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
  it('allows authenticated user to upload a base64-encoded file and retrieve it', async () => {
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

    // Get URL
    const urlRes = await admin.get(`/api/v1/storage/url/${encodeURIComponent(key)}`);
    expect(urlRes.status).toBe(200);
    expect(urlRes.body.url).toBeTruthy();

    // Anonymous can download public asset route
    const guest = new Client(t.app);
    const downloadRes = await guest.get(`/api/v1/storage/file/${encodeURIComponent(key)}`);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.body.toString('utf8')).toBe(fileContent);
  });

  it('rejects uploads that exceed the 10MB limit', async () => {
    // 11MB payload
    const bigBuf = Buffer.alloc(11 * 1024 * 1024, 'a');
    const base64Data = bigBuf.toString('base64');

    const uploadRes = await admin.post('/api/v1/storage/upload', {
      filename: 'huge.bin',
      mimeType: 'application/octet-stream',
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

