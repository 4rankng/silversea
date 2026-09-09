/**
 * One-shot idempotent backfill (2026-09-09 Bug A): every non-deleted ACTIVE
 * supplier must resolve to a linked ACTIVE isCarrier customer — the row every
 * "Chọn nhà xe" dropdown reads. The supplier write hook
 * (syncSupplierRelationsHook → ensureLinkedCarrierCustomer) only fires on
 * supplier writes, so suppliers created before the link fix (including the
 * user's just-added nhà thầu) never got a link. This backfills them using the
 * exact same ensure logic (adopt back-linked → adopt unique same-named →
 * adopt unique tax-code holder → mint), exported from config-helpers.
 *
 * Idempotent by construction: a supplier already resolving to a live
 * isCarrier customer is not a target, so a second run is a no-op. Ends by
 * invalidating catalogs:bootstrap (fault-tolerant; the key's TTL is ≤60s
 * anyway) so the master-plan popover picks the new carriers up immediately.
 *
 * Usage:
 *   cd backend && npx tsx src/scripts/backfill-supplier-carriers.ts [--dry-run]
 */

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { cacheInvalidate } from '../lib/redis';
import { ensureSupplierCarrierLink } from '../routes/config/config-helpers';

const DRY_RUN = process.argv.includes('--dry-run');

export interface BackfillResult {
  /** Non-deleted ACTIVE suppliers scanned. */
  checked: number;
  /** Suppliers that ended the run with a valid carrier link. */
  ensured: number;
  /** Suppliers already resolving to a live isCarrier customer — untouched. */
  skippedValid: number;
  /** Suppliers whose per-supplier transaction failed (logged, run continues). */
  errors: number;
}

/**
 * Ensure every non-deleted ACTIVE supplier resolves to a live isCarrier
 * customer. Exported so a pinned test can drive it against the real DB.
 */
export async function backfillSupplierCarrierLinks(): Promise<BackfillResult> {
  const rows = await db.select({
    id: s.suppliers.id,
    name: s.suppliers.name,
    shortName: s.suppliers.shortName,
    status: s.suppliers.status,
    taxCode: s.suppliers.taxCode,
    linkedCustomerId: s.suppliers.linkedCustomerId,
    customerDeletedAt: s.customers.deletedAt,
    customerIsCarrier: s.customers.isCarrier,
  }).from(s.suppliers)
    .leftJoin(s.customers, eq(s.customers.id, s.suppliers.linkedCustomerId))
    .where(and(isNull(s.suppliers.deletedAt), eq(s.suppliers.status, 'ACTIVE')));

  const targets = rows.filter((row) => (
    row.linkedCustomerId == null
    || row.customerDeletedAt != null
    || row.customerIsCarrier !== true
  ));

  const result: BackfillResult = {
    checked: rows.length, ensured: 0, skippedValid: rows.length - targets.length, errors: 0,
  };

  for (const target of targets) {
    const label = target.shortName?.trim() || target.name;
    const reason = target.linkedCustomerId == null
      ? 'unlinked'
      : `customer #${target.linkedCustomerId} ${target.customerDeletedAt != null ? 'deleted' : 'without isCarrier flag'}`;
    if (DRY_RUN) {
      console.log(`[dry-run] Would ensure #${target.id} ${label} (${reason})`);
      continue;
    }
    try {
      const linked = await db.transaction(async (tx): Promise<boolean> => {
        const ensuredId = await ensureSupplierCarrierLink(tx, target, null);
        return ensuredId != null;
      });
      if (linked) {
        result.ensured++;
        console.log(`Ensured #${target.id} ${label} → carrier customer linked`);
      }
    } catch (err) {
      result.errors++;
      console.error(`ERROR supplier #${target.id} ${label}:`, err);
    }
  }

  if (!DRY_RUN && result.ensured > 0) {
    try {
      await cacheInvalidate('catalogs:bootstrap');
    } catch {
      // Redis unreachable — the ≤60s TTL still refreshes the popover.
    }
  }

  if (!DRY_RUN) {
    // The backfill changes the carrier set — bust the cached bootstrap blob
    // so both "Chọn nhà xe" surfaces see it immediately (fault-tolerant; the
    // ≤60s TTL refreshes anyway).
    try {
      await cacheInvalidate('catalogs:bootstrap');
    } catch {
      // Redis unreachable — the ≤60s TTL still refreshes the popover.
    }
  }

  return result;
}

async function main() {
  console.log('=== Supplier → carrier customer backfill ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  const result = await backfillSupplierCarrierLinks();
  console.log('=== Results ===');
  console.log(`Checked:       ${result.checked}`);
  console.log(`Ensured:       ${result.ensured}`);
  console.log(`Already valid: ${result.skippedValid}`);
  console.log(`Errors:        ${result.errors}`);
  if (DRY_RUN) {
    console.log('\nThis was a DRY RUN. No changes were written to the database.');
  }
}

// Same main-module guard as seed.ts: importable by a pinned test, runnable
// as a one-shot script.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
