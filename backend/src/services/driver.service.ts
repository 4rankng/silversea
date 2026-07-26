import { db } from '../db';
import * as s from '../db/schema';
import { eq, ne, and, isNull, desc, asc, gte, lte, sql, inArray } from 'drizzle-orm';
import { ApiError } from '../errors';
import { computeVehicleAlerts, type VehicleAlert, round2dp, TxnType, type DriverProgressEventType, type DriverIncidentalCostType } from '@tingting/shared';

import { computeSalary } from './attendance.service';
import { LedgerService } from './ledger.service';
import { listTripContainers, listTripPhotoKeys } from './forwarder.service';
import { getTripInstructions } from './trip-instructions.service';
import { storageService } from './storage.service';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from './idempotency.service';

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
    tripCode: s.trips.tripCode,
    departureDate: s.trips.departureDate,
    status: s.trips.status,
    fuelLiters: s.trips.fuelLiters,
    totalRoadAllowance: s.trips.totalRoadAllowance,
    driverSalary: s.trips.driverSalary,
    routeName: s.routes.name,
    truckPlate: s.trucks.licensePlate,
    customerName: s.customers.name,
  }).from(s.trips)
    .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .leftJoin(s.customers, eq(s.trips.customerId, s.customers.id))
    .where(and(eq(s.trips.driverId, driverId), isNull(s.trips.deletedAt)))
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
  tripCode: string | null;
  departureDate: string;
  status: 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | 'LOCKED' | 'CANCELED';
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
  const rows = await db.select({
    id: s.trips.id,
    tripCode: s.trips.tripCode,
    departureDate: s.trips.departureDate,
    status: s.trips.status,
    fuelLiters: s.trips.fuelLiters,
    totalRoadAllowance: s.trips.totalRoadAllowance,
    driverSalary: s.trips.driverSalary,
    routeName: s.routes.name,
    truckPlate: s.trucks.licensePlate,
    customerName: s.customers.name,
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

  // Attach container numbers (batched single query, mirroring getDriverTrips).
  const tripIds = rows.map(r => r.id);
  const containersByTrip = new Map<number, string[]>();
  if (tripIds.length > 0) {
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
  }

  const allToday: DriverTripSummary[] = rows.map(r => ({
    id: r.id,
    tripCode: r.tripCode,
    departureDate: r.departureDate,
    // status has a DB default but is typed nullable; coalesce to 'CREATED'
    // (the column default) so the union stays narrow.
    status: r.status ?? 'CREATED',
    fuelLiters: r.fuelLiters,
    totalRoadAllowance: r.totalRoadAllowance,
    driverSalary: r.driverSalary,
    routeName: r.routeName,
    truckPlate: r.truckPlate,
    customerName: r.customerName,
    containerNumbers: containersByTrip.get(r.id) ?? [],
  }));

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

  return { date: today, active, next, firstOrderLate, allToday };
}

/**
 * Get a single trip detail for a driver (ownership-enforced).
 */
export async function getDriverTripDetail(driverId: number, tripId: number) {
  const [trip] = await db.select({
    id: s.trips.id,
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
    routeName: s.routes.name,
    truckPlate: s.trucks.licensePlate,
    trailerId: s.trips.trailerId,
    trailerPlate: s.trailers.licensePlate,
    trailerType: s.trips.trailerType,
    customerName: s.customers.name,
    cargoTypeName: s.cargoTypes.name,
    fuelSupplierName: s.suppliers.name,
  }).from(s.trips)
    .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .leftJoin(s.trailers, eq(s.trips.trailerId, s.trailers.id))
    .leftJoin(s.customers, eq(s.trips.customerId, s.customers.id))
    .leftJoin(s.cargoTypes, eq(s.trips.cargoTypeId, s.cargoTypes.id))
    .leftJoin(s.suppliers, eq(s.trips.fuelSupplierId, s.suppliers.id))
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
  const [contPhotoKeysRaw, sealPhotoKeysRaw, instructions] = await Promise.all([
    listTripPhotoKeys(tripId, 'CONTAINER'),
    listTripPhotoKeys(tripId, 'SEAL'),
    getTripInstructions(tripId),
  ]);
  const [contPhotoKeys, sealPhotoKeys] = await Promise.all([
    existingStorageKeys(contPhotoKeysRaw),
    existingStorageKeys(sealPhotoKeysRaw),
  ]);
  const contPhotoKey = contPhotoKeys[0] ?? null;
  const sealPhotoKey = sealPhotoKeys[0] ?? null;

  return { ...trip, legs, containers, contPhotoKey, sealPhotoKey, contPhotoKeys, sealPhotoKeys, instructions };
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
  // DRIVER_PAYOUT with method=CASH; forwarder advances are FORWARDER_ADVANCE on
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
 * actually drove last), then falling back to `drivers.assignedTruckId`.
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

  // 2. Fall back to the driver's assigned truck.
  if (!truckId) {
    const [driver] = await db.select({ assignedTruckId: s.drivers.assignedTruckId })
      .from(s.drivers)
      .where(and(eq(s.drivers.id, driverId), isNull(s.drivers.deletedAt)))
      .limit(1);
    truckId = driver?.assignedTruckId ?? null;
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
async function assertTripOwnedByDriver(tripId: number, driverId: number) {
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

  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_PROGRESS,
    idempotencyKey,
    payload: { tripId, driverId, ...input },
    createdBy: recordedBy,
    entityType: 'driver_progress_event',
    create: async () => {
      const [row] = await db.insert(s.driverProgressEvents).values({
        tripId,
        driverId,
        eventType: input.eventType,
        occurredAt: new Date(input.occurredAt),
        note: input.note ?? null,
        recordedBy,
      }).returning();
      return row as DriverProgressEvent;
    },
    load: async (id) => {
      const [row] = await db.select().from(s.driverProgressEvents)
        .where(eq(s.driverProgressEvents.id, id)).limit(1);
      if (!row) throw new ApiError(404, 'Sự kiện tiến độ không tồn tại');
      return row as DriverProgressEvent;
    },
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

// ─── M8.4 slice 3: driver incidental costs ───────────────────────────────────
//
// Driver-reported out-of-pocket expenses (per-diem, lift fee, parking, toll,
// fuel, other) against a trip. Distinct from `tripExpenses` (forwarder-scoped,
// buy/sell, supplier, approval workflow) — this is a lightweight driver-only
// record that feeds salary/settlement reconciliation. Idempotent create
// (reuses `runIdempotent` + `idempotency_keys` from M10.1) so the offline-
// queue replay doesn't duplicate (PRD M08-04-03).
//
// LOCKED trips reject new incidental costs — unlike progress events (append-
// only audit logs), costs affect financials, so lock = immutable.

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
 * 409 (Q23). LOCKED trips reject (409) — costs affect financials.
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

  // LOCKED trips reject — costs affect financials (unlike progress events).
  const [trip] = await db.select({ status: s.trips.status })
    .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  if (trip?.status === 'LOCKED') {
    throw new ApiError(409, 'Không thể thêm chi phí cho chuyến đã chốt');
  }

  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_INCIDENTAL_COST,
    idempotencyKey,
    payload: { tripId, driverId, ...input },
    createdBy: recordedBy,
    entityType: 'driver_incidental_cost',
    create: async () => {
      const [row] = await db.insert(s.driverIncidentalCosts).values({
        tripId,
        driverId,
        costType: input.costType,
        amount: String(input.amount),
        occurredAt: input.occurredAt,
        note: input.note ?? null,
        recordedBy,
      }).returning();
      return row as DriverIncidentalCost;
    },
    load: async (id) => {
      const [row] = await db.select().from(s.driverIncidentalCosts)
        .where(eq(s.driverIncidentalCosts.id, id)).limit(1);
      if (!row) throw new ApiError(404, 'Chi phí không tồn tại');
      return row as DriverIncidentalCost;
    },
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
