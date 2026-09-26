/**
 * Dispatch detail plan — fulfillment-less branch (BUG 5 secondary, 9e ruling
 * 2026-09-12): READY_FOR_DISPATCH containers that never decomposed into
 * shipment fulfillments (the historical becomesReady hole; the write paths
 * now decompose, but rows stuck BEFORE that fix must still surface so
 * dispatchers can allocate them).
 *
 * Shape contract: rows come back in the SAME select shape the base
 * listDispatchDetailPlanRows query produces, with the fulfillment-owned
 * fields nulled (fulfillmentId/version, planned carrier block, estimates,
 * classification falls back to 'SINGLE') so the existing row mapper renders
 * them untouched: taskStatus 'READY', carrier cell unassigned.
 *
 * Filter parity with the base query: date/hour (container appointment →
 * shipment expectedDeliveryDate fallback, identical to
 * dispatchDetailTransportDateSql), zone/port/delivery-point/direction, q
 * search (container number included), accountant customer scope. Rows are
 * inherently unassigned, so an ASSIGNED assignmentStatus filter excludes
 * the branch entirely. A null transport date only appears when no date
 * filter is set (it cannot equal any specific date).
 */
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { Tx } from './dispatch-planning-utils.service';
import {
  CUSTOMER_OPERATIONAL_NAME,
  ROUTE_OPERATIONAL_NAME,
  buildPattern,
  shipmentQSearchPredicate,
} from './dispatch-planning-utils.service';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { ensureShipmentFulfillmentsInTx } from './shipment-fulfillment.service';
import { assertActorCanAccessShipment } from './shipment-coordination.service';
import { runInTx } from '../lib/tx';

export interface FulfillmentLessFilters {
  q?: string;
  date?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  direction?: string | null;
  pickupIds?: number[] | null;
  dropoffIds?: number[] | null;
  deliveryPointIds?: number[] | null;
  hourFrom?: number | null;
  hourTo?: number | null;
  zone?: string | null;
  assignmentStatus?: 'UNASSIGNED' | 'ASSIGNED' | null;
}

const TRANSPORT_DATE_SQL = sql<string>`coalesce(
  date(${s.shipmentContainers.customerAppointmentAt} at time zone 'Asia/Ho_Chi_Minh'),
  ${s.shipments.expectedDeliveryDate}
)`;

const RUN_MINUTES_SQL = sql<number>`(extract(hour from ${s.shipmentContainers.customerAppointmentAt} at time zone 'Asia/Ho_Chi_Minh') * 60 + extract(minute from ${s.shipmentContainers.customerAppointmentAt} at time zone 'Asia/Ho_Chi_Minh'))`;

/**
 * Full-parity conditions shared by the rows select and the count query —
 * every filter the base list applies that can target this branch's tables.
 */
export function buildFulfillmentLessConditions(filters: FulfillmentLessFilters, accountantCustomerIds: number[] | null): SQL[] {
  return [
    isNull(s.shipments.deletedAt),
    eq(s.shipments.status, 'READY_FOR_DISPATCH'),
    // Only containers with NO live fulfillment: a canceled-only history
    // counts as none (the lot resurfaces here until re-decomposed).
    sql`not exists (
      select 1 from ${s.shipmentFulfillments} f
      where f.shipment_container_id = ${s.shipmentContainers.id}
        and f.canceled_at is null
    )`,
    accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
    filters.direction ? eq(s.shipments.tradeDirection, filters.direction as 'IMPORT' | 'EXPORT') : undefined,
    filters.date ? sql`${TRANSPORT_DATE_SQL} = ${filters.date}` : undefined,
    filters.dateFrom ? sql`${TRANSPORT_DATE_SQL} >= ${filters.dateFrom}` : undefined,
    filters.dateTo ? sql`${TRANSPORT_DATE_SQL} <= ${filters.dateTo}` : undefined,
    filters.pickupIds ? inArray(s.shipmentContainers.pickupPortId, filters.pickupIds) : undefined,
    filters.dropoffIds ? inArray(s.shipmentContainers.dropoffPortId, filters.dropoffIds) : undefined,
    filters.deliveryPointIds ? inArray(s.shipments.operationalSiteId, filters.deliveryPointIds) : undefined,
    filters.hourFrom != null ? sql`${RUN_MINUTES_SQL} >= ${filters.hourFrom}` : undefined,
    filters.hourTo != null ? sql`${RUN_MINUTES_SQL} <= ${filters.hourTo}` : undefined,
    filters.zone ? sql`(
      exists (select 1 from ${s.ports} pz where pz.id = ${s.shipmentContainers.pickupPortId} and pz.dispatch_zone = ${filters.zone} and pz.deleted_at is null)
      or exists (select 1 from ${s.ports} pz where pz.id = ${s.shipmentContainers.dropoffPortId} and pz.dispatch_zone = ${filters.zone} and pz.deleted_at is null)
    )` : undefined,
    shipmentQSearchPredicate(buildPattern(filters.q), { containerNumber: true }),
  ].filter((c): c is SQL => c != null);
}

