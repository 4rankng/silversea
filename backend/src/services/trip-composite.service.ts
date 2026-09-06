// Trips split Stage B/C core (lean-down 2026-09-06). The 99-column trips
// god-table is split into trips (operational) + trip_financial_state +
// trip_carrier_info (1:1 per trip). This module is the single seam every
// trips write goes through: `splitTripPatch` routes each field to its owning
// table, `applyTripPatch` persists a mixed patch across the three tables in
// one executor (tx or db), and `insertTripComposite` creates the trip plus
// its two sidecar rows atomically. Reads compose through the
// `trips_composite` view (schema trips.ts) or `getTripComposite`.
//
// Invariant: a trips row and its two sidecar rows are created together and
// never deleted independently (no FKs by project convention — app-level 1:1).

import { db } from '../db';
import * as s from '../db/schema';
import { eq } from 'drizzle-orm';

/** Financial-snapshot columns now owned by trip_financial_state. */
export const TRIP_FINANCIAL_FIELD_NAMES: ReadonlySet<string> = new Set([
  'driverSalary', 'fuelPriceApplied', 'fuelActualUnitPrice', 'roadAllowanceBaseApplied',
  'fuelLoadedNormApplied', 'fuelEmptyNormApplied', 'fuelFixedAllowanceApplied',
  'fuelSupplementNormApplied', 'tollPerStationApplied', 'returnCargoBonusApplied',
  'fuelLiters', 'totalFuelCost', 'fuelSurchargeAmount', 'fuelSurchargeSnapshot',
  'fuelSurchargeSnapshotDirty', 'totalRoadAllowance', 'tollCost', 'tollDeduction',
  'roadAllowanceOverride', 'totalCost', 'revenue', 'revenueEmptyReturn', 'revenueCombine',
  'twoPointDeliveryBonus', 'vehicleShiftAllowance', 'grossProfit', 'revenueOriginal',
  'revenueOverriddenBy', 'revenueOverriddenAt', 'revenueOverrideReason', 'pricingSource',
  'pricingFormula', 'pricingSnapshot', 'customerCommission', 'tripWageDays',
  'fuelSupplierId', 'vatRate', 'arCostHash', 'arSnapshotDirty', 'arSnapshotChangedAt',
  'apCostHash', 'apSnapshotDirty', 'apSnapshotChangedAt', 'pnlSnapshotGrossProfit',
]);

/** External-carrier execution columns now owned by trip_carrier_info. */
export const TRIP_CARRIER_FIELD_NAMES: ReadonlySet<string> = new Set([
  'carrierType', 'externalEntityId', 'externalEntityType', 'externalFreightCost',
  'externalPlateNumber', 'externalCarrierVehicleId', 'externalDriverName',
  'externalDriverPhone',
]);

export type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Route each key of a mixed trips patch to its owning table. Values (including
 * `sql` fragments) pass through untouched; callers must express SQL fragments
 * against the owning sidecar column (e.g. `sql\`${s.tripFinancialState.revenue} + 1\``),
 * not the legacy trips column.
 */
export function splitTripPatch<T extends Record<string, unknown>>(patch: T): {
  ops: Partial<T>;
  financial: Partial<T>;
  carrier: Partial<T>;
} {
  const ops: Record<string, unknown> = {};
  const financial: Record<string, unknown> = {};
  const carrier: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (TRIP_FINANCIAL_FIELD_NAMES.has(key)) financial[key] = value;
    else if (TRIP_CARRIER_FIELD_NAMES.has(key)) carrier[key] = value;
    else ops[key] = value;
  }
  return { ops: ops as Partial<T>, financial: financial as Partial<T>, carrier: carrier as Partial<T> };
}

// The sidecar NOT NULL columns with DB defaults. A composite row read from a
// legacy straggler (sidecar row missing) types these as nullable; coalesce to
// the schema default so an explicit NULL never violates the constraint.
function withFinancialDefaults(patch: Record<string, unknown>) {
  return {
    ...patch,
    fuelSurchargeAmount: (patch.fuelSurchargeAmount as string | null | undefined) ?? '0',
    fuelSurchargeSnapshotDirty: (patch.fuelSurchargeSnapshotDirty as boolean | null | undefined) ?? false,
    tollDeduction: (patch.tollDeduction as string | null | undefined) ?? '0',
    vatRate: (patch.vatRate as string | null | undefined) ?? '0.000',
  };
}

