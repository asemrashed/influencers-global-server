import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Container } from '../container.js';
import { AppError, errors } from '../lib/errors.js';
import { loadAuth } from '../modules/auth/session.service.js';

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

/** Authenticated API responses must never be stored by shared caches. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

/**
 * Defense in depth next to CSRF tokens: a browser state-changing request must come from an allow-listed origin.
 * Requests without an Origin header (curl, server-to-server, tests) are not browser-driven CSRF and pass here;
 * they still need the CSRF token when they carry a session cookie.
 */
export const originGuard = (c: Container): RequestHandler => {
  const allowed = new Set(c.env.CORS_ORIGINS);
  return (req, _res, next) => {
    const origin = req.get('origin');
    if (!UNSAFE.has(req.method) || !origin) return next();
    const sameOrigin = origin === `${req.protocol}://${req.get('host')}`;
    if (sameOrigin || allowed.has(origin)) return next();
    next(errors.originNotAllowed());
  };
};

/** Loads the session (if the cookie names a valid one) into `req.auth`. Never rejects; route policies decide. */
export const sessionLoader = (c: Container): RequestHandler => async (req, _res, next) => {
  try {
    const token = req.cookies?.[c.env.SESSION_COOKIE_NAME];
    if (typeof token === 'string' && token.length >= 20 && token.length <= 200) {
      const auth = await loadAuth(c, token);
      if (auth) req.auth = auth;
    }
    next();
  } catch (err) {
    next(err);
  }
};

export function createLimiter(c: Container, perMinute: number, name: string): RequestHandler {
  if (!c.env.RATE_LIMIT_ENABLED) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      c.logger.warn({ limiter: name, ip: req.ip, path: req.path }, 'rate limit exceeded');
      res.status(429).json({ code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.', requestId: req.requestId });
    },
  });
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ code: 'NOT_FOUND', message: 'Route not found', requestId: req.requestId });
};

export const errorHandler = (c: Container): ErrorRequestHandler => (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    if (err.headers) for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
    res.status(err.status).json({ code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}), requestId: req.requestId });
    return;
  }
  // body-parser / http-errors
  const e = err as { type?: string; status?: number; statusCode?: number };
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large', requestId: req.requestId });
    return;
  }
  if (e?.type === 'entity.parse.failed' || e?.type === 'encoding.unsupported' || e?.type === 'charset.unsupported') {
    res.status(400).json({ code: 'VALIDATION_FAILED', message: 'Malformed JSON body', requestId: req.requestId });
    return;
  }
  c.logger.error({ err, requestId: req.requestId, path: req.path, method: req.method }, 'unhandled error');
  res.status(500).json({ code: 'INTERNAL', message: 'Something went wrong', requestId: req.requestId });
};
