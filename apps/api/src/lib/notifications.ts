import type { Container } from '../container.js';
import { emailSendJob } from '../jobs/jobs.js';
import type { EmailMessage } from '../providers/index.js';

/**
 * Sends an email notification through the existing job queue (or inline if jobs not running),
 * but ONLY if email is configured on this installation.
 * dedupeKey ensures each email is queued/sent only once even across retries or repeated triggers.
 */
export async function sendNotificationEmail(
  c: Container,
  message: EmailMessage,
  dedupeKey: string,
): Promise<void> {
  if (!c.providers.email) return;

  try {
    if (c.jobs.enabled && c.jobs.isUp()) {
      await c.jobs.enqueue(emailSendJob, message, { dedupeKey });
      return;
    }
    await c.providers.email.send(message);
  } catch (err) {
    c.logger.error({ err, dedupeKey, to: message.to }, 'failed to send notification email');
  }
}

/**
 * Returns the email address of the active Super Admin, or null if none found.
 */
export async function getSuperAdminEmail(c: Container): Promise<string | null> {
  const superAdmin = await c.db.user.findFirst({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      roles: { some: { role: { isLocked: true } } },
    },
    select: { email: true },
  });
  return superAdmin?.email ?? null;
}
