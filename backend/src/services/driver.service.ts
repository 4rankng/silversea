import { db } from '../db';
import * as s from '../db/schema';
import { operationalName } from '../db/master-data-name';
import { eq, ne, and, isNull, isNotNull, or, desc, asc, gte, lte, sql, inArray, aliasedTable } from 'drizzle-orm';
import { ApiError } from '../errors';
import {
  computeVehicleAlerts,
  DRIVER_FULFILLMENT_PROGRESS_SEQUENCE,
  DRIVER_PROGRESS_EVENT_LABELS,
  DriverProgressEventType,
  Role,
  round2dp,
  TripStatus,
  TxnType,
  type DriverIncidentalCostType,
  type VehicleAlert,
} from '@tingting/shared';

import { computeSalary } from './attendance.service';
import { listFuelEvidenceReviewsForTrip } from './fuel-evidence-review.service';
import { LedgerService } from './ledger.service';
import { listTripContainers, listTripPhotoKeys } from './forwarder.service';
import { getTripInstructions } from './trip-instructions.service';
import { storageService } from './storage.service';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import { getActiveTruckIdForDriver } from './truck-driver-assignment.service';
import { assertTripShipmentAccountingUnlocked, getShipmentAccountingLockSummary } from './shipment-accounting-lock.service';
import type { Tx } from './trip-shared';
import { transitionTripStatus } from './trip-status-machine.service';
import { syncAttendanceAfterStatusChange } from './trip-attendance-sync.service';
import { cacheInvalidate, cacheInvalidatePattern } from '../lib/redis';
import { createCustomerVisibleEvent } from './shipment-coordination.service';
import {
  getDriverCompletionEvidenceStatus,
  listOrderedMilestoneTypesTx,
  listPodSubmissionsForDriver,
  loadOwnedFulfillmentTrip,
  projectSiteSnapshot,
  type DriverCompletionEvidenceStatus,
} from './trip-pod.service';

const CUSTOMER_OPERATIONAL_NAME = operationalName(s.customers.shortName, s.customers.name);
const ROUTE_OPERATIONAL_NAME = operationalName(s.routes.shortName, s.routes.name);

/**
 * Ledger txn types that count as cash the company has actually paid out / advanced
 * to a driver in a period ("Đã thanh toán / đã tạm ứng").
 *
 * Allow-list, not a blacklist: only DRIVER_PAYOUT represents cash leaving the
 * company on the DRIVER ledger. PENALTY is a non-cash deduction (shown separately
 * as "Khấu trừ kỷ luật") — including it here double-counted and overstated cash
 * paid. ADJUSTMENT on the DRIVER ledger is a reconciliation credit, never a cash
 * debit. UNLOCK_REVERSAL reverses a DRIVER_SALARY credit and is excluded.
 *
 * Exported so the SQL filter and the regression test reference one source of
 * truth (driver-earnings-paid-or-advanced.test.ts).
 */
export const PAID_OR_ADVANCED_TXN_TYPES: readonly TxnType[] = [
  TxnType.DRIVER_PAYOUT,
] as const;

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
  const trips = await db.select({
    id: s.trips.id,
    shipmentId: s.trips.shipmentId,
    fulfillmentId: s.trips.fulfillmentId,
    tripCode: s.trips.tripCode,
    departureDate: s.trips.departureDate,
    status: s.trips.status,
    fuelLiters: s.trips.fuelLiters,
    totalRoadAllowance: s.trips.totalRoadAllowance,
    driverSalary: s.trips.driverSalary,
    routeName: ROUTE_OPERATIONAL_NAME,
    truckPlate: s.trucks.licensePlate,
    customerName: CUSTOMER_OPERATIONAL_NAME,
  }).from(s.trips)
    .leftJoin(s.shipmentFulfillments, eq(s.trips.fulfillmentId, s.shipmentFulfillments.id))
    .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .leftJoin(s.customers, eq(s.trips.customerId, s.customers.id))
    .where(and(
      eq(s.trips.driverId, driverId),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, TripStatus.CANCELED),
      or(
        isNull(s.trips.fulfillmentId),
        and(
          isNotNull(s.shipmentFulfillments.id),
          isNull(s.shipmentFulfillments.canceledAt),
        ),
      ),
    ))
    .orderBy(desc(s.trips.departureDate));

  if (trips.length === 0) return trips;

  // Batched container fetch — single query for all trips on this list.
  const tripIds = trips.map(t => t.id);
  const containerRows = await db.select({
    tripId: s.tripContainers.tripId,
    containerNumber: s.tripContainers.containerNumber,
  }).from(s.tripContainers).where(inArray(s.tripContainers.tripId, tripIds));

  const containersByTrip = new Map<number, string[]>();
  for (const c of containerRows) {
    if (!c.containerNumber) continue;
    const list = containersByTrip.get(c.tripId);
    if (list) list.push(c.containerNumber);
    else containersByTrip.set(c.tripId, [c.containerNumber]);
  }

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

