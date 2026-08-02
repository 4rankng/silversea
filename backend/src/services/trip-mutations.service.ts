// Trip Mutations — Create, update, reassign, and departure date change functions
// All write operations that modify trip data

import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { canonicalShipmentStatus, TripStatus, FuelMode, Role, TxnType } from '@tingting/shared';
import type { TripLegInput } from '@tingting/shared';
import { resolveTripDriverSalary, computeTripTotals, type ComputeTripTotalsOutput } from '@tingting/shared';
import { ApiError } from '../errors';
import { resolveFreightPrice, resolveFuelSurcharge } from './pricing.service';
import { resolveFuelNorm } from './fuel.service';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';
import { propagateTripFinancialSourceChange } from './source-change.service';
import { createFinancialPosting, getActiveFinancialPosting } from './financial-posting.service';
import { captureProfitabilityAttributionSnapshot } from './profitability.service';
import { SnapshotServices } from './snapshot-services';

// Postgres unique-violation detector — 23505 is the SQLSTATE for any unique
// constraint violation. Drizzle wraps the underlying postgres-js error, so the
// code may live on either `err.code` (postgres-js direct) or `err.cause.code`
// (Drizzle-wrapped). Mirrors `shipment.service.ts`'s helper.
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === '23505' || e.cause?.code === '23505';
}

/**
 * M2.3: Build the full visible pricing formula: freight + VAT.
 * The freight component comes from resolveFreightPrice (e.g.
 * "15000kg × 4.500 ₫/kg = 67.500.000 ₫"). This appends the VAT line
 * when vatRate > 0, producing e.g. "15000kg × 4.500 ₫/kg = 67.500.000 ₫ + VAT 10% = 74.250.000 ₫".
 * Surcharges (twoPointDeliveryBonus, vehicleShiftAllowance) are 0 at createTrip
 * time and added later via updateTripFigures — they don't appear here.
 */
function buildFullPricingFormula(freightFormula: string, freightPrice: number, vatRate: number): string {
  if (vatRate > 0) {
    const vatMultiplier = 1 + vatRate;
    const totalInclVat = Math.round(freightPrice * vatMultiplier);
    return `${freightFormula} + VAT ${(vatRate * 100).toFixed(0)}% = ${totalInclVat.toLocaleString('vi-VN')} ₫`;
  }
  return freightFormula;
}

export function assertCustomerCommissionWithinRevenue(
  revenueInclVat: number,
  vatRate: number,
  customerCommission: number,
): void {
  const freightExVat = vatRate > 0
    ? Math.round(revenueInclVat / (1 + vatRate))
    : revenueInclVat;
  if (customerCommission > freightExVat) {
    throw new ApiError(
      400,
      'Hoa hồng khách hàng không được lớn hơn doanh thu chưa VAT',
    );
  }
}
import { resolveTrailer } from './trip-shared';
import type { Tx } from './trip-shared';
import { requirePersistedTripGovernanceAuthorization } from './trip-governance-authorization.service';
import { assertActiveApprovalApplication } from './governance-transition.service';
import { LedgerService } from './ledger.service';
import { assertCreditLimit, consumeShipmentCreditOverride } from './credit-limit.service';

// ─── B3 / D4: committed-legacy fuel freeze ──────────────────────────────────

export interface CommittedLegacyFuelInput {
  status: TripStatus;
  fuelPriceApplied: number;
  fuelLoadedNormApplied: number;
  fuelEmptyNormApplied: number;
  storedFuelCost: number;
  storedFuelLiters: number;
}

type FuelTotals = Pick<ComputeTripTotalsOutput, 'totalFuelCost' | 'totalCost' | 'grossProfit' | 'totalFuelLiters'>;

/**
 * Pin the fuel component of a committed legacy trip's totals to its stored
 * values (B3 / D4).
 *
 * Legacy trips created before fuel snapshots have `fuel_price_applied` /
 * `fuel_loaded_norm_applied` / `fuel_empty_norm_applied` all at 0. Their rows
 * predate `fuel_price_history`, so the effective price they were costed at
 * CANNOT be reconstructed (qa/feedback-repro-log.md §3/§7). The old behaviour
 * read LIVE fuel config on update, which recosts stored totals against today's
 * price the moment the price moves — a silent retroactive P&L rewrite.
 *
 * For committed trips (IN_TRANSIT / COMPLETED) with missing fuel
 * snapshots, `updateTripFigures` now skips the live fallback, so
 * `computeTripTotals` runs with the 0 sentinel price and its fuel outputs are
 * ~0. This helper restores the stored cost, propagates the delta to totalCost
 * / grossProfit, and holds litres at the stored value — guaranteeing the
 * stored `totalFuelCost` is preserved exactly (tolerance 0 VND) regardless of
 * the recomputed litres (which round to integers and can diverge from a stored
 * decimal value). Revenue, tolls and salary still flow through
 * `computeTripTotals` normally; only the unreconstructable fuel cost is frozen.
 *
 * Pure (no DB / req) so it is exercised by a data-driven unit test. Returns a
 * fresh object rather than mutating, so the caller stays explicit.
 *
 * (The road / allowance live-fallbacks share this latent shape but are outside
 * D4's fuel scope — see repro log §8.)
 */
export function applyCommittedLegacyFuelFreeze(
  trip: CommittedLegacyFuelInput,
  computed: FuelTotals,
): FuelTotals {
  const isCommitted = trip.status === TripStatus.IN_TRANSIT
    || trip.status === TripStatus.COMPLETED;
  const snapshotMissing = trip.fuelPriceApplied === 0
    && trip.fuelLoadedNormApplied === 0
    && trip.fuelEmptyNormApplied === 0;
  if (!isCommitted || !snapshotMissing) {
    return { ...computed };
  }

  const storedLiters = Math.round(trip.storedFuelLiters);
  const storedCost = Math.round(trip.storedFuelCost);
  const delta = storedCost - computed.totalFuelCost;
  return {
    totalFuelCost: storedCost,
    totalCost: computed.totalCost + delta,
    grossProfit: computed.grossProfit - delta,
    totalFuelLiters: storedLiters,
  };
}

// ─── Revenue resolution (pure, unit-tested) ────────────────────────────────

/** Revenue fields a trip-figures update may carry. The signaling contract is
 *  load-bearing: `undefined` means "not provided / leave stored alone", `0`
 *  means "explicit zero". The frontend must send `undefined` (never `0`) for
 *  untouched split fields — otherwise every save zeroes stored revenue
 *  (feedback202606 A3 §9; see tests/revenue-persistence). */
export interface RevenueUpdateInput {
  revenue?: number;
  revenueEmptyReturn?: number;
  revenueCombine?: number;
  /** M2.1: mandatory reason when overriding an auto-computed (TIER/TABLE) revenue. */
  revenueOverrideReason?: string;
}

/** Stored trip revenue fields (drizzle numeric columns → string | null). */
export interface StoredRevenue {
  revenue?: string | number | null;
  revenueEmptyReturn?: string | number | null;
  revenueCombine?: string | number | null;
}

/**
 * Resolve the persisted trip `revenue` from a figures update. Revenue is
 * split-based in the UI (empty-return leg + combined-load leg); the `revenue`
 * field itself is derived. Rules:
 *   - any split provided  → sum(provided splits; unprovided use stored value)
 *   - else direct revenue → use it (non-UI callers)
 *   - else                → preserve stored revenue (nothing changed)
 * `undefined` = not-provided throughout; `0` is an explicit zero. Pure so the
 * contract is unit-testable.
 */
export function resolveRevenue(data: RevenueUpdateInput, stored: StoredRevenue): number {
  const splitProvided = data.revenueEmptyReturn !== undefined || data.revenueCombine !== undefined;
  if (splitProvided) {
    const emptyReturn = data.revenueEmptyReturn !== undefined
      ? data.revenueEmptyReturn
      : Number(stored.revenueEmptyReturn || 0);
    const combine = data.revenueCombine !== undefined
      ? data.revenueCombine
      : Number(stored.revenueCombine || 0);
    return emptyReturn + combine;
  }
  if (data.revenue !== undefined) return data.revenue;
  return Number(stored.revenue || 0);
}

