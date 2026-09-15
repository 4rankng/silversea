
import { db } from '../db';
import * as s from '../db/schema';
import { operationalName } from '../db/master-data-name';
import { eq, ne, and, isNull, isNotNull, or, desc, asc, gte, lte, sql, inArray, aliasedTable } from 'drizzle-orm';
import { ApiError } from '../errors';
import { computeVehicleAlerts, DriverProgressEventType, TripStatus, type VehicleAlert } from '@tingting/shared';

import { listFuelEvidenceReviewsForTrip } from './fuel-evidence-review.service';
import { listTripContainers, listTripPhotoKeys } from './forwarder.service';
import { getTripInstructions } from './trip-instructions.service';
import { storageService } from './storage.service';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import { getActiveTruckIdForDriver } from './truck-driver-assignment.service';
import { getShipmentAccountingLockSummary } from './shipment-accounting-lock.service';
import { listDispatchTaskTags } from './dispatch-task-tags.service';
import { readSnapshotDeliverySiteName, resolveDeliveryStage } from './delivery-stage';
import type { Tx } from './trip-shared';
import {
  assertTripOwnedByDriver,
  getDriverCompletionEvidenceStatus,
  insertDriverProgressEventTx,
  isDriverFulfillmentMilestone,
  listPodSubmissionsForDriver,
  loadDriverProgressEventTx,
  loadOwnedFulfillmentTrip,
  projectSiteSnapshot,
  type DriverCompletionEvidenceStatus,
  type DriverProgressEvent,
} from './trip-pod.service';
import {
  listDriverFulfillmentProgress,
  recordDriverFulfillmentProgress,
} from './driver-fulfillment.service';
export { listDriverFulfillmentProgress, recordDriverFulfillmentProgress };

const CUSTOMER_OPERATIONAL_NAME = operationalName(s.customers.shortName, s.customers.name);
const ROUTE_OPERATIONAL_NAME = operationalName(s.routes.shortName, s.routes.name);

export { PAID_OR_ADVANCED_TXN_TYPES } from './driver-earnings.service';

/**
 * Resolve an auth-user ID to the corresponding driver record.
 * Extends `ApiError` so the global error handler honours the 404 instead
 * of falling through to the generic 500 branch (which previously leaked
 * the stack trace to the client and broke the driver portal UX).
 */
export class NoDriverProfileError extends ApiError {
  constructor() {
    super(404, 'Không tìm thấy thông tin lái xe');
    this.name = 'NoDriverProfileError';
  }
}

export async function getDriverByUserId(userId: number) {
  const [driver] = await db.select().from(s.drivers)
    .where(and(eq(s.drivers.userId, userId), isNull(s.drivers.deletedAt)))
    .limit(1);
  if (!driver) throw new NoDriverProfileError();
  return driver;
}

/** Resolve a driver profile that may safely receive an authenticated trip. */
export async function assertDispatchableDriverPrincipal(
  driverId: number,
  client: Tx | typeof db = db,
) {
  const [row] = await client.select({
    driver: s.drivers,
    userRole: s.users.role,
    userStatus: s.users.status,
    userDeletedAt: s.users.deletedAt,
  }).from(s.drivers)
    .leftJoin(s.users, eq(s.users.id, s.drivers.userId))
    .where(and(eq(s.drivers.id, driverId), isNull(s.drivers.deletedAt)))
    .limit(1);
  if (!row) throw new ApiError(404, 'Không tìm thấy tài xế.');
  if (row.driver.status !== 'ACTIVE'
    || row.driver.userId == null
    || row.userRole !== 'DRIVER'
    || row.userStatus !== 'ACTIVE'
    || row.userDeletedAt != null) {
    throw new ApiError(409, 'Tài xế chưa được liên kết với tài khoản DRIVER đang hoạt động.');
  }
  return row.driver;
}

async function existingStorageKeys(keys: string[]): Promise<string[]> {
  const checked = await Promise.all(keys.map(async key => {
    try {
      return await storageService.exists(key) ? key : null;
    } catch {
      return null;
    }
  }));
  return checked.filter((key): key is string => Boolean(key));
}

/**
 * List trips assigned to a driver (allowlisted fields for mobile portal).
 *
 * Includes the customer name (customers join, mirroring getDriverTripDetail)
 * and a comma-joined container-number list per trip. Containers are fetched in
 * ONE batched query (`WHERE tripId IN (...)`, grouped in memory) rather than
 * per-trip, so a driver with many trips stays O(1) queries, not O(N+1)
 * (feedback202606 B1 — driver list card must show customer + container).
 */
export async function getDriverTrips(driverId: number) {
  // Trips-split: fuel/road/salary read from the composed view.
  const trips = await db.select({
    id: s.tripsComposite.id,
    shipmentId: s.tripsComposite.shipmentId,
    fulfillmentId: s.tripsComposite.fulfillmentId,
    tripCode: s.tripsComposite.tripCode,
    departureDate: s.tripsComposite.departureDate,
    status: s.tripsComposite.status,
    fuelLiters: s.tripsComposite.fuelLiters,
    totalRoadAllowance: s.tripsComposite.totalRoadAllowance,
    driverSalary: s.tripsComposite.driverSalary,
    routeName: ROUTE_OPERATIONAL_NAME,
    truckPlate: s.trucks.licensePlate,
    customerName: CUSTOMER_OPERATIONAL_NAME,
  }).from(s.tripsComposite)
    .leftJoin(s.shipmentFulfillments, eq(s.tripsComposite.fulfillmentId, s.shipmentFulfillments.id))
    .leftJoin(s.routes, eq(s.tripsComposite.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.tripsComposite.truckId, s.trucks.id))
    .leftJoin(s.customers, eq(s.tripsComposite.customerId, s.customers.id))
    .where(and(
      eq(s.tripsComposite.driverId, driverId),
      isNull(s.tripsComposite.deletedAt),
      ne(s.tripsComposite.status, TripStatus.CANCELED),
      or(
        isNull(s.tripsComposite.fulfillmentId),
        and(
          isNotNull(s.shipmentFulfillments.id),
          isNull(s.shipmentFulfillments.canceledAt),
        ),
      ),
    ))
    .orderBy(desc(s.tripsComposite.departureDate));

  if (trips.length === 0) return trips;

  // Batched container fetch — single query for all trips on this list.
  const containersByTrip = await loadDriverTripContainers(trips.map(t => t.id));

  return trips.map(t => ({ ...t, containerNumbers: containersByTrip.get(t.id) ?? [] }));
}

