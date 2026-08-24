// Trip figures update (the 550-line recost + governance path). Extracted from
// trip-mutations.service.ts VERBATIM — the body is moved as one unit, not
// decomposed. The locked-entity manifest pins updateTripFigures to THIS file.
import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { TripStatus, FuelMode, Role, TxnType } from '@tingting/shared';
import { resolveFuelSurcharge } from './pricing.service';
import type { TripLegInput } from '@tingting/shared';
import { resolveTripDriverSalary, computeTripTotals } from '@tingting/shared';
import { ApiError } from '../errors';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';
import { propagateTripFinancialSourceChange } from './source-change.service';
import { createFinancialPosting, getActiveFinancialPosting } from './financial-posting.service';
import { captureProfitabilityAttributionSnapshot } from './profitability.service';
import { SnapshotServices } from './snapshot-services';
import { assertTripShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import type { Tx } from './trip-shared';
import { requirePersistedTripGovernanceAuthorization } from './trip-governance-authorization.service';
import { assertActiveApprovalApplication } from './governance-action-core.service';
import { LedgerService } from './ledger.service';
import {
  applyCommittedLegacyFuelFreeze,
  assertCustomerCommissionWithinRevenue,
  resolveRevenue,
  shouldMarkRevenueOverride,
} from './trip-mutations-shared.service';

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

/** Status read for the cancel-route guard; throws 404 when the trip is missing. */
export async function getTripStatusOr404(tripId: number): Promise<string | null> {
  const [current] = await db.select({ status: s.trips.status })
    .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  if (!current) throw new ApiError(404, 'Không tìm thấy chuyến đi');
  return current.status;
}

/** Marks a trip's paper POD as recovered (optimistic-locked write). */
export async function markTripPodRecovered(
  tripId: number,
  recoveredBy: number,
  expectedVersion?: number,
) {
  const [updated] = await db.update(s.trips).set({
    podRecoveredAt: new Date(),
    podRecoveredBy: recoveredBy,
    version: sql`${s.trips.version} + 1`,
    updatedAt: new Date(),
  }).where(and(
    eq(s.trips.id, tripId),
    ...(expectedVersion !== undefined ? [eq(s.trips.version, expectedVersion)] : []),
  )).returning();
  if (!updated) throw new ApiError(409, 'Chuyến đi đã bị thay đổi. Vui lòng tải lại.');
  return updated;
}

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
    // Financial mutations and governed cancellation must take the shared trip
    // authority before either path locks the parent shipment. Reversing these
    // two locks lets a direct edit hold the shipment while cancellation holds
    // the advisory authority, producing a PostgreSQL deadlock.
    await lockTripFinancialAuthority(tx, [tripId]);
    await assertTripShipmentAccountingUnlocked(tx, tripId);
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
    // 1. Fetch trip and check lock status
    // Both paths now observe the committed winner before derived financial
    // work begins: trip authority -> parent shipment -> trip row.
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
  return runInTx(transaction, execute);
}

