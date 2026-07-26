/**
 * Wave 3 M6.2 — supplier-type taxonomy service.
 *
 * Suppliers can be classified with one or more types from the canonical
 * `SupplierType` enum (CARRIER / PORT / WAREHOUSE / SHIPPING_LINE /
 * CUSTOMS / SERVICE / FUEL). The set lives on `suppliers.types` (text[]).
 *
 * The legacy `isFuelSupplier` boolean is kept in sync with `types` via
 * `syncFuelFlag` — readers of the boolean see the same value as readers
 * of the array, so existing code (fuel-voucher attribution, semantic-
 * data agent filters, etc.) keeps working unchanged.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { eq, isNull, sql } from 'drizzle-orm';
import { SUPPLIER_TYPES, SupplierType } from '@tingting/shared';

export { SUPPLIER_TYPES, SupplierType } from '@tingting/shared';

/**
 * Normalize a raw input (any array of strings, possibly from a form or
 * import) into a canonical sorted array of valid SupplierType values.
 * Invalid strings are dropped; duplicates removed; case normalized.
 *
 * Returns an empty array for null/undefined/empty input — callers store
 * that as either NULL or `[]` depending on the column constraint.
 */
export function normalizeSupplierTypes(input: unknown): SupplierType[] {
  if (!Array.isArray(input)) return [];
  const valid = new Set<string>(SUPPLIER_TYPES as readonly string[]);
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const upper = raw.trim().toUpperCase();
    if (valid.has(upper) && !seen.has(upper)) seen.add(upper);
  }
  // Sort by the canonical order in SUPPLIER_TYPES so storage is stable.
  return (SUPPLIER_TYPES as readonly string[])
    .filter(t => seen.has(t))
    .map(t => t as SupplierType);
}

/**
 * Pure helper: returns the boolean that `isFuelSupplier` should hold
 * given the supplier's `types` array. Used by the CRUD afterCreate /
 * afterUpdate hook and by tests.
 */
export function syncFuelFlag(types: unknown): boolean {
  const normalized = normalizeSupplierTypes(types);
  return normalized.includes(SupplierType.FUEL);
}

/**
 * List suppliers whose `types` array contains the given type. Includes
 * suppliers with NULL types only when the caller passes `includeUncategorized`
 * (default false — the typical query is "give me all PORTs").
 */
export async function listSuppliersByType(
  type: SupplierType,
  opts: { includeUncategorized?: boolean } = {},
) {
  const conditions = [isNull(s.suppliers.deletedAt)];
  if (!opts.includeUncategorized) {
    conditions.push(sql`${type} = ANY(coalesce(${s.suppliers.types}, ARRAY[]::text[]))`);
  }
  return db.select().from(s.suppliers).where(sql.join(conditions, sql` AND `));
}

/**
 * Bulk-assign types to a set of suppliers matched by name. Used by the
 * seed step to classify the existing demo suppliers. Idempotent — re-
 * running with the same assignments is a no-op.
 *
 * Returns the count of rows actually changed.
 */
export async function classifySuppliersByName(
  assignments: Array<{ namePattern: string; types: SupplierType[] }>,
): Promise<number> {
  let changed = 0;
  for (const a of assignments) {
    // Match by exact name (case-sensitive). The seed suppliers have
    // stable names; for fuzzier matching the caller can pre-resolve IDs.
    const rows = await db.select({ id: s.suppliers.id, types: s.suppliers.types })
      .from(s.suppliers)
      .where(eq(s.suppliers.name, a.namePattern));
    for (const row of rows) {
      const current = normalizeSupplierTypes(row.types);
      // Skip if the assignment matches what's already there.
      const same = current.length === a.types.length
        && a.types.every(t => current.includes(t));
      if (same) continue;
      await db.update(s.suppliers)
        .set({
          types: a.types,
          isFuelSupplier: a.types.includes(SupplierType.FUEL),
          updatedAt: new Date(),
        })
        .where(eq(s.suppliers.id, row.id));
      changed += 1;
    }
  }
  return changed;
}
