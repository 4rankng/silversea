import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Tx } from './dispatch-planning-utils.service';
import { dispatchDetailTransportDateSql } from './dispatch-planning-utils.service';
import { buildFulfillmentLessConditions, type FulfillmentLessFilters } from './dispatch-detail-plan-fulfillment-less';
import * as s from '../db/schema';

/** Select a single globally ordered page of identities before loading the
 * richer read model. Paging each source separately discards the unselected
 * half of a merged page and skips those containers on the next request. */
export async function listDetailPlanPageKeys(
  tx: Tx,
  fulfillmentFilters: SQL | undefined,
  branchFilters: FulfillmentLessFilters,
  accountantCustomerIds: number[] | null,
  limit: number,
  offset: number,
) {
  const directionRank = sql<number>`case
    when ${s.shipments.tradeDirection} = 'IMPORT' then 1
    when ${s.shipments.tradeDirection} = 'EXPORT' then 2 else 3 end`.as('direction_rank');
  const containerRank = sql<number>`case
    when ${s.containerTypes.code} like '20%' then 1
    when ${s.containerTypes.code} like '40%' then 2 else 4 end`;
  const fulfilled = tx.select({
    fulfillmentId: sql<number | null>`${s.shipmentFulfillments.id}`.as('fulfillment_id'),
    containerId: sql<number | null>`${s.shipmentContainers.id}`.as('container_id'),
    cargoRank: sql<number>`case when ${s.shipmentFulfillments.fulfillmentType} = 'LCL_SHIPMENT'
      then 3 else ${containerRank} end`.as('cargo_rank'),
    directionRank,
    transportDate: dispatchDetailTransportDateSql().as('transport_date'),
    sourceRank: sql<number>`0`.as('source_rank'),
    rowId: sql<number>`${s.shipmentFulfillments.id}`.as('row_id'),
  }).from(s.shipmentFulfillments)
    .innerJoin(s.shipments, eq(s.shipmentFulfillments.shipmentId, s.shipments.id))
    .innerJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
    .leftJoin(s.shipmentContainers, eq(s.shipmentFulfillments.shipmentContainerId, s.shipmentContainers.id))
    .leftJoin(s.containerTypes, eq(s.shipmentContainers.containerTypeId, s.containerTypes.id))
    .where(fulfillmentFilters);

  const undecomposed = tx.select({
    fulfillmentId: sql<number | null>`null::integer`.as('fulfillment_id'),
    containerId: sql<number | null>`${s.shipmentContainers.id}`.as('container_id'),
    cargoRank: containerRank.as('cargo_rank'),
    directionRank,
    transportDate: sql<string>`coalesce(date(${s.shipmentContainers.customerAppointmentAt}
      at time zone 'Asia/Ho_Chi_Minh'), ${s.shipments.expectedDeliveryDate})`.as('transport_date'),
    sourceRank: sql<number>`1`.as('source_rank'),
    rowId: sql<number>`${s.shipmentContainers.id}`.as('row_id'),
  }).from(s.shipments)
    .innerJoin(s.shipmentContainers, eq(s.shipmentContainers.shipmentId, s.shipments.id))
    .innerJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
    .leftJoin(s.containerTypes, eq(s.shipmentContainers.containerTypeId, s.containerTypes.id))
    .where(and(
      ...buildFulfillmentLessConditions(branchFilters, accountantCustomerIds),
      branchFilters.assignmentStatus === 'ASSIGNED' ? sql`false` : undefined,
    ));

  const combined = fulfilled.unionAll(undecomposed).as('detail_plan_keys');
  return tx.select({ fulfillmentId: combined.fulfillmentId, containerId: combined.containerId })
    .from(combined)
    .orderBy(combined.cargoRank, combined.directionRank,
      sql`coalesce(${combined.transportDate}, '9999-12-31') asc`, combined.sourceRank, combined.rowId)
    .limit(limit).offset(offset);
}

export function pageKeyPredicate(column: typeof s.shipmentContainers.id | typeof s.shipmentFulfillments.id, ids: number[]): SQL {
  return ids.length ? inArray(column, ids) : sql`false`;
}
