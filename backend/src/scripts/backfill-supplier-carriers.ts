/**
 * One-shot idempotent reconciliation of the supplier → carrier link.
 *
 * Two directions, both driven by the same rule the write hook uses
 * (`isCarrierSupplier`): a supplier is a carrier IFF its `types` array
 * contains CARRIER.
 *
 *  1. ENSURE — every non-deleted ACTIVE CARRIER-typed supplier must resolve to
 *     a linked ACTIVE isCarrier customer, the row every "Chọn nhà xe" dropdown
 *     reads. Uses the exact same ensure logic as the write hook (adopt
 *     back-linked → adopt unique same-named → adopt unique tax-code holder →
 *     mint), so the two write paths stay in lockstep forever.
 *  2. RETRACT — every non-carrier supplier (fuel station, insurer, weighbridge)
 *     that still holds an isCarrier mirror gives the flag back. Those rows were
 *     minted by the pre-2026-10-03 unconditional hook and are why Petrolimex
 *     and Bảo hiểm Bảo Việt were selectable as nhà xe and showed up in the
 *     merged customer list.
 *
 * Idempotent by construction: a supplier already in its correct state is not a
 * target, so a second run is a no-op. Ends by invalidating catalogs:bootstrap
 * (fault-tolerant; the key's TTL is ≤60s anyway) so the carrier dropdowns pick
 * the change up immediately.
 *
 * Usage:
 *   cd backend && npx tsx src/scripts/backfill-supplier-carriers.ts [--dry-run]
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { cacheInvalidate } from '../lib/redis';
import { ensureSupplierCarrierLink, isCarrierSupplier, retractCarrierLink } from '../services/supplier-carrier-link.service';
import { normalizeTaxCode } from '../services/legal-partner.service';
import { SupplierType } from '../services/supplier-types.service';

const DRY_RUN = process.argv.includes('--dry-run');

export interface BackfillResult {
  /** Non-deleted suppliers scanned (all statuses — a retired carrier supplier
   *  still needs its mirror retracted, and its customer must go dormant). */
  checked: number;
  /** CARRIER-typed suppliers that ended the run with a valid carrier link. */
  ensured: number;
  /** CARRIER-typed suppliers already resolving to a live isCarrier customer. */
  skippedValid: number;
  /** Non-carrier suppliers whose stale isCarrier flag was withdrawn. */
  retracted: number;
  /** Non-carrier suppliers that held no stale flag — untouched. */
  skippedNotCarrier: number;
  /** Rows whose per-supplier transaction failed (logged, run continues). */
  errors: number;
}

export interface AdoptResult {
  /** isCarrier customers with no owning supplier — the unadopted nhà xe. */
  checked: number;
  /** Attached to an existing supplier that already matched on tax code/name. */
  adopted: number;
  /** Given a freshly minted CARRIER-typed supplier. */
  minted: number;
  /** 2+ candidate suppliers matched — reported, never auto-resolved. */
  ambiguous: number;
  errors: number;
}

/**
 * Reconcile every non-deleted supplier against the carrier rule: ENSURE the
 * link for CARRIER-typed suppliers, RETRACT the stale flag from the rest.
 * Exported so a pinned test can drive it against the real DB.
 */
