/**
 * CR-011 Task 4.2 — one-time backfill: EVERY active supplier in `suppliers`
 * becomes a carrier (`CARRIER` added to `types` when absent) and is mirrored
 * into `customers` (isCarrier = true) through ensureSupplierCarrierLink, so
 * the whole contractor catalog appears in all 4 vehicle-assignment dropdowns.
 *
 * Known tradeoff (flagged in the CR-011 plan, overridable before running on
 * prod): suppliers used only for invoice purchases (fuel stations, insurers,
 * warehouses) also become selectable as nhà xe. The ticket's explicit wording
 * asks for the whole active catalog; a selective run can filter by name here.
 *
 * Idempotent: re-runs no-op (ensureSupplierCarrierLink resolves the same link,
 * the CARRIER type is only added when absent). Run with --dry-run to print
 * the would-be changes without writing. Ends with a catalogs:bootstrap cache
 * invalidation so the dropdowns see the new carriers immediately.
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db';
import * as s from '../src/db/schema';
import { cacheInvalidate } from '../src/lib/redis';
import { ensureSupplierCarrierLink } from '../src/services/supplier-carrier-link.service';
import { SupplierType } from '@tingting/shared';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const rows = await db.select({
    id: s.suppliers.id,
    name: s.suppliers.name,
    shortName: s.suppliers.shortName,
    status: s.suppliers.status,
    taxCode: s.suppliers.taxCode,
    types: s.suppliers.types,
    linkedCustomerId: s.suppliers.linkedCustomerId,
  }).from(s.suppliers).where(eq(s.suppliers.status, 'ACTIVE'));

  let updated = 0;
  for (const supplier of rows) {
    const types: SupplierType[] = Array.isArray(supplier.types) ? [...supplier.types] : [];
    const needsCarrierType = !types.includes(SupplierType.CARRIER);
    const unlinked = supplier.linkedCustomerId == null;
    const nextTypes = needsCarrierType ? [...types, SupplierType.CARRIER] : types;
    if (!needsCarrierType && !unlinked) continue;

    const label = supplier.shortName?.trim() || supplier.name;
    if (dryRun) {
      console.log(`[dry-run] ${label}: types ${JSON.stringify(types)} → ${JSON.stringify(nextTypes)}, carrier link ${unlinked ? 'ENSURE' : 'kept'}`);
      updated++;
      continue;
    }

    await db.transaction(async (tx) => {
      if (needsCarrierType) {
        await tx.update(s.suppliers)
          .set({ types: nextTypes, primaryType: nextTypes[0] ?? null, updatedAt: new Date() })
          .where(eq(s.suppliers.id, supplier.id));
      }
      await ensureSupplierCarrierLink(tx, {
        ...supplier,
        types: nextTypes,
      }, supplier.linkedCustomerId ?? null);
    });
    updated++;
    console.log(`Backfilled ${label} (types=${JSON.stringify(nextTypes)}).`);
  }

  if (!dryRun) await cacheInvalidate('catalogs:bootstrap');
  console.log(`Done: ${updated} active supplier(s) ${dryRun ? 'would be ' : ''}backfilled/synced as carriers.${dryRun ? ' Re-run without --dry-run to apply.' : ''}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
