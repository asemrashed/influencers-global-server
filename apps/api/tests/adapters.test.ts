import { describe, expect, it, vi } from 'vitest';
import { Writable } from 'node:stream';
import nodemailer from 'nodemailer';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { v2 as cloudinary } from 'cloudinary';
import { createSmtpEmail } from '../src/providers/email-smtp.js';
import { createS3Storage } from '../src/providers/storage-s3.js';
import { createCloudinaryStorage } from '../src/providers/storage-cloudinary.js';
import type { ApiEnv } from '@platform/config';

// Mock helper base env
const baseEnv: Partial<ApiEnv> = {
  NODE_ENV: 'test',
  EMAIL_FROM: 'noreply@example.test',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMTP_USER: 'smtp_user',
  SMTP_PASS: 'smtp_pass',

  S3_BUCKET: 'test-bucket',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'test_access_key',
  S3_SECRET_ACCESS_KEY: 'test_secret_key',
  S3_FORCE_PATH_STYLE: false,

  CLOUDINARY_CLOUD_NAME: 'test_cloud',
  CLOUDINARY_API_KEY: 'test_api_key',
  CLOUDINARY_API_SECRET: 'test_api_secret',
  CLOUDINARY_FOLDER: 'influencer_uploads',
};

describe('SMTP Email Adapter', () => {
  it('sends email successfully when nodemailer succeeds', async () => {
    const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'msg-123' });
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail: sendMailMock,
    } as any);

    const adapter = createSmtpEmail(baseEnv as ApiEnv);
    expect(adapter.name).toBe('smtp');

    await adapter.send({
      to: 'recipient@example.test',
      subject: 'Test Subject',
      text: 'Test Body',
      html: '<p>Test Body</p>',
    });

    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'noreply@example.test',
      to: 'recipient@example.test',
      subject: 'Test Subject',
      text: 'Test Body',
      html: '<p>Test Body</p>',
    });
  });

  it('throws when nodemailer transport throws an error', async () => {
    const sendMailMock = vi.fn().mockRejectedValue(new Error('SMTP Connection refused'));
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail: sendMailMock,
    } as any);

    const adapter = createSmtpEmail(baseEnv as ApiEnv);
    await expect(
      adapter.send({
        to: 'fail@example.test',
        subject: 'Fail',
        text: 'Fail',
      }),
    ).rejects.toThrow('SMTP Connection refused');
  });
});

describe('S3 Storage Adapter', () => {
  it('handles put, get, delete, exists, getUrl on success', async () => {
    const fileBytes = Buffer.from('s3 file content');
    const sendMock = vi.fn().mockImplementation(async (command) => {
      if (command instanceof PutObjectCommand) {
        return {};
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: {
            transformToByteArray: async () => fileBytes,
          },
        };
      }
      if (command instanceof HeadObjectCommand) {
        return {};
      }
      if (command instanceof DeleteObjectCommand) {
        return {};
      }
      return {};
    });

    vi.spyOn(S3Client.prototype, 'send').mockImplementation(sendMock);

    const adapter = createS3Storage(baseEnv as ApiEnv);
    expect(adapter.name).toBe('s3');

    // put
    await expect(adapter.put('portfolio/image.png', fileBytes)).resolves.toBeUndefined();

    // get
    const fetched = await adapter.get('portfolio/image.png');
    expect(fetched.toString('utf8')).toBe('s3 file content');

    // exists
    const exists = await adapter.exists('portfolio/image.png');
    expect(exists).toBe(true);

    // delete
    await expect(adapter.delete('portfolio/image.png')).resolves.toBeUndefined();

    // getUrl returns string
    const url = await adapter.getUrl('portfolio/image.png', 3600);
    expect(typeof url).toBe('string');
  });

  it('handles not found and errors on get and exists', async () => {
    const notFoundError = new Error('NoSuchKey');
    (notFoundError as any).name = 'NoSuchKey';
    (notFoundError as any).$metadata = { httpStatusCode: 404 };

    vi.spyOn(S3Client.prototype, 'send').mockRejectedValue(notFoundError);

    const adapter = createS3Storage(baseEnv as ApiEnv);

    // get throws 404 AppError
    await expect(adapter.get('products/missing.jpg')).rejects.toThrow();

    // exists returns false on 404
    const exists = await adapter.exists('products/missing.jpg');
    expect(exists).toBe(false);

    // rejects unsafe keys
    await expect(adapter.put('../etc/passwd', Buffer.from('bad'))).rejects.toThrow();
  });
});

describe('Cloudinary Storage Adapter', () => {
  it('handles put, get, delete, exists, getUrl on success', async () => {
    const fileBytes = Buffer.from('cloudinary file content');

    // Mock upload_stream
    vi.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation(((options: any, callback: any) => {
      const ws = new Writable({
        write(_chunk: any, _encoding: any, cb: () => void) {
          cb();
        },
      });
      ws.on('finish', () => {
        callback(null, { public_id: options.public_id, secure_url: 'https://cloudinary.test/file' });
      });
      return ws;
    }) as any);

    // Mock cloudinary private_download_url
    vi.spyOn(cloudinary.utils, 'private_download_url').mockReturnValue('https://cloudinary.test/signed/file');

    // Mock fetch for get
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      arrayBuffer: async () => fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength),
    });
    vi.stubGlobal('fetch', fetchMock);

    // Mock api.resource
    vi.spyOn(cloudinary.api, 'resource').mockResolvedValue({} as any);

    // Mock uploader.destroy
    vi.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' } as any);

    const adapter = createCloudinaryStorage(baseEnv as ApiEnv);
    expect(adapter.name).toBe('cloudinary');

    // put
    await expect(adapter.put('portfolio/pic.jpg', fileBytes)).resolves.toBeUndefined();

    // get
    const data = await adapter.get('portfolio/pic.jpg');
    expect(data.toString('utf8')).toBe('cloudinary file content');

    // exists
    expect(await adapter.exists('portfolio/pic.jpg')).toBe(true);

    // delete
    await expect(adapter.delete('portfolio/pic.jpg')).resolves.toBeUndefined();

    // getUrl
    const url = await adapter.getUrl('portfolio/pic.jpg');
    expect(url).toBe('https://cloudinary.test/signed/file');

    vi.unstubAllGlobals();
  });

  it('handles failures on put, get, and exists', async () => {
    // upload_stream failure
    vi.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation(((_options: any, callback: any) => {
      const ws = new Writable({
        write(_chunk: any, _encoding: any, cb: () => void) {
          cb();
        },
      });
      ws.on('finish', () => {
        callback(new Error('Cloudinary quota exceeded'), null);
      });
      return ws;
    }) as any);

    const adapter = createCloudinaryStorage(baseEnv as ApiEnv);
    await expect(adapter.put('products/item.png', Buffer.from('abc'))).rejects.toThrow('Cloudinary quota exceeded');

    // fetch 404 on get
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 404,
        ok: false,
      }),
    );
    await expect(adapter.get('products/missing.png')).rejects.toThrow();

    // resource 404 on exists
    vi.spyOn(cloudinary.api, 'resource').mockRejectedValue({ error: { http_code: 404 } });
    expect(await adapter.exists('products/missing.png')).toBe(false);

    vi.unstubAllGlobals();
  });
});
