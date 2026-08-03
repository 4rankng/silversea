import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

export function normalizeSeedText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function normalizedTextEquals(column: AnyPgColumn, value: string | null | undefined) {
  return sql`lower(btrim(${column})) = ${normalizeSeedText(value)}`;
}

export function normalizedNullableTextEquals(column: AnyPgColumn, value: string | null | undefined) {
  return sql`coalesce(nullif(lower(btrim(${column})), ''), '') = ${normalizeSeedText(value)}`;
}