type DriverFulfillmentMilestoneType = typeof DRIVER_FULFILLMENT_PROGRESS_SEQUENCE[number];

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
        id: s.trips.id,
        fulfillmentId: s.trips.fulfillmentId,
        tripCode: s.trips.tripCode,
        departureDate: s.trips.departureDate,
        status: s.trips.status,
        fuelLiters: s.trips.fuelLiters,
        totalRoadAllowance: s.trips.totalRoadAllowance,
        driverSalary: s.trips.driverSalary,
        routeName: ROUTE_OPERATIONAL_NAME,
        truckPlate: s.trucks.licensePlate,
        customerName: CUSTOMER_OPERATIONAL_NAME,
      }).from(s.trips)
        .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
        .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
        .leftJoin(s.customers, eq(s.trips.customerId, s.customers.id))
        .where(and(
          inArray(s.trips.id, [pair.firstTripId, pair.secondTripId]),
          isNull(s.trips.deletedAt),
        ))
        .orderBy(asc(s.trips.id));
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
    id: s.trips.id,
    fulfillmentId: s.trips.fulfillmentId,
    tripCode: s.trips.tripCode,
    departureDate: s.trips.departureDate,
    status: s.trips.status,
    fuelLiters: s.trips.fuelLiters,
    totalRoadAllowance: s.trips.totalRoadAllowance,
    driverSalary: s.trips.driverSalary,
    routeName: ROUTE_OPERATIONAL_NAME,
    truckPlate: s.trucks.licensePlate,
    customerName: CUSTOMER_OPERATIONAL_NAME,
    createdAt: s.trips.createdAt,
  }).from(s.trips)
    .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .leftJoin(s.customers, eq(s.trips.customerId, s.customers.id))
    .where(and(
      eq(s.trips.driverId, driverId),
      eq(s.trips.departureDate, today),
      isNull(s.trips.deletedAt),
      sql`${s.trips.status} <> 'CANCELED'`,
    ))
    .orderBy(asc(s.trips.createdAt));

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
    id: s.trips.id,
    shipmentId: s.trips.shipmentId,
    tripCode: s.trips.tripCode,
    departureDate: s.trips.departureDate,
    status: s.trips.status,
    fuelLiters: s.trips.fuelLiters,
    fuelMode: s.trips.fuelMode,
    totalRoadAllowance: s.trips.totalRoadAllowance,
    driverSalary: s.trips.driverSalary,
    hasReturnCargo: s.trips.hasReturnCargo,
    notes: s.trips.notes,
    customerReference: s.trips.customerReference,
    routeName: ROUTE_OPERATIONAL_NAME,
    truckPlate: s.trucks.licensePlate,
    trailerId: s.trips.trailerId,
    trailerPlate: s.trailers.licensePlate,
    trailerType: s.trips.trailerType,
    customerName: CUSTOMER_OPERATIONAL_NAME,
    cargoTypeName: s.cargoTypes.name,
    fuelSupplierName: s.suppliers.name,
    paperOrderCollectedAt: s.trips.paperOrderCollectedAt,
    paperOrderCollectedBy: s.trips.paperOrderCollectedBy,
    paperOrderCollectedByName: paperCollector.fullName,
  }).from(s.trips)
    .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .leftJoin(s.trailers, eq(s.trips.trailerId, s.trailers.id))
    .leftJoin(s.customers, eq(s.trips.customerId, s.customers.id))
    .leftJoin(s.cargoTypes, eq(s.trips.cargoTypeId, s.cargoTypes.id))
    .leftJoin(s.suppliers, eq(s.trips.fuelSupplierId, s.suppliers.id))
    .leftJoin(paperCollector, eq(paperCollector.id, s.trips.paperOrderCollectedBy))
    .where(and(eq(s.trips.id, tripId), eq(s.trips.driverId, driverId), isNull(s.trips.deletedAt)))
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

function isDriverFulfillmentMilestone(
  eventType: DriverProgressEventType,
): eventType is DriverFulfillmentMilestoneType {
  return DRIVER_FULFILLMENT_PROGRESS_SEQUENCE.includes(eventType as DriverFulfillmentMilestoneType);
}

function nextDriverFulfillmentMilestone(
  recorded: readonly DriverProgressEventType[],
): DriverFulfillmentMilestoneType | null {
  for (const eventType of DRIVER_FULFILLMENT_PROGRESS_SEQUENCE) {
    if (!recorded.includes(eventType)) {
      return eventType;
    }
  }
  return null;
}

function buildDriverFulfillmentSequenceError(
  recorded: readonly DriverProgressEventType[],
  attempted: DriverFulfillmentMilestoneType,
): string {
  const next = nextDriverFulfillmentMilestone(recorded);
  if (!next) {
    return 'Đã ghi nhận đủ 3 mốc thực hiện cho tác vụ này.';
  }
  if (recorded.includes(attempted)) {
    return `Mốc ${DRIVER_PROGRESS_EVENT_LABELS[attempted]} đã được ghi nhận. Mốc tiếp theo phải là ${DRIVER_PROGRESS_EVENT_LABELS[next]}.`;
  }
  return `Không thể ghi nhận ${DRIVER_PROGRESS_EVENT_LABELS[attempted]}. Mốc tiếp theo phải là ${DRIVER_PROGRESS_EVENT_LABELS[next]}.`;
}

