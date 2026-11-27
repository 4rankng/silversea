// K2.45 — the carrier's payment deadline ("hạn thanh toán") is stamped from
// the carrier customer's linked supplier ("Nhà cung cấp liên kết"). Deleting
// that supplier record clears the link (catalog-crud.routes.ts afterDelete),
// so the carrier payable loses its deadline and ages from its recording date.
//
// The close itself must SURVIVE that state — FB-018 / ac13e8b4 turned the
// dangling link into a 500 that killed every completion attempt, and the
// posting never fails for a missing enrichment. What was missing is the
// REASON: the degradation was silent, so nothing on screen explained that
// the payment deadline could not be determined. This module turns the broken
// link into a named reason the close surfaces, without blocking it.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Executor } from '../db';
import * as s from '../db/schema';

/** What the close needs to know about the carrier's linked supplier. */
export interface CarrierPaymentTermFacts {
  /** The carrier customer row exists (a missing row has nothing to say). */
  carrierExists: boolean;
  /** `customers.linked_supplier_id` — the "Nhà cung cấp liên kết". */
  linkedSupplierId: number | null;
  /** `customers.is_carrier` — the row is a nhà xe mirror. */
  isCarrier: boolean;
  /** The linked supplier row is still there (null = no link to check). */
  linkedSupplierExists: boolean | null;
}

/**
 * The named reason the close shows when the carrier's payment deadline
 * cannot be determined. Two distinct broken states, one honest sentence:
 *  - the link points at a supplier record that is gone (soft-deleted or
 *    hard-deleted) — the name still identifies what is missing;
 *  - the carrier carries no linked supplier at all — the shape the supplier
 *    delete leaves behind (and the shape the carrier backfill repairs).
 * A carrier whose linked supplier EXISTS is never a defect: an unset term is
 * the supplier's own choice (the term is opt-in per supplier per kind), so
 * no warning is raised.
 */
export function carrierPaymentTermWarning(facts: CarrierPaymentTermFacts): string | null {
  if (!facts.carrierExists) return null;
  if (facts.linkedSupplierId != null) {
    if (facts.linkedSupplierExists !== false) return null;
    return `Chưa xác định hạn thanh toán: nhà cung cấp liên kết #${facts.linkedSupplierId} không còn tồn tại.`;
  }
  if (!facts.isCarrier) return null;
  return 'Chưa xác định hạn thanh toán: nhà xe chưa có nhà cung cấp liên kết.';
}

/** Read the carrier customer's link state (and whether the link still resolves). */
export async function resolveCarrierPaymentTermFacts(
  executor: Executor,
  carrierCustomerId: number,
): Promise<CarrierPaymentTermFacts | null> {
  const [carrier] = await executor.select({
    linkedSupplierId: s.customers.linkedSupplierId,
    isCarrier: s.customers.isCarrier,
  })
    .from(s.customers)
    .where(eq(s.customers.id, carrierCustomerId))
    .limit(1);
  if (!carrier) return null;
  let linkedSupplierExists: boolean | null = null;
  if (carrier.linkedSupplierId != null) {
    const [supplier] = await executor.select({ deletedAt: s.suppliers.deletedAt })
      .from(s.suppliers)
      .where(eq(s.suppliers.id, carrier.linkedSupplierId))
      .limit(1);
    linkedSupplierExists = supplier != null && supplier.deletedAt == null;
  }
  return {
    carrierExists: true,
    linkedSupplierId: carrier.linkedSupplierId,
    isCarrier: carrier.isCarrier,
    linkedSupplierExists,
  };
}

/**
 * The close's reason for one trip. Only EXTERNAL trips carry a carrier
 * payable, and only a CUSTOMER-typed external entity resolves to the carrier
 * customer that owns the linked supplier (SUPPLIER-typed carriers post no
 * carrier ledger row today).
 */
export async function resolveTripCarrierPaymentTermWarning(
  executor: Executor,
  tripId: number,
): Promise<string | null> {
  const [trip] = await executor.select({
    carrierType: s.tripsComposite.carrierType,
    externalEntityId: s.tripsComposite.externalEntityId,
    externalEntityType: s.tripsComposite.externalEntityType,
  })
    .from(s.tripsComposite)
    .where(and(eq(s.tripsComposite.id, tripId), isNull(s.tripsComposite.deletedAt)))
    .limit(1);
  if (!trip) return null;
  if ((trip.carrierType ?? 'OWN') !== 'EXTERNAL') return null;
  if (trip.externalEntityType !== 'CUSTOMER') return null;
  if (trip.externalEntityId == null) return null;
  const facts = await resolveCarrierPaymentTermFacts(executor, trip.externalEntityId);
  return facts ? carrierPaymentTermWarning(facts) : null;
}

/**
 * Batch variant for list reads: resolves the warning for MANY carrier
 * customers in one facts pass (one customers query + one suppliers query),
 * so a page of rows never pays per-row lookups. Carriers absent from the
 * result have no entry — the caller treats a missing key as "no warning".
 */
export async function resolveCarrierPaymentTermWarnings(
  executor: Executor,
  carrierCustomerIds: number[],
): Promise<Map<number, string | null>> {
  const warnings = new Map<number, string | null>();
  if (carrierCustomerIds.length === 0) return warnings;
  const carriers = await executor.select({
    id: s.customers.id,
    linkedSupplierId: s.customers.linkedSupplierId,
    isCarrier: s.customers.isCarrier,
  })
    .from(s.customers)
    .where(inArray(s.customers.id, carrierCustomerIds));
  const supplierIds = [...new Set(carriers
    .map((carrier) => carrier.linkedSupplierId)
    .filter((id): id is number => id != null))];
  const deletedSupplierIds = new Set<number>();
  if (supplierIds.length > 0) {
    const suppliers = await executor.select({ id: s.suppliers.id, deletedAt: s.suppliers.deletedAt })
      .from(s.suppliers)
      .where(inArray(s.suppliers.id, supplierIds));
    for (const supplier of suppliers) {
      if (supplier.deletedAt != null) deletedSupplierIds.add(supplier.id);
    }
  }
  for (const carrier of carriers) {
    warnings.set(carrier.id, carrierPaymentTermWarning({
      carrierExists: true,
      linkedSupplierId: carrier.linkedSupplierId,
      isCarrier: carrier.isCarrier,
      linkedSupplierExists: carrier.linkedSupplierId != null
        ? !deletedSupplierIds.has(carrier.linkedSupplierId)
        : null,
    }));
  }
  return warnings;
}