// ─── M8.3: two-orders-per-day view ──────────────────────────────────────────
//
// PRD M08-03-03: a driver with two orders on the same day must see the active
// order and the next order distinctly — no mixing of documents or costs between
// them. This view groups today's trips into `{ active, next }` (active =
// IN_TRANSIT; next = earliest CREATED that isn't the active one) and surfaces
// an advisory `firstOrderLate` flag.
//
// Open question M8.3 §3 ("late threshold — minutes? GPS-based?") is status
// `pending`; the trips table has only `departureDate` (a DATE, no scheduled
// time) and no GPS ping to compare against. The safest backward-compatible
// interpretation: `firstOrderLate` is true when there are 2+ non-CANCELED
// trips today AND the earliest (by `createdAt`) is still CREATED — i.e. the
// day's first order has not started. Advisory only; never blocks. A
// GPS/time-based threshold is a follow-up once the schema carries scheduled
// times.

export interface DriverTripSummary {
  id: number;
  fulfillmentId: number | null;
  tripCode: string | null;
  departureDate: string;
  status: 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELED';
  fuelLiters: string | null;
  totalRoadAllowance: string | null;
  driverSalary: string | null;
  routeName: string | null;
  truckPlate: string | null;
  customerName: string | null;
  containerNumbers: string[];
}

export interface DriverTwoOrdersView {
  /** Today's date (YYYY-MM-DD, server-local). */
  date: string;
  /** The trip currently IN_TRANSIT today (at most one expected; if two,
   *  the earlier `createdAt` wins — a data-quality issue worth surfacing). */
  active: DriverTripSummary | null;
  /** The earliest CREATED trip today that is NOT the active one. */
  next: DriverTripSummary | null;
  /** Advisory: 2+ non-CANCELED trips today AND the earliest is still CREATED. */
  firstOrderLate: boolean;
  /** Every non-CANCELED trip today (for UI context / debugging). */
  allToday: DriverTripSummary[];
  /** Persisted ordered pair, including cross-day trips, when available. */
  pair: {
    pairId: number;
    status: 'ACTIVE' | 'BROKEN';
    breakReason: 'FIRST_TRIP_CANCELED' | 'SECOND_TRIP_CANCELED' | 'LATE_COMPLETION' | null;
    emptyDistanceKm: string | null;
    combinedEfficiencyPercent: string | null;
    requiredGapMinutes: number | null;
    actualGapMinutes: number | null;
    lateByMinutes: number | null;
    first: DriverTripSummary | null;
    second: DriverTripSummary | null;
  } | null;
}

type DriverPairBreakReason = NonNullable<NonNullable<DriverTwoOrdersView['pair']>['breakReason']>;

async function loadDriverTripContainers(tripIds: number[]): Promise<Map<number, string[]>> {
  const containersByTrip = new Map<number, string[]>();
  if (tripIds.length === 0) return containersByTrip;
  const containerRows = await db.select({
    tripId: s.tripContainers.tripId,
    containerNumber: s.tripContainers.containerNumber,
  }).from(s.tripContainers).where(inArray(s.tripContainers.tripId, tripIds));
  for (const c of containerRows) {
    if (!c.containerNumber) continue;
    const list = containersByTrip.get(c.tripId);
    if (list) list.push(c.containerNumber);
    else containersByTrip.set(c.tripId, [c.containerNumber]);
  }
  return containersByTrip;
}

function shapeDriverTripSummary(
  row: {
    id: number;
    fulfillmentId: number | null;
    tripCode: string | null;
    departureDate: string;
    status: string | null;
    fuelLiters: string | null;
    totalRoadAllowance: string | null;
    driverSalary: string | null;
    routeName: string | null;
    truckPlate: string | null;
    customerName: string | null;
  },
  containersByTrip: Map<number, string[]>,
): DriverTripSummary {
  return {
    id: row.id,
    fulfillmentId: row.fulfillmentId,
    tripCode: row.tripCode,
    departureDate: row.departureDate,
    status: (row.status ?? 'CREATED') as DriverTripSummary['status'],
    fuelLiters: row.fuelLiters,
    totalRoadAllowance: row.totalRoadAllowance,
    driverSalary: row.driverSalary,
    routeName: row.routeName,
    truckPlate: row.truckPlate,
    customerName: row.customerName,
    containerNumbers: containersByTrip.get(row.id) ?? [],
  };
}