export interface DriverFulfillmentDetail {
  fulfillmentId: number;
  shipmentId: number;
  shipmentCode: string | null;
  bookingRef: string | null;
  cargoMode: typeof s.shipments.$inferSelect.cargoMode;
  fulfillmentType: typeof s.shipmentFulfillments.$inferSelect.fulfillmentType;
  tripId: number;
  tripVersion: number;
  factoryName: string | null;
  shippingLineName: string | null;
  expectedDeliveryDate: string | null;
  customsCutoffAt: string | null;
  closingAt: string | null;
  plannedReturnAt: string | null;
  pickupLocation: string | null;
  deliveryLocation: string | null;
  contactName: string | null;
  contactPhone: string | null;
  siteSnapshot: Record<string, unknown>;
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

  const [shipmentRow] = await db.select({
    shipmentId: s.shipments.id,
    shipmentCode: s.shipments.shipmentCode,
    bookingRef: s.shipments.bookingRef,
    cargoMode: s.shipments.cargoMode,
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
    siteSnapshot: s.shipmentFulfillments.siteSnapshot,
  }).from(s.shipmentFulfillments)
    .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
    .where(eq(s.shipmentFulfillments.id, fulfillmentId))
    .limit(1);

  if (!shipmentRow) {
    throw new ApiError(404, 'Không tìm thấy tác vụ được giao.');
  }

  const [evidenceStatus, milestones, podSubmissions] = await Promise.all([
    getDriverCompletionEvidenceStatus(ownedTrip.tripId),
    listDriverFulfillmentProgress(fulfillmentId, driverId),
    listPodSubmissionsForDriver(driverId, fulfillmentId),
  ]);

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
  const deliverySiteName = typeof siteSnapshot.deliverySite === 'object'
    && siteSnapshot.deliverySite !== null
    && typeof (siteSnapshot.deliverySite as { name?: unknown }).name === 'string'
    ? (siteSnapshot.deliverySite as { name: string }).name
    : null;
  return {
    fulfillmentId,
    shipmentId: shipmentRow.shipmentId,
    shipmentCode: shipmentRow.shipmentCode,
    bookingRef: shipmentRow.bookingRef,
    cargoMode: shipmentRow.cargoMode,
    fulfillmentType: shipmentRow.fulfillmentType,
    tripId: ownedTrip.tripId,
    tripVersion: ownedTrip.tripVersion,
    factoryName: shipmentRow.factoryName ?? deliverySiteName,
    shippingLineName: shipmentRow.shippingLineName,
    expectedDeliveryDate: shipmentRow.expectedDeliveryDate,
    customsCutoffAt: shipmentRow.customsCutoffAt?.toISOString() ?? null,
    closingAt: shipmentRow.closingAt?.toISOString() ?? null,
    plannedReturnAt: shipmentRow.plannedReturnAt?.toISOString() ?? null,
    pickupLocation: shipmentRow.pickupLocation ?? pickupWarehouseName,
    deliveryLocation: shipmentRow.deliveryLocation ?? deliverySiteName,
    contactName: shipmentRow.contactName,
    contactPhone: shipmentRow.contactPhone,
    siteSnapshot,
    evidenceStatus,
    milestones,
    podSubmissions,
    trip,
  };
}

/**
 * Earnings summary for a driver: base salary + trip income - penalties.
 * Requires month/year — uses the attendance/salary computation logic.
 */
