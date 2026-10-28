import { z } from 'zod';

/** Stable, machine-readable error codes. Part of the public API contract: never rename or repurpose. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'TWO_FACTOR_REQUIRED',
  'TWO_FACTOR_SETUP_REQUIRED',
  'INVALID_TWO_FACTOR_CODE',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'CAPABILITY_DISABLED',
  'MODULE_DISABLED',
  'CSRF_INVALID',
  'ORIGIN_NOT_ALLOWED',
  'LAST_SUPER_ADMIN',
  'LOCKED_ROLE',
  'PERMISSION_ESCALATION',
  'INVALID_TOKEN',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorResponseSchema = z
  .object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .describe('Field-level problems, present for VALIDATION_FAILED'),
    requestId: z.string().optional(),
  })
  .meta({ id: 'ErrorResponse' });
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** Query parameters shared by every list endpoint (cursor pagination). */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(200).optional().describe('Opaque; pass `nextCursor` from the previous page'),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Wraps an item schema in the standard page shape: `{ items, nextCursor? }`. */
export function pageOf<T extends z.ZodType>(item: T, id: string) {
  return z
    .object({
      items: z.array(item),
      nextCursor: z.string().optional().describe('Absent on the last page'),
    })
    .meta({ id });
}

export const idParamSchema = z.object({ id: z.string().min(1).max(100) });
export const isoDateTime = z.iso.datetime();

/** Plain-text field: trimmed, no control characters. Output is escaped by consumers, never treated as HTML. */
export function plainText(min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v), 'Control characters are not allowed');
}

/** Trims and lowercases first, then validates, so "  Ann@Example.com " is accepted and stored normalized. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Password policy: length over composition rules (NIST 800-63B). */
export const passwordSchema = z.string().min(12, 'At least 12 characters').max(128);

export const okSchema = z.object({ ok: z.literal(true) }).meta({ id: 'Ok' });
