/**
 * dispatch-planning detail-plan ROW READS — row union, filters, facets, and the
 * display helpers every detail-plan surface renders with.
 * Structure-only split of dispatch-planning-detail-plan.service.ts (same LOC
 * budget law): READ side lives here, mutations stay in the write module. The
 * dependency is one-way (write imports loadPlannedDriverNames), never cyclic.
 */
import { CUSTOMER_OPERATIONAL_NAME, PORT_OPERATIONAL_NAME, ROUTE_OPERATIONAL_NAME, SITE_OPERATIONAL_NAME, DISPATCH_BUSINESS_TIME_ZONE, INTERNAL_FLEET_CARRIER_NAME, Tx, assertDispatchReadActor, buildPattern, dispatchDetailDataStatusSql, dispatchDetailTransportDateSql, loadDeclarationNumbers, normalizeDate, normalizeLimit, redactDispatchSiteForAccountant, requireAccountantDispatchScope, toFrozenSiteSummary, shipmentQSearchPredicate } from './dispatch-planning-utils.service';
import { DISPATCH_DETAIL_PLAN_CARRIER_TYPES } from './dispatch-planning-commands.service';
import { loadDispatchExpenseNotes } from './dispatch-expense-notes.service';
import { compareDetailPlanRows, countFulfillmentLessReadyRows, listFulfillmentLessReadyRows } from './dispatch-detail-plan-fulfillment-less';
import { listDetailPlanPageKeys, pageKeyPredicate } from './dispatch-detail-plan-page';
import { requireDispatchZone } from './dispatch-detail-plan-zones.service';
import { getActiveAssignmentsByTruckIds } from './truck-driver-assignment.service';
import { db } from '../db';
import { ApiError } from '../errors';
import { and, asc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { Role, TripStatus } from '@tingting/shared';
import * as s from '../db/schema';
import type { AuthUser } from '../middleware/auth';
/** Resolve planned OWN vehicle names in a batch; issued trips use their own
 * driver record below, never the truck's potentially newer roster. */
export async function loadPlannedDriverNames(tx: Tx, plates: string[]): Promise<Map<string, string>> {
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
  /** Card 20260927_61 (CHIEF rulings 27/09): assignment-scoped filters match
   *  the EFFECTIVE assignment only — the row's current planned plate; no
   *  reassignment history. */
  truckPlate?: string;
  /** Driver of the assigned OWN truck (active PRIMARY assignment). */
  driverId?: number;
  /** Đội xe: OWN = xe nhà, EXTERNAL = thầu ngoài (plannedCarrierType). */
  carrierClass?: 'OWN' | 'EXTERNAL';
  /** Assigned truck's trailer type (trucks.trailer_type). */
  trailerType?: string;
  /** Route of the LOT (FCL container→lot fallback), lot-first per ruling. */
  routeId?: number;
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

  // Card 20261008_3 — 'gán xe' on the fulfillment branch = a planned plate on
  // the row (OWN plate / carrier-vehicle plate / typed plate). Kept OUT of the
  // shared filter below so one grouped scan can count both chips' halves of
  // the union; pageKeys/rows still apply it through `rowFilters`.
  const assignmentPredicate = input.assignmentStatus === 'UNASSIGNED'
    ? sql`(${s.shipmentFulfillments.plannedVehiclePlateNumber} is null or ${s.shipmentFulfillments.plannedVehiclePlateNumber} = '')`
    : input.assignmentStatus === 'ASSIGNED'
      ? sql`(${s.shipmentFulfillments.plannedVehiclePlateNumber} is not null and ${s.shipmentFulfillments.plannedVehiclePlateNumber} <> '')`
      : undefined;

  return db.transaction(async (tx) => {
    // Shared filter so the rows page and the total count stay consistent
    // within one transaction. The assignment split (card 20261008_3) is NOT
    // part of it — `rowFilters` adds it for the page/rows selects while the
    // count split below reads both halves from these same conditions.
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
      input.customerId ? eq(s.shipments.customerId, input.customerId) : undefined,
      input.dataStatus ? dispatchDetailDataStatusSql(input.dataStatus) : undefined,
      // Card 20260927_61 advanced filters. Plate equality is the effective
      // assignment key (the editor stores the formatted plate on the row).
      input.truckPlate ? eq(s.shipmentFulfillments.plannedVehiclePlateNumber, input.truckPlate) : undefined,
      input.driverId ? sql`${s.shipmentFulfillments.plannedVehiclePlateNumber} in (
        select t.license_plate from ${s.trucks} t
        where exists (
          select 1 from ${s.truckDriverAssignments} a
          where a.truck_id = t.id and a.driver_id = ${input.driverId}
            and a.role = 'PRIMARY' and a.ends_at is null
        )
      )` : undefined,
      input.carrierClass ? eq(s.shipmentFulfillments.plannedCarrierType, input.carrierClass) : undefined,
      input.trailerType ? sql`exists (
        select 1 from ${s.trucks} t
        where t.license_plate = ${s.shipmentFulfillments.plannedVehiclePlateNumber}
          and t.trailer_type = ${input.trailerType}
      )` : undefined,
      // Lot-first route: same FCL container→lot fallback the row's Tuyến
      // cell renders, so a filter on the displayed route never lies.
      input.routeId ? sql`(case when ${s.shipmentFulfillments.cargoMode} = 'FCL'
        then coalesce(${s.shipmentContainers.routeId}, ${s.shipments.routeId})
        else ${s.shipments.routeId} end) = ${input.routeId}` : undefined,
      shipmentQSearchPredicate(qPattern, { containerNumber: true }),
    );

    // Card 20261008_7 — the topbar period must filter the điều phối branch
    // too. dateFrom/dateTo ride the SAME normalized values the fulfillment
    // branch filters on; the branch builder applies them to its own date
    // column (identical formula: container appointment date in
    // Asia/Ho_Chi_Minh, lot expectedDeliveryDate fallback, inclusive edges).
    // One shared builder feeds pageKeys + rows + count, so rows and
    // assignmentStatusCounts stay consistent by construction.
    const unionFilters = {
      q: input.q,
      date,
      dateFrom,
      dateTo,
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
      truckPlate: input.truckPlate ?? null,
      driverId: input.driverId ?? null,
      carrierClass: input.carrierClass ?? null,
      trailerType: input.trailerType ?? null,
      routeId: input.routeId ?? null,
    };
    const rowFilters = and(filters, assignmentPredicate);
    const pageKeys = await listDetailPlanPageKeys(tx, rowFilters, unionFilters, accountantCustomerIds, limit, (page - 1) * limit);
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
      .where(and(rowFilters, pageKeyPredicate(s.shipmentFulfillments.id, fulfillmentIds)))
      .orderBy(...dispatchDetailPriorityOrderSql()),
      // Card 20261008_3 — chip counts, same scan as the old total: one grouped
      // aggregate splits the fulfillment branch into both chips' halves.
      tx.select({
        unassigned: sql<number>`count(*) filter (where ${s.shipmentFulfillments.plannedVehiclePlateNumber} is null or ${s.shipmentFulfillments.plannedVehiclePlateNumber} = '')`,
        assigned: sql<number>`count(*) filter (where ${s.shipmentFulfillments.plannedVehiclePlateNumber} is not null and ${s.shipmentFulfillments.plannedVehiclePlateNumber} <> '')`,
      })
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
    // Every điều phối (fulfillment-less) row is inherently unassigned, so the
    // branch only ever contributes to the UNASSIGNED chip — counted with that
    // side of the split regardless of the request's own chip filter.
    const [unionRows, unionUnassignedCount] = await Promise.all([
      listFulfillmentLessReadyRows(tx, unionFilters, accountantCustomerIds, limit, 0, branchContainerIds),
      countFulfillmentLessReadyRows(tx, { ...unionFilters, assignmentStatus: 'UNASSIGNED' }, accountantCustomerIds),
    ]);
    const pageRows = [...rows, ...unionRows].sort(compareDetailPlanRows);
    const shipmentIds = pageRows.map((row) => row.shipmentId);
    // Card 20260928_162 criterion 3. Kế toán reads this board too: the route
    // admits ACCOUNTANT (dispatch-planning.routes.ts:165) and
    // assertDispatchReadActor lists it. The reason an uncharged Ops cost MUST
    // carry is exactly what they triage. Blanking the map here was an oversight
    // of the bulk patch a980c53c, not a redaction — this projection still carries
    // free text only, never an amount (file standing ruling), so opening it for
    // ACCOUNTANT does not widen what the role can see.
    const opsRecoveryNotes = await loadDispatchExpenseNotes(shipmentIds, tx);
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
      // Card 20261008_3 — chip counts over the UNION of both branches, full-set
      // under every other active filter. The two halves partition the row set
      // (planned plate set vs not), so their sum is the view's total.
      assignmentStatusCounts: {
        UNASSIGNED: Number(totals[0]?.unassigned ?? 0) + unionUnassignedCount,
        ASSIGNED: Number(totals[0]?.assigned ?? 0),
      },
      total: input.assignmentStatus === 'ASSIGNED'
        ? Number(totals[0]?.assigned ?? 0)
        : input.assignmentStatus === 'UNASSIGNED'
          ? Number(totals[0]?.unassigned ?? 0) + unionUnassignedCount
          : Number(totals[0]?.unassigned ?? 0) + Number(totals[0]?.assigned ?? 0) + unionUnassignedCount,
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