/** The branch is inherently unassigned — an ASSIGNED filter empties it. */
function branchActive(filters: FulfillmentLessFilters): boolean {
  return filters.assignmentStatus !== 'ASSIGNED';
}

export async function listFulfillmentLessReadyRows(
  tx: Tx,
  filters: FulfillmentLessFilters,
  accountantCustomerIds: number[] | null,
  limit: number,
  offset: number,
  containerIds?: number[],
) {
  if (!branchActive(filters) || containerIds?.length === 0) return [];
  return tx
    .select({
      // Fulfillment-owned fields are structurally absent on this branch.
      fulfillmentId: sql<null>`null`,
      fulfillmentVersion: sql<null>`null`,
      fulfillmentType: sql<string>`'FCL_CONTAINER'`,
      cargoMode: sql<string>`'FCL'`,
      plannedCarrierType: sql<null>`null`,
      plannedExternalCarrierId: sql<null>`null`,
      plannedExternalCarrierVehicleId: sql<null>`null`,
      plannedVehiclePlateNumber: sql<null>`null`,
      plannedRevenue: sql<null>`null`,
      plannedCarrierCost: sql<null>`null`,
      plannedEndAt: sql<null>`null`,
      classification: sql<string>`'SINGLE'`,
      shipmentContainerId: s.shipmentContainers.id,
      siteSnapshot: sql<null>`null`,
      shipmentId: s.shipments.id,
      shipmentVersion: s.shipments.version,
      shipmentCode: s.shipments.shipmentCode,
      isCombined: s.shipments.isCombined,
      bookingRef: s.shipments.bookingRef,
      blNumber: s.shipments.blNumber,
      tradeDirection: s.shipments.tradeDirection,
      customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
      closingAt: s.shipments.closingAt,
      plannedReturnAt: s.shipments.plannedReturnAt,
      transportDate: TRANSPORT_DATE_SQL,
      operationalNotes: s.shipments.operationalNotes,
      customerNotes: s.shipments.customerNotes,
      packageType: s.shipments.packageType,
      packageCount: s.shipments.packageCount,
      cargoWeightKg: s.shipments.cargoWeightKg,
      customerId: s.customers.id,
      customerName: CUSTOMER_OPERATIONAL_NAME,
      routeName: ROUTE_OPERATIONAL_NAME,
      operationalSiteId: s.shipments.operationalSiteId,
      containerNumber: s.shipmentContainers.containerNumber,
      containerCargoWeightKg: s.shipmentContainers.cargoWeightKg,
      containerTypeId: s.shipmentContainers.containerTypeId,
      containerTypeName: s.containerTypes.name,
      containerTypeCode: s.containerTypes.code,
      pickupPortId: s.shipmentContainers.pickupPortId,
      dropoffPortId: s.shipmentContainers.dropoffPortId,
      tripId: sql<null>`null`,
      tripStatus: sql<null>`null`,
      // No fulfillment ⇒ no trip ⇒ no active pair; keep the row shape aligned
      // with the fulfillment-owned branch so the shared dispatch mapping
      // (pairStatus/pairKind reads) typechecks and yields null.
      activeTripPairId: sql<null>`null`,
      pairKind: sql<null>`null`,
      pairStatus: sql<null>`null`,
    })
    .from(s.shipments)
    .innerJoin(s.shipmentContainers, eq(s.shipmentContainers.shipmentId, s.shipments.id))
    .innerJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
    .leftJoin(s.containerTypes, eq(s.shipmentContainers.containerTypeId, s.containerTypes.id))
    .leftJoin(s.operationalSites, eq(s.shipments.operationalSiteId, s.operationalSites.id))
    // Same container → shipment FCL fallback as the fulfillment-owned rows
    // query (QA-045): a route-less container on a routed lot shows the lot's
    // route here too. Local — the shared util feeds the master plan's INNER
    // join, whose row-set semantics must not change.
    .leftJoin(s.routes, eq(s.routes.id, sql<number>`case when ${s.shipments.cargoMode} = 'FCL'
      then coalesce(${s.shipmentContainers.routeId}, ${s.shipments.routeId})
      else ${s.shipments.routeId} end`))
    .where(and(...buildFulfillmentLessConditions(filters, accountantCustomerIds),
      containerIds ? inArray(s.shipmentContainers.id, containerIds) : undefined))
    .orderBy(sql`coalesce(${TRANSPORT_DATE_SQL}, '9999-12-31') asc`, s.shipmentContainers.id)
    .limit(limit)
    .offset(offset);
}

