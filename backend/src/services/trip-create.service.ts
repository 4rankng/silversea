// Trip create + copy: pricing/fuel-norm snapshotting, credit-limit gate, trip
// code generation, and the shipment-link create path. Extracted from
// trip-mutations.service.ts verbatim (pure code movement); pure rules and the
// copy builders live in trip-mutations-shared.
import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { canonicalShipmentStatus, TripStatus, FuelMode, Role } from '@tingting/shared';
import { computeTripTotals } from '@tingting/shared';
import { ApiError } from '../errors';
import { resolveFreightPrice, resolveFuelSurcharge } from './pricing.service';
import { resolveFuelNorm } from './fuel.service';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';
import { assertShipmentAccountingUnlocked, assertTripShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { resolveTrailer } from './trip-shared';
import type { Tx } from './trip-shared';
import { assertCreditLimit, consumeShipmentCreditOverride } from './credit-limit.service';
import { buildCopiedTripValues, buildCopiedTripLegValues } from './trip-mutations-shared.service';

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
// ─── createTrip ─────────────────────────────────────────────────────────────

async function generateTripCode(tx: Tx, departureDateValue: string): Promise<string> {
  const departureDate = new Date(departureDateValue);
  const year = departureDate.getFullYear();
  const month = String(departureDate.getMonth() + 1).padStart(2, '0');
  const yearMonth = `${year}${month}`;

  await lockApplicationOwnedUniqueness(tx, 'trip-code-counter:year-month', [yearMonth]);
  const counterRows = await tx.select().from(s.tripCodeCounters)
    .where(eq(s.tripCodeCounters.yearMonth, yearMonth))
    .for('update');
  if (counterRows.length > 1) {
    throw new ApiError(409, `Bộ đếm mã chuyến tháng ${yearMonth} bị trùng. Vui lòng kiểm tra dữ liệu.`);
  }
  const [counterRow] = counterRows.length === 0
    ? await tx.insert(s.tripCodeCounters).values({ yearMonth, counter: 1 }).returning()
    : await tx.update(s.tripCodeCounters)
      .set({ counter: sql`${s.tripCodeCounters.counter} + 1` })
      .where(eq(s.tripCodeCounters.yearMonth, yearMonth))
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
  pricingRateKey?: string | null;
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
  /** Explicit trailer resolved by the caller (e.g. dispatch planning). When
   *  set, skips the truck.currentTrailerId fallback. */
  trailerId?: number | null;
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
      await assertShipmentAccountingUnlocked(tx, data.shipmentId);
      await lockApplicationOwnedUniqueness(
        tx,
        'trips:live-shipment-unassigned',
        [data.shipmentId],
      );
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
      // Keep internal/legacy trip-link commands tolerant during the readiness
      // cutover. Dispatch visibility and fulfillment order issuance still
      // require READY_FOR_DISPATCH at their own authoritative boundaries.
      if (shipmentStatus !== 'PENDING_DATE' && shipmentStatus !== 'READY_FOR_DISPATCH' && shipmentStatus !== 'DISPATCHED') {
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

      const [existingLiveTrip] = await tx.select({ id: s.trips.id })
        .from(s.trips)
        .where(and(
          eq(s.trips.shipmentId, shipment.id),
          isNull(s.trips.fulfillmentId),
          isNull(s.trips.deletedAt),
          sql`${s.trips.status} <> 'CANCELED'`,
        ))
        .limit(1);
      if (existingLiveTrip) {
        throw new ApiError(
          409,
          'Lô hàng đã được gắn vào một chuyến khác. Vui lòng tải lại.',
        );
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
      containerTypeId: data.containerTypeId ?? null,
      pricingRateKey: data.pricingRateKey ?? null,
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
      const resolved = await resolveTrailer(tx, data.trailerId ?? truck.currentTrailerId);
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
    //    guarded UPDATE below (see step 4b). The application-owned shipment
    //    lock and canonical lookup above ensure only one live link is created.
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

      // 4b. Link only after the trip and container snapshot are complete.
      const [linked] = await tx.update(s.trips)
        .set({ shipmentId: data.shipmentId })
        .where(eq(s.trips.id, trip.id))
        .returning();
      if (linked) {
        Object.assign(trip, linked);
      }
    }

    await consumeShipmentCreditOverride(creditCheck.overrideRequest, trip.id, tx);

    // Audit row is produced by auditLogMiddleware on POST /api/trips as
    // "Quản lý <actor> tạo lệnh vận chuyển <tripCode>". A service-level write
    // here would duplicate that row, so we deliberately skip it.

    return trip;
  };
  return runInTx(transaction, execute);
}

// ─── copyTrip ────────────────────────────────────────────────────────────────

export async function copyTrip(sourceTripId: number, createdBy: number, transaction?: Tx) {
  const execute = async (tx: Tx) => {
    await assertTripShipmentAccountingUnlocked(tx, sourceTripId);
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