/**
 * Whether this update should stamp the revenue-override audit fields
 * (`revenueOriginal` / `revenueOverriddenBy` / `revenueOverriddenAt`). Fires
 * only when a provided revenue value actually differs from stored — sending
 * `undefined` (untouched) never fires. Pure for testability.
 */
export function shouldMarkRevenueOverride(data: RevenueUpdateInput, stored: StoredRevenue): boolean {
  return (
    (data.revenue !== undefined && data.revenue !== Number(stored.revenue || 0)) ||
    (data.revenueEmptyReturn !== undefined && data.revenueEmptyReturn !== Number(stored.revenueEmptyReturn || 0)) ||
    (data.revenueCombine !== undefined && data.revenueCombine !== Number(stored.revenueCombine || 0))
  );
}

// ─── createTrip ─────────────────────────────────────────────────────────────

type TripRow = typeof s.trips.$inferSelect;
type TripInsert = typeof s.trips.$inferInsert;
type TripLegRow = typeof s.tripLegs.$inferSelect;

const COPY_EXCLUDED_TRIP_FIELDS = new Set<keyof TripRow>([
  'id',
  'tripCode',
  'version',
  'status',
  'completedAt',
  'createdBy',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'revenueOverriddenBy',
  'revenueOverriddenAt',
]);

/**
 * Copy persisted plan and financial values, while resetting identity,
 * lifecycle, deletion, and audit metadata for a genuinely new trip.
 */
export function buildCopiedTripValues(
  source: TripRow,
  tripCode: string,
  createdBy: number,
): TripInsert {
  const copiedFields = Object.fromEntries(
    Object.entries(source).filter(([key]) => !COPY_EXCLUDED_TRIP_FIELDS.has(key as keyof TripRow)),
  ) as Omit<TripInsert, 'tripCode'>;

  return {
    ...copiedFields,
    tripCode,
    version: 1,
    status: TripStatus.CREATED,
    completedAt: null,
    createdBy,
    deletedAt: null,
    // The copied current revenue is the new trip's baseline. Carrying the
    // source's pre-override baseline would create audit history that never
    // happened on this new trip.
    revenueOriginal: source.revenue,
    revenueOverriddenBy: null,
    revenueOverriddenAt: null,
  };
}

export function buildCopiedTripLegValues(source: TripLegRow, tripId: number) {
  return {
    tripId,
    sequence: source.sequence,
    origin: source.origin,
    destination: source.destination,
    km: source.km,
    loadingType: source.loadingType,
    calculatedLiters: source.calculatedLiters,
  };
}

async function generateTripCode(tx: Tx, departureDateValue: string): Promise<string> {
  const departureDate = new Date(departureDateValue);
  const year = departureDate.getFullYear();
  const month = String(departureDate.getMonth() + 1).padStart(2, '0');
  const yearMonth = `${year}${month}`;

  const [counterRow] = await tx.insert(s.tripCodeCounters)
    .values({ yearMonth, counter: 1 })
    .onConflictDoUpdate({
      target: s.tripCodeCounters.yearMonth,
      set: { counter: sql`${s.tripCodeCounters.counter} + 1` },
    })
    .returning();

  return `TRP-${yearMonth}-${String(counterRow.counter).padStart(4, '0')}`;
}

