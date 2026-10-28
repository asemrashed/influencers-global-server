import { pino, type Logger } from 'pino';
import type { ApiEnv } from '@platform/config';

export type { Logger };

/** Structured JSON logs. Secrets and tokens must never be passed in; these paths are redacted as a backstop. */
export function createLogger(env: Pick<ApiEnv, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  return pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
        '*.passwordHash',
        '*.currentPassword',
        '*.newPassword',
      ],
      censor: '[redacted]',
    },
    base: undefined,
  });
}
