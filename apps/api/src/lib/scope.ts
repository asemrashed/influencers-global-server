import type { Scope } from '@platform/shared-types';

const RANK: Record<Scope, number> = { own: 1, assigned: 2, all: 3 };

/** Highest scope wins when several roles grant the same permission. */
export const widest = (a: Scope, b: Scope): Scope => (RANK[a] >= RANK[b] ? a : b);

/** May someone holding `held` hand out `wanted`? `all` covers everything; narrower scopes only themselves. */
export const scopeCovers = (held: Scope, wanted: Scope): boolean => held === 'all' || held === wanted;

export interface ScopeOptions {
  userId: string;
  /** Column holding the creator/owner id, used for `own`. */
  ownField: string;
  /** Builds the filter for `assigned` (records linked to the user's assignments). Omit if the resource has none. */
  assigned?: (userId: string) => Record<string, unknown>;
}

/**
 * Turns a scope into a Prisma `where` fragment. Repositories MUST merge this into every list and by-id lookup.
 * A scope the resource cannot express yields a filter that matches nothing (fail closed).
 */
export function scopeWhere(scope: Scope, opts: ScopeOptions): Record<string, unknown> {
  switch (scope) {
    case 'all':
      return {};
    case 'own':
      return { [opts.ownField]: opts.userId };
    case 'assigned':
      return opts.assigned ? opts.assigned(opts.userId) : { id: { in: [] as string[] } };
  }
}

/**
 * Combine a by-id (or any other) filter with a scope fragment. ALWAYS use this instead of spreading
 * `scopeWhere(...)` next to other keys: a scope on `id` (e.g. users reading themselves) would otherwise
 * overwrite the `id` being looked up and return the wrong record.
 */
export const withScope = <T extends Record<string, unknown>>(where: T, scope: Record<string, unknown>) => ({ AND: [where, scope] });
