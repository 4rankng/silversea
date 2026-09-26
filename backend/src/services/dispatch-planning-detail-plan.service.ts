import { loadDispatchExpenseNotes } from './dispatch-expense-notes.service';
/**
 * dispatch-planning detail — detail-plan grid, facets, plate/carrier/estimate mutations, zone panels.
 * Extracted from dispatch-planning.service.ts (structure-only split, no behavior change).
 * Layering: utils <- queries <- detail; utils <- commands <- detail (keep acyclic).
 */
import { CUSTOMER_OPERATIONAL_NAME, PORT_OPERATIONAL_NAME, ROUTE_OPERATIONAL_NAME, SITE_OPERATIONAL_NAME, DISPATCH_BUSINESS_TIME_ZONE, DispatchActor, INTERNAL_FLEET_CARRIER_NAME, Tx, assertDispatchActor, assertDispatchReadActor, buildPattern, dispatchDetailDataStatusSql, dispatchDetailTransportDateSql, loadDeclarationNumbers, normalizeDate, normalizeLimit, parseIsoWithZone, redactDispatchSiteForAccountant, requireAccountantDispatchScope, toFrozenSiteSummary, toIsoOrNull, shipmentQSearchPredicate } from './dispatch-planning-utils.service';
import { DISPATCH_DETAIL_PLAN_CARRIER_TYPES, loadLiveTripForFulfillment } from './dispatch-planning-commands.service';
import { compareDetailPlanRows, countFulfillmentLessReadyRows, listFulfillmentLessReadyRows } from './dispatch-detail-plan-fulfillment-less';
import { db } from '../db';
import { listDetailPlanPageKeys, pageKeyPredicate } from './dispatch-detail-plan-page';
import { requireDispatchZone } from './dispatch-detail-plan-zones.service';
import { ApiError } from '../errors';

import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import { getActiveAssignment, getActiveAssignmentsByTruckIds } from './truck-driver-assignment.service';
import { assertActorCanAccessShipment } from './shipment-coordination.service';



import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';