export async function backfillSupplierCarrierLinks(): Promise<BackfillResult> {
  const rows = await db.select({
    id: s.suppliers.id,
    name: s.suppliers.name,
    shortName: s.suppliers.shortName,
    status: s.suppliers.status,
    taxCode: s.suppliers.taxCode,
    types: s.suppliers.types,
    linkedCustomerId: s.suppliers.linkedCustomerId,
    customerDeletedAt: s.customers.deletedAt,
    customerIsCarrier: s.customers.isCarrier,
  }).from(s.suppliers)
    .leftJoin(s.customers, eq(s.customers.id, s.suppliers.linkedCustomerId))
    .where(isNull(s.suppliers.deletedAt));

  const result: BackfillResult = {
    checked: rows.length, ensured: 0, skippedValid: 0, retracted: 0, skippedNotCarrier: 0, errors: 0,
  };

  for (const row of rows) {
    const label = row.shortName?.trim() || row.name;
    if (!isCarrierSupplier(row.types)) {
      // Only the ACTIVE set is scanned for a link to ensure; an INACTIVE
      // supplier still owes a retraction when it holds a stale flag.
      if (row.customerIsCarrier !== true) {
        result.skippedNotCarrier++;
        continue;
      }
      if (DRY_RUN) {
        console.log(`[dry-run] Would retract carrier flag from customer #${row.linkedCustomerId} (supplier #${row.id} ${label} is not CARRIER-typed)`);
        continue;
      }
      try {
        await db.transaction(async (tx) => { await retractCarrierLink(tx, row.id); });
        result.retracted++;
        console.log(`Retracted carrier flag → customer #${row.linkedCustomerId} (supplier #${row.id} ${label})`);
      } catch (err) {
        result.errors++;
        console.error(`ERROR retracting supplier #${row.id} ${label}:`, err);
      }
      continue;
    }

    // An INACTIVE carrier supplier is already in its correct end state: the
    // ensure logic parked its customer at LOCKED so the carrier drops out of
    // every dropdown. Re-ensuring it would rewrite the same row on every run,
    // which is exactly what "idempotent by construction" forbids.
    if (row.status !== 'ACTIVE') {
      result.skippedValid++;
      continue;
    }

    const linkValid = row.linkedCustomerId != null
      && row.customerDeletedAt == null
      && row.customerIsCarrier === true;
    if (linkValid) {
      result.skippedValid++;
      continue;
    }
    const reason = row.linkedCustomerId == null
      ? 'unlinked'
      : `customer #${row.linkedCustomerId} ${row.customerDeletedAt != null ? 'deleted' : 'without isCarrier flag'}`;
    if (DRY_RUN) {
      console.log(`[dry-run] Would ensure #${row.id} ${label} (${reason})`);
      continue;
    }
    try {
      const linked = await db.transaction(async (tx): Promise<boolean> => (
        (await ensureSupplierCarrierLink(tx, row, null)) != null
      ));
      if (linked) {
        result.ensured++;
        console.log(`Ensured #${row.id} ${label} → carrier customer linked`);
      }
    } catch (err) {
      result.errors++;
      console.error(`ERROR supplier #${row.id} ${label}:`, err);
    }
  }

  if (!DRY_RUN && (result.ensured > 0 || result.retracted > 0)) {
    // The backfill changes the carrier set — bust the cached bootstrap blob so
    // both "Chọn nhà xe" surfaces see it immediately (fault-tolerant; the ≤60s
    // TTL refreshes anyway).
    try {
      await cacheInvalidate('catalogs:bootstrap');
    } catch {
      // Redis unreachable — the ≤60s TTL still refreshes the popover.
    }
  }

  return result;
}

/**
 * Direction 3 — every nhà xe is administered somewhere. Under the new model a
 * carrier is a CARRIER-typed supplier; the carrier rows seeded straight from
 * the workbook's "Nhà xe" sheet predate that and carry no supplier at all, so
 * they were invisible on /suppliers and uneditable. Adopt each onto its
 * supplier (unique tax-code holder → unique same-named carrier) or mint a
 * CARRIER-typed supplier mirroring it.
 *
 * Ambiguity (2+ candidates for the same key) is reported, never resolved by
 * picking one — the same discipline the ensure logic uses for customers.
 */
