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
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { Executor } from '../db';
import * as s from '../db/schema';

/** What the close needs to know about the carrier's linked supplier. */
export interface CarrierPaymentTermFacts {
  /** The carrier customer row exists (a missing row has nothing to say). */
  carrierExists: boolean;
  /** The carrier customer's id and display name, for naming the record when
   *  its own row is tombstoned. Optional so pure-function tests can pass the
   *  four original facts only. */
  carrierId?: number;
  carrierName?: string | null;
  /** The carrier customer row itself is soft-deleted. */
  carrierDeleted?: boolean;
  /** `customers.linked_supplier_id` — the "Nhà cung cấp liên kết". */
  linkedSupplierId: number | null;
  /** `customers.is_carrier` — the row is a nhà xe mirror. */
  isCarrier: boolean;
  /** The linked supplier row is still there (null = no link to check). */
  linkedSupplierExists: boolean | null;
  /** The linked supplier's display name (read past the tombstone). */
  linkedSupplierName?: string | null;
  /** Tombstoned suppliers still pointing back at this carrier through
   *  `suppliers.linked_customer_id` — the trace the supplier-delete hook
   *  leaves after nulling `customers.linked_supplier_id`. This is the only
   *  way to NAME what QA deleted (SIL-1082 K2.45: the reason must call the
   *  missing record by name, not "#id" or a generic sentence). */
  deletedLinkedSuppliers?: ReadonlyArray<{ id: number; name: string | null }>;
}

/**
 * The named reason the close shows when the carrier's payment deadline
 * cannot be determined. Three distinct broken states, one honest sentence:
 *  - the link points at a supplier record that is gone (soft-deleted or
 *    hard-deleted) — the name still identifies what is missing;
 *  - the carrier carries no linked supplier at all — the shape the supplier
 *    delete leaves behind (link nulled by the afterDelete hook). When the
 *    tombstoned supplier still points back via linked_customer_id the reason
 *    recovers its NAME; a hard delete with no trace keeps the generic line;
 *  - the carrier customer row itself is tombstoned — named too, because QA
 *    deletes both ends before completing (SIL-1082 K2.45 round 3).
 * A carrier whose linked supplier EXISTS is never a defect: an unset term is
 * the supplier's own choice (the term is opt-in per supplier per kind), so
 * no warning is raised.
 */
