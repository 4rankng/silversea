/**
 * Ops "Kế hoạch làm hàng" (docs/prd/OpsVanHanh.md §3): company-wide shipment
 * list by expected delivery date with per-user pins.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { ApiError } from '../errors';

export interface OpsOrderItem {
  id: number;
  shipmentCode: string | null;
  status: string | null;
  tradeDirection: string | null;
  /** IMPORT → bl_number, EXPORT → booking_ref */
  billRef: string | null;
  customerName: string | null;
  routeName: string | null;
  pinned: boolean;
  pinnedAt: Date | null;
  containerCount: number;
  containerNumbers: string[];
  containerIds: number[];
}

export async function listOpsOrders(
  userId: number,
  date: string,
  search?: string,
): Promise<OpsOrderItem[]> {
  const conditions = [
    eq(s.shipments.expectedDeliveryDate, date),
    isNull(s.shipments.deletedAt),
    ne(s.shipments.status, 'CANCELED'),
  ];

  if (search && search.trim()) {
    const needle = `%${search.trim()}%`;
    conditions.push(or(
      ilike(s.shipments.shipmentCode, needle),
      ilike(s.customers.name, needle),
      // Container-number search through a correlated exists — avoids a join
      // that would fan out rows before the page is assembled.
      sql`exists (select 1 from ${s.shipmentContainers} sc
        where sc.shipment_id = ${s.shipments.id}
          and sc.container_number ilike ${needle})`,
    )!);
  }

  const rows = await db
    .select({
      id: s.shipments.id,
      shipmentCode: s.shipments.shipmentCode,
      status: s.shipments.status,
      tradeDirection: s.shipments.tradeDirection,
      billRef: sql<string | null>`case when ${s.shipments.tradeDirection} = 'IMPORT'
        then ${s.shipments.blNumber} else ${s.shipments.bookingRef} end`,
      customerName: s.customers.name,
      routeName: s.routes.name,
      pinnedAt: s.userShipmentPins.pinnedAt,
    })
    .from(s.shipments)
    .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
    .leftJoin(s.routes, eq(s.routes.id, s.shipments.routeId))
    .leftJoin(
      s.userShipmentPins,
      and(
        eq(s.userShipmentPins.shipmentId, s.shipments.id),
        eq(s.userShipmentPins.userId, userId),
      ),
    )
    .where(and(...conditions))
    // Pinned rows float to the top, newest pin first; NULLS LAST keeps unpinned
    // rows below without a separate sort key.
    .orderBy(sql`${s.userShipmentPins.pinnedAt} desc nulls last`, asc(s.shipments.shipmentCode));

  if (rows.length === 0) return [];

  const containers = await db
    .select({
      id: s.shipmentContainers.id,
      shipmentId: s.shipmentContainers.shipmentId,
      containerNumber: s.shipmentContainers.containerNumber,
    })
    .from(s.shipmentContainers)
    .where(inArray(
      s.shipmentContainers.shipmentId,
      rows.map((row) => row.id),
    ));

  const byShipment = new Map<number, Array<{ id: number; number: string | null }>>();
  for (const container of containers) {
    const bucket = byShipment.get(container.shipmentId) ?? [];
    bucket.push({ id: container.id, number: container.containerNumber });
    byShipment.set(container.shipmentId, bucket);
  }

  return rows.map((row) => {
    // id↔number pairs stay aligned; only numbered vỏ enter the two projected
    // arrays so the expense form's value/label zip can never mispair.
    const numbered = (byShipment.get(row.id) ?? []).filter(
      (pair): pair is { id: number; number: string } => pair.number != null,
    );
    return {
      id: row.id,
      shipmentCode: row.shipmentCode,
      status: row.status,
      tradeDirection: row.tradeDirection,
      billRef: row.billRef,
      customerName: row.customerName,
      routeName: row.routeName,
      pinned: row.pinnedAt != null,
      pinnedAt: row.pinnedAt,
      containerCount: numbered.length,
      containerNumbers: numbered.map((pair) => pair.number),
      containerIds: numbered.map((pair) => pair.id),
    };
  });
}

/**
 * Set (or clear) the caller's personal pin on a shipment. PUT semantics — a
 * replayed request converges on the requested state instead of flipping it;
 * re-pinning refreshes pinned_at so the newest pin stays on top.
 */
export async function setShipmentPin(
  userId: number,
  shipmentId: number,
  pinned: boolean,
): Promise<{ pinned: boolean }> {
  const [shipment] = await db
    .select({ id: s.shipments.id })
    .from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');

  if (!pinned) {
    await db.delete(s.userShipmentPins).where(and(
      eq(s.userShipmentPins.userId, userId),
      eq(s.userShipmentPins.shipmentId, shipmentId),
    ));
    return { pinned: false };
  }
  await db
    .insert(s.userShipmentPins)
    .values({ userId, shipmentId, pinnedAt: new Date() })
    .onConflictDoUpdate({
      target: [s.userShipmentPins.userId, s.userShipmentPins.shipmentId],
      set: { pinnedAt: new Date() },
    });
  return { pinned: true };
}
