import { z } from 'zod';

export const healthSchema = z.object({ status: z.literal('ok'), version: z.string() }).meta({ id: 'Health' });
export const readySchema = z
  .object({
    status: z.enum(['ready', 'degraded']),
    checks: z.object({ database: z.boolean(), jobs: z.enum(['up', 'down', 'disabled']) }),
  })
  .meta({ id: 'Ready' });
