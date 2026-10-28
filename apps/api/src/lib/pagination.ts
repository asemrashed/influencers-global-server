import type { PaginationQuery } from '@platform/shared-types';

/**
 * Cursor pagination over an `id`-keyed, stable ordering.
 * Fetch `limit + 1` rows with `cursor`/`skip`, then pass the rows through `toPage`.
 */
export function pageArgs(q: PaginationQuery) {
  return {
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 0 } : {}),
  };
}

export function toPage<T extends { id: string }, U>(rows: T[], limit: number, map: (row: T) => U): { items: U[]; nextCursor?: string } {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const next = hasMore ? rows[limit]?.id : undefined; // the first row of the next page
  return { items: pageRows.map(map), ...(next ? { nextCursor: next } : {}) };
}
