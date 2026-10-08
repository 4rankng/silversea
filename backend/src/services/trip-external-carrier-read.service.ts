import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { operationalName } from '../db/master-data-name';

/** Read legacy supplier identities through their explicit customer link only. */
export async function readTripExternalCarrier(entityId: number | null, entityType: string | null) {
  if (entityId == null) return { externalCarrierId: null, externalCarrierName: null };
  if (entityType === 'SUPPLIER') {
    const [supplier] = await db.select({
      name: operationalName(s.suppliers.shortName, s.suppliers.name),
      customerId: s.customers.id,
      customerName: operationalName(s.customers.shortName, s.customers.name),
    }).from(s.suppliers).leftJoin(s.customers, and(
      eq(s.customers.id, s.suppliers.linkedCustomerId),
      eq(s.customers.isCarrier, true), eq(s.customers.status, 'ACTIVE'), isNull(s.customers.deletedAt),
    )).where(eq(s.suppliers.id, entityId)).limit(1);
    return {
      externalCarrierId: supplier?.customerId ?? null,
      externalCarrierName: supplier?.customerName ?? supplier?.name ?? 'Đơn vị vận chuyển không còn trong danh mục',
    };
  }
  if (entityType !== 'CUSTOMER') return { externalCarrierId: null, externalCarrierName: 'Chưa xác định đơn vị vận chuyển' };
  const [customer] = await db.select({ name: operationalName(s.customers.shortName, s.customers.name) })
    .from(s.customers).where(eq(s.customers.id, entityId)).limit(1);
  return { externalCarrierId: entityId, externalCarrierName: customer?.name ?? 'Đơn vị vận chuyển không còn trong danh mục' };
}
