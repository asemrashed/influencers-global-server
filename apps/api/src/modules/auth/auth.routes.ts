import { Router } from 'express';
import {
  acceptInvitationBodySchema, changePasswordBodySchema, forgotPasswordBodySchema, loginBodySchema, okSchema,
  resetPasswordBodySchema, sessionStateSchema, twoFactorCodeBodySchema, twoFactorEnableBodySchema, twoFactorEnabledSchema, twoFactorSetupSchema,
} from '@platform/shared-types';
import type { Container } from '../../container.js';
import { routeFactory, type RouteKit } from '../../lib/route.js';
import * as auth from './auth.service.js';

const tags = ['Auth'];

export function authRoutes(kit: RouteKit): Router {
  const c: Container = kit.c;
  const router = Router();
  const route = routeFactory(kit, router);

  route(
    {
      method: 'post', path: '/api/v1/auth/login', operationId: 'login', tags, summary: 'Sign in with email and password',
      description: 'Sets an httpOnly session cookie. If two-factor is required the session is "pending" until `/auth/2fa/verify` (or setup) succeeds. Failures always return INVALID_CREDENTIALS.',
      access: { type: 'public', reason: 'entry point; protected by rate limit, lockout and uniform errors' },
      csrf: false, rateLimit: 'auth', body: loginBodySchema, response: { status: 200, schema: sessionStateSchema },
      errors: ['INVALID_CREDENTIALS'],
    },
    ({ body, req, res }) => auth.login(c, req, res, body.email, body.password),
  );

  route(
    { method: 'post', path: '/api/v1/auth/logout', operationId: 'logout', tags, summary: 'Sign out', access: { type: 'pending-2fa' }, response: { status: 204 } },
    async ({ auth: a, req, res }) => auth.logout(c, req, res, a),
  );

  route(
    {
      method: 'post', path: '/api/v1/auth/2fa/setup', operationId: 'twoFactorSetup', tags, summary: 'Start two-factor enrollment',
      description: 'Returns an otpauth URL (render as QR) and a manual key. Call `/auth/2fa/enable` with a code to finish.',
      access: { type: 'pending-2fa' }, response: { status: 200, schema: twoFactorSetupSchema }, errors: ['CONFLICT'],
    },
    ({ auth: a, req }) => auth.twoFactorSetup(c, req, a),
  );

  route(
    {
      method: 'post', path: '/api/v1/auth/2fa/enable', operationId: 'twoFactorEnable', tags, summary: 'Confirm enrollment and receive recovery codes',
      description: 'Recovery codes are shown once. The session is rotated and marked verified; the response sets a new cookie, so fetch the new CSRF token from `GET /me`.',
      access: { type: 'pending-2fa' }, rateLimit: 'auth', body: twoFactorEnableBodySchema, response: { status: 200, schema: twoFactorEnabledSchema },
      errors: ['INVALID_TWO_FACTOR_CODE', 'CONFLICT'],
    },
    ({ auth: a, body, req, res }) => auth.twoFactorEnable(c, req, res, a, body.code),
  );

  route(
    {
      method: 'post', path: '/api/v1/auth/2fa/verify', operationId: 'twoFactorVerify', tags, summary: 'Complete sign-in with an authenticator or recovery code',
      access: { type: 'pending-2fa' }, rateLimit: 'auth', body: twoFactorCodeBodySchema, response: { status: 200, schema: sessionStateSchema },
      errors: ['INVALID_TWO_FACTOR_CODE', 'TWO_FACTOR_SETUP_REQUIRED'],
    },
    ({ auth: a, body, req, res }) => auth.twoFactorVerify(c, req, res, a, body),
  );

  route(
    {
      method: 'post', path: '/api/v1/auth/invitations/accept', operationId: 'acceptInvitation', tags, summary: 'Accept an invitation and create the account',
      access: { type: 'public', reason: 'invitee has no account yet; authorized by a single-use token' },
      csrf: false, rateLimit: 'auth', body: acceptInvitationBodySchema, response: { status: 201, schema: sessionStateSchema }, errors: ['INVALID_TOKEN', 'CONFLICT'],
    },
    ({ body, req, res }) => auth.acceptInvitation(c, req, res, body),
  );

  route(
    {
      method: 'post', path: '/api/v1/auth/password/forgot', operationId: 'forgotPassword', tags, summary: 'Request a password reset email',
      description: 'Always 202 for any address. Rejected with CAPABILITY_DISABLED when no email provider is configured; use an administrator-issued link then.',
      access: { type: 'public', reason: 'account recovery; uniform response, rate limited' },
      csrf: false, rateLimit: 'auth', body: forgotPasswordBodySchema, response: { status: 202, schema: okSchema }, errors: ['CAPABILITY_DISABLED'],
    },
    async ({ body, req }) => {
      await auth.forgotPassword(c, req, body.email);
      return { ok: true as const };
    },
  );

  route(
    {
      method: 'post', path: '/api/v1/auth/password/reset', operationId: 'resetPassword', tags, summary: 'Set a new password using a reset token',
      description: 'Signs the user out everywhere.',
      access: { type: 'public', reason: 'authorized by a single-use token' },
      csrf: false, rateLimit: 'auth', body: resetPasswordBodySchema, response: { status: 204 }, errors: ['INVALID_TOKEN'],
    },
    async ({ body, req }) => auth.resetPassword(c, req, body),
  );

  route(
    {
      method: 'post', path: '/api/v1/auth/password/change', operationId: 'changePassword', tags, summary: 'Change your password',
      description: 'Other devices are signed out; this session stays.',
      access: { type: 'authenticated' }, rateLimit: 'auth', body: changePasswordBodySchema, response: { status: 204 }, errors: ['INVALID_CREDENTIALS'],
    },
    async ({ auth: a, body, req }) => auth.changePassword(c, req, a, body),
  );

  return router;
}