export async function getDriverEarnings(driverId: number, month: number, year: number) {
  const salaryData = await computeSalary(driverId, year, month);

  // F2 / B2 — trip-based income for the salary period:
  //   • Lương SX (production pay)      = Σ trip.driverSalary
  //   • Tiền đi đường (road allowance) = Σ trip.totalRoadAllowance
  // over the driver's non-canceled trips departing within the period.
  const [tripAgg] = await db.select({
    productionSalary: sql<string>`coalesce(sum(${s.trips.driverSalary}::numeric), 0)`,
    roadAllowance: sql<string>`coalesce(sum(${s.trips.totalRoadAllowance}::numeric), 0)`,
  }).from(s.trips)
    .where(and(
      eq(s.trips.driverId, driverId),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
      gte(s.trips.departureDate, salaryData.periodStart),
      lte(s.trips.departureDate, salaryData.periodEnd),
    ));
  const productionSalary = round2dp(parseFloat(tripAgg?.productionSalary ?? '0'));
  const roadAllowance = round2dp(parseFloat(tripAgg?.roadAllowance ?? '0'));

  // F2 / B2 — outstanding payable: what the company still owes this driver,
  // read from the DRIVER ledger (Σ DRIVER_SALARY credits − reversals − payouts).
  // Customer chose "show payable balance" over a new advance-tracking model.
  const payableBalance = round2dp(await LedgerService.getBalance('DRIVER', driverId));

  // "Đã thanh toán / đã tạm ứng" = actual cash the company has paid out to the
  // driver in the period. Only true cash-out ledger debits count.
  //
  // Allow-list (see PAID_OR_ADVANCED_TXN_TYPES): DRIVER_PAYOUT is the only
  // DRIVER-ledger debit that represents cash leaving the company. PENALTY is
  // explicitly EXCLUDED — it posts a debit too, but it is a non-cash deduction
  // already shown separately as "Khấu trừ kỷ luật"; counting it here would
  // double-count and overstate cash paid. ADJUSTMENT on the DRIVER ledger is a
  // reconciliation credit (penalty cancellation), never a cash debit.
  // UNLOCK_REVERSAL reverses a DRIVER_SALARY credit and is also excluded.
  //
  // No separate driver-advance txn type exists (advances are recorded as
  // DRIVER_PAYOUT with method=CASH; forwarder advances are OPS_ADVANCE on
  // the FORWARDER ledger, not this one).
  const [driverLedgerAgg] = await db.select({
    paidOrAdvanced: sql<string>`coalesce(sum(
      case
        when ${inArray(s.ledger.txnType, [...PAID_OR_ADVANCED_TXN_TYPES])}
        then ${s.ledger.debit}::numeric
        else 0
      end
    ), 0)`,
  }).from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'DRIVER'),
      eq(s.ledger.entityId, driverId),
      gte(sql`(${s.ledger.createdAt})::date`, salaryData.periodStart),
      lte(sql`(${s.ledger.createdAt})::date`, salaryData.periodEnd),
    ));
  const paidOrAdvanced = round2dp(parseFloat(driverLedgerAgg?.paidOrAdvanced ?? '0'));

  return {
    baseSalary: String(salaryData.baseSalary),
    tripIncome: String(salaryData.totalTripSalary),
    penalties: String(salaryData.totalPenalties),
    supplementPay: String(salaryData.supplementPay),
    leaveDeduction: String(salaryData.leaveDeduction),
    netIncome: String(salaryData.netSalary),
    netSalary: String(salaryData.netSalary),
    adjustment: salaryData.adjustment,
    standardWorkDays: salaryData.standardWorkDays,
    paidDays: salaryData.paidDays,
    dailyRate: salaryData.dailyRate,
    periodStart: salaryData.periodStart,
    periodEnd: salaryData.periodEnd,
    productionSalary: String(productionSalary),
    roadAllowance: String(roadAllowance),
    paidOrAdvanced: String(paidOrAdvanced),
    payableBalance: String(payableBalance),
  };
}

/**
 * N5 / B4 — vehicle compliance/service reminders for a driver.
 *
 * Resolves the driver's truck by preferring the truck on their most-recent
 * non-deleted trip (so a driver reassigned mid-period sees the truck they
 * actually drove last), then falling back to the driver's active
 * truck_driver_assignments row.
 * Returns only overdue/due alerts (the helper already filters out 'ok').
 *
 * Returns `null` when no truck is resolvable; the route maps that to an empty
 * alerts list (no reminders to show) rather than 404.
 */