export function carrierPaymentTermWarning(facts: CarrierPaymentTermFacts): string | null {
  if (!facts.carrierExists) return null;
  const parts: string[] = [];
  if (facts.linkedSupplierId != null) {
    if (facts.linkedSupplierExists !== false) return null;
    parts.push(facts.linkedSupplierName
      ? `nhà cung cấp liên kết "${facts.linkedSupplierName}" (#${facts.linkedSupplierId}) không còn tồn tại`
      : `nhà cung cấp liên kết #${facts.linkedSupplierId} không còn tồn tại`);
  } else if (!facts.isCarrier) {
    return null;
  } else {
    const traced = facts.deletedLinkedSuppliers ?? [];
    if (traced.length > 0) {
      const named = traced
        .map((supplier) => (supplier.name ? `"${supplier.name}" (#${supplier.id})` : `#${supplier.id}`))
        .join(', ');
      parts.push(`nhà cung cấp liên kết đã bị xóa (${named})`);
    } else {
      parts.push('nhà xe chưa có nhà cung cấp liên kết');
    }
  }
  if (facts.carrierDeleted) {
    parts.push(facts.carrierName
      ? `hồ sơ nhà xe "${facts.carrierName}"${facts.carrierId != null ? ` (#${facts.carrierId})` : ''} cũng đã bị xóa`
      : 'hồ sơ nhà xe cũng đã bị xóa');
  }
  return `Chưa xác định hạn thanh toán: ${parts.join('; ')}.`;
}

/** Read the carrier customer's link state (and whether the link still resolves). */
export async function resolveCarrierPaymentTermFacts(
  executor: Executor,
  carrierCustomerId: number,
): Promise<CarrierPaymentTermFacts | null> {
  const [carrier] = await executor.select({
    id: s.customers.id,
    name: s.customers.name,
    deletedAt: s.customers.deletedAt,
    linkedSupplierId: s.customers.linkedSupplierId,
    isCarrier: s.customers.isCarrier,
  })
    .from(s.customers)
    .where(eq(s.customers.id, carrierCustomerId))
    .limit(1);
  if (!carrier) return null;
  let linkedSupplierExists: boolean | null = null;
  let linkedSupplierName: string | null = null;
  if (carrier.linkedSupplierId != null) {
    const [supplier] = await executor.select({ deletedAt: s.suppliers.deletedAt, name: s.suppliers.name })
      .from(s.suppliers)
      .where(eq(s.suppliers.id, carrier.linkedSupplierId))
      .limit(1);
    linkedSupplierExists = supplier != null && supplier.deletedAt == null;
    linkedSupplierName = supplier?.name ?? null;
  }
  const deletedLinkedSuppliers = carrier.linkedSupplierId == null && carrier.isCarrier
    ? await executor.select({ id: s.suppliers.id, name: s.suppliers.name })
      .from(s.suppliers)
      .where(and(eq(s.suppliers.linkedCustomerId, carrierCustomerId), isNotNull(s.suppliers.deletedAt)))
    : [];
  return {
    carrierExists: true,
    carrierId: carrier.id,
    carrierName: carrier.name,
    carrierDeleted: carrier.deletedAt != null,
    linkedSupplierId: carrier.linkedSupplierId,
    isCarrier: carrier.isCarrier,
    linkedSupplierExists,
    linkedSupplierName,
    deletedLinkedSuppliers,
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
    name: s.customers.name,
    deletedAt: s.customers.deletedAt,
    linkedSupplierId: s.customers.linkedSupplierId,
    isCarrier: s.customers.isCarrier,
  })
    .from(s.customers)
    .where(inArray(s.customers.id, carrierCustomerIds));
  const supplierIds = [...new Set(carriers
    .map((carrier) => carrier.linkedSupplierId)
    .filter((id): id is number => id != null))];
  const linkedSuppliers = supplierIds.length > 0
    ? await executor.select({ id: s.suppliers.id, name: s.suppliers.name, deletedAt: s.suppliers.deletedAt })
      .from(s.suppliers)
      .where(inArray(s.suppliers.id, supplierIds))
    : [];
  const supplierById = new Map(linkedSuppliers.map((supplier) => [supplier.id, supplier]));
  // Tombstone recovery — the supplier-delete hook nulls customers.linked_supplier_id,
  // so an unlinked carrier's lost "Nhà cung cấp liên kết" is only reachable
  // through suppliers.linked_customer_id. One extra IN query, only for the
  // unlinked nhà xe mirrors on the page.
  const unlinkedCarrierIds = carriers
    .filter((carrier) => carrier.linkedSupplierId == null && carrier.isCarrier)
    .map((carrier) => carrier.id);
  const tombstonesByCustomerId = new Map<number, Array<{ id: number; name: string | null }>>();
  if (unlinkedCarrierIds.length > 0) {
    const tombstones = await executor.select({ id: s.suppliers.id, name: s.suppliers.name, linkedCustomerId: s.suppliers.linkedCustomerId })
      .from(s.suppliers)
      .where(and(inArray(s.suppliers.linkedCustomerId, unlinkedCarrierIds), isNotNull(s.suppliers.deletedAt)));
    for (const tombstone of tombstones) {
      if (tombstone.linkedCustomerId == null) continue;
      const list = tombstonesByCustomerId.get(tombstone.linkedCustomerId) ?? [];
      list.push({ id: tombstone.id, name: tombstone.name });
      tombstonesByCustomerId.set(tombstone.linkedCustomerId, list);
    }
  }
  for (const carrier of carriers) {
    const linked = carrier.linkedSupplierId != null ? supplierById.get(carrier.linkedSupplierId) : undefined;
    warnings.set(carrier.id, carrierPaymentTermWarning({
      carrierExists: true,
      carrierId: carrier.id,
      carrierName: carrier.name,
      carrierDeleted: carrier.deletedAt != null,
      linkedSupplierId: carrier.linkedSupplierId,
      isCarrier: carrier.isCarrier,
      linkedSupplierExists: carrier.linkedSupplierId != null
        ? linked != null && linked.deletedAt == null
        : null,
      linkedSupplierName: linked?.name ?? null,
      deletedLinkedSuppliers: carrier.linkedSupplierId == null
        ? tombstonesByCustomerId.get(carrier.id) ?? []
        : undefined,
    }));
  }
  return warnings;
}