import { and, asc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { canonicalShipmentStatus, Role, TripStatus, type DispatchClassification } from '@tingting/shared';

import * as s from '../db/schema';
import type { AuthUser } from '../middleware/auth';



/** Resolve planned OWN vehicle names in a batch; issued trips use their own
 * driver record below, never the truck's potentially newer roster. */
async function loadPlannedDriverNames(tx: Tx, plates: string[]): Promise<Map<string, string>> {
  const uniquePlates = [...new Set(plates)];
  if (uniquePlates.length === 0) return new Map();
  const trucks = await tx.select({ id: s.trucks.id, plate: s.trucks.licensePlate })
    .from(s.trucks)
    .where(and(inArray(s.trucks.licensePlate, uniquePlates), isNull(s.trucks.deletedAt)));
  const assignments = await getActiveAssignmentsByTruckIds(tx, trucks.map((truck) => truck.id));
  return new Map(trucks.flatMap((truck) => {
    const assignment = assignments.get(truck.id);
    return assignment ? [[truck.plate, assignment.driverName] as const] : [];
  }));
}

export interface ListDispatchDetailPlanRowsInput {
  actor: AuthUser;
  page?: number;
  limit?: number;
  q?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  direction?: 'IMPORT' | 'EXPORT';
  assignmentStatus?: 'UNASSIGNED' | 'ASSIGNED';
  pickupIds?: number[];
  dropoffIds?: number[];
  deliveryPointIds?: number[];
  hourFrom?: string;
  hourTo?: string;
  /** Only rows whose container picks up or drops off at a port in this zone. */
  zone?: string;
  /** Exact-match customer scope (card 20260926_50 ribbon combobox). */
  customerId?: number;
  /** COMPLETE/MISSING intake-data predicate (card 20260926_50 ribbon select). */
  dataStatus?: 'COMPLETE' | 'MISSING';
}

/**
 * One atomic editor save: carrier + vehicle + estimates + classification in a
 * single fulfillment-plus-shipment transaction. The editor always sends every
 * plan field and both row versions, so a partially-stale tab cannot silently
 * erase concurrent work. The lot-level `isCombined` flag is CUS-owned and
 * omitted by the editor; it stays writable here only for existing callers.
 */

export interface UpdateDispatchDetailPlanInput {
  fulfillmentId: number;
  expectedFulfillmentVersion: number;
  expectedShipmentVersion: number;
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId?: number | null;
  truckId?: number | null;
  externalCarrierVehicleId?: number | null;
  plateNumber?: string | null;
  clearVehicle?: boolean;
  plannedRevenue: number | null;
  plannedCarrierCost: number | null;
  /** Per-row Phân loại (Đơn/Kẹp/Kết hợp/Lẻ). The dispatcher's call for cont
   *  rows (Đơn/Kẹp/Kết hợp) since 2026-09-08; CUS sets it at intake and LCL
   *  rows keep Lẻ. Undefined = unchanged. */
  classification?: DispatchClassification;
  /** Lot-level `shipments.is_combined` — CUS owns it (create + quick edit).
   *  Undefined = untouched by this save, which is what the dispatch editor
   *  now always sends: a per-container dispatcher must not rewrite a flag
   *  that spans every container in the lot. */
  isCombined?: boolean;
  /** Driver-facing note (shipments.operational_notes). Undefined = note
   *  untouched by this save. '' clears; null ≡ '' for change detection. */
  operationalNotes?: string | null;
  /** Giờ trả hàng staged on the row (shipment_fulfillments.planned_end_at).
   *  Undefined = untouched by this save; null/'' clears it. Zone-qualified
   *  instant only — parseIsoWithZone 400s on a naive local string. The FE
   *  owns the 'Giờ trả hàng phải sau giờ chạy' cross-field rule. */
  plannedEndAt?: string | null;
  idempotencyKey: string;
  actor: DispatchActor;
}


export interface DispatchDetailPlanMutationResult {
  fulfillmentId: number;
  fulfillmentVersion: number;
  shipmentId: number;
  shipmentVersion: number;
  classification: DispatchClassification;
  isCombined: boolean;
  /** Stored Giờ trả hàng after the save (ISO instant; null when unstaged). */
  plannedEndAt: string | null;
  /** Stored driver-facing note after the save (accountants never reach this
   *  path — the route gate excludes them, matching the read-side mask). */
  operationalNotes: string | null;
  dispatch: {
    carrierType: 'OWN' | 'EXTERNAL';
    carrierName: string | null;
    externalCarrierId: number | null;
    externalCarrierVehicleId: number | null;
    assignedPlate: string | null;
    assignedDriverName: string | null;
    /** True once the trip's driver acknowledged (ORDER_RECEIVED) — locks
     *  reassignment; always false for fulfillment-less rows. */
    driverAccepted: boolean;
  };
  estimates: {
    plannedRevenue: string | null;
    plannedCarrierCost: string | null;
  };
  lotFullyPlated: boolean;
  driverNotified: boolean;
  driverHint: string | null;
}


export interface AssignFulfillmentPlateInput {
  fulfillmentId: number;
  expectedVersion: number;
  truckId?: number | null;
  externalCarrierVehicleId?: number | null;
  plateNumber?: string | null;
  clear?: boolean;
  idempotencyKey: string;
  actor: DispatchActor;
}


export interface AssignFulfillmentCarrierInput {
  fulfillmentId: number;
  expectedVersion: number;
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  idempotencyKey: string;
  actor: DispatchActor;
}

/** Operational revenue/cost estimates; never a ledger or accounting entry. */

export interface UpdateFulfillmentEstimatesInput {
  fulfillmentId: number;
  expectedVersion: number;
  plannedRevenue: number | null;
  plannedCarrierCost: number | null;
  idempotencyKey: string;
  actor: DispatchActor;
}


export function normalizeIdList(raw: readonly (number | string)[] | null | undefined, label: string): number[] | null {
  if (!raw?.length) return null;
  const result: number[] = [];
  const seen = new Set<number>();
  for (const value of raw) {
    const id = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(400, `${label} không hợp lệ.`);
    }
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result.length > 0 ? result : null;
}


export function normalizeTimeMinutes(raw: string | undefined, label: string): number | null {
  if (raw == null) return null;
  const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(raw);
  if (!match) {
    throw new ApiError(400, `${label} phải có định dạng HH:MM.`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

// Minute granularity of the run window — coalesce closingAt then plannedReturnAt,
// same precedence the dispatch-queue date filter uses. Pinned to the business
// timezone so the JS-side display hour and the SQL filters agree regardless of
// the Postgres session timezone.


export function dispatchDetailRunMinutesSql() {
  return sql<number>`(
    extract(hour from coalesce(${s.shipmentContainers.customerAppointmentAt}, ${s.shipments.closingAt}, ${s.shipments.plannedReturnAt}) at time zone ${sql.raw(`'${DISPATCH_BUSINESS_TIME_ZONE}'`)}) * 60
    + extract(minute from coalesce(${s.shipmentContainers.customerAppointmentAt}, ${s.shipments.closingAt}, ${s.shipments.plannedReturnAt}) at time zone ${sql.raw(`'${DISPATCH_BUSINESS_TIME_ZONE}'`)})
  )`;
}


// Display-side hour in the same business timezone (matches the SQL filter).
export function dispatchDetailDisplayHour(closingAt: Date | null, plannedReturnAt: Date | null): number | null {
  const value = closingAt ?? plannedReturnAt;
  if (value == null) return null;
  // 7 = Asia/Ho_Chi_Minh offset (+07, no DST).
  return new Date(value.getTime() + 7 * 60 * 60 * 1000).getUTCHours();
}

/**
 * Server-owned default priority order for the detailed-plan grid. The editor
 * may layer explicit sorting on top, but pagination always follows this
 * canonical order so page boundaries stay stable. Buckets are derived from
 * canonical container codes / fulfillment type — never translated labels.
 *
 * 1. Cargo priority: 20-foot, 40-foot, LCL, everything else.
 * 2. Direction: Import, Export, unknown.
 * 3. Transport date ascending, nulls last (same date the grid filters on).
 * 4. Fulfillment id ascending — stable tie-break.
 */

export function dispatchDetailPriorityOrderSql() {
  const cargoRank = sql<number>`case
    when ${s.shipmentFulfillments.fulfillmentType} = 'LCL_SHIPMENT' then 3
    when ${s.containerTypes.code} like '20%' then 1
    when ${s.containerTypes.code} like '40%' then 2
    else 4
  end`;
  const directionRank = sql<number>`case
    when ${s.shipments.tradeDirection} = 'IMPORT' then 1
    when ${s.shipments.tradeDirection} = 'EXPORT' then 2
    else 3
  end`;
  return [
    sql`${cargoRank} asc`,
    sql`${directionRank} asc`,
    sql`coalesce(${dispatchDetailTransportDateSql()}, '9999-12-31') asc`,
    sql`${s.shipmentFulfillments.id} asc`,
  ];
}


export async function listDispatchDetailPlanRows(input: ListDispatchDetailPlanRowsInput) {
  assertDispatchReadActor(input.actor);
  const accountantCustomerIds = requireAccountantDispatchScope(input.actor);
  const limit = normalizeLimit(input.limit, 50);
  const page = Number.isFinite(input.page) ? Math.max(1, Math.floor(input.page as number)) : 1;
  const qPattern = buildPattern(input.q);
  const date = normalizeDate(input.date);
  const dateFrom = normalizeDate(input.dateFrom);
  const dateTo = normalizeDate(input.dateTo);
  const pickupIds = normalizeIdList(input.pickupIds, 'pickupIds');
  const dropoffIds = normalizeIdList(input.dropoffIds, 'dropoffIds');
  const deliveryPointIds = normalizeIdList(input.deliveryPointIds, 'deliveryPointIds');
  const hourFrom = normalizeTimeMinutes(input.hourFrom, 'hourFrom');
  const hourTo = normalizeTimeMinutes(input.hourTo, 'hourTo');
  // Zone filter takes its code from the DB taxonomy — unknown codes are a
  // client error, not an empty result (stale client, not silent nothing).
  if (input.zone != null) await requireDispatchZone(input.zone);

  return db.transaction(async (tx) => {
    // Shared filter so the rows page and the total count stay consistent
    // within one transaction.
    const filters = and(
      isNull(s.shipmentFulfillments.canceledAt),
      isNull(s.shipments.deletedAt),
      inArray(s.shipments.status, ['READY_FOR_DISPATCH', 'DISPATCHED', 'IN_TRANSIT', 'COMPLETED']),
      // 2026-09-09 dispatcher report: the detail plan only showed containers
      // already carrier-allocated on the master plan. A fulfillment with no
      // carrier plan yet (plannedCarrierType NULL) is exactly the one the
      // dispatcher needs to allocate here, so NULL stays in the row set —
      // the grid's carrier cell renders it as unassigned and the editor can
      // assign OWN/EXTERNAL straight from this screen.
      or(
        inArray(s.shipmentFulfillments.plannedCarrierType, [...DISPATCH_DETAIL_PLAN_CARRIER_TYPES]),
        isNull(s.shipmentFulfillments.plannedCarrierType),
      ),
      accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
      input.direction ? eq(s.shipments.tradeDirection, input.direction) : undefined,
      date ? eq(dispatchDetailTransportDateSql(), date) : undefined,
      dateFrom ? sql`${dispatchDetailTransportDateSql()} >= ${dateFrom}` : undefined,
      dateTo ? sql`${dispatchDetailTransportDateSql()} <= ${dateTo}` : undefined,
      pickupIds ? inArray(s.shipmentContainers.pickupPortId, pickupIds) : undefined,
      dropoffIds ? inArray(s.shipmentContainers.dropoffPortId, dropoffIds) : undefined,
      deliveryPointIds ? inArray(s.shipments.operationalSiteId, deliveryPointIds) : undefined,
      hourFrom != null ? sql`${dispatchDetailRunMinutesSql()} >= ${hourFrom}` : undefined,
      hourTo != null ? sql`${dispatchDetailRunMinutesSql()} <= ${hourTo}` : undefined,
      // Zone is stored authority: match the row's own container ports, either
      // side, against live ports in the requested zone (facet parity with the
      // master-plan per-zone port filter, zone-wide instead of per-port).
      input.zone ? or(
        sql`exists (select 1 from ${s.ports} pz where pz.id = ${s.shipmentContainers.pickupPortId} and pz.dispatch_zone = ${input.zone} and pz.deleted_at is null)`,
        sql`exists (select 1 from ${s.ports} pz where pz.id = ${s.shipmentContainers.dropoffPortId} and pz.dispatch_zone = ${input.zone} and pz.deleted_at is null)`,
      ) : undefined,
      input.assignmentStatus === 'UNASSIGNED'
        ? sql`(${s.shipmentFulfillments.plannedVehiclePlateNumber} is null or ${s.shipmentFulfillments.plannedVehiclePlateNumber} = '')`
        : undefined,
      input.assignmentStatus === 'ASSIGNED'
        ? sql`(${s.shipmentFulfillments.plannedVehiclePlateNumber} is not null and ${s.shipmentFulfillments.plannedVehiclePlateNumber} <> '')`
        : undefined,
      input.customerId ? eq(s.shipments.customerId, input.customerId) : undefined,
      input.dataStatus ? dispatchDetailDataStatusSql(input.dataStatus) : undefined,
      shipmentQSearchPredicate(qPattern, { containerNumber: true }),
    );

    const unionFilters = {
      q: input.q,
      date,
      direction: input.direction ?? null,
      pickupIds,
      dropoffIds,
      deliveryPointIds,
      hourFrom,
      hourTo,
      zone: input.zone ?? null,
      assignmentStatus: input.assignmentStatus ?? null,
      customerId: input.customerId ?? null,
      dataStatus: input.dataStatus ?? null,
    };
    const pageKeys = await listDetailPlanPageKeys(tx, filters, unionFilters, accountantCustomerIds, limit, (page - 1) * limit);
    const fulfillmentIds = pageKeys.flatMap((key) => key.fulfillmentId == null ? [] : [key.fulfillmentId]);
    const branchContainerIds = pageKeys.flatMap((key) => key.fulfillmentId == null && key.containerId != null ? [key.containerId] : []);

    const [rows, totals] = await Promise.all([
      tx.select({
      fulfillmentId: s.shipmentFulfillments.id,
      fulfillmentVersion: s.shipmentFulfillments.version,
      fulfillmentType: s.shipmentFulfillments.fulfillmentType,
      cargoMode: s.shipmentFulfillments.cargoMode,
      plannedCarrierType: s.shipmentFulfillments.plannedCarrierType,
      plannedExternalCarrierId: s.shipmentFulfillments.plannedExternalCarrierId,
      plannedExternalCarrierVehicleId: s.shipmentFulfillments.plannedExternalCarrierVehicleId,
      plannedVehiclePlateNumber: s.shipmentFulfillments.plannedVehiclePlateNumber,
      plannedRevenue: s.shipmentFulfillments.plannedRevenue,
      plannedCarrierCost: s.shipmentFulfillments.plannedCarrierCost,
      plannedEndAt: s.shipmentFulfillments.plannedEndAt,
      classification: s.shipmentFulfillments.dispatchClassification,
      shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
      siteSnapshot: s.shipmentFulfillments.siteSnapshot,
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
      transportDate: dispatchDetailTransportDateSql(),
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
      tripId: s.trips.id,
      tripStatus: s.trips.status,
      // Acceptance signal (ORDER_RECEIVED milestone) — lets the grid chip and
      // the reassignment dialog show the lock before the driver edits.
      driverAccepted: sql<boolean>`exists (select 1 from ${s.driverProgressEvents} dpe
        where dpe.trip_id = ${s.trips.id} and dpe.event_type = 'ORDER_RECEIVED')`,
      activeTripPairId: s.trips.activeTripPairId,
      pairKind: s.tripPairs.pairKind,
      pairStatus: s.tripPairs.status,
    }).from(s.shipmentFulfillments)
      .innerJoin(s.shipments, eq(s.shipmentFulfillments.shipmentId, s.shipments.id))
      .innerJoin(s.customers, and(eq(s.shipments.customerId, s.customers.id), isNull(s.customers.deletedAt)))
      .leftJoin(s.shipmentContainers, eq(s.shipmentFulfillments.shipmentContainerId, s.shipmentContainers.id))
      .leftJoin(s.containerTypes, eq(s.shipmentContainers.containerTypeId, s.containerTypes.id))
      .leftJoin(s.operationalSites, eq(s.shipments.operationalSiteId, s.operationalSites.id))
      // The plan's FCL route falls back container → shipment, mirroring the
      // CUS workspace's effectiveRouteNames: a container not yet routed
      // individually still shows the lot's route instead of a silent dash.
      // Local on purpose — the shared dispatchEffectiveRouteIdSql feeds the
      // master plan's INNER join, whose row-set semantics must not change.
      .leftJoin(s.routes, eq(s.routes.id, sql<number>`case when ${s.shipments.cargoMode} = 'FCL'
        then coalesce(${s.shipmentContainers.routeId}, ${s.shipments.routeId})
        else ${s.shipments.routeId} end`))
      .leftJoin(s.trips, and(
        eq(s.trips.fulfillmentId, s.shipmentFulfillments.id),
        ne(s.trips.status, TripStatus.CANCELED),
        isNull(s.trips.deletedAt),
      ))
      // Ghép chuyến tag (PRD LoHangKepKetHop §3.2): the pair kind is derived
      // from the ACTIVE trip pair, never entered by hand.
      .leftJoin(s.tripPairs, and(
        eq(s.tripPairs.id, s.trips.activeTripPairId),
        eq(s.tripPairs.status, 'ACTIVE'),
      ))
      .where(and(filters, pageKeyPredicate(s.shipmentFulfillments.id, fulfillmentIds)))
      .orderBy(...dispatchDetailPriorityOrderSql()),
      tx.select({ total: sql<number>`count(*)` })
        .from(s.shipmentFulfillments)
        .innerJoin(s.shipments, eq(s.shipmentFulfillments.shipmentId, s.shipments.id))
        .innerJoin(s.customers, and(eq(s.shipments.customerId, s.customers.id), isNull(s.customers.deletedAt)))
        .leftJoin(s.shipmentContainers, eq(s.shipmentFulfillments.shipmentContainerId, s.shipmentContainers.id))
        .where(filters),
    ]);

    // BUG 5 secondary (9e ruling 2026-09-12): historical READY_FOR_DISPATCH
    // containers that never decomposed ride the page through a second
    // branch query — same row shape, fulfillment-owned fields nulled — so
    // dispatchers can see and allocate lots stuck before the write-path
    // fix. The global identity page has already selected both sources;
    // hydrate only those rows and retain the combined total.
    const [unionRows, unionCount] = await Promise.all([
      listFulfillmentLessReadyRows(tx, unionFilters, accountantCustomerIds, limit, 0, branchContainerIds),
      countFulfillmentLessReadyRows(tx, unionFilters, accountantCustomerIds),
    ]);
    const pageRows = [...rows, ...unionRows].sort(compareDetailPlanRows);
    const shipmentIds = pageRows.map((row) => row.shipmentId);
    const opsRecoveryNotes = input.actor.role === Role.ACCOUNTANT ? new Map<number, string[]>() : await loadDispatchExpenseNotes(shipmentIds, tx);
    const carrierIds = pageRows
      .map((row) => row.plannedExternalCarrierId)
      .filter((id): id is number => id != null);
    const portIds = pageRows.flatMap((row) => [row.pickupPortId, row.dropoffPortId]).filter((id): id is number => id != null);
    const tripIds = pageRows.flatMap((row) => row.tripId == null ? [] : [row.tripId]);
    const plannedOwnPlates = pageRows.flatMap((row) => row.tripId == null
      && row.plannedCarrierType === 'OWN' && row.plannedVehiclePlateNumber
      ? [row.plannedVehiclePlateNumber] : []);
    const [declarations, carriers, ports, platedCounts, tripDrivers, plannedDriverNames] = await Promise.all([
      loadDeclarationNumbers(tx, shipmentIds),
      carrierIds.length === 0 ? [] : tx.select({ id: s.customers.id, name: CUSTOMER_OPERATIONAL_NAME }).from(s.customers).where(inArray(s.customers.id, [...new Set(carrierIds)])),
      portIds.length === 0 ? [] : tx.select({ id: s.ports.id, name: PORT_OPERATIONAL_NAME }).from(s.ports).where(inArray(s.ports.id, [...new Set(portIds)])),
      shipmentIds.length === 0 ? [] : tx.select({
        shipmentId: s.shipmentFulfillments.shipmentId,
        total: sql<number>`count(*)`,
        plated: sql<number>`count(*) filter (where ${s.shipmentFulfillments.plannedVehiclePlateNumber} is not null and ${s.shipmentFulfillments.plannedVehiclePlateNumber} <> '')`,
      }).from(s.shipmentFulfillments)
        .where(and(
          inArray(s.shipmentFulfillments.shipmentId, [...new Set(shipmentIds)]),
          isNull(s.shipmentFulfillments.canceledAt),
        ))
        .groupBy(s.shipmentFulfillments.shipmentId),
      tripIds.length === 0 ? [] : tx.select({
        tripId: s.tripsComposite.id,
        carrierType: s.tripsComposite.carrierType,
        driverName: s.drivers.name,
        externalDriverName: s.tripsComposite.externalDriverName,
      }).from(s.tripsComposite)
        .leftJoin(s.drivers, eq(s.drivers.id, s.tripsComposite.driverId))
        .where(inArray(s.tripsComposite.id, tripIds)),
      loadPlannedDriverNames(tx, plannedOwnPlates),
    ]);
    const tripDriverNames = new Map(tripDrivers.map((trip) => [trip.tripId,
      trip.carrierType === 'EXTERNAL' ? trip.externalDriverName : trip.driverName]));
    const carriersById = new Map(carriers.map((row) => [row.id, row]));
    const portsById = new Map(ports.map((row) => [row.id, row]));
    const platedByShipment = new Map(platedCounts.map((row) => [row.shipmentId, { total: Number(row.total), plated: Number(row.plated) }]));

    return {
      items: pageRows.map((row) => {
        const snapshot = (row.siteSnapshot ?? {}) as Record<string, unknown>;
        const deliverySite = redactDispatchSiteForAccountant(input.actor, toFrozenSiteSummary(snapshot.deliverySite));
        const plated = platedByShipment.get(row.shipmentId);
        return {
          fulfillmentId: row.fulfillmentId,
          version: row.fulfillmentVersion,
          // Branch rows (fulfillment-less) carry no fulfillmentId — the FE's
          // decompose entrypoint targets the container, so the id must ride
          // the wire for BOTH row families.
          shipmentContainerId: row.shipmentContainerId,
          shipmentId: row.shipmentId,
          shipmentVersion: row.shipmentVersion,
          shipmentCode: row.shipmentCode,
          isCombined: row.isCombined,
          fulfillmentType: row.fulfillmentType,
          cargoMode: row.cargoMode,
          // A completed trip must stop reading as "Đã phát lệnh" — the grid's
          // status chip keys off taskStatus (trip completion regression
          // reported 2026-09-08, MNBU0000283).
          taskStatus: row.tripId
            ? (row.tripStatus === TripStatus.COMPLETED ? 'COMPLETED' : 'DISPATCHED')
            : 'READY',
          time: {
            deliveryDate: row.transportDate,
            // Full run timestamp (appointment → closing → planned return —
            // same precedence as the hour below) so the grid can
            // render minutes and sort chronologically. The hour-int runHour
            // stays on the wire for the issue-order dialog and older readers.
            runAt: (row.customerAppointmentAt ?? row.closingAt ?? row.plannedReturnAt)?.toISOString() ?? null,
            runHour: dispatchDetailDisplayHour(row.customerAppointmentAt, row.closingAt ?? row.plannedReturnAt),
          },
          customerRoute: {
            customerName: row.customerName,
            factoryName: deliverySite.name,
            deliveryPoint: deliverySite.address,
            routeName: row.routeName,
          },
          docs: {
            billNumber: row.blNumber || row.bookingRef,
            tradeDirection: row.tradeDirection,
            declarationNumbers: declarations.get(row.shipmentId) ?? [],
          },
          container: {
            containerNumber: row.containerNumber,
            containerTypeLabel: row.containerTypeName ?? row.containerTypeCode ?? null,
            cargoWeightKg: row.containerCargoWeightKg ?? row.cargoWeightKg,
          },
          notes: {
            vehicleNote: input.actor.role === Role.ACCOUNTANT ? null : row.operationalNotes,
            customerNote: row.customerNotes,
            opsRecoveryNotes: opsRecoveryNotes.get(row.shipmentId) ?? [],
          },
          dispatch: {
            tripId: row.tripId,
            tripStatus: row.tripStatus,
            driverAccepted: row.tripId != null && row.driverAccepted === true,
            carrierType: row.plannedCarrierType,
            carrierName: row.plannedCarrierType === 'OWN'
              ? INTERNAL_FLEET_CARRIER_NAME
              : row.plannedExternalCarrierId
                ? carriersById.get(row.plannedExternalCarrierId)?.name ?? null
                : null,
            externalCarrierId: row.plannedExternalCarrierId,
            externalCarrierVehicleId: row.plannedExternalCarrierVehicleId,
            assignedPlate: row.plannedVehiclePlateNumber,
            assignedDriverName: row.tripId != null
              ? tripDriverNames.get(row.tripId) ?? null
              : row.plannedCarrierType === 'OWN' && row.plannedVehiclePlateNumber
                ? plannedDriverNames.get(row.plannedVehiclePlateNumber) ?? null
                : null,
            pairKind: row.pairStatus === 'ACTIVE' && (row.pairKind === 'KEP' || row.pairKind === 'KET_HOP')
              ? row.pairKind
              : null,
          },
          estimates: {
            plannedRevenue: row.plannedRevenue,
            plannedCarrierCost: row.plannedCarrierCost,
          },
          plannedEndAt: row.plannedEndAt?.toISOString() ?? null,
          // NOT NULL DEFAULT 'SINGLE': fresh containers surface as "Đơn"
          // until dispatch reclassifies them.
          classification: row.classification,
          ports: {
            pickupPortId: row.pickupPortId,
            pickupPortName: row.pickupPortId ? portsById.get(row.pickupPortId)?.name ?? null : null,
            dropoffPortId: row.dropoffPortId,
            dropoffPortName: row.dropoffPortId ? portsById.get(row.dropoffPortId)?.name ?? null : null,
          },
          lotFullyPlated: plated != null && plated.total > 0 && plated.plated === plated.total,
        };
      }),
      limit,
      total: Number(totals[0]?.total ?? 0) + unionCount,
      page,
      pageSize: limit,
    };
  });
}

// Distinct dropoff delivery points for the filter-bar multi-select facet.
// Scoped to the accountant's customer set like the rows endpoint.


// Distinct dropoff delivery points for the filter-bar multi-select facet.
// Scoped to the accountant's customer set like the rows endpoint.
export async function listDispatchDeliveryPointFacets(input: { actor: AuthUser; q?: string }) {
  assertDispatchReadActor(input.actor);
  const accountantCustomerIds = requireAccountantDispatchScope(input.actor);
  const qPattern = buildPattern(input.q);
  const rows = await db.selectDistinct({ id: s.operationalSites.id, name: SITE_OPERATIONAL_NAME })
    .from(s.shipments)
    .innerJoin(s.shipmentFulfillments, and(
      eq(s.shipmentFulfillments.shipmentId, s.shipments.id),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .innerJoin(s.operationalSites, eq(s.shipments.operationalSiteId, s.operationalSites.id))
    .where(and(
      isNull(s.shipments.deletedAt),
      eq(s.shipments.status, 'READY_FOR_DISPATCH'),
      accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
      qPattern ? or(ilike(SITE_OPERATIONAL_NAME, qPattern), ilike(s.operationalSites.name, qPattern)) : undefined,
    ))
    .orderBy(asc(SITE_OPERATIONAL_NAME))
    .limit(100);
  return { items: rows };
}

// Distinct pickup/dropoff ports for the filter-bar multi-select facets
// (spec §2 "Điểm Nâng / Hạ / Trả"). Scoped to the accountant's customer set
// like the rows endpoint.


// Distinct pickup/dropoff ports for the filter-bar multi-select facets
// (spec §2 "Điểm Nâng / Hạ / Trả"). Scoped to the accountant's customer set
// like the rows endpoint.
export async function listDispatchPortFacets(
  input: { actor: AuthUser; q?: string },
  kind: 'pickup' | 'dropoff',
) {
  assertDispatchReadActor(input.actor);
  const accountantCustomerIds = requireAccountantDispatchScope(input.actor);
  const qPattern = buildPattern(input.q);
  const portColumn = kind === 'pickup' ? s.shipmentContainers.pickupPortId : s.shipmentContainers.dropoffPortId;
  const rows = await db.selectDistinct({ id: s.ports.id, name: PORT_OPERATIONAL_NAME })
    .from(s.shipments)
    .innerJoin(s.shipmentFulfillments, and(
      eq(s.shipmentFulfillments.shipmentId, s.shipments.id),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .innerJoin(s.shipmentContainers, and(
      eq(s.shipmentContainers.shipmentId, s.shipments.id),
      isNotNull(portColumn),
    ))
    .innerJoin(s.ports, eq(s.ports.id, portColumn))
    .where(and(
      isNull(s.shipments.deletedAt),
      eq(s.shipments.status, 'READY_FOR_DISPATCH'),
      accountantCustomerIds ? inArray(s.shipments.customerId, accountantCustomerIds) : undefined,
      qPattern ? ilike(s.ports.name, qPattern) : undefined,
    ))
    .orderBy(asc(PORT_OPERATIONAL_NAME))
    .limit(100);
  return { items: rows };
}


export interface PlateMutationResult {
  fulfillmentId: number;
  version: number;
  lotFullyPlated: boolean;
  driverNotified: boolean;
  assignedPlate: string | null;
  assignedDriverId: number | null;
  assignedDriverName: string | null;
  driverHint: string | null;
}


export interface CarrierMutationResult {
  fulfillmentId: number;
  version: number;
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  carrierName: string;
  externalCarrierVehicleId: null;
  assignedPlate: null;
  lotFullyPlated: boolean;
}

// Same display normalization the carrier vehicle catalog uses
// (carrier-fleet-vehicle.service.ts formatPlate): trim, uppercase, collapse
// internal whitespace.


// Same display normalization the carrier vehicle catalog uses
// (carrier-fleet-vehicle.service.ts formatPlate): trim, uppercase, collapse
// internal whitespace.
export function normalizeFreeTextPlate(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Reassign exactly one ready fulfillment from the detailed vehicle workspace.
 * The master-plan allocation remains the aggregate planning surface; this
 * command only changes the selected operational task and atomically removes
 * its now-incompatible vehicle/plate assignment.
 */

export async function assignFulfillmentCarrierWriteCommand(input: AssignFulfillmentCarrierInput): Promise<CarrierMutationResult & { replayed: boolean }> {
  assertDispatchActor(input.actor);
  const outcome = await runIdempotent<CarrierMutationResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_CARRIER_ASSIGN,
    idempotencyKey: input.idempotencyKey,
    payload: {
      fulfillmentId: input.fulfillmentId,
      expectedVersion: input.expectedVersion,
      carrierType: input.carrierType,
      externalCarrierId: input.externalCarrierId,
    },
    createdBy: input.actor.userId,
    entityType: 'shipment_fulfillments',
    getEntityId: (result) => result.fulfillmentId,
    create: (tx) => assignFulfillmentCarrierInTx(tx, input),
  });
  return { ...outcome.result, replayed: outcome.replayed };
}


export async function assignFulfillmentCarrierInTx(tx: Tx, input: AssignFulfillmentCarrierInput): Promise<CarrierMutationResult> {
  // Read the parent id first, then use the same shipment → fulfillment lock
  // order as dispatch issuance so this mutation cannot deadlock with it.
  const [candidate] = await tx.select({ shipmentId: s.shipmentFulfillments.shipmentId })
    .from(s.shipmentFulfillments)
    .where(and(eq(s.shipmentFulfillments.id, input.fulfillmentId), isNull(s.shipmentFulfillments.canceledAt)))
    .limit(1);
  if (!candidate) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');

  const [shipment] = await tx.select().from(s.shipments)
    .where(and(eq(s.shipments.id, candidate.shipmentId), isNull(s.shipments.deletedAt)))
    .for('update')
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');
  await assertActorCanAccessShipment(tx, shipment.id, input.actor, { write: true });
  await assertShipmentAccountingUnlocked(tx, shipment.id);
  // Per-container reassignment: only terminal lot statuses block carrier
  // changes. A partially-dispatched lot keeps its remaining READY rows
  // re-assignable — same stranding risk as the plan-save guard below (the lot
  // flips DISPATCHED when the first container's order is issued), mirroring
  // the 2026-09-05 issuance-side fix in dispatch-planning-commands.service.ts.
  const carrierAssignStatus = canonicalShipmentStatus(shipment.status);
  if (carrierAssignStatus === 'COMPLETED' || carrierAssignStatus === 'CANCELED') {
    throw new ApiError(409, 'Lô hàng đã kết thúc, không thể đổi nhà xe.');
  }

  const [fulfillment] = await tx.select().from(s.shipmentFulfillments)
    .where(and(eq(s.shipmentFulfillments.id, input.fulfillmentId), isNull(s.shipmentFulfillments.canceledAt)))
    .for('update')
    .limit(1);
  if (!fulfillment) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');
  if (fulfillment.version !== input.expectedVersion) {
    throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
  }
  if (await loadLiveTripForFulfillment(tx, fulfillment.id)) {
    throw new ApiError(409, 'Không thể đổi nhà xe sau khi đã phát hành lệnh điều xe.');
  }

  let carrierName = INTERNAL_FLEET_CARRIER_NAME;
  if (input.carrierType === 'OWN') {
    if (input.externalCarrierId != null) throw new ApiError(400, 'Xe nội bộ không dùng mã nhà xe ngoài.');
  } else {
    if (input.externalCarrierId == null) throw new ApiError(400, 'Nhà xe ngoài là bắt buộc.');
    const [carrier] = await tx.select({ id: s.customers.id, name: CUSTOMER_OPERATIONAL_NAME })
      .from(s.customers)
      .where(and(
        eq(s.customers.id, input.externalCarrierId),
        eq(s.customers.isCarrier, true),
        eq(s.customers.status, 'ACTIVE'),
        isNull(s.customers.deletedAt),
      ))
      .limit(1);
    if (!carrier) throw new ApiError(409, 'Nhà xe không còn hiệu lực.');
    carrierName = carrier.name;
  }

  const [updated] = await tx.update(s.shipmentFulfillments).set({
    plannedCarrierType: input.carrierType,
    plannedExternalCarrierId: input.carrierType === 'EXTERNAL' ? input.externalCarrierId : null,
    plannedExternalCarrierVehicleId: null,
    plannedVehiclePlateNumber: null,
    version: fulfillment.version + 1,
    updatedAt: new Date(),
  }).where(and(
    eq(s.shipmentFulfillments.id, fulfillment.id),
    eq(s.shipmentFulfillments.version, fulfillment.version),
  )).returning();
  if (!updated) throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');

  return {
    fulfillmentId: updated.id,
    version: updated.version,
    carrierType: input.carrierType,
    externalCarrierId: input.carrierType === 'EXTERNAL' ? input.externalCarrierId : null,
    carrierName,
    externalCarrierVehicleId: null,
    assignedPlate: null,
    lotFullyPlated: await recomputeLotFullyPlated(tx, shipment.id),
  };
}


export async function assignFulfillmentPlate(input: AssignFulfillmentPlateInput): Promise<PlateMutationResult & { replayed: boolean }> {
  assertDispatchActor(input.actor);
  const outcome = await runIdempotent<PlateMutationResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_PLATE_ASSIGN,
    idempotencyKey: input.idempotencyKey,
    payload: {
      fulfillmentId: input.fulfillmentId,
      expectedVersion: input.expectedVersion,
      truckId: input.truckId ?? null,
      externalCarrierVehicleId: input.externalCarrierVehicleId ?? null,
      plateNumber: input.plateNumber ?? null,
      clear: input.clear === true,
    },
    createdBy: input.actor.userId,
    entityType: 'shipment_fulfillments',
    getEntityId: (result) => result.fulfillmentId,
    create: (tx) => assignFulfillmentPlateInTx(tx, input),
  });

  return { ...outcome.result, replayed: outcome.replayed };
}


export interface DispatchVehicleResolution {
  plannedVehiclePlateNumber: string | null;
  plannedExternalCarrierVehicleId: number | null;
  assignedTruckId: number | null;
  assignedDriverId: number | null;
  assignedDriverName: string | null;
  driverHint: string | null;
}

/**
 * Resolve the editor's vehicle selection into fulfillment columns. Shared by
 * the legacy plate endpoint and the atomic plan save. Vehicle ownership is
 * validated against the passed carrier — for the atomic save that is the
 * incoming carrier, so carrier and vehicle can switch together without
 * stranding a stale carrier-vehicle link.
 */

export async function resolveDispatchVehicleAssignment(tx: Tx, args: {
  carrierType: 'OWN' | 'EXTERNAL';
  plannedExternalCarrierId: number | null;
  truckId: number | null;
  externalCarrierVehicleId: number | null;
  plateNumber: string | null;
  clear: boolean;
}): Promise<DispatchVehicleResolution> {
  let plannedVehiclePlateNumber: string | null = null;
  let plannedExternalCarrierVehicleId: number | null = null;
  let assignedTruckId: number | null = null;
  let assignedDriverId: number | null = null;
  let assignedDriverName: string | null = null;
  let driverHint: string | null = null;

  if (args.clear) {
    // Clear path: both carrier types allowed; un-assign everything.
  } else if (args.carrierType === 'OWN') {
    if (args.truckId == null) {
      throw new ApiError(400, 'Xe nội bộ phải chọn biển số từ đội xe công ty.');
    }
    if (args.plateNumber != null || args.externalCarrierVehicleId != null) {
      throw new ApiError(400, 'Nhà xe nội bộ không dùng biển số tự do hoặc xe nhà thầu.');
    }
    const [truck] = await tx.select({
      id: s.trucks.id,
      licensePlate: s.trucks.licensePlate,
      status: s.trucks.status,
      deletedAt: s.trucks.deletedAt,
    }).from(s.trucks).where(eq(s.trucks.id, args.truckId)).limit(1);
    if (!truck || truck.deletedAt || truck.status !== 'ACTIVE') {
      throw new ApiError(409, 'Xe đầu kéo không còn hiệu lực.');
    }
    const assignment = await getActiveAssignment(tx, truck.id);
    plannedVehiclePlateNumber = truck.licensePlate;
    assignedTruckId = truck.id;
    if (assignment) {
      assignedDriverId = assignment.driverId;
      assignedDriverName = assignment.driverName;
      if (assignment.driverUserId == null) driverHint = 'Lái xe chưa có tài khoản đăng nhập.';
    } else {
      driverHint = 'Chưa có lái xe gắn với xe.';
    }
  } else {
    // EXTERNAL: catalog pick, free text, or empty (CUS fills later).
    if (args.externalCarrierVehicleId != null) {
      if (args.plateNumber != null) {
        throw new ApiError(400, 'Chỉ chọn một nguồn biển số: xe nhà thầu hoặc nhập tay.');
      }
      const [vehicle] = await tx.select({
        id: s.carrierFleetVehicles.id,
        carrierId: s.carrierFleetVehicles.carrierId,
        licensePlate: s.carrierFleetVehicles.licensePlate,
        isActive: s.carrierFleetVehicles.isActive,
        deletedAt: s.carrierFleetVehicles.deletedAt,
      }).from(s.carrierFleetVehicles)
        .where(eq(s.carrierFleetVehicles.id, args.externalCarrierVehicleId))
        .limit(1);
      if (!vehicle || vehicle.deletedAt || !vehicle.isActive) {
        throw new ApiError(409, 'Xe nhà thầu không còn hiệu lực.');
      }
      if (args.plannedExternalCarrierId != null && vehicle.carrierId !== args.plannedExternalCarrierId) {
        throw new ApiError(409, 'Xe không thuộc nhà xe được phân công.');
      }
      plannedVehiclePlateNumber = vehicle.licensePlate;
      plannedExternalCarrierVehicleId = vehicle.id;
    } else if (args.plateNumber != null) {
      const normalized = normalizeFreeTextPlate(args.plateNumber);
      const trimmed = args.plateNumber.trim();
      if (trimmed.length < 4 || trimmed.length > 20) {
        throw new ApiError(400, 'Biển số xe không hợp lệ.');
      }
      plannedVehiclePlateNumber = normalized;
      // Registry A (trucks) is the source of truth for external plates: a
      // typed plate links to (or auto-registers into) the carrier's catalog —
      // the list dispatchers manage on /suppliers — so attribution
      // (resolve-carrier) self-heals instead of decaying. Tombstoned plates
      // stay reserved; the plate's UNIQUE column blocks a duplicate insert.
      if (args.plannedExternalCarrierId != null) {
        const plateKey = normalized.replace(/[^A-Z0-9]/g, '');
        const [truckMatch] = await tx.select({ id: s.trucks.id }).from(s.trucks)
          .where(and(
            eq(s.trucks.carrierId, args.plannedExternalCarrierId),
            sql`regexp_replace(upper(${s.trucks.licensePlate}), '[^A-Z0-9]', '', 'g') = ${plateKey}`,
            isNull(s.trucks.deletedAt),
          ))
          .limit(1);
        if (!truckMatch) {
          const [plateOwner] = await tx.select({ id: s.trucks.id }).from(s.trucks)
            .where(sql`regexp_replace(upper(${s.trucks.licensePlate}), '[^A-Z0-9]', '', 'g') = ${plateKey}`)
            .limit(1);
          if (!plateOwner) {
            await tx.insert(s.trucks).values({
              licensePlate: normalized,
              carrierId: args.plannedExternalCarrierId,
              status: 'ACTIVE',
            }).onConflictDoNothing();
          }
        }
        // Legacy B match retained so pre-unification assignments keep
        // resolving their vehicle link.
        const [match] = await tx.select({
          id: s.carrierFleetVehicles.id,
        }).from(s.carrierFleetVehicles)
          .where(and(
            eq(s.carrierFleetVehicles.carrierId, args.plannedExternalCarrierId),
            eq(s.carrierFleetVehicles.normalizedPlate, plateKey),
            isNull(s.carrierFleetVehicles.deletedAt),
          ))
          .limit(1);
        plannedExternalCarrierVehicleId = match?.id ?? null;
      }
    }
    // else: empty assignment (bypass) — plate stays null, allowed for EXTERNAL.
  }

  return {
    plannedVehiclePlateNumber,
    plannedExternalCarrierVehicleId,
    assignedTruckId,
    assignedDriverId,
    assignedDriverName,
    driverHint,
  };
}

export async function assignFulfillmentPlateInTx(tx: Tx, input: AssignFulfillmentPlateInput): Promise<PlateMutationResult> {
  const [fulfillment] = await tx.select().from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.id, input.fulfillmentId),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .limit(1)
    .for('update');
  if (!fulfillment) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');
  if (fulfillment.version !== input.expectedVersion) {
    throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
  }
  const carrierType = fulfillment.plannedCarrierType;
  if (carrierType !== 'OWN' && carrierType !== 'EXTERNAL') {
    throw new ApiError(409, 'CUS chưa gán nhà xe cho tác vụ này.');
  }

  // Terminal lot statuses block plate writes on this single-field endpoint
  // too — the atomic plan save and the carrier change already reject with
  // 409 "Lô hàng đã kết thúc", and this legacy path accepting the same write
  // on a COMPLETED lot was a guard inconsistency. Deliberately a plain read
  // (no FOR UPDATE): the fulfillment row lock above already serializes this
  // endpoint, and locking the shipment here would invert the carrier path's
  // lock order (shipment → fulfillment) and deadlock the two endpoints.
  const [plateLot] = await tx.select({ status: s.shipments.status })
    .from(s.shipments)
    .where(and(eq(s.shipments.id, fulfillment.shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!plateLot) throw new ApiError(404, 'Không tìm thấy lô hàng.');
  if (canonicalShipmentStatus(plateLot.status) === 'COMPLETED' || canonicalShipmentStatus(plateLot.status) === 'CANCELED') {
    throw new ApiError(409, 'Lô hàng đã kết thúc, không thể gán biển số.');
  }

  await assertShipmentAccountingUnlocked(tx, fulfillment.shipmentId);

  const vehicle = await resolveDispatchVehicleAssignment(tx, {
    carrierType,
    plannedExternalCarrierId: fulfillment.plannedExternalCarrierId,
    truckId: input.truckId ?? null,
    externalCarrierVehicleId: input.externalCarrierVehicleId ?? null,
    plateNumber: input.plateNumber ?? null,
    clear: input.clear === true,
  });

  const [updated] = await tx.update(s.shipmentFulfillments).set({
    plannedVehiclePlateNumber: vehicle.plannedVehiclePlateNumber,
    plannedExternalCarrierVehicleId: vehicle.plannedExternalCarrierVehicleId,
    version: fulfillment.version + 1,
    updatedAt: new Date(),
  }).where(and(
    eq(s.shipmentFulfillments.id, fulfillment.id),
    eq(s.shipmentFulfillments.version, fulfillment.version),
  )).returning();
  if (!updated) throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');

  const lotFullyPlated = await recomputeLotFullyPlated(tx, fulfillment.shipmentId);

  // Plate assignment never notifies the driver — dispatch-order issuance
  // (issueOrderCreateOrUpdate) owns the driver notification, so the driver
  // never sees or taps into a job that has no trips row yet.
  return {
    fulfillmentId: fulfillment.id,
    version: updated.version,
    lotFullyPlated,
    driverNotified: false,
    assignedPlate: vehicle.plannedVehiclePlateNumber,
    assignedDriverId: vehicle.assignedDriverId,
    assignedDriverName: vehicle.assignedDriverName,
    driverHint: vehicle.driverHint,
  };
}


export interface FulfillmentEstimatesMutationResult {
  fulfillmentId: number;
  version: number;
  plannedRevenue: string | null;
  plannedCarrierCost: string | null;
}

/**
 * Saves an operational estimate only.  Financial postings stay exclusively in
 * the accounting workflow, and the accounting lock also protects this plan.
 */

export async function updateFulfillmentEstimates(
  input: UpdateFulfillmentEstimatesInput,
): Promise<FulfillmentEstimatesMutationResult & { replayed: boolean }> {
  assertDispatchActor(input.actor);
  const outcome = await runIdempotent<FulfillmentEstimatesMutationResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_ESTIMATES_UPDATE,
    idempotencyKey: input.idempotencyKey,
    payload: {
      fulfillmentId: input.fulfillmentId,
      expectedVersion: input.expectedVersion,
      plannedRevenue: input.plannedRevenue,
      plannedCarrierCost: input.plannedCarrierCost,
    },
    createdBy: input.actor.userId,
    entityType: 'shipment_fulfillments',
    getEntityId: (result) => result.fulfillmentId,
    create: async (tx) => {
      const [fulfillment] = await tx.select().from(s.shipmentFulfillments)
        .where(and(
          eq(s.shipmentFulfillments.id, input.fulfillmentId),
          isNull(s.shipmentFulfillments.canceledAt),
        ))
        .limit(1)
        .for('update');
      if (!fulfillment) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');
      if (fulfillment.version !== input.expectedVersion) {
        throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
      }

      await assertShipmentAccountingUnlocked(tx, fulfillment.shipmentId);
      const [updated] = await tx.update(s.shipmentFulfillments).set({
        plannedRevenue: input.plannedRevenue == null ? null : String(input.plannedRevenue),
        plannedCarrierCost: input.plannedCarrierCost == null ? null : String(input.plannedCarrierCost),
        version: fulfillment.version + 1,
        updatedAt: new Date(),
      }).where(and(
        eq(s.shipmentFulfillments.id, fulfillment.id),
        eq(s.shipmentFulfillments.version, fulfillment.version),
      )).returning();
      if (!updated) throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
      return {
        fulfillmentId: updated.id,
        version: updated.version,
        plannedRevenue: updated.plannedRevenue,
        plannedCarrierCost: updated.plannedCarrierCost,
      };
    },
  });
  return { ...outcome.result, replayed: outcome.replayed };
}

/**
 * Atomic editor save for one detailed-plan row. Locks shipment then
 * fulfillment (the same order as dispatch issuance, so this cannot deadlock
 * with it), applies the union of the strongest legacy guards, updates both
 * versioned rows in one transaction, and returns the complete row state.
 * Planning saves never notify the driver — dispatch-order issuance
 * (issueOrderCreateOrUpdate) owns the driver notification.
 */

export async function updateDispatchDetailPlan(input: UpdateDispatchDetailPlanInput): Promise<DispatchDetailPlanMutationResult & { replayed: boolean }> {
  assertDispatchActor(input.actor);
  const outcome = await runIdempotent<DispatchDetailPlanMutationResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_FULFILLMENT_PLAN_UPDATE,
    idempotencyKey: input.idempotencyKey,
    payload: {
      fulfillmentId: input.fulfillmentId,
      expectedFulfillmentVersion: input.expectedFulfillmentVersion,
      expectedShipmentVersion: input.expectedShipmentVersion,
      carrierType: input.carrierType,
      externalCarrierId: input.externalCarrierId ?? null,
      truckId: input.truckId ?? null,
      externalCarrierVehicleId: input.externalCarrierVehicleId ?? null,
      plateNumber: input.plateNumber ?? null,
      clearVehicle: input.clearVehicle === true,
      plannedRevenue: input.plannedRevenue,
      plannedCarrierCost: input.plannedCarrierCost,
      classification: input.classification ?? null as unknown as DispatchClassification,
      isCombined: input.isCombined,
      // Note and Giờ trả hàng are part of the dedup payload: two saves
      // differing only in these must not collide as the same idempotent request.
      operationalNotes: input.operationalNotes ?? null,
      plannedEndAt: input.plannedEndAt ?? null,
    },
    createdBy: input.actor.userId,
    entityType: 'shipment_fulfillments',
    getEntityId: (result) => result.fulfillmentId,
    create: (tx) => updateDispatchDetailPlanInTx(tx, input),
  });

  return { ...outcome.result, replayed: outcome.replayed };
}


export async function updateDispatchDetailPlanInTx(tx: Tx, input: UpdateDispatchDetailPlanInput): Promise<DispatchDetailPlanMutationResult> {
  // Lock shipment first, then fulfillment — the dispatch-issuance lock order.
  const [candidate] = await tx.select({ shipmentId: s.shipmentFulfillments.shipmentId })
    .from(s.shipmentFulfillments)
    .where(and(eq(s.shipmentFulfillments.id, input.fulfillmentId), isNull(s.shipmentFulfillments.canceledAt)))
    .limit(1);
  if (!candidate) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');

  const [shipment] = await tx.select().from(s.shipments)
    .where(and(eq(s.shipments.id, candidate.shipmentId), isNull(s.shipments.deletedAt)))
    .for('update')
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');

  // Union of the strongest guards from every legacy single-field endpoint.
  await assertActorCanAccessShipment(tx, shipment.id, input.actor, { write: true });
  await assertShipmentAccountingUnlocked(tx, shipment.id);
  // Per-container planning: only terminal lot statuses block plan saves. A
  // partially-dispatched lot keeps its remaining READY rows editable — the
  // lot status flips to DISPATCHED as soon as the first container's order is
  // issued, and the old READY_FOR_DISPATCH-only guard stranded the 2nd
  // container's planning entirely (2026-09-09 bug: the dispatcher could not
  // save the driver-note tags on the remaining container, and the UI mapped
  // the 409 to a misleading "reload" banner). Mirrors the 2026-09-05
  // issuance-side fix in dispatch-planning-commands.service.ts; the per-row
  // live-trip guard below is what keeps issued rows un-editable.
  const planSaveStatus = canonicalShipmentStatus(shipment.status);
  if (planSaveStatus === 'COMPLETED' || planSaveStatus === 'CANCELED') {
    throw new ApiError(409, 'Lô hàng đã kết thúc, không thể lưu kế hoạch.');
  }
  if (shipment.version !== input.expectedShipmentVersion) {
    throw new ApiError(409, 'Lô hàng đã thay đổi. Vui lòng tải lại.');
  }

  const [fulfillment] = await tx.select().from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.id, input.fulfillmentId),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .limit(1)
    .for('update');
  if (!fulfillment) throw new ApiError(404, 'Không tìm thấy tác vụ điều xe.');
  if (fulfillment.version !== input.expectedFulfillmentVersion) {
    throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');
  }
  if (await loadLiveTripForFulfillment(tx, fulfillment.id)) {
    throw new ApiError(409, 'Không thể sửa kế hoạch sau khi đã phát hành lệnh điều xe.');
  }

  // Giờ trả hàng staging: undefined = untouched; null/'' = clear; otherwise a
  // zone-qualified instant — validated before any write so an invalid value
  // changes nothing (all-or-nothing like carrier resolution). The FE owns the
  // after-start cross-field rule (card _15, 2026-09-26).
  const plannedEndAtProvided = input.plannedEndAt !== undefined;
  const nextPlannedEndAt = plannedEndAtProvided
    ? (input.plannedEndAt == null || input.plannedEndAt === '' ? null : parseIsoWithZone(input.plannedEndAt, 'Giờ trả hàng'))
    : null;

  // Carrier resolution — validated before any write, so an invalid carrier
  // changes nothing (all-or-nothing).
  let carrierName = INTERNAL_FLEET_CARRIER_NAME;
  let plannedExternalCarrierId: number | null = null;
  if (input.carrierType === 'OWN') {
    if (input.externalCarrierId != null) throw new ApiError(400, 'Xe nội bộ không dùng mã nhà xe ngoài.');
  } else {
    if (input.externalCarrierId == null) throw new ApiError(400, 'Nhà xe ngoài là bắt buộc.');
    const [carrier] = await tx.select({ id: s.customers.id, name: CUSTOMER_OPERATIONAL_NAME })
      .from(s.customers)
      .where(and(
        eq(s.customers.id, input.externalCarrierId),
        eq(s.customers.isCarrier, true),
        eq(s.customers.status, 'ACTIVE'),
        isNull(s.customers.deletedAt),
      ))
      .limit(1);
    if (!carrier) throw new ApiError(409, 'Nhà xe không còn hiệu lực.');
    carrierName = carrier.name;
    plannedExternalCarrierId = carrier.id;
  }

  // Vehicle resolution validates ownership against the incoming carrier. In
  // the atomic save the vehicle block is optional for both carrier types: an
  // editor save that changes only estimates/classification sends no vehicle
  // fields and leaves the plate untouched (null → keep stored columns) —
  // EXCEPT on a carrier switch, where an unspecified vehicle means "none for
  // the new carrier" and the previous carrier's vehicle/plate columns are
  // cleared, mirroring the legacy carrier endpoint.
  const carrierSwitched = fulfillment.plannedCarrierType !== input.carrierType;
  const vehicleSelected = input.truckId != null
    || input.externalCarrierVehicleId != null
    || input.plateNumber != null
    || input.clearVehicle === true
    || carrierSwitched;
  let vehicle: DispatchVehicleResolution | null = null;
  if (vehicleSelected) {
    vehicle = await resolveDispatchVehicleAssignment(tx, {
      carrierType: input.carrierType,
      plannedExternalCarrierId,
      truckId: input.truckId ?? null,
      externalCarrierVehicleId: input.externalCarrierVehicleId ?? null,
      plateNumber: input.plateNumber ?? null,
      clear: input.clearVehicle === true || (carrierSwitched && input.truckId == null && input.externalCarrierVehicleId == null && input.plateNumber == null),
    });
  }

  // Fulfillment row: assignment snapshot + estimates + classification.
  // Without a vehicle block the stored vehicle columns keep their values.
  const [updatedFulfillment] = await tx.update(s.shipmentFulfillments).set({
    plannedCarrierType: input.carrierType,
    plannedExternalCarrierId,
    ...(vehicle != null ? {
      plannedExternalCarrierVehicleId: vehicle.plannedExternalCarrierVehicleId,
      plannedVehiclePlateNumber: vehicle.plannedVehiclePlateNumber,
    } : {}),
    plannedRevenue: input.plannedRevenue == null ? null : String(input.plannedRevenue),
    plannedCarrierCost: input.plannedCarrierCost == null ? null : String(input.plannedCarrierCost),
    // Giờ trả hàng: a save that omits the field leaves the stored value untouched.
    ...(plannedEndAtProvided ? { plannedEndAt: nextPlannedEndAt } : {}),
    // Phân loại per-row is the dispatcher's call (2026-09-08): a save that
    // carries it rewrites the stored value; omitted = untouched.
    ...(input.classification ? { dispatchClassification: input.classification } : {}),
    version: fulfillment.version + 1,
    updatedAt: new Date(),
  }).where(and(
    eq(s.shipmentFulfillments.id, fulfillment.id),
    eq(s.shipmentFulfillments.version, fulfillment.version),
  )).returning();
  if (!updatedFulfillment) throw new ApiError(409, 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.');

  // Shipment row: isCombined is lot-level and independent of classification;
  // the driver-facing note (operationalNotes) rides the same shipment write.
  // Version bumps only when one of the two actually changes — a save that
  // keeps both at their stored values must not invalidate other tabs.
  // Undefined isCombined = "not part of this save" (the dispatch editor's
  // normal case now that the lot flag is CUS-owned); it must not be read as
  // a request to write `false` over a stored `true`.
  let shipmentVersion = shipment.version;
  // Accountant masking happens at the route gate (requireRoles excludes
  // ACCOUNTANT — same rule as the grid read at :386), so the type system
  // narrows actor to admin/manager/dispatcher here. Undefined note = "not
  // part of this save".
  const noteProvided = input.operationalNotes !== undefined;
  const nextNote = noteProvided ? (input.operationalNotes ?? '') : null;
  const notesChanged = noteProvided && nextNote !== (shipment.operationalNotes ?? '');
  const isCombinedChanged = input.isCombined !== undefined && shipment.isCombined !== input.isCombined;
  let storedNote = shipment.operationalNotes;
  let storedIsCombined = shipment.isCombined;
  if (isCombinedChanged || notesChanged) {
    const [updatedShipment] = await tx.update(s.shipments).set({
      ...(isCombinedChanged ? { isCombined: input.isCombined } : {}),
      ...(notesChanged ? { operationalNotes: nextNote } : {}),
      version: shipment.version + 1,
      updatedAt: new Date(),
    }).where(and(
      eq(s.shipments.id, shipment.id),
      eq(s.shipments.version, shipment.version),
    )).returning();
    if (!updatedShipment) throw new ApiError(409, 'Lô hàng đã thay đổi. Vui lòng tải lại.');
    shipmentVersion = updatedShipment.version;
    storedNote = updatedShipment.operationalNotes;
    storedIsCombined = updatedShipment.isCombined;
  }

  const lotFullyPlated = await recomputeLotFullyPlated(tx, shipment.id);

  const assignedDriverName = vehicle != null
    ? vehicle.assignedDriverName
    : input.carrierType === 'OWN' && updatedFulfillment.plannedVehiclePlateNumber
      ? (await loadPlannedDriverNames(tx, [updatedFulfillment.plannedVehiclePlateNumber]))
        .get(updatedFulfillment.plannedVehiclePlateNumber) ?? null
      : null;

  // Planning saves never notify the driver — dispatch-order issuance
  // (issueOrderCreateOrUpdate) owns the driver notification, so the driver
  // never sees or taps into a job that has no trips row yet.
  return {
    fulfillmentId: updatedFulfillment.id,
    fulfillmentVersion: updatedFulfillment.version,
    shipmentId: shipment.id,
    shipmentVersion,
    classification: updatedFulfillment.dispatchClassification,
    // Stored value, not the input: an omitted isCombined must echo back what
    // the lot actually holds so the grid keeps rendering its "Kết hợp" note.
    isCombined: storedIsCombined,
    // The route gate excludes ACCOUNTANT, so this is always the real note —
    // mirroring the grid read's non-accountant shape.
    operationalNotes: storedNote ?? null,
    dispatch: {
      carrierType: input.carrierType,
      carrierName,
      externalCarrierId: plannedExternalCarrierId,
      externalCarrierVehicleId: vehicle?.plannedExternalCarrierVehicleId ?? updatedFulfillment.plannedExternalCarrierVehicleId,
      assignedPlate: updatedFulfillment.plannedVehiclePlateNumber,
      assignedDriverName,
      // Plan saves only reach rows without a live trip (the per-row live-trip
      // guard keeps issued rows un-editable), so no acceptance can exist.
      driverAccepted: false,
    },
    estimates: {
      plannedRevenue: updatedFulfillment.plannedRevenue,
      plannedCarrierCost: updatedFulfillment.plannedCarrierCost,
    },
    // Stored value, not the input: an omitted save echoes what the row holds.
    plannedEndAt: toIsoOrNull(updatedFulfillment.plannedEndAt),
    lotFullyPlated,
    driverNotified: false,
    driverHint: vehicle?.driverHint ?? null,
  };
}


export async function recomputeLotFullyPlated(tx: Tx, shipmentId: number): Promise<boolean> {
  const [counts] = await tx.select({
    total: sql<number>`count(*)`,
    plated: sql<number>`count(*) filter (where ${s.shipmentFulfillments.plannedVehiclePlateNumber} is not null and ${s.shipmentFulfillments.plannedVehiclePlateNumber} <> '')`,
  }).from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.shipmentId, shipmentId),
      isNull(s.shipmentFulfillments.canceledAt),
    ));
  const total = Number(counts?.total ?? 0);
  const plated = Number(counts?.plated ?? 0);
  return total > 0 && plated === total;
}