export async function countFulfillmentLessReadyRows(
  tx: Tx,
  filters: FulfillmentLessFilters,
  accountantCustomerIds: number[] | null,
): Promise<number> {
  if (!branchActive(filters)) return 0;
  const rows = await tx
    .select({ total: sql<number>`count(*)` })
    .from(s.shipments)
    .innerJoin(s.shipmentContainers, eq(s.shipmentContainers.shipmentId, s.shipments.id))
    .innerJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
    .where(and(...buildFulfillmentLessConditions(filters, accountantCustomerIds)));
  return Number(rows[0]?.total ?? 0);
}

/** Sort keys the merge shares with the base query's priority order. */
export interface DetailPlanSortRow {
  fulfillmentType: string;
  containerTypeCode: string | null;
  tradeDirection: string | null;
  transportDate: string | null;
  fulfillmentId: number | null;
  shipmentContainerId: number | null;
}

/**
 * Merge comparator mirroring dispatchDetailPriorityOrderSql: cargo rank,
 * direction rank, transport date (nulls last), then source and stable id.
 * Keep the source rank explicit so large fulfillment ids cannot collide
 * with the independent container-id space.
 */
export function compareDetailPlanRows(a: DetailPlanSortRow, b: DetailPlanSortRow): number {
  const cargoRank = (row: DetailPlanSortRow) => (row.fulfillmentType === 'LCL_SHIPMENT' ? 3
    : row.containerTypeCode?.startsWith('20') ? 1
    : row.containerTypeCode?.startsWith('40') ? 2
    : 4);
  const directionRank = (row: DetailPlanSortRow) => (row.tradeDirection === 'IMPORT' ? 1
    : row.tradeDirection === 'EXPORT' ? 2
    : 3);
  const dateKey = (row: DetailPlanSortRow) => row.transportDate ?? '9999-12-31';
  const sourceRank = (row: DetailPlanSortRow) => row.fulfillmentId == null ? 1 : 0;
  const idKey = (row: DetailPlanSortRow) => row.fulfillmentId ?? row.shipmentContainerId ?? 0;
  return cargoRank(a) - cargoRank(b)
    || directionRank(a) - directionRank(b)
    || dateKey(a).localeCompare(dateKey(b))
    || sourceRank(a) - sourceRank(b)
    || idKey(a) - idKey(b);
}

/**
 * Decompose entrypoint for the fulfillment-less branch (9e ruling, point d):
 * the editor cannot target a branch row (no fulfillmentId), so this governed
 * write decomposes the lot and returns the fresh fulfillment for that
 * container. Idempotent via the durable command registry — a replay returns
 * the SAME fulfillment, never a second row.
 */
export async function decomposeFulfillmentLessContainer(input: {
  shipmentId: number;
  containerId: number;
  expectedShipmentVersion: number;
  actorId: number;
  actor: { userId: number; role: string };
}): Promise<{ fulfillmentId: number; fulfillmentVersion: number; shipmentId: number; shipmentVersion: number }> {
  return runInTx(undefined, async (tx) => {
    await assertActorCanAccessShipment(tx, input.shipmentId, input.actor as never, { write: true });
    const [shipment] = await tx.select({ id: s.shipments.id, version: s.shipments.version })
      .from(s.shipments)
      .where(and(eq(s.shipments.id, input.shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');
    if (shipment.version !== input.expectedShipmentVersion) {
      throw new ApiError(409, 'Lô hàng đã thay đổi. Vui lòng tải lại.');
    }
    const [container] = await tx.select({ id: s.shipmentContainers.id })
      .from(s.shipmentContainers)
      .where(and(eq(s.shipmentContainers.id, input.containerId), eq(s.shipmentContainers.shipmentId, input.shipmentId)))
      .limit(1);
    if (!container) throw new ApiError(404, 'Không tìm thấy container của lô hàng.');
    const rows = await ensureShipmentFulfillmentsInTx(tx, {
      shipmentId: input.shipmentId,
      actorId: input.actorId,
      allowClerkIntake: true,
    });
    const fresh = rows.find((row) => row.shipmentContainerId === input.containerId)
      ?? rows[0];
    if (!fresh) throw new ApiError(409, 'Lô hàng không thể phân tách tác vụ.');
    const [after] = await tx.select({ version: s.shipments.version })
      .from(s.shipments).where(eq(s.shipments.id, input.shipmentId)).limit(1);
    return {
      fulfillmentId: fresh.id,
      fulfillmentVersion: fresh.version,
      shipmentId: shipment.id,
      shipmentVersion: after?.version ?? input.expectedShipmentVersion,
    };
  });
}
