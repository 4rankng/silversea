/**
 * CR-011 Task 4.2 — prod runner for the contractor-carrier backfill, compiled
 * plain JS so it runs inside the production image (no tsx there). Identical
 * logic to backend/scripts/backfill-subcontractor-carriers.ts — it imports the
 * SAME built modules (dist) the running app uses: db, schema, redis cache
 * invalidation, ensureSupplierCarrierLink. Idempotent; --dry-run prints
 * without writing.
 */
import { eq } from 'drizzle-orm';
// SIL-1018 — dist-relative: the prod image ships only the BUILT modules
// (/prod/backend/dist), never src — src-relative imports made the runner die
// with ERR_MODULE_NOT_FOUND before it could do anything. The script sits at
// scripts/, so the built siblings are ../dist/*.
import { db } from '../dist/db/index.js';
import * as s from '../dist/db/schema/index.js';
import { cacheInvalidate } from '../dist/lib/redis.js';
import { ensureSupplierCarrierLink } from '../dist/services/supplier-carrier-link.service.js';

const CARRIER = 'CARRIER';

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
    const types = Array.isArray(supplier.types) ? [...supplier.types] : [];
    const needsCarrierType = !types.includes(CARRIER);
    const nextTypes = needsCarrierType ? [...types, CARRIER] : types;
    const unlinked = supplier.linkedCustomerId == null;
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
