import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema.js';

export type { components, paths } from './schema.js';
export type ErrorResponse = components['schemas']['ErrorResponse'];

export interface ApiClientOptions {
  /** API origin, e.g. `https://api.client.com`. No trailing slash. */
  baseUrl: string;
  /** Inject for tests or non-browser runtimes. */
  fetch?: typeof fetch;
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Pulls a CSRF token out of the responses that carry one (login, 2FA, accept-invite, /me). */
function extractCsrf(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as { csrfToken?: unknown; session?: { csrfToken?: unknown } };
  if (typeof b.csrfToken === 'string') return b.csrfToken;
  if (typeof b.session?.csrfToken === 'string') return b.session.csrfToken;
  return undefined;
}

/**
 * Typed client for the platform API. Sends the session cookie (`credentials: include`) and attaches the
 * `X-CSRF-Token` header to state-changing requests automatically once a token has been seen.
 *
 *   const api = createApiClient({ baseUrl: 'https://api.client.com' });
 *   await api.POST('/api/v1/auth/login', { body: { email, password } });
 *   const { data } = await api.GET('/api/v1/me');
 */
export function createApiClient(options: ApiClientOptions) {
  let csrfToken: string | undefined;
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    credentials: 'include',
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const csrf: Middleware = {
    onRequest({ request }) {
      if (csrfToken && UNSAFE.has(request.method)) request.headers.set('X-CSRF-Token', csrfToken);
      return request;
    },
    async onResponse({ response }) {
      if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
        const token = extractCsrf(await response.clone().json().catch(() => undefined));
        if (token) csrfToken = token;
      }
      return response;
    },
  };
  client.use(csrf);

  return Object.assign(client, {
    /** Set manually if you restore a session from elsewhere (e.g. after a page reload: call `GET /api/v1/me`). */
    setCsrfToken(token: string | undefined): void {
      csrfToken = token;
    },
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