/** Format a Date as YYYY-MM-DD in the server's local timezone. */
function todayYyyyMmDd(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Build the two-orders-per-day view for a driver. Reads today's trips only
 * (PRD M08-03-03); trips on other days are excluded. CANCELED trips are
 * excluded throughout. The view is read-only — it never mutates trip status.
 */
export async function getDriverTwoOrdersView(driverId: number): Promise<DriverTwoOrdersView> {
  const today = todayYyyyMmDd();
  const [activePairMembership] = await db.select({
    pairId: s.trips.activeTripPairId,
  }).from(s.trips)
    .where(and(
      eq(s.trips.driverId, driverId),
      isNull(s.trips.deletedAt),
      sql`${s.trips.activeTripPairId} is not null`,
    ))
    .orderBy(desc(s.trips.departureDate), desc(s.trips.id))
    .limit(1);

  if (activePairMembership?.pairId) {
    const [pair] = await db.select({
      id: s.tripPairs.id,
      status: s.tripPairs.status,
      breakReason: s.tripPairs.breakReason,
      emptyDistanceKm: s.tripPairs.emptyDistanceKm,
      combinedEfficiencyPercent: s.tripPairs.combinedEfficiencyPercent,
      requiredGapMinutes: s.tripPairs.requiredGapMinutes,
      actualGapMinutes: s.tripPairs.actualGapMinutes,
      lateByMinutes: s.tripPairs.lateByMinutes,
      firstTripId: s.tripPairs.firstTripId,
      secondTripId: s.tripPairs.secondTripId,
    }).from(s.tripPairs)
      .where(eq(s.tripPairs.id, activePairMembership.pairId))
      .limit(1);

    if (pair) {
      const pairRows = await db.select({
        id: s.tripsComposite.id,
        fulfillmentId: s.tripsComposite.fulfillmentId,
        tripCode: s.tripsComposite.tripCode,
        departureDate: s.tripsComposite.departureDate,
        status: s.tripsComposite.status,
        fuelLiters: s.tripsComposite.fuelLiters,
        totalRoadAllowance: s.tripsComposite.totalRoadAllowance,
        driverSalary: s.tripsComposite.driverSalary,
        routeName: ROUTE_OPERATIONAL_NAME,
        truckPlate: s.trucks.licensePlate,
        customerName: CUSTOMER_OPERATIONAL_NAME,
      }).from(s.tripsComposite)
        .leftJoin(s.routes, eq(s.tripsComposite.routeId, s.routes.id))
        .leftJoin(s.trucks, eq(s.tripsComposite.truckId, s.trucks.id))
        .leftJoin(s.customers, eq(s.tripsComposite.customerId, s.customers.id))
        .where(and(
          inArray(s.tripsComposite.id, [pair.firstTripId, pair.secondTripId]),
          isNull(s.tripsComposite.deletedAt),
        ))
        .orderBy(asc(s.tripsComposite.id));
      const containersByTrip = await loadDriverTripContainers(pairRows.map((row) => row.id));
      const pairTripById = new Map(pairRows.map((row) => [
        row.id,
        shapeDriverTripSummary(row, containersByTrip),
      ]));
      const first = pairTripById.get(pair.firstTripId) ?? null;
      const second = pairTripById.get(pair.secondTripId) ?? null;
      const orderedTrips = [first, second].filter((trip): trip is DriverTripSummary => Boolean(trip));
      const active = orderedTrips.find((trip) => trip.status === 'IN_TRANSIT') ?? null;
      const next = first?.status === 'CREATED'
        ? first
        : second?.status === 'CREATED'
          ? second
          : null;
      const firstOrderLate = first?.status === 'CREATED' && second != null;

      return {
        date: today,
        active,
        next,
        firstOrderLate,
        allToday: orderedTrips,
        pair: {
          pairId: pair.id,
          status: (pair.status === 'BROKEN' ? 'BROKEN' : 'ACTIVE'),
          breakReason: pair.breakReason as DriverPairBreakReason,
          emptyDistanceKm: pair.emptyDistanceKm,
          combinedEfficiencyPercent: pair.combinedEfficiencyPercent,
          requiredGapMinutes: pair.requiredGapMinutes,
          actualGapMinutes: pair.actualGapMinutes,
          lateByMinutes: pair.lateByMinutes,
          first,
          second,
        },
      };
    }
  }

  const rows = await db.select({
    id: s.tripsComposite.id,
    fulfillmentId: s.tripsComposite.fulfillmentId,
    tripCode: s.tripsComposite.tripCode,
    departureDate: s.tripsComposite.departureDate,
    status: s.tripsComposite.status,
    fuelLiters: s.tripsComposite.fuelLiters,
    totalRoadAllowance: s.tripsComposite.totalRoadAllowance,
    driverSalary: s.tripsComposite.driverSalary,
    routeName: ROUTE_OPERATIONAL_NAME,
    truckPlate: s.trucks.licensePlate,
    customerName: CUSTOMER_OPERATIONAL_NAME,
    createdAt: s.tripsComposite.createdAt,
  }).from(s.tripsComposite)
    .leftJoin(s.routes, eq(s.tripsComposite.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.tripsComposite.truckId, s.trucks.id))
    .leftJoin(s.customers, eq(s.tripsComposite.customerId, s.customers.id))
    .where(and(
      eq(s.tripsComposite.driverId, driverId),
      eq(s.tripsComposite.departureDate, today),
      isNull(s.tripsComposite.deletedAt),
      sql`${s.tripsComposite.status} <> 'CANCELED'`,
    ))
    .orderBy(asc(s.tripsComposite.createdAt));

  const containersByTrip = await loadDriverTripContainers(rows.map((row) => row.id));
  const allToday: DriverTripSummary[] = rows.map((row) => shapeDriverTripSummary(row, containersByTrip));

  // active = the IN_TRANSIT trip today (earliest createdAt if 2, data-quality guard).
  const inTransit = allToday.filter(t => t.status === 'IN_TRANSIT');
  inTransit.sort((a, b) => String(a.id) === String(b.id) ? 0 : (a.id - b.id));
  const active = inTransit[0] ?? null;

  // next = earliest CREATED trip today that is NOT the active one.
  const created = allToday.filter(t => t.status === 'CREATED' && (active === null || t.id !== active.id));
  const next = created[0] ?? null;

  // firstOrderLate = 2+ today AND the earliest (rows is already asc by createdAt)
  // is still CREATED — the day's first order hasn't started. Advisory only.
  const earliest = allToday[0] ?? null;
  const firstOrderLate = allToday.length >= 2 && earliest !== null && earliest.status === 'CREATED';

  return { date: today, active, next, firstOrderLate, allToday, pair: null };
}

/**
 * Get a single trip detail for a driver (ownership-enforced).
 */
export async function getDriverTripDetail(driverId: number, tripId: number) {
  const paperCollector = aliasedTable(s.users, 'driver_trip_paper_collector');
  const [trip] = await db.select({
    id: s.tripsComposite.id,
    shipmentId: s.tripsComposite.shipmentId,
    fulfillmentId: s.tripsComposite.fulfillmentId,
    tripCode: s.tripsComposite.tripCode,
    departureDate: s.tripsComposite.departureDate,
    plannedStartAt: s.tripsComposite.plannedStartAt,
    status: s.tripsComposite.status,
    fuelLiters: s.tripsComposite.fuelLiters,
    fuelMode: s.tripsComposite.fuelMode,
    totalRoadAllowance: s.tripsComposite.totalRoadAllowance,
    driverSalary: s.tripsComposite.driverSalary,
    hasReturnCargo: s.tripsComposite.hasReturnCargo,
    notes: s.tripsComposite.notes,
    costSubmissionNote: s.tripsComposite.costSubmissionNote,
    customerReference: s.tripsComposite.customerReference,
    routeName: ROUTE_OPERATIONAL_NAME,
    truckPlate: s.trucks.licensePlate,
    trailerId: s.tripsComposite.trailerId,
    trailerPlate: s.trailers.licensePlate,
    trailerType: s.tripsComposite.trailerType,
    customerName: CUSTOMER_OPERATIONAL_NAME,
    cargoTypeName: s.cargoTypes.name,
    fuelSupplierName: s.suppliers.name,
    paperOrderCollectedAt: s.tripsComposite.paperOrderCollectedAt,
    paperOrderCollectedBy: s.tripsComposite.paperOrderCollectedBy,
    paperOrderCollectedByName: paperCollector.fullName,
  }).from(s.tripsComposite)
    .leftJoin(s.routes, eq(s.tripsComposite.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.tripsComposite.truckId, s.trucks.id))
    .leftJoin(s.trailers, eq(s.tripsComposite.trailerId, s.trailers.id))
    .leftJoin(s.customers, eq(s.tripsComposite.customerId, s.customers.id))
    .leftJoin(s.cargoTypes, eq(s.tripsComposite.cargoTypeId, s.cargoTypes.id))
    .leftJoin(s.suppliers, eq(s.tripsComposite.fuelSupplierId, s.suppliers.id))
    .leftJoin(paperCollector, eq(paperCollector.id, s.tripsComposite.paperOrderCollectedBy))
    .where(and(eq(s.tripsComposite.id, tripId), eq(s.tripsComposite.driverId, driverId), isNull(s.tripsComposite.deletedAt)))
    .limit(1);

  if (!trip) return null;

  const legs = await db.select().from(s.tripLegs)
    .where(eq(s.tripLegs.tripId, tripId))
    .orderBy(s.tripLegs.sequence);

  // Include containers so the driver can review/confirm container & seal numbers
  // (populated by the OCR flow).
  const containers = await listTripContainers(tripId);

  // Latest uploaded photo per type for this trip — shown as thumbnails on the
  // driver detail page once a container has been saved. Also fetch the full
  // list (newest first) so the driver UI can surface every captured photo,
  // not just the latest. Singular fields kept for back-compat with the
  // existing driver app build; contPhotoKeys[0] === contPhotoKey.
  const [contPhotoKeysRaw, sealPhotoKeysRaw, instructions, fuelEvidenceReviews, accountingLock] = await Promise.all([
    listTripPhotoKeys(tripId, 'CONTAINER'),
    listTripPhotoKeys(tripId, 'SEAL'),
    getTripInstructions(tripId),
    listFuelEvidenceReviewsForTrip(tripId),
    trip.shipmentId == null ? Promise.resolve(null) : getShipmentAccountingLockSummary(trip.shipmentId),
  ]);
  const [contPhotoKeys, sealPhotoKeys] = await Promise.all([
    existingStorageKeys(contPhotoKeysRaw),
    existingStorageKeys(sealPhotoKeysRaw),
  ]);
  const contPhotoKey = contPhotoKeys[0] ?? null;
  const sealPhotoKey = sealPhotoKeys[0] ?? null;

  return {
    ...trip,
    legs,
    containers,
    contPhotoKey,
    sealPhotoKey,
    contPhotoKeys,
    sealPhotoKeys,
    instructions,
    fuelEvidenceReviews,
    accountingLock,
  };
}

export interface DriverFulfillmentInvoiceInfo {
  liftFeeInvoiceName: string | null;
  liftFeeInvoiceAddress: string | null;
  liftFeeTaxCode: string | null;
  dropFeeInvoiceName: string | null;
  dropFeeInvoiceAddress: string | null;
  dropFeeTaxCode: string | null;
  cleaningInvoiceName: string | null;
  cleaningInvoiceAddress: string | null;
  cleaningTaxCode: string | null;
}

/** Factory's own invoice identity: the container factory site's fee-invoice
 *  profile with precedence lift → drop → cleaning (the only site-level
 *  invoice fields that exist). Null when the site is unconfigured — the FE
 *  renders an honest empty state instead of falling back to the customer. */
export function factoryInvoiceProfile(row: {
  liftFeeInvoiceName: string | null;
  liftFeeInvoiceAddress: string | null;
  liftFeeTaxCode: string | null;
  dropFeeInvoiceName: string | null;
  dropFeeInvoiceAddress: string | null;
  dropFeeTaxCode: string | null;
  cleaningInvoiceName: string | null;
  cleaningInvoiceAddress: string | null;
  cleaningTaxCode: string | null;
}): { name: string | null; address: string | null; taxCode: string | null } | null {
  return [
    { name: row.liftFeeInvoiceName, address: row.liftFeeInvoiceAddress, taxCode: row.liftFeeTaxCode },
    { name: row.dropFeeInvoiceName, address: row.dropFeeInvoiceAddress, taxCode: row.dropFeeTaxCode },
    { name: row.cleaningInvoiceName, address: row.cleaningInvoiceAddress, taxCode: row.cleaningTaxCode },
  ].map((profile) => ({
    name: profile.name?.trim() || null,
    address: profile.address?.trim() || null,
    taxCode: profile.taxCode?.trim() || null,
  })).find((profile) => profile.name || profile.address || profile.taxCode) ?? null;
}

export interface DriverFulfillmentDetail {
  fulfillmentId: number;
  shipmentId: number;
  shipmentCode: string | null;
  bookingRef: string | null;
  cargoMode: typeof s.shipments.$inferSelect.cargoMode;
  /** IMPORT (trả hàng) vs EXPORT (đóng hàng) — branches the driver-side
   *  container-photo OCR behavior (cross-check vs auto-fill; spec A6). */
  tradeDirection: typeof s.shipments.$inferSelect.tradeDirection;
  fulfillmentType: typeof s.shipmentFulfillments.$inferSelect.fulfillmentType;
  tripId: number;
  tripVersion: number;
  factoryName: string | null;
  factoryShortName: string | null;
  /** Canonical full site name for the driver's full-name row: the container
   *  factory join wins over the shipment's free-text factory name, which can
   *  hold stale or abbreviated values. */
  factoryFullName: string | null;
  /** Factory site street address (own "Địa chỉ nhà máy" row on the driver grid). */
  factoryAddress: string | null;
  /** Legacy site phone; the UI uses one combined named contact row. */
  khoPhone: string | null;
  /** TC-DA-005: shipment customer master-data invoice block (hidden when all null). */
  invoiceMaster: { taxCode: string | null; companyName: string | null; address: string | null } | null;
  /** Factory's own invoice identity for the trip — explicit party attribution
   *  in the driver invoice section; null when the factory site carries no
   *  invoice configuration (FE renders an honest empty state, never a
   *  customer fallback). */
  invoiceFactory: { name: string | null; address: string | null; taxCode: string | null } | null;
  /** TC-DA-001: canonical tag pool; FE resolves chips with lib/dispatchTaskTags parseNote. */
  knownTagLabels: string[];
  shippingLineName: string | null;
  expectedDeliveryDate: string | null;
  customsCutoffAt: string | null;
  closingAt: string | null;
  plannedReturnAt: string | null;
  pickupLocation: string | null;
  deliveryLocation: string | null;
  /** Canonical container dropoff port for IMPORT, including same-place delivery;
   *  for other directions only a distinct return stage is exposed. */
  returnDepotName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  driverNotes: string | null;
  siteSnapshot: Record<string, unknown>;
  invoiceInfo: DriverFulfillmentInvoiceInfo | null;
  containerSealPhotos: Array<{ id: number; type: 'CONTAINER' | 'SEAL' | 'DELIVERY_NOTE'; storageKey: string; uploadedAt: string }>;
  evidenceStatus: DriverCompletionEvidenceStatus;
  milestones: DriverProgressEvent[];
  podSubmissions: Awaited<ReturnType<typeof listPodSubmissionsForDriver>>;
  trip: Awaited<ReturnType<typeof getDriverTripDetail>>;
}

export async function getDriverFulfillmentDetail(
  driverId: number,
  fulfillmentId: number,
): Promise<DriverFulfillmentDetail> {
  const ownedTrip = await loadOwnedFulfillmentTrip(db, fulfillmentId, driverId);
  const trip = await getDriverTripDetail(driverId, ownedTrip.tripId);
  if (!trip) {
    throw new ApiError(404, 'Không tìm thấy tác vụ được giao.');
  }

  // Container-authority fallbacks: CUS maintains the per-container ports and
  // factory; they fill the driver's "Điểm lấy / Điểm trả / Nhà máy" facts
  // when neither the shipment text columns nor the legacy snapshot half
  // carries a name (FCL rows decomposed before snapshot sync).
  const pickupPort = aliasedTable(s.ports, 'driver_pickup_port');
  const dropoffPort = aliasedTable(s.ports, 'driver_dropoff_port');
  const containerFactory = aliasedTable(s.operationalSites, 'driver_container_factory');
  const [shipmentRow] = await db.select({
    shipmentId: s.shipments.id,
    shipmentCode: s.shipments.shipmentCode,
    bookingRef: s.shipments.bookingRef,
    cargoMode: s.shipments.cargoMode,
    tradeDirection: s.shipments.tradeDirection,
    fulfillmentType: s.shipmentFulfillments.fulfillmentType,
    factoryName: s.shipments.factoryName,
    shippingLineName: s.shipments.shippingLineName,
    expectedDeliveryDate: s.shipments.expectedDeliveryDate,
    customsCutoffAt: s.shipments.customsCutoffAt,
    closingAt: s.shipments.closingAt,
    plannedReturnAt: s.shipments.plannedReturnAt,
    pickupLocation: s.shipments.pickupLocation,
    deliveryLocation: s.shipments.deliveryLocation,
    contactName: s.shipments.contactName,
    contactPhone: s.shipments.contactPhone,
    driverNotes: s.shipments.operationalNotes,
    siteSnapshot: s.shipmentFulfillments.siteSnapshot,
    siteContactName: containerFactory.contactName,
    siteContactPhone: containerFactory.contactPhone,
    containerFactoryAddress: containerFactory.address,
    customerTaxCode: s.customers.taxCode,
    customerCompanyName: s.customers.name,
    customerAddress: s.customers.address,
    containerPickupPortName: pickupPort.name,
    containerDropoffPortName: dropoffPort.name,
    containerFactoryName: containerFactory.name,
    // Blank-safe: short_name is notNull defaulting to '', so resolve the
    // display label in SQL (short → full) instead of an in-code ?? that
    // never fires on unfilled rows.
    containerFactoryShortName: operationalName(containerFactory.shortName, containerFactory.name),
    liftFeeInvoiceName: containerFactory.liftFeeInvoiceName,
    liftFeeInvoiceAddress: containerFactory.liftFeeInvoiceAddress,
    liftFeeTaxCode: containerFactory.liftFeeTaxCode,
    dropFeeInvoiceName: containerFactory.dropFeeInvoiceName,
    dropFeeInvoiceAddress: containerFactory.dropFeeInvoiceAddress,
    dropFeeTaxCode: containerFactory.dropFeeTaxCode,
    cleaningInvoiceName: containerFactory.cleaningInvoiceName,
    cleaningInvoiceAddress: containerFactory.cleaningInvoiceAddress,
    cleaningTaxCode: containerFactory.cleaningTaxCode,
  }).from(s.shipmentFulfillments)
    .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
    .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
    .leftJoin(s.shipmentContainers, eq(s.shipmentContainers.id, s.shipmentFulfillments.shipmentContainerId))
    .leftJoin(pickupPort, eq(pickupPort.id, s.shipmentContainers.pickupPortId))
    .leftJoin(dropoffPort, eq(dropoffPort.id, s.shipmentContainers.dropoffPortId))
    .leftJoin(containerFactory, eq(containerFactory.id, s.shipmentContainers.operationalSiteId))
    .where(eq(s.shipmentFulfillments.id, fulfillmentId))
    .limit(1);

  if (!shipmentRow) {
    throw new ApiError(404, 'Không tìm thấy tác vụ được giao.');
  }

  const [evidenceStatus, milestones, podSubmissions, containerSealPhotoRows, tagPool] = await Promise.all([
    getDriverCompletionEvidenceStatus(ownedTrip.tripId),
    listDriverFulfillmentProgress(fulfillmentId, driverId),
    listPodSubmissionsForDriver(driverId, fulfillmentId),
    db.select({
      id: s.tripPhotos.id,
      type: s.tripPhotos.type,
      storageKey: s.tripPhotos.storageKey,
      uploadedAt: s.tripPhotos.uploadedAt,
    }).from(s.tripPhotos)
      // 40f3ae15: DELIVERY_NOTE rides the wire too — the driver's biên bản
      // giao hàng photo is stored as its own trip_photos type.
      .where(and(eq(s.tripPhotos.tripId, ownedTrip.tripId), inArray(s.tripPhotos.type, ['CONTAINER', 'SEAL', 'DELIVERY_NOTE'])))
      .orderBy(desc(s.tripPhotos.uploadedAt)),
    // TC-DA-001: same pool embed the journey-board response carries (320aad6b
    // contract) — the FE resolves chips with lib/dispatchTaskTags parseNote.
    listDispatchTaskTags().then((tags) => tags.items.map((tag) => tag.label)),
  ]);
  const containerSealPhotos = containerSealPhotoRows.map((row) => ({
    id: row.id,
    type: row.type as 'CONTAINER' | 'SEAL' | 'DELIVERY_NOTE',
    storageKey: row.storageKey,
    uploadedAt: row.uploadedAt.toISOString(),
  }));

  const siteSnapshot = projectSiteSnapshot(shipmentRow.siteSnapshot ?? {});
  // The driver portal shows the trip's pickup / drop / factory in three
  // dedicated facts. Top-level shipment columns (`pickupLocation`,
  // `deliveryLocation`, `factoryName`) are not always populated for every
  // fulfillment type, but the snapshot always carries the human-readable
  // site names that CUS selected when creating the shipment. Fall back to
  // those so the driver never sees an em-dash for a real, known location.
  const pickupWarehouseName = typeof siteSnapshot.pickupWarehouse === 'object'
    && siteSnapshot.pickupWarehouse !== null
    && typeof (siteSnapshot.pickupWarehouse as { name?: unknown }).name === 'string'
    ? (siteSnapshot.pickupWarehouse as { name: string }).name
    : null;
  const deliverySiteName = readSnapshotDeliverySiteName(siteSnapshot);
  // Khối 3 (spec): the yard/factory contact person belongs on the driver's
  // task screen. Same snapshot-vs-live precedence as the site names above:
  // CUS-typed shipment contact → point-in-time snapshot contact → live site.
  const snapshotContact = (site: unknown): { name: string | null; phone: string | null } => {
    if (typeof site !== 'object' || site === null) return { name: null, phone: null };
    const record = site as { contactName?: unknown; contactPhone?: unknown };
    const name = typeof record.contactName === 'string' && record.contactName.trim()
      ? record.contactName.trim()
      : null;
    const phone = typeof record.contactPhone === 'string' && record.contactPhone.trim()
      ? record.contactPhone.trim()
      : null;
    return { name, phone };
  };
  const deliverySiteContact = (() => {
    const fromDelivery = snapshotContact(siteSnapshot.deliverySite);
    if (fromDelivery.name || fromDelivery.phone) return fromDelivery;
    return snapshotContact(siteSnapshot.pickupWarehouse);
  })();
  // One delivery-stage chain shared with the journey-board card and the CUS
  // ledger cell (delivery-stage.ts) — the FE renders this output as-is, and
  // stage 2 surfaces the empty-container return depot when it differs.
  const deliveryStage = resolveDeliveryStage(
    deliverySiteName,
    shipmentRow.deliveryLocation,
    shipmentRow.containerDropoffPortName,
  );
  return {
    fulfillmentId,
    shipmentId: shipmentRow.shipmentId,
    shipmentCode: shipmentRow.shipmentCode,
    bookingRef: shipmentRow.bookingRef,
    cargoMode: shipmentRow.cargoMode,
    tradeDirection: shipmentRow.tradeDirection,
    fulfillmentType: shipmentRow.fulfillmentType,
    tripId: ownedTrip.tripId,
    tripVersion: ownedTrip.tripVersion,
    factoryName: shipmentRow.factoryName ?? deliverySiteName ?? shipmentRow.containerFactoryName,
    factoryShortName: shipmentRow.containerFactoryShortName ?? shipmentRow.factoryName ?? deliverySiteName,
    // Canonical site name first: the shipment free-text factoryName can be a
    // stale or abbreviated value, so the full-name row reads the container
    // factory join before falling back to the free-text/snapshot names.
    factoryFullName: shipmentRow.containerFactoryName ?? shipmentRow.factoryName ?? deliverySiteName ?? null,
    // TC-DA-002: street address of the container's factory/kho site (Tuyến row
    // on the driver screen). Null-safe: the site join is left.
    factoryAddress: shipmentRow.containerFactoryAddress ?? null,
    // Kho site phone — the FE warehouse-phone row always renders (tel link or "—").
    khoPhone: shipmentRow.siteContactPhone ?? null,
    shippingLineName: shipmentRow.shippingLineName,
    expectedDeliveryDate: shipmentRow.expectedDeliveryDate,
    customsCutoffAt: shipmentRow.customsCutoffAt?.toISOString() ?? null,
    closingAt: shipmentRow.closingAt?.toISOString() ?? null,
    plannedReturnAt: shipmentRow.plannedReturnAt?.toISOString() ?? null,
    pickupLocation: shipmentRow.pickupLocation ?? pickupWarehouseName ?? shipmentRow.containerPickupPortName,
    deliveryLocation: deliveryStage.deliveryName,
    returnDepotName: shipmentRow.tradeDirection === 'IMPORT'
      ? (shipmentRow.containerDropoffPortName?.trim() || null)
      : deliveryStage.returnDepotName,
    contactName: (shipmentRow.contactName?.trim() || null)
      ?? deliverySiteContact.name
      ?? (shipmentRow.siteContactName?.trim() || null)
      ?? null,
    contactPhone: (shipmentRow.contactPhone?.trim() || null)
      ?? deliverySiteContact.phone
      ?? (shipmentRow.siteContactPhone?.trim() || null)
      ?? null,
    driverNotes: shipmentRow.driverNotes ?? null,
    siteSnapshot,
    invoiceInfo: [
      shipmentRow.liftFeeInvoiceName, shipmentRow.liftFeeInvoiceAddress, shipmentRow.liftFeeTaxCode,
      shipmentRow.dropFeeInvoiceName, shipmentRow.dropFeeInvoiceAddress, shipmentRow.dropFeeTaxCode,
      shipmentRow.cleaningInvoiceName, shipmentRow.cleaningInvoiceAddress, shipmentRow.cleaningTaxCode,
    ].some((value) => Boolean(value?.trim())) ? {
      liftFeeInvoiceName: shipmentRow.liftFeeInvoiceName,
      liftFeeInvoiceAddress: shipmentRow.liftFeeInvoiceAddress,
      liftFeeTaxCode: shipmentRow.liftFeeTaxCode,
      dropFeeInvoiceName: shipmentRow.dropFeeInvoiceName,
      dropFeeInvoiceAddress: shipmentRow.dropFeeInvoiceAddress,
      dropFeeTaxCode: shipmentRow.dropFeeTaxCode,
      cleaningInvoiceName: shipmentRow.cleaningInvoiceName,
      cleaningInvoiceAddress: shipmentRow.cleaningInvoiceAddress,
      cleaningTaxCode: shipmentRow.cleaningTaxCode,
    } : null,
    containerSealPhotos,
    evidenceStatus,
    milestones,
    podSubmissions,
    trip,
    // TC-DA-005: shipment customer master-data invoice block; FE hides the
    // block when every member is null (graceful hide per spec).
    invoiceMaster: Boolean(shipmentRow.customerCompanyName?.trim() || shipmentRow.customerTaxCode?.trim() || shipmentRow.customerAddress?.trim())
      ? {
        taxCode: shipmentRow.customerTaxCode,
        companyName: shipmentRow.customerCompanyName,
        address: shipmentRow.customerAddress,
      }
      : null,
    invoiceFactory: factoryInvoiceProfile(shipmentRow),
    // TC-DA-001: canonical tag pool for the FE parseNote resolution.
    knownTagLabels: tagPool,
  };
}

/**
 * Earnings summary for a driver: base salary + trip income - penalties.
 * Requires month/year — uses the attendance/salary computation logic.
 */
export { getDriverEarnings } from './driver-earnings.service';

/**
 * Which truck is "the driver's xe" for driver-facing reads: the truck on
 * their most-recent non-deleted, non-canceled trip (so a driver reassigned
 * mid-period sees the truck they actually drove last), falling back to the
 * active truck_driver_assignments row (the 1-truck-1-driver rule).
 * `null` = none resolvable.
 */
async function resolveDriverTruckId(driverId: number): Promise<number | null> {
  // Exclude CANCELED trips — a canceled trip was never driven, so its truck
  // shouldn't shadow the truck the driver actually last used (a later-dated
  // canceled trip would otherwise win on departureDate).
  const [recent] = await db.select({ truckId: s.trips.truckId })
    .from(s.trips)
    .where(and(eq(s.trips.driverId, driverId), isNull(s.trips.deletedAt), ne(s.trips.status, 'CANCELED')))
    .orderBy(desc(s.trips.departureDate))
    .limit(1);
  return recent?.truckId ?? getActiveTruckIdForDriver(db, driverId);
}

/**
 * The driver's current vehicle, shown as an identity chip in the driver-app
 * topbar (biển số xe next to the driver's name). Shares the truck resolution
 * with the vehicle-alerts read so the header and the reminders always agree
 * on which truck is "the driver's xe".
 */
export async function getDriverVehicle(driverId: number): Promise<{ truckPlate: string | null }> {
  const truckId = await resolveDriverTruckId(driverId);
  if (!truckId) return { truckPlate: null };

  const [truck] = await db.select({ licensePlate: s.trucks.licensePlate })
    .from(s.trucks)
    .where(and(eq(s.trucks.id, truckId), isNull(s.trucks.deletedAt)))
    .limit(1);
  return { truckPlate: truck?.licensePlate ?? null };
}

/**
 * N5 / B4 — vehicle compliance/service reminders for a driver.
 *
 * Resolves the driver's truck via resolveDriverTruckId (shared with the
 * topbar vehicle read).
 * Returns only overdue/due alerts (the helper already filters out 'ok').
 *
 * Returns `null` when no truck is resolvable; the route maps that to an empty
 * alerts list (no reminders to show) rather than 404.
 */
export async function getDriverVehicleAlerts(driverId: number): Promise<VehicleAlert[] | null> {
  const truckId = await resolveDriverTruckId(driverId);
  if (!truckId) return null;

  const [truck] = await db.select({
    nextInspectionDate: s.trucks.nextInspectionDate,
    insuranceExpiryDate: s.trucks.insuranceExpiryDate,
    lastOilServiceDate: s.trucks.lastOilServiceDate,
  }).from(s.trucks)
    .where(and(eq(s.trucks.id, truckId), isNull(s.trucks.deletedAt)))
    .limit(1);

  if (!truck) return null;

  return computeVehicleAlerts({
    nextInspectionDate: truck.nextInspectionDate,
    insuranceExpiryDate: truck.insuranceExpiryDate,
    lastOilServiceDate: truck.lastOilServiceDate,
  });
}

/**
 * List penalties for a driver, optionally scoped to a date range.
 */
export async function getDriverPenalties(driverId: number, dateFrom?: string, dateTo?: string) {
  // Same policy as payroll (attendance.service): CANCELED records are audit
  // history and must never read as deductions on the driver's own page.
  const conditions = [eq(s.penalties.driverId, driverId), isNull(s.penalties.deletedAt), ne(s.penalties.status, 'CANCELED')];
  if (dateFrom) conditions.push(gte(s.penalties.date, dateFrom));
  if (dateTo) conditions.push(lte(s.penalties.date, dateTo));

  return db.select({
    id: s.penalties.id,
    amount: s.penalties.amount,
    date: s.penalties.date,
    status: s.penalties.status,
    customReason: s.penalties.customReason,
    reasonText: s.penaltyReasons.reasonText,
    tripId: s.penalties.tripId,
    tripCode: s.trips.tripCode,
  }).from(s.penalties)
    .leftJoin(s.penaltyReasons, eq(s.penalties.reasonId, s.penaltyReasons.id))
    .leftJoin(s.trips, eq(s.penalties.tripId, s.trips.id))
    .where(and(...conditions))
    .orderBy(desc(s.penalties.date));
}

// ─── M8.4: driver progress events ───────────────────────────────────────────
//
// Append-only log of driver-reported milestones (DEPARTED, ARRIVED, FUELED,
// INCIDENT, NOTE) against a trip. PRD M08-04-03: the create path is
// server-side idempotent (reuses `runIdempotent` + the `idempotency_keys`
// table from M10.1) so the offline-queue replay (slice 2 frontend) does not
// duplicate events. These events are audit-style records only — they do NOT
// mutate trip status; lifecycle transitions stay with `transitionTripStatus`.

/**
 * Update the 27.8 cost-section Ghi chú on a trip. Distinct from the per-line
 * `driver_incidental_costs.note` (which explains an individual entry) and from
 * `shipments.operationalNotes` (which is cus/dispatcher→driver rule copy).
 * The driver writes this when the auto-recorded cost (Tiền đường) is wrong so
 * kế toán can re-check. Empty/whitespace-only input is stored as NULL.
 */
export async function updateDriverTripCostSubmissionNote(
  tripId: number,
  driverId: number,
  note: string | null,
): Promise<{ tripId: number; costSubmissionNote: string | null }> {
  await assertTripOwnedByDriver(tripId, driverId);
  const cleaned = note?.trim() ? note.trim() : null;
  const [row] = await db.update(s.trips)
    .set({ costSubmissionNote: cleaned })
    .where(and(eq(s.trips.id, tripId), eq(s.trips.driverId, driverId), isNull(s.trips.deletedAt)))
    .returning({ id: s.trips.id, costSubmissionNote: s.trips.costSubmissionNote });
  if (!row) throw new ApiError(404, 'Không tìm thấy chuyến được giao.');
  return { tripId: row.id, costSubmissionNote: row.costSubmissionNote };
}

/**
 * Record a driver progress event. Server-side idempotent: a replay with the
 * same `idempotencyKey` + same payload returns the original event (201 first,
 * 200 replay); the same key with a different payload is rejected 409 (Q23).
 * `replayed` is true on a replay so the route can set the right status code.
 */
export async function recordDriverProgress(
  tripId: number,
  driverId: number,
  input: { eventType: DriverProgressEventType; occurredAt: string; note?: string },
  recordedBy: number,
  idempotencyKey: string | undefined,
): Promise<{ event: DriverProgressEvent; replayed: boolean }> {
  await assertTripOwnedByDriver(tripId, driverId);

  if (isDriverFulfillmentMilestone(input.eventType)) {
    const [trip] = await db.select({ fulfillmentId: s.trips.fulfillmentId })
      .from(s.trips)
      .where(and(eq(s.trips.id, tripId), eq(s.trips.driverId, driverId), isNull(s.trips.deletedAt)))
      .limit(1);
    if (!trip?.fulfillmentId) {
      throw new ApiError(409, 'Chuyến cũ chưa có tác vụ giao nhận; không thể ghi mốc vận hành theo lộ trình mới.');
    }
    return recordDriverFulfillmentProgress({
      fulfillmentId: trip.fulfillmentId,
      driverId,
      input,
      recordedBy,
      idempotencyKey,
    });
  }

  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_PROGRESS,
    idempotencyKey,
    payload: { tripId, driverId, ...input },
    createdBy: recordedBy,
    entityType: 'driver_progress_event',
    create: async (tx) => insertDriverProgressEventTx(tx, tripId, driverId, input, recordedBy),
    load: async (id, tx) => loadDriverProgressEventTx(tx, id),
  });
  return { event: result, replayed };
}

