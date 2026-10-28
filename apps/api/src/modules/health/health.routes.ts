import { Router } from 'express';
import { healthSchema, readySchema } from '@platform/shared-types';
import { routeFactory, type RouteKit } from '../../lib/route.js';

export function healthRoutes(kit: RouteKit): Router {
  const c = kit.c;
  const router = Router();
  const route = routeFactory(kit, router);

  route(
    {
      method: 'get', path: '/health', operationId: 'health', tags: ['Ops'], summary: 'Liveness: the process is up',
      access: { type: 'public', reason: 'load balancer and uptime probes; exposes nothing sensitive' }, response: { status: 200, schema: healthSchema },
    },
    async () => ({ status: 'ok' as const, version: c.env.APP_VERSION }),
  );

  route(
    {
      method: 'get', path: '/ready', operationId: 'ready', tags: ['Ops'], summary: 'Readiness: dependencies are reachable',
      description: 'Responds 503 with `status: degraded` when the database or job queue is down, so orchestrators stop routing traffic.',
      access: { type: 'public', reason: 'orchestrator readiness probe; exposes only up/down flags' }, response: { status: 200, schema: readySchema }, errors: ['INTERNAL'],
    },
    async ({ res }) => {
      const database = await c.db.$queryRaw`SELECT 1`.then(() => true, () => false);
      const jobs = !c.jobs.enabled ? ('disabled' as const) : c.jobs.isUp() ? ('up' as const) : ('down' as const);
      const ok = database && jobs !== 'down';
      if (!ok) res.locals.statusOverride = 503;
      return { status: ok ? ('ready' as const) : ('degraded' as const), checks: { database, jobs } };
    },
  );
  return router;
}