export async function getDriverVehicleAlerts(driverId: number): Promise<VehicleAlert[] | null> {
  // 1. Most-recent trip's truck. Exclude CANCELED trips — a canceled trip was
  // never driven, so its truck shouldn't shadow the truck the driver actually
  // last used (a later-dated canceled trip would otherwise win on departureDate).
  const [recent] = await db.select({ truckId: s.trips.truckId })
    .from(s.trips)
    .where(and(eq(s.trips.driverId, driverId), isNull(s.trips.deletedAt), ne(s.trips.status, 'CANCELED')))
    .orderBy(desc(s.trips.departureDate))
    .limit(1);

  let truckId = recent?.truckId ?? null;

  // 2. Fall back to the driver's active truck assignment.
  if (!truckId) {
    truckId = await getActiveTruckIdForDriver(db, driverId);
  }

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
  const conditions = [eq(s.penalties.driverId, driverId), isNull(s.penalties.deletedAt)];
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

export interface DriverProgressEvent {
  id: number;
  tripId: number;
  driverId: number;
  eventType: DriverProgressEventType;
  occurredAt: Date;
  note: string | null;
  recordedBy: number | null;
  createdAt: Date;
}

/**
 * Verify the trip belongs to `driverId` and return its row. Throws 404 if the
 * trip is missing, 403 if it belongs to a different driver. Used by both the
 * create and list paths so ownership is enforced consistently.
 */
export async function assertTripOwnedByDriver(tripId: number, driverId: number) {
  const [trip] = await db.select({ id: s.trips.id, driverId: s.trips.driverId, deletedAt: s.trips.deletedAt })
    .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  if (!trip || trip.deletedAt) {
    throw new ApiError(404, 'Không tìm thấy chuyến đi');
  }
  if (trip.driverId !== driverId) {
    throw new ApiError(403, 'Bạn không được phân công chuyến đi này');
  }
  return trip;
}

async function insertDriverProgressEventTx(
  tx: Tx,
  tripId: number,
  driverId: number,
  input: { eventType: DriverProgressEventType; occurredAt: string; note?: string },
  recordedBy: number,
): Promise<DriverProgressEvent> {
  await assertTripShipmentAccountingUnlocked(tx, tripId);
  const [row] = await tx.insert(s.driverProgressEvents).values({
    tripId,
    driverId,
    eventType: input.eventType,
    occurredAt: new Date(input.occurredAt),
    note: input.note ?? null,
    recordedBy,
  }).returning();
  return row as DriverProgressEvent;
}

async function loadDriverProgressEventTx(tx: Tx, id: number): Promise<DriverProgressEvent> {
  const [row] = await tx.select().from(s.driverProgressEvents)
    .where(eq(s.driverProgressEvents.id, id)).limit(1);
  if (!row) throw new ApiError(404, 'Sự kiện tiến độ không tồn tại');
  return row as DriverProgressEvent;
}

async function assertTripAcceptsIncidentalCostTx(tx: Tx, tripId: number): Promise<void> {
  await assertTripShipmentAccountingUnlocked(tx, tripId);
  const [trip] = await tx.select({ status: s.trips.status })
    .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  // O2C: costs stay editable after COMPLETED (no hard-freeze). Only CANCELED
  // trips reject new incidental costs. A cost on a completed trip flips
  // ar_snapshot_dirty via the caller.
  if (trip?.status === 'CANCELED') {
    throw new ApiError(409, 'Không thể thêm chi phí cho chuyến đã hủy');
  }
}

async function insertDriverIncidentalCostTx(
  tx: Tx,
  tripId: number,
  driverId: number,
  input: { costType: DriverIncidentalCostType; amount: number; occurredAt: string; note?: string },
  recordedBy: number,
): Promise<DriverIncidentalCost> {
  const [row] = await tx.insert(s.driverIncidentalCosts).values({
    tripId,
    driverId,
    costType: input.costType,
    amount: String(input.amount),
    occurredAt: input.occurredAt,
    note: input.note ?? null,
    recordedBy,
  }).returning();
  return row as DriverIncidentalCost;
}

async function loadDriverIncidentalCostTx(tx: Tx, id: number): Promise<DriverIncidentalCost> {
  const [row] = await tx.select().from(s.driverIncidentalCosts)
    .where(eq(s.driverIncidentalCosts.id, id)).limit(1);
  if (!row) throw new ApiError(404, 'Chi phí không tồn tại');
  return row as DriverIncidentalCost;
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

export async function recordDriverFulfillmentProgress(args: {
  fulfillmentId: number;
  driverId: number;
  input: {
    eventType: DriverProgressEventType;
    occurredAt: string;
    note?: string;
    expectedVersion?: number;
  };
  recordedBy: number;
  idempotencyKey: string | undefined;
}): Promise<{ event: DriverProgressEvent; replayed: boolean }> {
  const eventType = args.input.eventType;
  if (!isDriverFulfillmentMilestone(eventType)) {
    throw new ApiError(400, 'Mốc thực hiện không hợp lệ.');
  }

  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_PROGRESS,
    idempotencyKey: args.idempotencyKey,
    payload: {
      fulfillmentId: args.fulfillmentId,
      driverId: args.driverId,
      eventType: args.input.eventType,
      occurredAt: args.input.occurredAt,
      note: args.input.note ?? null,
      expectedVersion: args.input.expectedVersion ?? null,
    },
    createdBy: args.recordedBy,
    entityType: 'driver_progress_event',
    create: async (tx) => {
      // Shipment is the aggregate lock root. Acquire it before the trip so
      // driver acknowledgement follows the same lock order as dispatch/POD
      // review and cannot deadlock against those workflows.
      await tx.select({ id: s.shipments.id })
        .from(s.shipmentFulfillments)
        .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
        .where(eq(s.shipmentFulfillments.id, args.fulfillmentId))
        .for('update');
      const ownedTrip = await loadOwnedFulfillmentTrip(tx, args.fulfillmentId, args.driverId, { forUpdate: true });
      if (args.input.expectedVersion != null && ownedTrip.tripVersion !== args.input.expectedVersion) {
        throw new ApiError(409, 'Tác vụ đã thay đổi. Vui lòng tải lại.');
      }
      const recorded = await listOrderedMilestoneTypesTx(tx, ownedTrip.tripId);
      const next = nextDriverFulfillmentMilestone(recorded);
      if (next == null || eventType !== next) {
        throw new ApiError(409, buildDriverFulfillmentSequenceError(recorded, eventType));
      }
      if (
        eventType === DriverProgressEventType.ORDER_RECEIVED
        && (!ownedTrip.paperOrderCollectedAt || !ownedTrip.paperOrderCollectedBy)
      ) {
        throw new ApiError(409, 'Ops chưa xác nhận giao lệnh gốc cho chuyến này.');
      }
      const event = await insertDriverProgressEventTx(tx, ownedTrip.tripId, args.driverId, args.input, args.recordedBy);
      const publication = customerPublicationForDriverEvent(eventType, event.occurredAt);
      if (publication) {
        const customerEvent = await createCustomerVisibleEvent({
          shipmentId: ownedTrip.shipmentId,
          eventKey: `driver-progress:${event.id}:${eventType}`,
          eventType: 'MILESTONE',
          title: publication.title,
          message: publication.message,
          occurredAt: event.occurredAt,
          createdBy: args.recordedBy,
        }, undefined, tx);
        if (eventType === DriverProgressEventType.DELIVERED) {
          const [scope] = await tx.select({
            shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
          }).from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, ownedTrip.fulfillmentId)).limit(1);
          await tx.insert(s.deliveryAttempts).values({
            shipmentId: ownedTrip.shipmentId,
            fulfillmentId: ownedTrip.fulfillmentId,
            tripId: ownedTrip.tripId,
            shipmentContainerId: scope?.shipmentContainerId ?? null,
            driverProgressEventId: event.id,
            customerVisibleEventId: customerEvent.id,
            result: 'DELIVERED',
            occurredAt: event.occurredAt,
            recordedBy: args.recordedBy,
          });
        }
      }
      if (eventType === DriverProgressEventType.ORDER_RECEIVED && ownedTrip.tripStatus === TripStatus.CREATED) {
        await transitionTripStatus(
          ownedTrip.tripId,
          TripStatus.IN_TRANSIT,
          args.recordedBy,
          Role.DRIVER,
          false,
          false,
          {
            expectedVersion: ownedTrip.tripVersion,
            transaction: tx,
            // Ownership was verified and locked above. Receiving the assigned
            // order is the driver's explicit start action for this fulfillment.
            driverOwnedFulfillmentStart: {
              driverId: args.driverId,
              fulfillmentId: args.fulfillmentId,
            },
          },
        );
        const { recomputeShipmentCompletion } = await import('./shipment.service.js');
        await recomputeShipmentCompletion(ownedTrip.shipmentId, { changedBy: args.recordedBy }, tx);
      }
      return event;
    },
    load: async (id, tx) => loadDriverProgressEventTx(tx, id),
  });
  return { event: result, replayed };
}