export async function createTrip(data: {
  customerId: number;
  routeId: number;
  truckId?: number | null;
  driverId?: number | null;
  cargoTypeId?: number | null;
  departureDate: string;
  customerReference?: string;
  containerCount?: number;
  containerTypeId?: number | null;
  fuelMode?: FuelMode;
  createdBy?: number;
  vatRate?: number;
  carrierType?: 'OWN' | 'EXTERNAL';
  externalCarrierId?: number | null;
  externalFreightCost?: number | null;
  externalPlateNumber?: string | null;
  externalDriverName?: string | null;
  externalDriverPhone?: string | null;
  fuelSupplierId?: number | null;
  fuelActualUnitPrice?: number | null;
  // Wave 0: optional link to the shipment this trip fulfills. When set, the
  // shipment must exist + still be open for dispatching, and the shipment's containers are
  // snapshotted into the new trip. When
  // absent, the trip is created without a shipment link (legacy behaviour).
  shipmentId?: number | null;
  creditApprovalRequestId?: number | null;
  createdByRole?: Role;
}, transaction?: Tx) {
  const execute = async (tx: Tx) => {
    const containerCount = data.containerCount ?? 1;
    let authoritativeCargoTypeId = data.cargoTypeId ?? null;
    let sourceShipmentVersion: number | null = null;

    // 0. Wave 0: if a shipmentId was provided, validate the shipment up front
    //    so a bad link fails the create cleanly (404 / 409) rather than
    //    silently inserting an unlinked trip. The cross-check runs in the
    //    same transaction so a concurrent shipment soft-delete/cancel is
    //    visible. We do NOT advance the shipment's status here — advancing
    //    remains the dispatch endpoint's responsibility. This keeps the two
    //    flows orthogonal: trip-create LINKS, dispatch ADVANCES.
    if (data.shipmentId != null) {
      const [shipment] = await tx.select({
        id: s.shipments.id,
        status: s.shipments.status,
        customerId: s.shipments.customerId,
        cargoTypeId: s.shipments.cargoTypeId,
        version: s.shipments.version,
      })
        .from(s.shipments)
        .where(and(eq(s.shipments.id, data.shipmentId), isNull(s.shipments.deletedAt)))
        .for('update')
        .limit(1);
      if (!shipment) {
        throw new ApiError(404, 'Không tìm thấy lô hàng');
      }
      const shipmentStatus = canonicalShipmentStatus(shipment.status);
      if (shipmentStatus !== 'NEW' && shipmentStatus !== 'DISPATCHED') {
        throw new ApiError(
          409,
          `Không thể gắn lô hàng ở trạng thái "${shipmentStatus ?? shipment.status}".`,
        );
      }
      if (shipment.customerId !== data.customerId) {
        throw new ApiError(
          400,
          'Lô hàng không thuộc khách hàng của chuyến đi.',
        );
      }
      if (shipment.cargoTypeId != null && data.cargoTypeId != null && shipment.cargoTypeId !== data.cargoTypeId) {
        throw new ApiError(
          409,
          'Loại hàng của chuyến không khớp với lô hàng nguồn.',
        );
      }
      if (shipment.cargoTypeId == null && data.cargoTypeId != null) {
        const [seededShipment] = await tx.update(s.shipments)
          .set({
            cargoTypeId: data.cargoTypeId,
            version: sql`${s.shipments.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(s.shipments.id, shipment.id))
          .returning({
            cargoTypeId: s.shipments.cargoTypeId,
            version: s.shipments.version,
          });
        authoritativeCargoTypeId = seededShipment?.cargoTypeId ?? data.cargoTypeId;
        sourceShipmentVersion = seededShipment?.version ?? (shipment.version + 1);
      } else {
        authoritativeCargoTypeId = shipment.cargoTypeId ?? data.cargoTypeId ?? null;
        sourceShipmentVersion = shipment.version;
      }
    }

    // 1. Pricing resolution — replaced the inline pricing_tables lookup with
    //    the Wave 1 resolveFreightPrice service. This handles BOTH the
    //    fixed-price model (TABLE) AND the new weight-tier model (TIER),
    //    falling back to MANUAL (price 0) when no pricing exists — same
    //    behavior as before for routes without a pricing table.
    const freightPrice = await resolveFreightPrice({
      customerId: data.customerId,
      routeId: data.routeId,
      cargoTypeId: authoritativeCargoTypeId,
      date: data.departureDate,
      containerCount,
    });

    const revenue = freightPrice.price;

    const creditCheck = await assertCreditLimit({
      customerId: data.customerId,
      proposedAmount: revenue,
      approvalRequestId: data.creditApprovalRequestId ?? null,
      shipmentId: data.shipmentId ?? null,
      transaction: tx,
    });

    // 2. Fuel-norm resolution — replaced the inline fuel_config lookup with
    //    the Wave 1 resolveFuelNorm service. This resolves per-route/per-
    //    truck norms from fuel_norms, falling back to the legacy fuel_config
    //    singleton. Same values when only fuel_config exists.
    const fuelNorm = await resolveFuelNorm({
      routeId: data.routeId,
      truckId: data.truckId ?? undefined,
      date: data.departureDate,
    });

    const [route] = await tx.select().from(s.routes).where(eq(s.routes.id, data.routeId)).limit(1);
    if (!route) {
      throw new ApiError(400, 'Tuyến đường không tồn tại');
    }

    const [roadCfg] = await tx.select().from(s.roadConfig).limit(1);

    let trailerId: number | null = null;
    let trailerType: '20FT' | '40FT' | null = null;

    if ((data.carrierType ?? 'OWN') === 'OWN' && data.truckId) {
      const [truck] = await tx.select().from(s.trucks).where(eq(s.trucks.id, data.truckId)).limit(1);
      if (!truck) {
        throw new ApiError(400, 'Xe đầu kéo không tồn tại');
      }
      const resolved = await resolveTrailer(tx, truck.currentTrailerId);
      trailerId = resolved.trailerId;
      trailerType = (resolved.trailerType || truck.trailerType || '40FT') as '20FT' | '40FT';
    }

    // Look up road allowance base for snapshotted column
    let roadAllowanceBase = 0;
    if (trailerType) {
      const [allowance] = await tx.select().from(s.roadAllowances).where(
        and(
          eq(s.roadAllowances.routeId, data.routeId),
          eq(s.roadAllowances.trailerType, trailerType),
          isNull(s.roadAllowances.deletedAt)
        )
      ).limit(1);
      roadAllowanceBase = allowance ? Number(allowance.baseAmount) : 0;
    }

    // Fuel-norm snapshot values come from the resolved norm. When source is
    // FUEL_CONFIG (legacy singleton), the values are identical to the old
    // inline lookup. When source is FUEL_NORMS, the per-route/per-truck
    // values are used. The fuel unit price still comes from fuel_config
    // (it's a global price, not per-route) — this matches the existing model.
    const [fuelCfgForPrice] = await tx.select().from(s.fuelConfig).where(isNull(s.fuelConfig.deletedAt)).limit(1);
    const fuelPriceApplied = fuelCfgForPrice ? Number(fuelCfgForPrice.unitPrice) : 0;
    const fuelLoadedNormApplied = fuelNorm.loadedLitersPer100Km;
    const fuelEmptyNormApplied = fuelNorm.emptyLitersPer100Km;
    const fuelFixedAllowanceApplied = route.fixedFuelAllowance ? Number(route.fixedFuelAllowance) : 0;
    const fuelSupplementNormApplied = fuelNorm.supplementLiters;
    const tollPerStationApplied = roadCfg ? Number(roadCfg.tollPerStation) : 0;
    const returnCargoBonusApplied = roadCfg ? Number(roadCfg.returnCargoBonus) : 0;

    // Rev1 §B1 requires the surcharge as soon as the shipment/trip is created.
    // At this point there are no persisted trip legs yet, so use the route's
    // canonical default legs (or its single distance as a loaded-leg fallback)
    // with the same shared fuel calculation used by later actuals. A subsequent
    // figures update replaces this estimate with the actual leg snapshot.
    const initialFuelLegs = route.defaultLegs?.length
      ? route.defaultLegs.map((leg, index) => ({
          sequence: index + 1,
          km: leg.km,
          loadingType: leg.loadingType,
        }))
      : route.distanceKm && route.distanceKm > 0
        ? [{ sequence: 1, km: route.distanceKm, loadingType: 'HANG' as const }]
        : [];
    const initialFuelTotals = computeTripTotals({
      legs: initialFuelLegs,
      fuelMode: data.fuelMode ?? FuelMode.AUTO,
      fuelLitersOverride: null,
      fuelSupplementLiters: 0,
      fuelLoadedNorm: fuelLoadedNormApplied,
      fuelEmptyNorm: fuelEmptyNormApplied,
      fuelPerTripSupplement: fuelSupplementNormApplied,
      fuelUnitPrice: fuelPriceApplied,
      fuelActualUnitPrice: data.fuelActualUnitPrice ?? null,
      isMountainRoute: !!route.isMountain,
      mountainFixedAllowance: fuelFixedAllowanceApplied > 0 ? fuelFixedAllowanceApplied : null,
      roadAllowanceBase,
      tollsDiscount: 0,
      tollsAddition: 0,
      tollsStations: route.tollsStations ?? 0,
      tollPerStation: tollPerStationApplied,
      hasReturnCargo: false,
      returnCargoBonus: returnCargoBonusApplied,
      revenue,
      driverSalary: 0,
      twoPointDeliveryBonus: 0,
      vehicleShiftAllowance: 0,
      vatRate: data.vatRate ?? 0,
      carrierType: data.carrierType ?? 'OWN',
      externalFreightCost: data.externalFreightCost ?? 0,
    });
    const initialFuelSurcharge = await resolveFuelSurcharge({
      customerId: data.customerId,
      fuelLiters: initialFuelTotals.totalFuelLiters,
      date: new Date(`${data.departureDate}T00:00:00.000Z`),
    });

    // 3. Atomic tripCode generation
    const tripCode = await generateTripCode(tx, data.departureDate);

    // 4. Create trip with snapshotted rates. The trip is inserted with
    //    shipmentId = NULL even when one was provided — the link is set in a
    //    guarded UPDATE below (see step 4b) so a concurrent createTrip
    //    against the same shipment surfaces as a clean 409 with a domain
    //    message rather than a generic 23505.
    const [trip] = await tx.insert(s.trips).values({
      tripCode,
      version: 1,
      createdBy: data.createdBy ?? null,
      customerId: data.customerId,
      routeId: data.routeId,
      trailerId,
      trailerType,
      truckId: data.truckId ?? null,
      driverId: data.driverId ?? null,
      cargoTypeId: authoritativeCargoTypeId,
      containerCount,
      departureDate: data.departureDate,
      customerReference: data.customerReference ?? null,
      status: TripStatus.CREATED,
      shipmentId: null,
      sourceShipmentVersion,
      fuelSupplierId: data.fuelSupplierId ?? null,
      // Persist the chosen fuel mode (defaults to AUTO at the DB layer).
      fuelMode: data.fuelMode ?? FuelMode.AUTO,
      // Per-trip actual pump price (nullable). fuelPriceApplied stays the config
      // snapshot; the effective price = actual ?? snapshot is resolved at read.
      fuelActualUnitPrice: data.fuelActualUnitPrice != null ? String(data.fuelActualUnitPrice) : null,
      revenue: String(revenue),
      revenueEmptyReturn: String(revenue),
      revenueCombine: '0',
      twoPointDeliveryBonus: '0',
      vehicleShiftAllowance: '0',
      revenueOriginal: String(revenue),

      // Wave 1: pricing-source snapshot. Populated by resolveFreightPrice
      // so accountants can distinguish AUTO (TIER/TABLE) from MANUAL.
      pricingSource: freightPrice.source,
      // M2.3: enhance the base freight formula with surcharges + VAT so the
      // UI shows the complete revenue breakdown. When the source is MANUAL,
      // keep the original "thủ công" message.
      pricingFormula: freightPrice.source === 'MANUAL' ? freightPrice.formula
        : buildFullPricingFormula(freightPrice.formula, freightPrice.price,
            data.vatRate ?? 0),
      pricingSnapshot: freightPrice.snapshot,

      // Snapshots
      fuelPriceApplied: String(fuelPriceApplied),
      roadAllowanceBaseApplied: String(roadAllowanceBase),
      fuelLoadedNormApplied: String(fuelLoadedNormApplied),
      fuelEmptyNormApplied: String(fuelEmptyNormApplied),
      fuelFixedAllowanceApplied: String(fuelFixedAllowanceApplied),
      fuelSupplementNormApplied: String(fuelSupplementNormApplied),
      tollPerStationApplied: String(tollPerStationApplied),
      returnCargoBonusApplied: String(returnCargoBonusApplied),
      fuelSurchargeAmount: String(initialFuelSurcharge.amount),
      fuelSurchargeSnapshot: initialFuelSurcharge.snapshot as unknown as Record<string, unknown>,
      fuelSurchargeSnapshotDirty: false,

      // External fields
      vatRate: data.vatRate !== undefined ? String(data.vatRate) : '0.000',
      carrierType: data.carrierType ?? 'OWN',
      externalEntityId: data.externalCarrierId ?? null,
      externalEntityType: data.externalCarrierId != null ? 'CUSTOMER' : null,
      externalFreightCost: data.externalFreightCost !== undefined && data.externalFreightCost !== null ? String(data.externalFreightCost) : null,
      externalPlateNumber: data.externalPlateNumber ?? null,
      externalDriverName: data.externalDriverName ?? null,
      externalDriverPhone: data.externalDriverPhone ?? null,
    }).returning();

    if (data.containerTypeId != null) {
      await tx.insert(s.tripContainers).values(
        Array.from({ length: containerCount }, () => ({
          tripId: trip.id,
          containerTypeId: data.containerTypeId,
          containerNumber: null,
          sealNumber: null,
          createdBy: data.createdBy ?? null,
        })),
      );
    }

    // Wave 0: if a shipmentId was provided, snapshot the shipment's real
    // containers into the trip. The default empty rows inserted above are
    // kept so a shipment with no
    // containers still has `containerCount` placeholder rows to render in
    // the trip UI; the snapshot ADDS the real ones when present. The snapshot
    // helper is idempotent and carries a `__shipment_snapshot:<id>` marker.
    if (data.shipmentId != null) {
      // Imported lazily to avoid a circular import at module init:
      // shipment.service.ts imports trip-command.service.ts (which imports
      // trip.service.ts → trip-mutations.service.ts → back here). Deferring
      // the import to call-time breaks the cycle.
      const { snapshotContainersIntoTrip } = await import('./shipment.service.js');
      await snapshotContainersIntoTrip(data.shipmentId, trip.id, data.createdBy ?? null, tx);

      // 4b. Link the trip to the shipment via UPDATE so a concurrent
      //     createTrip against the same shipment surfaces as a clean domain
      //     409 (not a generic 23505 "Dữ liệu đã tồn tại"). The partial
      //     unique index `trips_shipment_id_live_uniq` is the concurrency
      //     guard. On conflict the whole transaction rolls back (including
      //     the trip insert + snapshot), so no orphan trip persists — the
      //     loser just gets a clear 409 and can refresh to see the winner's
      //     trip.
      try {
        const [linked] = await tx.update(s.trips)
          .set({ shipmentId: data.shipmentId })
          .where(eq(s.trips.id, trip.id))
          .returning();
        // Refresh the local trip object so callers see the post-link state.
        if (linked) {
          // Object.assign preserves the identity consumers may already hold
          // while picking up the new shipmentId.
          Object.assign(trip, linked);
        }
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ApiError(
            409,
            'Lô hàng đã được gắn vào một chuyến khác. Vui lòng tải lại.',
          );
        }
        throw err;
      }
    }

    await consumeShipmentCreditOverride(creditCheck.overrideRequest, trip.id, tx);

    // Audit row is produced by auditLogMiddleware on POST /api/trips as
    // "Quản lý <actor> tạo lệnh vận chuyển <tripCode>". A service-level write
    // here would duplicate that row, so we deliberately skip it.

    return trip;
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}

// ─── copyTrip ────────────────────────────────────────────────────────────────

export async function copyTrip(sourceTripId: number, createdBy: number, transaction?: Tx) {
  const execute = async (tx: Tx) => {
    const [source] = await tx.select()
      .from(s.trips)
      .where(and(eq(s.trips.id, sourceTripId), isNull(s.trips.deletedAt)))
      .limit(1);
    if (!source) throw new ApiError(404, 'Không tìm thấy chuyến cần copy');

    const tripCode = await generateTripCode(tx, source.departureDate);
    const [trip] = await tx.insert(s.trips)
      .values(buildCopiedTripValues(source, tripCode, createdBy))
      .returning();

    const sourceLegs = await tx.select()
      .from(s.tripLegs)
      .where(eq(s.tripLegs.tripId, sourceTripId))
      .orderBy(s.tripLegs.sequence);
    if (sourceLegs.length > 0) {
      await tx.insert(s.tripLegs).values(
        sourceLegs.map((leg) => buildCopiedTripLegValues(leg, trip.id)),
      );
    }

    const sourceContainers = await tx.select()
      .from(s.tripContainers)
      .where(eq(s.tripContainers.tripId, sourceTripId))
      .orderBy(s.tripContainers.id);
    if (sourceContainers.length > 0) {
      await tx.insert(s.tripContainers).values(sourceContainers.map((container) => ({
        tripId: trip.id,
        containerTypeId: container.containerTypeId,
        cargoWeightKg: container.cargoWeightKg,
        notes: container.notes,
        createdBy,
        // Container/seal numbers identify physical execution and must be new.
        containerNumber: null,
        sealNumber: null,
      })));
    }

    const [instructions] = await tx.select()
      .from(s.tripInstructions)
      .where(eq(s.tripInstructions.tripId, sourceTripId))
      .limit(1);
    if (instructions) {
      await tx.insert(s.tripInstructions).values({
        tripId: trip.id,
        contactName: instructions.contactName,
        contactPhone: instructions.contactPhone,
        notes: instructions.notes,
        updatedBy: createdBy,
      });
    }

    return trip;
  };
  return transaction
    ? execute(transaction)
    : db.transaction(execute, { isolationLevel: 'repeatable read' });
}

// ─── updateTripFigures ──────────────────────────────────────────────────────

export type TripFigureUpdateInput = {
    legs: TripLegInput[];
    customerId?: number;
    departureDate?: string;
    completedAt?: string;
    fuelMode: FuelMode;
    fuelLitersOverride?: number | null;
    fuelSupplementLiters?: number;
    fuelSupplementReason?: string;
    fuelActualUnitPrice?: number | null;
    fuelSupplierId?: number | null;
    tollsDiscount?: number;
    tollsAddition?: number;
    tollsStations?: number;
    /** O2C "kẹp hàng" backhaul toll dedup (PRD Bước 2). System-managed by the
     * trip-pairing flow; the figures-correction path preserves/echoes it so a
     * re-run does not silently drop the dedup. Undefined ⇒ keep existing trip row value. */
    tollDeduction?: number;
    hasReturnCargo?: boolean;
    roadAllowanceOverride?: number | null;
    driverSalary?: number;
    revenue?: number;
    revenueEmptyReturn?: number;
    revenueCombine?: number;
    /** M2.1: mandatory reason when overriding an auto-computed (TIER/TABLE) revenue. */
    revenueOverrideReason?: string;
    twoPointDeliveryBonus?: number;
    vehicleShiftAllowance?: number;
    customerCommission?: number;
    tripWageDays?: number;
    notes?: string;
    expectedVersion?: number;
    userId?: number;
    userRole?: Role;
    routeId?: number;
    carrierType?: 'OWN' | 'EXTERNAL';
    externalCarrierId?: number | null;
    externalFreightCost?: number | null;
    externalPlateNumber?: string | null;
    externalDriverName?: string | null;
    externalDriverPhone?: string | null;
    truckId?: number | null;
    driverId?: number | null;
    trailerType?: string | null;
};

export async function updateTripFigures(
  tripId: number,
  data: TripFigureUpdateInput,
  transaction?: Tx,
  governanceActionId?: number,
) {
  // Normalize leg distances to integers to satisfy strict database integer constraints and avoid PG 22P02 syntax errors
  const normalizedLegs = data.legs.map(leg => ({
    ...leg,
    km: Math.round(leg.km),
  }));

  const execute = async (tx: Tx) => {
    let governanceAuthorized = false;
    if (governanceActionId != null) {
      assertActiveApprovalApplication(tx, governanceActionId);
      await requirePersistedTripGovernanceAuthorization({
        tx,
        actionId: governanceActionId,
        tripId,
        tripVersion: data.expectedVersion ?? 0,
        actorId: data.userId ?? 0,
        actorRole: data.userRole ?? '',
        operation: 'EDIT_COMPLETED',
        mutationPayload: data,
      });
      governanceAuthorized = true;
    }
    await lockTripFinancialAuthority(tx, [tripId]);
    // 1. Fetch trip and check lock status
    // Use the same controlling-row-first lock order as lifecycle transitions.
    // This prevents a completed-trip edit from holding a customer ledger lock
    // while cancellation holds the trip row and waits for that same ledger
    // lock. It also makes the status/version checks below observe the committed
    // winner before any derived financial work starts.
    const [trip] = await tx.select().from(s.trips)
      .where(eq(s.trips.id, tripId))
      .limit(1)
      .for('update');
    if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    // O2C: costs stay editable after COMPLETED (no hard-freeze). A financial
    // edit on a completed trip requires a governed correction (the caller has
    // already established governanceAuthorized via the adjustment flow).
    if (trip.status === TripStatus.CANCELED) {
      throw new ApiError(400, 'Chuyến đi đã hủy, không thể sửa');
    }
    if (trip.status === TripStatus.COMPLETED && !governanceAuthorized) {
      throw new ApiError(
        409,
        'Số liệu tài chính của chuyến đã hoàn thành chỉ được thay đổi sau khi kiểm tra và phê duyệt',
      );
    }


    // 2. Optimistic concurrency check
    if (data.expectedVersion !== undefined && trip.version !== data.expectedVersion) {
      throw new ApiError(409, 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.');
    }

    const customerChanged = data.customerId !== undefined && data.customerId !== trip.customerId;
    if (customerChanged && trip.shipmentId != null) {
      throw new ApiError(
        409,
        'Chuyến đã gắn lô hàng; hãy đổi khách hàng từ lô hàng nguồn theo quy trình điều vận.',
      );
    }
    if (customerChanged && data.userRole !== Role.ADMIN && data.userRole !== Role.MANAGER) {
      throw new ApiError(403, 'Chỉ Quản lý hoặc Quản trị viên mới có quyền đổi khách hàng của lệnh vận chuyển');
    }

    if (customerChanged) {
      const [customer] = await tx.select({ id: s.customers.id })
        .from(s.customers)
        .where(and(
          eq(s.customers.id, data.customerId!),
          eq(s.customers.status, 'ACTIVE'),
          isNull(s.customers.deletedAt),
        ))
        .limit(1);
      if (!customer) throw new ApiError(400, 'Khách hàng không tồn tại hoặc đã ngừng hoạt động');

      if (trip.status === TripStatus.COMPLETED) {
        // Lock the old and new customer consistently before checking payment
        // history or moving the receivable, avoiding opposite A→B/B→A locks.
        for (const customerId of [trip.customerId, data.customerId!].sort((a, b) => a - b)) {
          await LedgerService.lockEntity(tx, 'CUSTOMER', customerId);
        }

        const [payment] = await tx.select({ id: s.ledger.id })
          .from(s.ledger)
          .where(and(
            eq(s.ledger.txnType, TxnType.PAYMENT_RECEIVED),
            eq(s.ledger.txnId, tripId),
            eq(s.ledger.entityType, 'CUSTOMER'),
            eq(s.ledger.entityId, trip.customerId),
          ))
          .limit(1);
        if (payment) {
          throw new ApiError(422, 'Chuyến đã phát sinh thanh toán; không thể đổi khách hàng');
        }
      }
    }

    let finalRouteId = trip.routeId;
    let fuelFixedAllowanceApplied = Number(trip.fuelFixedAllowanceApplied || 0);
    let roadAllowanceBaseApplied = Number(trip.roadAllowanceBaseApplied || 0);
    let route = null;

    const finalTrailerType = data.trailerType !== undefined ? data.trailerType : trip.trailerType;

    if (data.routeId !== undefined && data.routeId !== trip.routeId) {
      finalRouteId = data.routeId;
      const [newRoute] = await tx.select().from(s.routes).where(eq(s.routes.id, finalRouteId)).limit(1);
      if (newRoute) {
        route = newRoute;
        fuelFixedAllowanceApplied = Number(newRoute.fixedFuelAllowance || 0);
      }

      if (finalTrailerType) {
        const [allowance] = await tx.select().from(s.roadAllowances).where(
          and(
            eq(s.roadAllowances.routeId, finalRouteId),
            eq(s.roadAllowances.trailerType, finalTrailerType as '20FT' | '40FT'),
            isNull(s.roadAllowances.deletedAt)
          )
        ).limit(1);
        roadAllowanceBaseApplied = allowance ? Number(allowance.baseAmount) : 0;
      }
    } else {
      const [existingRoute] = await tx.select().from(s.routes).where(eq(s.routes.id, trip.routeId)).limit(1);
      route = existingRoute;

      if (data.trailerType !== undefined && data.trailerType !== trip.trailerType) {
        if (finalTrailerType) {
          const [allowance] = await tx.select().from(s.roadAllowances).where(
            and(
              eq(s.roadAllowances.routeId, finalRouteId),
              eq(s.roadAllowances.trailerType, finalTrailerType as '20FT' | '40FT'),
              isNull(s.roadAllowances.deletedAt)
            )
          ).limit(1);
          roadAllowanceBaseApplied = allowance ? Number(allowance.baseAmount) : 0;
        } else {
          roadAllowanceBaseApplied = 0;
        }
      }
    }

    // 3. Resolve snapshotted rates from trip row (set at creation time).
    // If any snapshot is null, the trip was created before config was enforced.
    let fuelPriceApplied = Number(trip.fuelPriceApplied || 0);
    let fuelLoadedNormApplied = Number(trip.fuelLoadedNormApplied || 0);
    let fuelEmptyNormApplied = Number(trip.fuelEmptyNormApplied || 0);
    let fuelSupplementNormApplied = Number(trip.fuelSupplementNormApplied || 0);
    let tollPerStationApplied = Number(trip.tollPerStationApplied || 0);
    let returnCargoBonusApplied = Number(trip.returnCargoBonusApplied || 0);

    // If snapshotted fuel rates are all zero, the trip predates fuel config.
    // B3 / D4: for trips NOT yet financially committed we still re-fetch LIVE
    // fuel config so in-progress trips compute against today's rates. For
    // COMMITTED trips (IN_TRANSIT / COMPLETED) we deliberately do NOT
    // read live — the price they were costed at cannot be reconstructed
    // (fuel_price_history predates them; qa/feedback-repro-log.md §3/§7), so a
    // live read would recost stored totals the moment the price moves
    // (Principle 4 / COMPLETED-invariant). The fuel component is instead pinned
    // to stored totals after computeTripTotals (see applyCommittedLegacyFuelFreeze).
    // `trip.status` is drizzle-inferred as a narrow literal union that omits
    // CANCELED (and includes null); normalise to the full enum so the
    // committed-state checks type-check — CANCELED does occur at runtime.
    const tripStatus: TripStatus = (trip.status ?? TripStatus.CREATED) as TripStatus;
    const isCommittedTrip = tripStatus === TripStatus.IN_TRANSIT
      || tripStatus === TripStatus.COMPLETED;
    if (!isCommittedTrip
        && fuelPriceApplied === 0 && fuelLoadedNormApplied === 0 && fuelEmptyNormApplied === 0) {
      const [liveFuelCfg] = await tx.select().from(s.fuelConfig).where(isNull(s.fuelConfig.deletedAt)).limit(1);
      if (liveFuelCfg) {
        fuelPriceApplied = Number(liveFuelCfg.unitPrice);
        fuelLoadedNormApplied = Number(liveFuelCfg.loadedNorm);
        fuelEmptyNormApplied = Number(liveFuelCfg.emptyNorm);
        fuelSupplementNormApplied = Number(liveFuelCfg.supplement);
      }
    }

    // Same for road config: if toll/bonus snapshots are zero, re-fetch live config.
    if (tollPerStationApplied === 0 && returnCargoBonusApplied === 0) {
      const [liveRoadCfg] = await tx.select().from(s.roadConfig).limit(1);
      if (liveRoadCfg) {
        tollPerStationApplied = Number(liveRoadCfg.tollPerStation);
        returnCargoBonusApplied = Number(liveRoadCfg.returnCargoBonus);
      }
    }

    // If roadAllowanceBase is zero and we have a route+trailerType, try to resolve it.
    if (roadAllowanceBaseApplied === 0 && trip.trailerType) {
      const [liveAllowance] = await tx.select().from(s.roadAllowances).where(
        and(
          eq(s.roadAllowances.routeId, finalRouteId),
          eq(s.roadAllowances.trailerType, trip.trailerType),
          isNull(s.roadAllowances.deletedAt)
        )
      ).limit(1);
      if (liveAllowance) {
        roadAllowanceBaseApplied = Number(liveAllowance.baseAmount);
      }
    }

    // Revenue is split-based (empty-return + combined-load legs); `revenue` is
    // derived. resolveRevenue honors the `undefined`=not-provided contract so
    // untouched splits preserve stored revenue (feedback202606 A3 §9).
    const revenueEmptyReturn = data.revenueEmptyReturn !== undefined ? data.revenueEmptyReturn : Number(trip.revenueEmptyReturn || 0);
    const revenueCombine = data.revenueCombine !== undefined ? data.revenueCombine : Number(trip.revenueCombine || 0);
    const revenue = resolveRevenue(data, trip);

    let revenueOriginal = Number(trip.revenueOriginal || 0);
    let revenueOverriddenBy = trip.revenueOverriddenBy;
    let revenueOverriddenAt = trip.revenueOverriddenAt ? new Date(trip.revenueOverriddenAt) : null;
    // Wave 1 M2.1: when the operator overrides the auto-computed revenue
    // (pricingSource is TIER or TABLE), a reason is mandatory. When
    // pricingSource is MANUAL there was no auto-computation, so no reason
    // is required.
    let revenueOverrideReason: string | null = trip.revenueOverrideReason ?? null;

    if (shouldMarkRevenueOverride(data, trip)) {
      revenueOriginal = revenueOriginal || Number(trip.revenue || 0);
      revenueOverriddenBy = data.userId ?? null;
      revenueOverriddenAt = new Date();

      // M2.1: require a reason when overriding an auto-computed price.
      // The caller passes `revenueOverrideReason` in the update data; if
      // the trip's pricingSource is TIER/TABLE and no reason is provided,
      // reject with 400.
      const isAutoPriced = trip.pricingSource === 'TABLE' || trip.pricingSource === 'TIER';
      if (isAutoPriced) {
        const reason = data.revenueOverrideReason;
        if (!reason || !reason.trim()) {
          throw new ApiError(
            400,
            'Lý do ghi đè giá là bắt buộc khi thay đổi doanh thu đã tự động tính.',
          );
        }
        revenueOverrideReason = reason.trim();
      }
    }

    // Auto-populate driverSalary from route config if not yet set.
    // Only auto-fill when the user didn't explicitly send a value (undefined)
    // AND the existing trip has no salary — this prevents overwriting an
    // explicit user-entered 0 with the route default.
    let driverSalary = data.driverSalary !== undefined ? data.driverSalary : Number(trip.driverSalary || 0);
    // Salary auto-fill from driver's baseSalary (cost allocation, no BHXH per customer Pete).
    // Formula: baseSalary / 26 × tripWageDays
    // Only triggers when no salary is set yet and we have a driver + wage days.
    let tripWageDays = data.tripWageDays !== undefined ? data.tripWageDays : trip.tripWageDays;
    if (!tripWageDays) {
      // Auto-compute from departure date to completedAt (or departure alone for 1-day trips)
      const depDate = new Date(data.departureDate ?? trip.departureDate);
      const compDate = data.completedAt ? new Date(data.completedAt) : (trip.completedAt ? new Date(trip.completedAt) : null);
      if (compDate) {
        const diffMs = compDate.getTime() - depDate.getTime();
        tripWageDays = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1);
      } else {
        tripWageDays = 1; // default: single-day trip
      }
    }

    if (data.driverSalary === undefined && driverSalary === 0) {
      let baseSalary = 0;
      if (trip.driverId) {
        const [driver] = await tx.select({
          baseSalary: s.drivers.baseSalary,
        }).from(s.drivers).where(eq(s.drivers.id, trip.driverId)).limit(1);
        baseSalary = Number(driver?.baseSalary) || 0;
      }
      driverSalary = resolveTripDriverSalary(
        baseSalary,
        tripWageDays ?? 1,
        Number(route?.driverSalary) || 0,
      );
    }
    const twoPointDeliveryBonus = data.twoPointDeliveryBonus !== undefined ? data.twoPointDeliveryBonus : Number(trip.twoPointDeliveryBonus || 0);
    const vehicleShiftAllowance = data.vehicleShiftAllowance !== undefined ? data.vehicleShiftAllowance : Number(trip.vehicleShiftAllowance || 0);
    const customerCommission = data.customerCommission !== undefined ? data.customerCommission : Number(trip.customerCommission || 0);
    const tripVatRate = Number(trip.vatRate || 0);
    assertCustomerCommissionWithinRevenue(revenue, tripVatRate, customerCommission);

    // 4. Compute Totals using pure shared function. Ancillary service/ocean-fee
    //    amounts are receivables/debit-note data only; computeTripTotals keeps
    //    them out of transport grossProfit.
    const tripFees = await tx.select({
      buyAmount: s.tripExpenses.buyAmount,
      sellAmount: s.tripExpenses.sellAmount,
      vatRate: s.forwarderExpenseTypes.vatRate,
    }).from(s.tripExpenses)
      .innerJoin(s.forwarderExpenseTypes, eq(s.tripExpenses.expenseType, s.forwarderExpenseTypes.code))
      .where(
        and(
          eq(s.tripExpenses.tripId, tripId),
          eq(s.tripExpenses.approvalStatus, 'APPROVED'),
        )
      );
    const ledgerFees = tripStatus === TripStatus.COMPLETED
      ? await tx.select().from(s.tripExpenses).where(eq(s.tripExpenses.tripId, tripId))
      : [];

    const totalsInput = {
      legs: normalizedLegs.map(l => ({ sequence: l.sequence, km: l.km, loadingType: l.loadingType })),
      fuelMode: data.fuelMode,
      fuelLitersOverride: data.fuelLitersOverride ?? null,
      fuelSupplementLiters: data.fuelSupplementLiters ?? 0,
      fuelLoadedNorm: fuelLoadedNormApplied,
      fuelEmptyNorm: fuelEmptyNormApplied,
      fuelPerTripSupplement: fuelSupplementNormApplied,
      fuelUnitPrice: fuelPriceApplied,
      fuelActualUnitPrice: data.fuelActualUnitPrice ?? null,
      isMountainRoute: route ? !!route.isMountain : false,
      mountainFixedAllowance: fuelFixedAllowanceApplied > 0 ? fuelFixedAllowanceApplied : null,
      roadAllowanceBase: roadAllowanceBaseApplied,
      tollsDiscount: data.tollsDiscount ?? 0,
      tollsAddition: data.tollsAddition ?? 0,
      tollsStations: data.tollsStations ?? 0,
      // Preserve system-managed backhaul dedup across recalc; pair flow is the writer.
      tollDeduction: data.tollDeduction ?? Number(trip.tollDeduction ?? 0),
      tollPerStation: tollPerStationApplied,
      hasReturnCargo: data.hasReturnCargo ?? false,
      returnCargoBonus: returnCargoBonusApplied,
      revenue,
      driverSalary,
      twoPointDeliveryBonus,
      vehicleShiftAllowance,
      roadAllowanceOverride: data.roadAllowanceOverride ?? null,
      vatRate: tripVatRate,
      carrierType: (data.carrierType !== undefined ? data.carrierType : trip.carrierType) as 'OWN' | 'EXTERNAL',
      externalFreightCost: Number(data.externalFreightCost !== undefined ? (data.externalFreightCost ?? 0) : (trip.externalFreightCost ?? 0)),
      ancillaryFees: tripFees.map(f => ({
        buyAmount: Number(f.buyAmount || 0),
        sellAmount: Number(f.sellAmount || 0),
        vatRate: Number(f.vatRate || 0.080),
      })),
      customerCommission,
    };

    const totals = computeTripTotals(totalsInput);
    // updateTripFigures is the canonical calculation path. On COMPLETED trips
    // it is reachable only from an independently checked and approved financial
    // correction, so this is also the safe authority for reconciling a dirty
    // surcharge. The old amount is reversed below and the new amount is reposted
    // under a fresh financial posting; the unaudited recapture endpoint never
    // changes money.
    const fuelSurcharge = {
      ...(await resolveFuelSurcharge({
        customerId: data.customerId ?? trip.customerId,
        fuelLiters: totals.totalFuelLiters,
        date: new Date(`${data.departureDate ?? trip.departureDate}T00:00:00.000Z`),
      })),
      dirty: false,
    };

    // B3 / D4: pin the fuel component of committed legacy trips to stored
    // totals. computeTripTotals ran with the 0 sentinel price for these trips
    // (no live fallback above), so its fuel outputs are ~0; restore the stored
    // cost and propagate to totalCost / grossProfit, holding litres at the
    // stored value. Revenue / tolls / salary still flow through normally — only
    // the unreconstructable fuel cost is frozen (tolerance 0 VND).
    const frozenFuel = applyCommittedLegacyFuelFreeze(
      {
        status: tripStatus,
        fuelPriceApplied: Number(trip.fuelPriceApplied || 0),
        fuelLoadedNormApplied: Number(trip.fuelLoadedNormApplied || 0),
        fuelEmptyNormApplied: Number(trip.fuelEmptyNormApplied || 0),
        storedFuelCost: Number(trip.totalFuelCost || 0),
        storedFuelLiters: Number(trip.fuelLiters || 0),
      },
      totals,
    );
    totals.totalFuelCost = frozenFuel.totalFuelCost;
    totals.totalCost = frozenFuel.totalCost;
    totals.grossProfit = frozenFuel.grossProfit;
    totals.totalFuelLiters = frozenFuel.totalFuelLiters;

    // B2: completion is no longer auto-triggered from actuals entry. Saving
    // figures keeps the trip in its current lifecycle status; the user marks
    // the trip "Hoàn thành" explicitly via POST /trips/:id/complete (permissive
    // — photos may be added/edited afterwards). This removes the surprise
    // IN_TRANSIT → COMPLETED jump that previously fired whenever any photo
    // existed (A3.1).

        // 6. Update derived fields and increment version
    const nextVersion = trip.version + 1;
    const [updated] = await tx.update(s.trips).set({
      version: nextVersion,
      customerId: data.customerId ?? trip.customerId,
      departureDate: data.departureDate ?? trip.departureDate,
      routeId: finalRouteId,
      fuelFixedAllowanceApplied: String(fuelFixedAllowanceApplied),
      roadAllowanceBaseApplied: String(roadAllowanceBaseApplied),
      fuelMode: data.fuelMode,
      fuelLitersOverride: data.fuelLitersOverride != null ? String(data.fuelLitersOverride) : null,
      fuelSupplementLiters: String(data.fuelSupplementLiters || 0),
      fuelSupplementReason: data.fuelSupplementReason ?? null,
      fuelActualUnitPrice: data.fuelActualUnitPrice != null ? String(data.fuelActualUnitPrice) : null,
      fuelSupplierId: data.fuelSupplierId !== undefined ? data.fuelSupplierId : trip.fuelSupplierId,
      tollsDiscount: String(data.tollsDiscount || 0),
      tollsAddition: String(data.tollsAddition || 0),
      tollsStations: data.tollsStations || 0,
      tollDeduction: String(data.tollDeduction ?? Number(trip.tollDeduction ?? 0)),
      hasReturnCargo: data.hasReturnCargo ?? false,
      driverSalary: String(driverSalary),
      roadAllowanceOverride: data.roadAllowanceOverride != null ? String(data.roadAllowanceOverride) : null,
      fuelLiters: String(totals.totalFuelLiters),
      totalFuelCost: String(totals.totalFuelCost),
      fuelSurchargeAmount: String(fuelSurcharge.amount),
      fuelSurchargeSnapshot: fuelSurcharge.snapshot as unknown as Record<string, unknown>,
      fuelSurchargeSnapshotDirty: fuelSurcharge.dirty,
      totalRoadAllowance: String(totals.totalRoadAllowance),
      tollCost: String(totals.tollCost),
      ...(data.completedAt ? { completedAt: new Date(data.completedAt) } : {}),
      totalCost: String(totals.totalCost),
      revenue: String(revenue),
      revenueEmptyReturn: String(revenueEmptyReturn),
      revenueCombine: String(revenueCombine),
      twoPointDeliveryBonus: String(twoPointDeliveryBonus),
      vehicleShiftAllowance: String(vehicleShiftAllowance),
      customerCommission: String(customerCommission),
      tripWageDays: tripWageDays,
      grossProfit: String(totals.grossProfit),
      revenueOriginal: String(revenueOriginal),
      revenueOverriddenBy,
      revenueOverriddenAt,
      revenueOverrideReason,
      notes: data.notes ?? null,
      carrierType: data.carrierType !== undefined ? data.carrierType : trip.carrierType,
      externalEntityId: data.externalCarrierId !== undefined ? data.externalCarrierId : trip.externalEntityId,
      externalEntityType: data.externalCarrierId !== undefined ? (data.externalCarrierId != null ? 'CUSTOMER' : null) : trip.externalEntityType,
      externalFreightCost: data.externalFreightCost !== undefined ? (data.externalFreightCost != null ? String(data.externalFreightCost) : null) : trip.externalFreightCost,
      externalPlateNumber: data.externalPlateNumber !== undefined ? data.externalPlateNumber : trip.externalPlateNumber,
      externalDriverName: data.externalDriverName !== undefined ? data.externalDriverName : trip.externalDriverName,
      externalDriverPhone: data.externalDriverPhone !== undefined ? data.externalDriverPhone : trip.externalDriverPhone,
      truckId: data.truckId !== undefined ? data.truckId : trip.truckId,
      driverId: data.driverId !== undefined ? data.driverId : trip.driverId,
      trailerType: data.trailerType !== undefined ? (data.trailerType as '20FT' | '40FT' | null) : trip.trailerType,
      updatedAt: new Date(),
    }).where(and(eq(s.trips.id, tripId), eq(s.trips.version, trip.version))).returning();

    if (!updated) {
      throw new ApiError(409, 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.');
    }

    if (tripStatus === TripStatus.COMPLETED) {
      const previousPosting = await getActiveFinancialPosting(tx, trip.id)
        ?? await createFinancialPosting(tx, {
          tripId: trip.id,
          tripVersion: trip.version,
          reason: 'COMPLETION',
          effectiveAt: trip.completedAt ?? new Date(),
        });
      const mappedLedgerFees = ledgerFees.map(fee => ({
        id: fee.id,
        buyAmount: fee.buyAmount,
        sellAmount: fee.sellAmount,
        settlementMethod: fee.settlementMethod,
        supplierId: fee.supplierId ?? null,
        forwarderId: fee.forwarderId ?? null,
        approvalStatus: fee.approvalStatus,
      }));

      await LedgerService.postTripCompletionReverse(tx, {
        id: trip.id,
        tripCode: trip.tripCode,
        customerId: trip.customerId,
        driverId: trip.driverId ?? null,
        revenue: trip.revenue,
        driverSalary: trip.driverSalary,
        carrierType: trip.carrierType ?? 'OWN',
        externalEntityId: trip.externalEntityId ?? null,
        externalEntityType: trip.externalEntityType ?? null,
        externalFreightCost: trip.externalFreightCost ?? null,
        fuelSupplierId: trip.fuelSupplierId ?? null,
        totalFuelCost: trip.totalFuelCost,
        fuelSurchargeAmount: trip.fuelSurchargeAmount,
        ancillaryFees: mappedLedgerFees,
      }, { strict: false, financialPostingId: previousPosting.id });

      const newPosting = await createFinancialPosting(tx, {
        tripId: updated.id,
        tripVersion: updated.version,
        reason: 'GOVERNED_CORRECTION',
        governanceActionId,
      });

      await LedgerService.postTripCompletion(tx, {
        id: updated.id,
        tripCode: updated.tripCode,
        customerId: updated.customerId,
        driverId: updated.driverId ?? null,
        revenue: updated.revenue,
        driverSalary: updated.driverSalary,
        carrierType: updated.carrierType ?? 'OWN',
        externalEntityId: updated.externalEntityId ?? null,
        externalEntityType: updated.externalEntityType ?? null,
        externalFreightCost: updated.externalFreightCost ?? null,
        fuelSupplierId: updated.fuelSupplierId ?? null,
        totalFuelCost: updated.totalFuelCost,
        fuelSurchargeAmount: updated.fuelSurchargeAmount,
        ancillaryFees: mappedLedgerFees,
      }, { strict: false, financialPostingId: newPosting.id });
      await captureProfitabilityAttributionSnapshot(tx, updated.id, newPosting.id);
      // Hash the exact reposted authority in this transaction. If another
      // financial writer wins later it will serialize on the same trip lock and
      // dirty these snapshots again, so no dirty signal can be lost.
      await SnapshotServices.markBothDirty(updated.id, tx);
    }

    // 7. Persist physical leg segments
    await tx.delete(s.tripLegs).where(eq(s.tripLegs.tripId, tripId));
    if (normalizedLegs.length > 0) {
      await tx.insert(s.tripLegs).values(
        normalizedLegs.map((leg, _i) => {
          const calcLeg = totals.legCalculations.find(cl => cl.sequence === leg.sequence);
          return {
            tripId,
            sequence: leg.sequence,
            origin: leg.origin,
            destination: leg.destination,
            km: leg.km,
            loadingType: leg.loadingType,
            calculatedLiters: calcLeg ? String(calcLeg.calculatedLiters) : '0',
          };
        })
      );
    }

    await propagateTripFinancialSourceChange(tx, { tripId: updated.id });

    // Audit row is produced by auditLogMiddleware on PUT /api/trips/:id/
    // actuals (and /pre-departure) as "Quản lý <actor> cập nhật số liệu
    // thực tế chuyến <tripCode>". Skip the service-level write to avoid
    // duplicating that row.

    return updated;
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}

// ─── updateDepartureDate ────────────────────────────────────────────────────

export async function updateDepartureDate(
  tripId: number,
  newDepartureDate: string,
  userId: number,
  userRole: string,
  expectedVersion?: number,
  transaction?: Tx,
) {
  if (userRole !== Role.ADMIN && userRole !== Role.MANAGER) {
    throw new ApiError(403, 'Chỉ Quản lý hoặc Quản trị viên mới có quyền thay đổi ngày khởi hành');
  }

  const execute = async (tx: Tx) => {
    const [trip] = await tx.select().from(s.trips).where(eq(s.trips.id, tripId)).limit(1).for('update');
    if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    if (expectedVersion !== undefined && trip.version !== expectedVersion) {
      throw new ApiError(409, 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.');
    }
    if (trip.status === TripStatus.CANCELED) {
      throw new ApiError(400, 'Không thể thay đổi ngày khởi hành của chuyến đã hủy');
    }
    if (trip.status === TripStatus.COMPLETED) {
      throw new ApiError(409, 'Không thể thay đổi ngày khởi hành của chuyến đã chốt');
    }
    if (trip.departureDate === newDepartureDate) return trip; // Idempotent

    const [updated] = await tx.update(s.trips).set({
      departureDate: newDepartureDate,
      version: sql`${s.trips.version} + 1`,
      updatedAt: new Date(),
    }).where(eq(s.trips.id, tripId)).returning();

    return updated;
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}

// ─── reassignTrip ───────────────────────────────────────────────────────────

export async function reassignTrip(
  tripId: number,
  data: { carrierType?: 'OWN' | 'EXTERNAL'; truckId?: number | null; driverId?: number | null; externalCarrierId?: number | null; externalPlateNumber?: string | null; externalDriverName?: string | null; externalDriverPhone?: string | null; expectedVersion?: number; },
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [trip] = await tx.select().from(s.trips).where(eq(s.trips.id, tripId)).limit(1).for('update');
    if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    if (data.expectedVersion !== undefined && trip.version !== data.expectedVersion) {
      throw new ApiError(409, 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.');
    }
    if (trip.status !== TripStatus.CREATED) throw new ApiError(409, 'Chỉ có thể đổi lái xe/xe cho chuyến chưa xuất phát');

    const carrierType = data.carrierType || 'OWN';
    let trailerId = trip.trailerId;
    let trailerType = trip.trailerType;

    if (carrierType === 'OWN') {
      const [newTruck] = await tx.select({ id: s.trucks.id, trailerType: s.trucks.trailerType, currentTrailerId: s.trucks.currentTrailerId }).from(s.trucks)
        .where(and(eq(s.trucks.id, data.truckId!), isNull(s.trucks.deletedAt))).limit(1);
      if (!newTruck) throw new ApiError(400, 'Xe đầu kéo không tồn tại hoặc đã bị xóa');
      const [driver] = await tx.select({ id: s.drivers.id }).from(s.drivers)
        .where(and(eq(s.drivers.id, data.driverId!), isNull(s.drivers.deletedAt))).limit(1);
      if (!driver) throw new ApiError(400, 'Lái xe không tồn tại hoặc đã bị xóa');

      const resolved = await resolveTrailer(tx, newTruck.currentTrailerId);
      trailerId = resolved.trailerId;
      trailerType = (resolved.trailerType || newTruck.trailerType || trip.trailerType || '40FT') as '20FT' | '40FT';
    } else {
      trailerId = null;
      trailerType = null;
    }

    const [updated] = await tx.update(s.trips).set({
      carrierType,
      truckId: carrierType === 'OWN' ? data.truckId! : null,
      driverId: carrierType === 'OWN' ? data.driverId! : null,
      trailerId,
      trailerType,
      externalEntityId: carrierType === 'EXTERNAL' && data.externalCarrierId ? data.externalCarrierId : null,
      externalEntityType: carrierType === 'EXTERNAL' && data.externalCarrierId ? 'CUSTOMER' : null,
      externalPlateNumber: carrierType === 'EXTERNAL' && data.externalPlateNumber ? data.externalPlateNumber : null,
      externalDriverName: carrierType === 'EXTERNAL' && data.externalDriverName ? data.externalDriverName : null,
      externalDriverPhone: carrierType === 'EXTERNAL' && data.externalDriverPhone ? data.externalDriverPhone : null,
      version: sql`${s.trips.version} + 1`,
      updatedAt: new Date(),
    }).where(eq(s.trips.id, tripId)).returning();

    return updated;
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}


/**
 * Soft-delete a trip. Only trips in CREATED status can be deleted; any other
 * status (IN_TRANSIT, COMPLETED, CANCELED) returns 409. Per flow 01 §2.6.
 */
export async function deleteTrip(
  tripId: number,
  expectedVersion?: number,
  transaction?: Tx,
): Promise<void> {
  const execute = async (tx: Tx) => {
    const [trip] = await tx.select({ id: s.trips.id, status: s.trips.status, version: s.trips.version, deletedAt: s.trips.deletedAt })
      .from(s.trips)
      .where(eq(s.trips.id, tripId)).limit(1).for('update');
    if (!trip) throw new ApiError(404, "Không tìm thấy chuyến đi");
    if (trip.deletedAt) throw new ApiError(404, "Không tìm thấy chuyến đi");
    if (expectedVersion !== undefined && trip.version !== expectedVersion) {
      throw new ApiError(409, 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.');
    }
    if (trip.status !== TripStatus.CREATED) {
      throw new ApiError(409, `Chỉ xóa được chuyến ở trạng thái CREATED (hiện tại: ${trip.status})`);
    }
    await tx.update(s.trips).set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(s.trips.id, tripId));
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}
