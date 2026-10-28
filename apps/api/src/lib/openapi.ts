import { z } from 'zod';
import { errorResponseSchema } from '@platform/shared-types';
import type { RegisteredRoute } from './route.js';

type Json = Record<string, unknown>;

const STATUS_FOR_ERROR: Record<string, number> = {
  VALIDATION_FAILED: 400, INVALID_TOKEN: 400, UNAUTHENTICATED: 401, INVALID_CREDENTIALS: 401, INVALID_TWO_FACTOR_CODE: 401,
  FORBIDDEN: 403, TWO_FACTOR_REQUIRED: 403, TWO_FACTOR_SETUP_REQUIRED: 403, CSRF_INVALID: 403, ORIGIN_NOT_ALLOWED: 403,
  PERMISSION_ESCALATION: 403, MODULE_DISABLED: 403, NOT_FOUND: 404, CONFLICT: 409, LAST_SUPER_ADMIN: 409, LOCKED_ROLE: 409,
  PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, RATE_LIMITED: 429, INTERNAL: 500, CAPABILITY_DISABLED: 503,
};

/** Drops the very long regexes zod emits for formats; the `format` keyword already says it. */
function simplify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(simplify);
  if (node && typeof node === 'object') {
    const obj = node as Json;
    const out: Json = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'pattern' && typeof obj.format === 'string') continue;
      if (k === '$schema') continue;
      out[k] = simplify(v);
    }
    return out;
  }
  return node;
}

function toJsonSchema(schema: z.ZodType, io: 'input' | 'output', defs: Json): Json {
  const raw = z.toJSONSchema(schema, { target: 'draft-2020-12', io, unrepresentable: 'any' }) as Json;
  const { $defs, ...rest } = raw as { $defs?: Json } & Json;
  if ($defs) for (const [id, def] of Object.entries($defs)) defs[id] = simplify(def);
  return simplify(rest) as Json;
}

const rewriteRefs = (v: unknown): unknown => JSON.parse(JSON.stringify(v).replaceAll('#/$defs/', '#/components/schemas/'));

export interface OpenApiInfo {
  title: string;
  version: string;
  cookieName: string;
}

export function buildOpenApi(routes: RegisteredRoute[], info: OpenApiInfo): Json {
  const defs: Json = {};
  const paths: Record<string, Record<string, unknown>> = {};
  const errorRef = { $ref: '#/components/schemas/ErrorResponse' };

  for (const r of [...routes].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))) {
    const parameters: Json[] = [];
    if (r.params) {
      const s = toJsonSchema(r.params, 'input', defs) as { properties?: Record<string, Json> };
      for (const [name, schema] of Object.entries(s.properties ?? {})) parameters.push({ name, in: 'path', required: true, schema });
    }
    if (r.query) {
      const s = toJsonSchema(r.query, 'input', defs) as { properties?: Record<string, Json>; required?: string[] };
      for (const [name, schema] of Object.entries(s.properties ?? {})) {
        const { description, ...rest } = schema as Json & { description?: string };
        parameters.push({ name, in: 'query', required: s.required?.includes(name) ?? false, ...(description ? { description } : {}), schema: rest });
      }
    }

    const responses: Record<string, Json> = {};
    responses[String(r.response.status)] = {
      description: r.response.description ?? 'Success',
      ...(r.response.schema && r.response.status !== 204
        ? { content: { 'application/json': { schema: toJsonSchema(r.response.schema, 'output', defs) } } }
        : {}),
    };
    const byStatus = new Map<number, string[]>();
    for (const code of r.errors) {
      const st = STATUS_FOR_ERROR[code] ?? 500;
      byStatus.set(st, [...(byStatus.get(st) ?? []), code]);
    }
    for (const [st, codes] of byStatus) {
      responses[String(st)] = { description: `Error codes: ${codes.join(', ')}`, content: { 'application/json': { schema: errorRef } } };
    }

    const security: Json[] = r.access.type === 'public' ? [] : r.csrf ? [{ cookieAuth: [], csrfHeader: [] }] : [{ cookieAuth: [] }];
    const accessNote =
      r.access.type === 'public' ? `Public: ${r.access.reason}`
      : r.access.type === 'pending-2fa' ? 'Requires a session; allowed before two-factor is completed.'
      : r.access.type === 'authenticated' ? 'Requires a fully authenticated session.'
      : `Requires permission \`${r.access.permission}\`.`;

    const operation: Json = {
      operationId: r.operationId,
      summary: r.summary,
      description: [r.description, accessNote, r.module ? `Module: \`${r.module}\` (rejected with MODULE_DISABLED when switched off).` : '']
        .filter(Boolean)
        .join('\n\n'),
      tags: r.tags,
      'x-access': r.access.type === 'permission' ? { type: 'permission', permission: r.access.permission } : { type: r.access.type },
      security,
      ...(parameters.length ? { parameters } : {}),
      ...(r.body ? { requestBody: { required: true, content: { 'application/json': { schema: toJsonSchema(r.body, 'input', defs) } } } } : {}),
      responses,
    };
    (paths[r.path] ??= {})[r.method] = operation;
  }

  // The shared error envelope is referenced by every error response, so it is always emitted from the real schema.
  toJsonSchema(errorResponseSchema, 'output', defs);

  return rewriteRefs({
    openapi: '3.1.0',
    info: {
      title: info.title,
      version: info.version,
      description:
        'Backend API. Cookie session + CSRF header on state-changing requests. Errors always use `{ code, message, details?, requestId? }`; branch on `code`, never on `message`.',
    },
    servers: [{ url: '/' }],
    paths,
    components: {
      schemas: Object.fromEntries(Object.entries(defs).sort(([a], [b]) => a.localeCompare(b))),
      securitySchemes: {
        cookieAuth: { type: 'apiKey', in: 'cookie', name: info.cookieName },
        csrfHeader: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
      },
    },
  }) as Json;
}