function customerPublicationForDriverEvent(eventType: DriverProgressEventType, occurredAt: Date): { title: string; message: string } | null {
  // This is a deliberately closed allowlist. It must never interpolate notes,
  // evidence references, expense details, incident text, or internal IDs.
  const occurred = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(occurredAt);
  if (eventType === DriverProgressEventType.PICKED_UP) return { title: 'Đã nhận hàng để vận chuyển', message: `Tài xế đã báo nhận hàng lúc ${occurred}.` };
  if (eventType === DriverProgressEventType.LOADING_OR_RETURNING) return { title: 'Đang thực hiện chặng vận chuyển', message: `Tài xế đã báo đang thực hiện chặng vận chuyển lúc ${occurred}.` };
  if (eventType === DriverProgressEventType.DELIVERED) return { title: 'Tài xế báo đã giao hàng', message: `Tài xế đã báo giao hàng lúc ${occurred}. Đây chưa phải xác nhận chấp nhận giao hàng cuối cùng.` };
  return null;
}

export async function syncDriverFulfillmentStartSideEffects(
  args: {
    fulfillmentId: number;
    driverId: number;
    recordedBy: number;
  },
  invalidateReports: () => Promise<void> = async () => {
    await Promise.all([
      cacheInvalidate('reports:dashboard'),
      cacheInvalidate('reports:dashboard:executive'),
      cacheInvalidatePattern('reports:entity-results:*'),
      cacheInvalidatePattern('reports:fuel-variance:*'),
    ]).catch(() => {});
  },
): Promise<void> {
    const [startedTrip] = await db.select({
      id: s.trips.id,
      driverId: s.trips.driverId,
      departureDate: s.trips.departureDate,
      status: s.trips.status,
    }).from(s.trips)
      .where(and(
        eq(s.trips.fulfillmentId, args.fulfillmentId),
        eq(s.trips.driverId, args.driverId),
        isNull(s.trips.deletedAt),
      ))
      .limit(1);
    if (!startedTrip || startedTrip.status !== TripStatus.IN_TRANSIT) return;
    await syncAttendanceAfterStatusChange(
      startedTrip.id,
      TripStatus.IN_TRANSIT,
      startedTrip.driverId,
      startedTrip.departureDate,
      null,
      args.recordedBy,
    );
    await invalidateReports();
}

/** List a trip's progress events, oldest-first (timeline order). */
export async function listDriverProgress(tripId: number, driverId: number): Promise<DriverProgressEvent[]> {
  await assertTripOwnedByDriver(tripId, driverId);
  const rows = await db.select().from(s.driverProgressEvents)
    .where(eq(s.driverProgressEvents.tripId, tripId))
    .orderBy(asc(s.driverProgressEvents.occurredAt));
  return rows as DriverProgressEvent[];
}

export async function listDriverFulfillmentProgress(
  fulfillmentId: number,
  driverId: number,
): Promise<DriverProgressEvent[]> {
  const ownedTrip = await loadOwnedFulfillmentTrip(db, fulfillmentId, driverId);
  const rows = await db.select().from(s.driverProgressEvents)
    .where(and(
      eq(s.driverProgressEvents.tripId, ownedTrip.tripId),
      inArray(s.driverProgressEvents.eventType, [...DRIVER_FULFILLMENT_PROGRESS_SEQUENCE]),
    ))
    .orderBy(asc(s.driverProgressEvents.occurredAt), asc(s.driverProgressEvents.id));
  return rows as DriverProgressEvent[];
}

