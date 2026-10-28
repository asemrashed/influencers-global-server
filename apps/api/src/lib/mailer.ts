import type { Container } from '../container.js';
import { emailSendJob } from '../jobs/jobs.js';
import { errors } from './errors.js';
import type { EmailMessage } from '../providers/index.js';
import type { IssuedToken } from '@platform/shared-types';

/**
 * Sends through the job queue when jobs are on (retries, backoff), otherwise inline.
 * With no email provider configured the capability is OFF and this rejects: it never pretends to have sent.
 */
export async function sendEmail(c: Container, message: EmailMessage, dedupeKey?: string): Promise<void> {
  if (!c.providers.email) throw errors.capabilityDisabled('Email');
  if (c.jobs.enabled && c.jobs.isUp()) {
    const id = await c.jobs.enqueue(emailSendJob, message, dedupeKey ? { dedupeKey } : {});
    if (id !== null || dedupeKey) return;
  }
  await c.providers.email.send(message);
}

export const uiLink = (c: Container, path: string, token: string): string =>
  c.env.UI_BASE_URL ? `${c.env.UI_BASE_URL.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}` : `${path}?token=${token}`;

/**
 * Delivers a one-time token. With email on: emailed, the token never appears in the response.
 * With email off: returned ONCE in the response so the operator can pass it on securely.
 */
export async function issueToken(
  c: Container,
  args: { to: string; subject: string; text: (link: string) => string; path: string; token: string; expiresAt: Date },
): Promise<IssuedToken> {
  if (c.providers.email) {
    await sendEmail(c, { to: args.to, subject: args.subject, text: args.text(uiLink(c, args.path, args.token)) });
    return { delivery: 'email', expiresAt: args.expiresAt.toISOString() };
  }
  return { delivery: 'manual', token: args.token, expiresAt: args.expiresAt.toISOString() };
}
