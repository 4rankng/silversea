// Leaf read service: resolve an external carrier's display name from a trip's
// soft external-entity pointer (trip_carrier_info.external_entity_id /
// external_entity_type). Resolution mirrors the canonical phoi-phieu rule:
// CUSTOMER → the customers row; SUPPLIER → the supplier's linked isCarrier
// customer (ACTIVE, not deleted) with the supplier row itself as fallback;
// unresolvable master data degrades to a Vietnamese label instead of leaking
// `null` into the trip-detail payload (frontend ExternalCarrierCard treats a
// null name as "no carrier").
import { aliasedTable, and, eq, isNull } from 'drizzle-orm';
import { db, type Executor } from '../db';
import * as s from '../db/schema';
import { operationalName } from '../db/master-data-name';

const linkedCarrierCustomer = aliasedTable(s.customers, 'ext_carrier_linked_customer');

/** Master data row is gone (deleted/unlinked) — keep the trip readable. */
const CARRIER_MISSING_LABEL = 'Đơn vị vận chuyển không còn trong danh mục';
/** Pointer set but the entity type is neither CUSTOMER nor SUPPLIER. */
const CARRIER_UNKNOWN_LABEL = 'Chưa xác định đơn vị vận chuyển';

/**
 * Read the display name of a trip's external carrier. Returns an object (not
 * a bare value) so callers can spread it straight into the trip payload:
 * `{ externalCarrierName }`. `null` id ⇒ `{ externalCarrierName: null }`.
 */
export async function readTripExternalCarrier(
  externalEntityId: number | null,
  externalEntityType: string | null,
  executor: Executor = db,
): Promise<{ externalCarrierName: string | null }> {
  if (externalEntityId == null) return { externalCarrierName: null };

  if (externalEntityType === 'CUSTOMER') {
    const [row] = await executor.select({
      name: operationalName(s.customers.shortName, s.customers.name),
    }).from(s.customers)
      .where(eq(s.customers.id, externalEntityId))
      .limit(1);
    return { externalCarrierName: row?.name ?? CARRIER_MISSING_LABEL };
  }

  if (externalEntityType === 'SUPPLIER') {
    const [row] = await executor.select({
      linkedName: operationalName(linkedCarrierCustomer.shortName, linkedCarrierCustomer.name),
      name: operationalName(s.suppliers.shortName, s.suppliers.name),
    }).from(s.suppliers)
      .leftJoin(linkedCarrierCustomer, and(
        eq(linkedCarrierCustomer.id, s.suppliers.linkedCustomerId),
        eq(linkedCarrierCustomer.isCarrier, true),
        eq(linkedCarrierCustomer.status, 'ACTIVE'),
        isNull(linkedCarrierCustomer.deletedAt),
      ))
      .where(eq(s.suppliers.id, externalEntityId))
      .limit(1);
    return { externalCarrierName: row?.linkedName ?? row?.name ?? CARRIER_MISSING_LABEL };
  }

  return { externalCarrierName: CARRIER_UNKNOWN_LABEL };
}