// ─── M8.4 slice 3: driver incidental costs ───────────────────────────────────
//
// Driver-reported out-of-pocket expenses (per-diem, lift fee, parking, toll,
// fuel, other) against a trip. Distinct from `tripExpenses` (forwarder-scoped,
// buy/sell, supplier, approval workflow) — this is a lightweight driver-only
// record that feeds salary/settlement reconciliation. Idempotent create
// (reuses `runIdempotent` + `idempotency_keys` from M10.1) so the offline-
// queue replay doesn't duplicate (PRD M08-04-03).
//
// COMPLETED trips reject new incidental costs — unlike progress events (append-
// only audit logs), costs affect financials, so completion = immutable.

export interface DriverIncidentalCost {
  id: number;
  tripId: number;
  driverId: number;
  costType: DriverIncidentalCostType;
  amount: string;
  occurredAt: string;
  note: string | null;
  recordedBy: number | null;
  createdAt: Date;
}

/**
 * Record a driver incidental cost. Server-side idempotent: same key + same
 * body → 201 first / 200 replay (no duplicate); same key + different body →
 * 409 (Q23). COMPLETED trips reject (409) — costs affect financials.
 */
export async function recordIncidentalCost(
  tripId: number,
  driverId: number,
  input: { costType: DriverIncidentalCostType; amount: number; occurredAt: string; note?: string },
  recordedBy: number,
  idempotencyKey: string | undefined,
): Promise<{ cost: DriverIncidentalCost; replayed: boolean }> {
  // Ownership check (reuses the progress-event helper).
  await assertTripOwnedByDriver(tripId, driverId);

  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_INCIDENTAL_COST,
    idempotencyKey,
    payload: { tripId, driverId, ...input },
    createdBy: recordedBy,
    entityType: 'driver_incidental_cost',
    create: async (tx) => {
      await assertTripAcceptsIncidentalCostTx(tx, tripId);
      return insertDriverIncidentalCostTx(tx, tripId, driverId, input, recordedBy);
    },
    load: async (id, tx) => loadDriverIncidentalCostTx(tx, id),
  });
  return { cost: result, replayed };
}

/** List a trip's incidental costs, newest-first. */
export async function listIncidentalCosts(tripId: number, driverId: number): Promise<DriverIncidentalCost[]> {
  await assertTripOwnedByDriver(tripId, driverId);
  const rows = await db.select().from(s.driverIncidentalCosts)
    .where(eq(s.driverIncidentalCosts.tripId, tripId))
    .orderBy(desc(s.driverIncidentalCosts.createdAt));
  return rows as DriverIncidentalCost[];
}

export interface DriverFulfillmentCompletionResult {
  tripId: number;
  fulfillmentId: number;
  status: typeof s.trips.$inferSelect.status;
  version: number;
  completedAt: string | null;
  evidenceStatus: DriverCompletionEvidenceStatus;
}

async function buildDriverFulfillmentCompletionResultTx(
  tx: Tx,
  tripId: number,
  driverId: number,
): Promise<DriverFulfillmentCompletionResult> {
  const [trip] = await tx.select({
    id: s.trips.id,
    fulfillmentId: s.trips.fulfillmentId,
    status: s.trips.status,
    version: s.trips.version,
    completedAt: s.trips.completedAt,
  }).from(s.trips)
    .where(and(
      eq(s.trips.id, tripId),
      eq(s.trips.driverId, driverId),
      isNull(s.trips.deletedAt),
    ))
    .limit(1);
  if (!trip || trip.fulfillmentId == null) {
    throw new ApiError(404, 'Không tìm thấy tác vụ được giao.');
  }
  const evidenceStatus = await getDriverCompletionEvidenceStatus(trip.id, tx);
  return {
    tripId: trip.id,
    fulfillmentId: trip.fulfillmentId,
    status: trip.status,
    version: trip.version,
    completedAt: trip.completedAt?.toISOString() ?? null,
    evidenceStatus,
  };
}

export async function completeOwnedFulfillmentTrip(args: {
  fulfillmentId: number;
  driverId: number;
  actorUserId: number;
  expectedVersion: number;
  idempotencyKey: string | undefined;
}): Promise<{ trip: DriverFulfillmentCompletionResult; replayed: boolean }> {
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_FULFILLMENT_COMPLETE,
    idempotencyKey: args.idempotencyKey,
    payload: {
      fulfillmentId: args.fulfillmentId,
      driverId: args.driverId,
      actorUserId: args.actorUserId,
      expectedVersion: args.expectedVersion,
    },
    createdBy: args.actorUserId,
    entityType: 'trip',
    responseStatusCode: 200,
    create: async (tx) => {
      await tx.select({ id: s.shipments.id })
        .from(s.shipmentFulfillments)
        .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
        .where(eq(s.shipmentFulfillments.id, args.fulfillmentId))
        .for('update');
      const ownedTrip = await loadOwnedFulfillmentTrip(tx, args.fulfillmentId, args.driverId, { forUpdate: true });
      await assertTripShipmentAccountingUnlocked(tx, ownedTrip.tripId);
      if (ownedTrip.tripVersion !== args.expectedVersion) {
        throw new ApiError(409, 'Tác vụ đã thay đổi. Vui lòng tải lại.');
      }
      const evidenceStatus = await getDriverCompletionEvidenceStatus(ownedTrip.tripId, tx);
      if (!evidenceStatus.ready) {
        throw new ApiError(409, `Chưa thể hoàn thành chuyến. Còn thiếu: ${evidenceStatus.missing.join(', ')}.`);
      }
      // Driver "Hoàn thành" means hand off the operational evidence for
      // accounting review. It never posts revenue or changes the trip to the
      // financial COMPLETED state; Q15 reserves that transition for the
      // independently approved close action.
      const { recomputeShipmentCompletion } = await import('./shipment.service.js');
      await recomputeShipmentCompletion(ownedTrip.shipmentId, { changedBy: args.actorUserId }, tx);
      return buildDriverFulfillmentCompletionResultTx(tx, ownedTrip.tripId, args.driverId);
    },
    load: async (entityId, tx) => buildDriverFulfillmentCompletionResultTx(tx, entityId, args.driverId),
    getEntityId: (value) => value.tripId,
  });

  return { trip: result, replayed };
}

