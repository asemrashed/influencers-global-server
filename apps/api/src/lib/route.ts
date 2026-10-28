import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { type z } from 'zod';
import type { ErrorCode, ModuleKey, Scope } from '@platform/shared-types';
import type { Container } from '../container.js';
import type { PermissionKey } from '../permissions/definitions.js';
import type { AuthContext } from '../modules/auth/auth.types.js';
import { scopeFor } from '../modules/auth/auth.types.js';
import { safeEqual } from './crypto.js';
import { errors } from './errors.js';

/**
 * EVERY route declares exactly one access policy. There is no way to register a route without one,
 * so "unintended public route" cannot happen by omission.
 */
export type Access =
  | { type: 'public'; reason: string }
  | { type: 'pending-2fa' }
  | { type: 'authenticated' }
  | { type: 'permission'; permission: PermissionKey };

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type OptSchema = z.ZodType | undefined;
type Out<S> = S extends z.ZodType ? z.output<S> : undefined;
type In<S> = S extends z.ZodType ? z.input<S> : void;

export interface RouteSpec<A extends Access, P extends OptSchema, Q extends OptSchema, B extends OptSchema, R extends OptSchema> {
  method: Method;
  /** Full path in OpenAPI style, e.g. `/api/v1/users/{id}`. */
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  access: A;
  /** Server-enforced module toggle. */
  module?: ModuleKey;
  params?: P;
  query?: Q;
  body?: B;
  response: { status: 200 | 201 | 202 | 204; schema?: R; description?: string };
  /** Error codes this route can return, for the docs. Common ones for the access type are added automatically. */
  errors?: ErrorCode[];
  /** Opt out of CSRF only for entry points used without a session (login, accept invite, forgot password). */
  csrf?: false;
  /** Stricter per-IP limit on top of the global one. */
  rateLimit?: 'auth' | 'public-form';
}

export interface HandlerArgs<A extends Access, P extends OptSchema, Q extends OptSchema, B extends OptSchema> {
  params: Out<P>;
  query: Out<Q>;
  body: Out<B>;
  auth: A extends { type: 'public' } ? AuthContext | undefined : AuthContext;
  scope: A extends { type: 'permission' } ? Scope : undefined;
  req: Request;
  res: Response;
}

/** Type-erased form kept for OpenAPI generation and the policy test. */
export interface RegisteredRoute {
  method: Method;
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  access: Access;
  module?: ModuleKey;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  response: { status: number; schema?: z.ZodType; description?: string };
  errors: ErrorCode[];
  csrf: boolean;
}

