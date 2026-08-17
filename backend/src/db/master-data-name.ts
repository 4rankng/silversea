import { sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Operational labels prefer the configured short name while remaining safe
 * for rolling deployments and internal legacy writers that only know `name`.
 * Legal/report queries intentionally select the full-name column directly.
 */
export function operationalName(shortName: PgColumn, fullName: PgColumn) {
  return sql<string>`coalesce(nullif(btrim(${shortName}), ''), ${fullName})`;
}