// ─── M8.6: driver payslip periods ───────────────────────────────────────────
//
// PRD M08-06-03: a driver sees their own issued salary periods (CLOSED or
// REOPENED) with per-period earnings + close/adjustment metadata. Ownership
// is enforced by resolving driverId from the authenticated user (the route
// does this). The list reuses getDriverEarnings for the per-period summary.

export interface DriverPayslipPeriod {
  period: string;
  status: string;
  closedAt: string | null;
  closedByName: string | null;
  note: string | null;
  earnings: {
    netIncome: string;
    productionSalary: string;
    roadAllowance: string;
    penalties: string;
    paidOrAdvanced: string;
    payableBalance: string;
    periodStart: string;
    periodEnd: string;
  };
}

/**
 * List the driver's issued salary periods (CLOSED or REOPENED), newest-first,
 * with per-period earnings summary. Reuses getDriverEarnings for the numbers.
 */
export async function getDriverPayslipPeriods(driverId: number): Promise<DriverPayslipPeriod[]> {
  // Fetch all salary_period_closes rows (any driver — the period is global),
  // then join the closer's name. The earnings are per-driver (getDriverEarnings
  // filters by driverId), so the same period yields different numbers for
  // different drivers; the period-close row itself is shared.
  const closes = await db.select({
    period: s.salaryPeriodCloses.period,
    status: s.salaryPeriodCloses.status,
    closedAt: s.salaryPeriodCloses.closedAt,
    closedBy: s.salaryPeriodCloses.closedBy,
    note: s.salaryPeriodCloses.note,
  }).from(s.salaryPeriodCloses)
    .where(sql`${s.salaryPeriodCloses.payslipIssuedAt} is not null`)
    .orderBy(desc(s.salaryPeriodCloses.period));

  if (closes.length === 0) return [];

  // Batch-resolve closer names.
  const closerIds = [...new Set(closes.map(c => c.closedBy).filter((id): id is number => id != null))];
  const closers = closerIds.length > 0
    ? await db.select({ id: s.users.id, name: s.users.fullName }).from(s.users).where(inArray(s.users.id, closerIds))
    : [];
  const closerMap = new Map(closers.map(c => [c.id, c.name]));

  // Compute earnings per period for this driver.
  const result: DriverPayslipPeriod[] = [];
  for (const c of closes) {
    const [yearStr, monthStr] = c.period.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) continue;

    const earnings = await getDriverEarnings(driverId, month, year);
    result.push({
      period: c.period,
      status: c.status,
      closedAt: c.closedAt?.toISOString() ?? null,
      closedByName: c.closedBy ? closerMap.get(c.closedBy) ?? null : null,
      note: c.note,
      earnings: {
        netIncome: earnings.netIncome,
        productionSalary: earnings.productionSalary,
        roadAllowance: earnings.roadAllowance,
        penalties: earnings.penalties,
        paidOrAdvanced: earnings.paidOrAdvanced,
        payableBalance: earnings.payableBalance,
        periodStart: earnings.periodStart ?? '',
        periodEnd: earnings.periodEnd ?? '',
      },
    });
  }

  return result;
}

// ─── M8.4 slice 4: advisory evidence-readiness before completion ──────────
//
// PRD M08-04-03 + open §3 question ("which evidences mandatory before
// completion — photo / signature / GPS?"). Status `pending`. Resolved the
// same way as M10.2 slice 2: advisory, NOT enforcing. This function returns
// the list of missing recommended evidence types so the UI (or the
// operator) sees what's absent before marking the trip COMPLETED. A
// follow-up flip enforces once §3 sign-off lands.
//
// Recommended set: ≥1 container photo + ≥1 DEPARTED progress event + ≥1
// ARRIVED progress event. These are the minimum audit trail for a trip
// that was physically driven.

export type CompletionEvidenceStatus = DriverCompletionEvidenceStatus;

export async function getCompletionEvidenceStatus(tripId: number): Promise<CompletionEvidenceStatus> {
  return getDriverCompletionEvidenceStatus(tripId);
}