/** Upsert the financial sidecar row for a trip (1:1 by tripId). */
export async function upsertTripFinancialState(
  exec: Executor,
  tripId: number,
  patch: Record<string, unknown>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  // Defaults fill NOT NULL columns on the INSERT branch only. The
  // conflict-update SET carries just the patch keys, so an incidental upsert
  // (snapshot capture, posting, status transition without a vat override)
  // never clobbers financial values it did not intend to touch.
  const values = withFinancialDefaults(patch);
  await exec.insert(s.tripFinancialState)
    .values({ tripId, ...values } as typeof s.tripFinancialState.$inferInsert)
    .onConflictDoUpdate({
      target: s.tripFinancialState.tripId,
      set: { ...patch, updatedAt: new Date() } as Partial<typeof s.tripFinancialState.$inferInsert>,
    });
}

/** Upsert the external-carrier sidecar row for a trip (1:1 by tripId). */
export async function upsertTripCarrierInfo(
  exec: Executor,
  tripId: number,
  patch: Record<string, unknown>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  // Same insert-only-defaults rule as upsertTripFinancialState: an update
  // patch must never reset carrierType back to 'OWN'.
  const values = { ...patch, carrierType: (patch.carrierType as string | null | undefined) ?? 'OWN' };
  await exec.insert(s.tripCarrierInfo)
    .values({ tripId, ...values } as typeof s.tripCarrierInfo.$inferInsert)
    .onConflictDoUpdate({
      target: s.tripCarrierInfo.tripId,
      set: { ...patch, updatedAt: new Date() } as Partial<typeof s.tripCarrierInfo.$inferInsert>,
    });
}

export type TripCompositeRow = Awaited<ReturnType<typeof getTripComposite>>;

/**
 * The composed select shape for explicit join queries — same field set as the
 * `trips_composite` view. Use with:
 *   db.select(tripCompositeSelect()).from(s.trips)
 *     .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
 *     .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
 * Needed where `.for('update')` row locks are taken (views cannot be locked);
 * plain readers should query `s.tripsComposite` instead.
 */
export function tripCompositeSelect() {
  return { ...selectOpsColumns(), ...selectFinancialColumns(), ...selectCarrierColumns() };
}

/**
 * Fetch the composed trip (ops + financial + carrier) — the pre-split
 * `select().from(trips)` row shape, minus the sidecar bookkeeping columns
 * (their id/createdAt/updatedAt).
 */
export async function getTripComposite(tripId: number) {
  const [row] = await db.select({
    ...selectOpsColumns(),
    ...selectFinancialColumns(),
    ...selectCarrierColumns(),
  })
    .from(s.trips)
    .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .where(eq(s.trips.id, tripId))
    .limit(1);
  return row ?? null;
}

/** Apply a mixed patch across trips + both sidecars on one executor. */
export async function applyTripPatch(
  exec: Executor,
  tripId: number,
  patch: Record<string, unknown>,
): Promise<void> {
  const { ops, financial, carrier } = splitTripPatch(patch);
  if (Object.keys(ops).length > 0) {
    await exec.update(s.trips).set(ops).where(eq(s.trips.id, tripId));
  }
  await upsertTripFinancialState(exec, tripId, financial);
  await upsertTripCarrierInfo(exec, tripId, carrier);
}

/**
 * Create a trip and its two sidecar rows on one executor. `values` may mix
 * operational, financial and carrier fields (the pre-split insert shape);
 * each field lands in its owning table. Returns the composed row. Wrap in a
 * transaction when the caller needs all three inserts atomic (trip-create
 * does; seeds/scripts may pass `db` directly).
 */
export async function insertTripComposite(exec: Executor, values: Record<string, unknown>) {
  const { ops, financial, carrier } = splitTripPatch(values);
  const [trip] = await exec.insert(s.trips)
    .values(ops as typeof s.trips.$inferInsert)
    .returning({ id: s.trips.id });
  if (!trip) throw new Error('insertTripComposite: trips insert returned no row');
  await upsertTripFinancialState(exec, trip.id, financial);
  await upsertTripCarrierInfo(exec, trip.id, carrier);
  const composed = await getTripCompositeInTx(exec, trip.id);
  if (!composed) throw new Error(`insertTripComposite: composed row missing for trip ${trip.id}`);
  return composed;
}

export async function getTripCompositeInTx(tx: Executor, tripId: number) {
  const rows = await tx.select({
    ...selectOpsColumns(),
    ...selectFinancialColumns(),
    ...selectCarrierColumns(),
  })
    .from(s.trips)
    .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .where(eq(s.trips.id, tripId))
    .limit(1);
  return rows[0] ?? null;
}