export interface RouteKit {
  c: Container;
  registry: RegisteredRoute[];
  authLimiter: RequestHandler;
  publicFormLimiter?: RequestHandler;
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const toExpressPath = (p: string) => p.replace(/\{(\w+)\}/g, ':$1');

function parseOrThrow(schema: z.ZodType, value: unknown, source: 'params' | 'query' | 'body'): unknown {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  throw errors.validation(
    result.error.issues.map((i) => ({ path: [source, ...i.path].join('.'), message: i.message })),
  );
}

function commonErrors(access: Access, hasInput: boolean, unsafe: boolean, csrf: boolean): ErrorCode[] {
  const list: ErrorCode[] = ['INTERNAL', 'RATE_LIMITED'];
  if (hasInput) list.push('VALIDATION_FAILED');
  if (access.type !== 'public') list.push('UNAUTHENTICATED');
  if (access.type === 'authenticated' || access.type === 'permission') list.push('TWO_FACTOR_REQUIRED', 'TWO_FACTOR_SETUP_REQUIRED');
  if (access.type === 'permission') list.push('FORBIDDEN');
  if (unsafe && csrf) list.push('CSRF_INVALID', 'ORIGIN_NOT_ALLOWED');
  return list;
}

/** Creates the `route(spec, handler)` function for one router. */
export function routeFactory(kit: RouteKit, router: Router) {
  return function route<
    const A extends Access,
    P extends OptSchema = undefined,
    Q extends OptSchema = undefined,
    B extends OptSchema = undefined,
    R extends OptSchema = undefined,
  >(spec: RouteSpec<A, P, Q, B, R>, handler: (args: HandlerArgs<A, P, Q, B>) => Promise<In<R>>): void {
    const unsafe = UNSAFE.has(spec.method.toUpperCase());
    const csrf = spec.csrf !== false;
    kit.registry.push({
      method: spec.method,
      path: spec.path,
      operationId: spec.operationId,
      summary: spec.summary,
      ...(spec.description ? { description: spec.description } : {}),
      tags: spec.tags,
      access: spec.access,
      ...(spec.module ? { module: spec.module } : {}),
      ...(spec.params ? { params: spec.params } : {}),
      ...(spec.query ? { query: spec.query } : {}),
      ...(spec.body ? { body: spec.body } : {}),
      response: {
        status: spec.response.status,
        ...(spec.response.schema ? { schema: spec.response.schema } : {}),
        ...(spec.response.description ? { description: spec.response.description } : {}),
      },
      errors: [...new Set([...(spec.errors ?? []), ...commonErrors(spec.access, Boolean(spec.params || spec.query || spec.body), unsafe, csrf)])],
      csrf: unsafe && csrf && spec.access.type !== 'public',
    });

    const run = async (req: Request, res: Response): Promise<void> => {
      // 1. Authentication: a session must exist for every non-public route.
      const access = spec.access;
      if (access.type !== 'public' && !req.auth) throw errors.unauthenticated();

      // 2. CSRF: any state-changing request carried by a session cookie needs the matching token header.
      //    Checked before authorization so a forged request learns nothing about the victim's permissions.
      if (unsafe && csrf && req.auth) {
        const sent = req.get('x-csrf-token');
        if (!sent || !safeEqual(sent, req.auth.session.csrfToken)) throw errors.csrf();
      }

      // 3. Authorization: two-factor completion, then the permission and its scope.
      let scope: Scope | undefined;
      if (access.type !== 'public') {
        const auth = req.auth!;
        if (access.type !== 'pending-2fa' && auth.twoFactorRequired && !auth.session.twoFactorVerified) {
          throw auth.user.twoFactorEnabled ? errors.twoFactorRequired() : errors.twoFactorSetupRequired();
        }
        if (access.type === 'permission') {
          const held = scopeFor(auth, access.permission);
          if (!held) throw errors.forbidden();
          scope = held;
        }
      }

      // 4. Module toggle
      if (spec.module) await kit.c.modules.assertEnabled(spec.module);

      // 5. Input validation (Zod, shared schemas)
      const params = spec.params ? parseOrThrow(spec.params, req.params, 'params') : undefined;
      const query = spec.query ? parseOrThrow(spec.query, req.query, 'query') : undefined;
      const body = spec.body ? parseOrThrow(spec.body, req.body, 'body') : undefined;

      const result = await handler({ params, query, body, auth: req.auth, scope, req, res } as unknown as HandlerArgs<A, P, Q, B>);

      // 6. Output is always re-parsed through the response schema: unknown fields are stripped, so a raw
      //    ORM object can never leak even if a handler forgets to map to a DTO.
      const status = typeof res.locals.statusOverride === 'number' ? res.locals.statusOverride : spec.response.status;
      if (spec.response.status === 204 || !spec.response.schema) {
        res.status(status).end();
        return;
      }
      res.status(status).json(spec.response.schema.parse(result));
    };

    const stack: RequestHandler[] = [];
    if (spec.rateLimit === 'auth') stack.push(kit.authLimiter);
    if (spec.rateLimit === 'public-form' && kit.publicFormLimiter) stack.push(kit.publicFormLimiter);
    stack.push((req: Request, res: Response, next: NextFunction) => {
      run(req, res).catch(next);
    });
    router[spec.method](toExpressPath(spec.path), ...stack);
  };
}
