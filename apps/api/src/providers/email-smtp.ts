import nodemailer from 'nodemailer';
import type { ApiEnv } from '@platform/config';
import type { EmailProvider } from './types.js';

/**
 * SMTP adapter (any SMTP server: Hostinger mail, Gmail app password, Brevo, SES SMTP, Mailgun...).
 * A failed send throws, so the job queue retries it with backoff; it is never reported as sent.
 */
export function createSmtpEmail(env: ApiEnv): EmailProvider {
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST!,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER !== undefined && env.SMTP_PASS !== undefined ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    name: 'smtp',
    async send(message) {
      await transport.sendMail({
        from: env.EMAIL_FROM!,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
    },
  };
}