// Select-shape helpers — the pre-split full trips row, sourced from the three
// tables. Mirrors the trips_composite view column list.
function selectOpsColumns() {
  const t = s.trips;
  return {
    id: t.id, tripCode: t.tripCode, version: t.version, createdBy: t.createdBy,
    customerId: t.customerId, customerReference: t.customerReference, truckId: t.truckId,
    driverId: t.driverId, routeId: t.routeId, trailerId: t.trailerId, trailerType: t.trailerType,
    cargoTypeId: t.cargoTypeId, containerCount: t.containerCount, status: t.status,
    departureDate: t.departureDate, plannedStartAt: t.plannedStartAt, plannedEndAt: t.plannedEndAt,
    canonicalOrigin: t.canonicalOrigin, canonicalDestination: t.canonicalDestination,
    cargoWeightKg: t.cargoWeightKg, vehicleCapacityKg: t.vehicleCapacityKg,
    activeTripPairId: t.activeTripPairId, activeTripPairOrder: t.activeTripPairOrder,
    fuelMode: t.fuelMode, fuelLitersOverride: t.fuelLitersOverride,
    fuelSupplementLiters: t.fuelSupplementLiters, fuelSupplementReason: t.fuelSupplementReason,
    tollsDiscount: t.tollsDiscount, tollsAddition: t.tollsAddition, tollsStations: t.tollsStations,
    hasReturnCargo: t.hasReturnCargo, notes: t.notes, costSubmissionNote: t.costSubmissionNote,
    shipmentId: t.shipmentId, fulfillmentId: t.fulfillmentId,
    sourceShipmentVersion: t.sourceShipmentVersion, completedAt: t.completedAt,
    podRecoveredAt: t.podRecoveredAt, podRecoveredBy: t.podRecoveredBy,
    paperOrderCollectedAt: t.paperOrderCollectedAt, paperOrderCollectedBy: t.paperOrderCollectedBy,
    instructionContactName: t.instructionContactName,
    instructionContactPhone: t.instructionContactPhone, instructionNotes: t.instructionNotes,
    createdAt: t.createdAt, updatedAt: t.updatedAt, deletedAt: t.deletedAt,
  };
}

function selectFinancialColumns() {
  const f = s.tripFinancialState;
  return {
    driverSalary: f.driverSalary, fuelPriceApplied: f.fuelPriceApplied,
    fuelActualUnitPrice: f.fuelActualUnitPrice, roadAllowanceBaseApplied: f.roadAllowanceBaseApplied,
    fuelLoadedNormApplied: f.fuelLoadedNormApplied, fuelEmptyNormApplied: f.fuelEmptyNormApplied,
    fuelFixedAllowanceApplied: f.fuelFixedAllowanceApplied,
    fuelSupplementNormApplied: f.fuelSupplementNormApplied,
    tollPerStationApplied: f.tollPerStationApplied, returnCargoBonusApplied: f.returnCargoBonusApplied,
    fuelLiters: f.fuelLiters, totalFuelCost: f.totalFuelCost,
    fuelSurchargeAmount: f.fuelSurchargeAmount, fuelSurchargeSnapshot: f.fuelSurchargeSnapshot,
    fuelSurchargeSnapshotDirty: f.fuelSurchargeSnapshotDirty,
    totalRoadAllowance: f.totalRoadAllowance, tollCost: f.tollCost, tollDeduction: f.tollDeduction,
    roadAllowanceOverride: f.roadAllowanceOverride, totalCost: f.totalCost, revenue: f.revenue,
    revenueEmptyReturn: f.revenueEmptyReturn, revenueCombine: f.revenueCombine,
    twoPointDeliveryBonus: f.twoPointDeliveryBonus, vehicleShiftAllowance: f.vehicleShiftAllowance,
    grossProfit: f.grossProfit, revenueOriginal: f.revenueOriginal,
    revenueOverriddenBy: f.revenueOverriddenBy, revenueOverriddenAt: f.revenueOverriddenAt,
    revenueOverrideReason: f.revenueOverrideReason, pricingSource: f.pricingSource,
    pricingFormula: f.pricingFormula, pricingSnapshot: f.pricingSnapshot,
    customerCommission: f.customerCommission, tripWageDays: f.tripWageDays,
    fuelSupplierId: f.fuelSupplierId, vatRate: f.vatRate, arCostHash: f.arCostHash,
    arSnapshotDirty: f.arSnapshotDirty, arSnapshotChangedAt: f.arSnapshotChangedAt,
    apCostHash: f.apCostHash, apSnapshotDirty: f.apSnapshotDirty,
    apSnapshotChangedAt: f.apSnapshotChangedAt, pnlSnapshotGrossProfit: f.pnlSnapshotGrossProfit,
  };
}

function selectCarrierColumns() {
  const c = s.tripCarrierInfo;
  return {
    carrierType: c.carrierType, externalEntityId: c.externalEntityId,
    externalEntityType: c.externalEntityType, externalFreightCost: c.externalFreightCost,
    externalPlateNumber: c.externalPlateNumber, externalCarrierVehicleId: c.externalCarrierVehicleId,
    externalDriverName: c.externalDriverName, externalDriverPhone: c.externalDriverPhone,
  };
}