/** List a trip's progress events, oldest-first (timeline order). */
export async function listDriverProgress(tripId: number, driverId: number): Promise<DriverProgressEvent[]> {
  await assertTripOwnedByDriver(tripId, driverId);
  const rows = await db.select().from(s.driverProgressEvents)
    .where(eq(s.driverProgressEvents.tripId, tripId))
    .orderBy(asc(s.driverProgressEvents.occurredAt));
  return rows as DriverProgressEvent[];
}

// M8.6 payslip periods moved to driver-payslip.service.ts (LOC budget).
// Re-export keeps routes/ and tests importing from this module unchanged.
export { getDriverPayslipPeriods } from './driver-payslip.service';
export type { DriverPayslipPeriod } from './driver-payslip.service';

// ─── Compatibility re-exports ─────────────────────────────────────────────────
// Fulfillment write path moved to driver-fulfillment.service (LOC budget,
// 2026-09-01); shared progress-event/milestone helpers moved to
// trip-pod.service. This barrel keeps routes/ and tests importing from
// driver.service unchanged. Do not `export *` — the material-write registry
// scanner resolves named exports.
export {
  completeOwnedFulfillmentTrip,
  getCompletionEvidenceStatus,
  listIncidentalCosts,
  recordIncidentalCost,
  syncDriverFulfillmentStartSideEffects,
  type CompletionEvidenceStatus,
  type DriverFulfillmentCompletionResult,
  type DriverIncidentalCost,
} from './driver-fulfillment.service';
export { assertTripOwnedByDriver } from './trip-pod.service';
export type { DriverProgressEvent } from './trip-pod.service';
