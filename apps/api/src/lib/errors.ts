import type { ErrorCode } from '@platform/shared-types';

/** Expected, client-facing failure. Anything else that is thrown becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: { path: string; message: string }[],
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  validation: (details: { path: string; message: string }[], message = 'Request validation failed') =>
    new AppError(400, 'VALIDATION_FAILED', message, details),
  unauthenticated: (message = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', message),
  invalidCredentials: () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password'),
  forbidden: (message = 'You do not have permission to do this') => new AppError(403, 'FORBIDDEN', message),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`),
  conflict: (message: string) => new AppError(409, 'CONFLICT', message),
  invalidToken: () => new AppError(400, 'INVALID_TOKEN', 'This link is invalid or has expired'),
  invalidTwoFactor: () => new AppError(401, 'INVALID_TWO_FACTOR_CODE', 'Invalid verification code'),
  twoFactorRequired: () => new AppError(403, 'TWO_FACTOR_REQUIRED', 'Two-factor verification required'),
  twoFactorSetupRequired: () => new AppError(403, 'TWO_FACTOR_SETUP_REQUIRED', 'Two-factor setup required'),
  capabilityDisabled: (name: string) =>
    new AppError(503, 'CAPABILITY_DISABLED', `${name} is not enabled on this installation`),
  moduleDisabled: (key: string) => new AppError(403, 'MODULE_DISABLED', `The "${key}" module is disabled`),
  lastSuperAdmin: () =>
    new AppError(409, 'LAST_SUPER_ADMIN', 'The last active Super Admin cannot be removed, demoted or disabled'),
  csrf: () => new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token'),
  originNotAllowed: () => new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed'),
  lockedRole: () => new AppError(409, 'LOCKED_ROLE', 'This role is locked and cannot be changed'),
  escalation: (message = 'You cannot grant permissions you do not hold') =>
    new AppError(403, 'PERMISSION_ESCALATION', message),
};