export async function backfillCarrierSuppliers(): Promise<AdoptResult> {
  const carriers = await db.select({
    id: s.customers.id,
    name: s.customers.name,
    shortName: s.customers.shortName,
    contactPerson: s.customers.contactPerson,
    phone: s.customers.phone,
    taxCode: s.customers.taxCode,
  }).from(s.customers)
    .where(and(eq(s.customers.isCarrier, true), isNull(s.customers.deletedAt), isNull(s.customers.linkedSupplierId)));

  const result: AdoptResult = { checked: carriers.length, adopted: 0, minted: 0, ambiguous: 0, errors: 0 };

  for (const carrier of carriers) {
    if (DRY_RUN) {
      console.log(`[dry-run] Would adopt/mint a CARRIER supplier for customer #${carrier.id} ${carrier.name}`);
      continue;
    }
    try {
      const outcome = await db.transaction(async (tx) => {
        const byTax = carrier.taxCode
          ? await tx.select({ id: s.suppliers.id }).from(s.suppliers).where(and(
            isNull(s.suppliers.deletedAt),
            sql`nullif(lower(regexp_replace(${s.suppliers.taxCode}, '\\s+', '', 'g')), '') = ${normalizeTaxCode(carrier.taxCode)}`,
          )).limit(2)
          : [];
        const byName = byTax.length === 0
          ? await tx.select({ id: s.suppliers.id }).from(s.suppliers).where(and(
            isNull(s.suppliers.deletedAt),
            sql`lower(btrim(${s.suppliers.name})) = lower(${carrier.name.trim()})`,
          )).limit(2)
          : [];
        const candidates = byTax.length > 0 ? byTax : byName;
        if (candidates.length > 1) return 'ambiguous' as const;

        const supplierId = candidates.length === 1
          ? candidates[0]!.id
          : (await tx.insert(s.suppliers).values({
            name: carrier.name,
            shortName: carrier.shortName?.trim() || carrier.name.trim(),
            contactPerson: carrier.contactPerson,
            phone: carrier.phone,
            types: [SupplierType.CARRIER],
            primaryType: SupplierType.CARRIER,
            status: 'ACTIVE',
          }).returning({ id: s.suppliers.id }))[0]!.id;

        await tx.update(s.suppliers)
          .set({ linkedCustomerId: carrier.id, updatedAt: new Date() })
          .where(eq(s.suppliers.id, supplierId));
        await tx.update(s.customers)
          .set({ linkedSupplierId: supplierId, updatedAt: new Date() })
          .where(eq(s.customers.id, carrier.id));
        return candidates.length === 1 ? 'adopted' as const : 'minted' as const;
      });
      if (outcome === 'ambiguous') {
        result.ambiguous++;
        console.warn(`AMBIGUOUS supplier match for carrier #${carrier.id} ${carrier.name} — left for manual review`);
        continue;
      }
      result[outcome]++;
      console.log(`${outcome === 'adopted' ? 'Adopted' : 'Minted'} CARRIER supplier for customer #${carrier.id} ${carrier.name}`);
    } catch (err) {
      result.errors++;
      console.error(`ERROR adopting carrier #${carrier.id} ${carrier.name}:`, err);
    }
  }

  return result;
}

async function main() {
  console.log('=== Supplier → carrier reconciliation ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  const links = await backfillSupplierCarrierLinks();
  console.log('--- supplier → carrier link ---');
  console.log(`Checked:        ${links.checked}`);
  console.log(`Ensured:        ${links.ensured}`);
  console.log(`Already valid:  ${links.skippedValid}`);
  console.log(`Retracted:      ${links.retracted}`);
  console.log(`Not a carrier:  ${links.skippedNotCarrier}`);
  console.log(`Errors:         ${links.errors}`);
  // Runs second: a carrier adopted onto its own new supplier needs no further
  // link repair, and the ensure pass has already retracted the false carriers.
  const adopted = await backfillCarrierSuppliers();
  console.log('--- carrier → owning supplier ---');
  console.log(`Checked:        ${adopted.checked}`);
  console.log(`Adopted:        ${adopted.adopted}`);
  console.log(`Minted:         ${adopted.minted}`);
  console.log(`Ambiguous:      ${adopted.ambiguous}`);
  console.log(`Errors:         ${adopted.errors}`);
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
