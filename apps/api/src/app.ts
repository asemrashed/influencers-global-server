import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import type { Container } from './container.js';
import { buildOpenApi } from './lib/openapi.js';
import type { RegisteredRoute, RouteKit } from './lib/route.js';
import { createLimiter, errorHandler, noStore, notFoundHandler, originGuard, requestId, sessionLoader } from './middleware/common.js';
import { aiRoutes } from './modules/ai/ai.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { commerceRoutes } from './modules/commerce/commerce.routes.js';
import { collaborationRoutes } from './modules/collaboration/collaboration.routes.js';
import { meetingsRoutes } from './modules/collaboration/meetings.routes.js';
import { contactsRoutes } from './modules/contacts/contacts.routes.js';
import { eventsRoutes } from './modules/events/events.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { inboxRoutes } from './modules/inbox/inbox.routes.js';
import { meRoutes } from './modules/me/me.routes.js';
import { profileRoutes } from './modules/profile/profile.routes.js';
import { rolesRoutes } from './modules/roles/roles.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { socialRoutes } from './modules/social/social.routes.js';
import { storageRoutes } from './modules/storage/storage.routes.js';
import { supportRoutes } from './modules/support/support.routes.js';
import { invitationsRoutes } from './modules/users/invitations.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';

export interface CreatedApp {
  app: Express;
  routes: RegisteredRoute[];
  openapi: () => Record<string, unknown>;
}

export function createApp(c: Container): CreatedApp {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', c.env.TRUST_PROXY_HOPS); // 0 = direct; set 1 behind nginx so req.ip is the real client

  const registry: RegisteredRoute[] = [];
  const kit: RouteKit = {
    c,
    registry,
    authLimiter: createLimiter(c, c.env.RATE_LIMIT_AUTH_PER_MIN, 'auth'),
    publicLimiter: createLimiter(c, c.env.RATE_LIMIT_PUBLIC_PER_MIN, 'public'),
  };

  app.use(requestId);
  app.use(
    pinoHttp({
      logger: c.logger,
      genReqId: (req) => (req as express.Request).requestId,
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
      customProps: (req) => ({ userId: (req as express.Request).auth?.user.id }),
    }),
  );

  // Build routers first so the OpenAPI document knows every route; mounting order is set below.
  const routers = [
    healthRoutes(kit),
    authRoutes(kit),
    meRoutes(kit),
    usersRoutes(kit),
    invitationsRoutes(kit),
    rolesRoutes(kit),
    settingsRoutes(kit),
    auditRoutes(kit),
    profileRoutes(kit),
    contactsRoutes(kit),
    inboxRoutes(kit),
    supportRoutes(kit),
    collaborationRoutes(kit),
    meetingsRoutes(kit),
    eventsRoutes(kit),
    socialRoutes(kit),
    commerceRoutes(kit),
    storageRoutes(kit),
    aiRoutes(kit),
  ];
  let cached: Record<string, unknown> | undefined;
  const openapi = () => (cached ??= buildOpenApi(registry, { title: `${c.env.APP_NAME} API`, version: c.env.APP_VERSION, cookieName: c.env.SESSION_COOKIE_NAME }));

  if (c.env.API_DOCS_ENABLED) {
    // Interactive docs need inline scripts, so they get their own, narrower-scoped CSP before the strict API one.
    const docsCsp = helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] } },
    });
    app.get('/openapi.json', docsCsp, (_req, res) => void res.json(openapi()));
    app.use('/docs', docsCsp, swaggerUi.serve, (req: express.Request, res: express.Response, next: express.NextFunction) => swaggerUi.setup(openapi())(req, res, next));
  }

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  const allowed = new Set(c.env.CORS_ORIGINS);
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Retry-After', 'RateLimit', 'RateLimit-Policy'],
      maxAge: 600,
    }),
  );
  app.use(noStore);
  app.use('/api', createLimiter(c, c.env.RATE_LIMIT_GLOBAL_PER_MIN, 'global'));
  app.use(cookieParser());
  app.use('/api/v1/storage/upload', express.json({ limit: '15mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(originGuard(c));
  app.use(sessionLoader(c));

  for (const r of routers) app.use(r);
  app.use(notFoundHandler);
  app.use(errorHandler(c));
  return { app, routes: registry, openapi };
}
