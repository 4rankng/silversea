/**
 * LCL cost-group money law (FB-092/161026232319/161026232329, card
 * 171026142500) — the one module that prices and zeroes the group's
 * cước trả ĐV.
 *
 * Extracted from lcl-grouping.service.ts along its money seam: assignment
 * ("Gán xe nhóm") and issuance ("phát lệnh") are two moments of the SAME law
 * because dispatch groups lots on Kế hoạch Chi tiết BEFORE the issue creates
 * their trips —
 *
 *   - at ASSIGNMENT, the lots that already carry a live trip are priced /
 *     zeroed immediately (`applyPrincipalCostFreight` + `zeroMemberDriverMoney`);
 *   - at ISSUANCE, the trip the order just created receives the same law
 *     (`applyLclCostGroupFreightToNewTrip`), keyed by the group facts the
 *     assignment stamped on the shipment and the nhà xe identity it persisted
 *     on the lot's "phân bổ xe" fulfillment channel.
 *
 * Shared law: Lô 1 carries 100% of the vendor freight — the manual entry when
 * dispatch typed one, else the carrier price board for the lane (tuyến × loại
 * xe, the nhà xe's own row first, the generic row as fallback) — while members
 * 2..N are zeroed. A board miss is never an invented 0₫: Lô 1 keeps its own
 * value (or stays null ⇒ the boards' honest "Thiếu cước trả ĐV").
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Tx } from '../db';
import * as s from '../db/schema';
import { upsertTripCarrierInfo, upsertTripFinancialState } from './trip-composite.service';
import { resolveCarrierVehicleClassPrice } from './pricing.service';
import type { LclCostCarrier, LiveTripFacts, ShipmentRow } from './lcl-grouping.service';

/**
 * SIL-493 — the dispatcher's "Cước trả dự kiến" (the per-lot editor's ONLY
 * money field) reads `shipment_fulfillments.planned_carrier_cost`, a channel
 * the group money never touched: after a COST recomposition the money
 * holder's editor read 0₫ and the dialog promise ("tiền cước 100% của Lô 1
 * vẫn giữ nguyên trên Lô 1") was invisible. Every seam that LANDS the
 * group's cước trả on a lot (assignment/update, issuance, promotion,
 * whole-group tách) mirrors the landed amount here so the money holder's
 * plan estimate stays the board truth. Members awaiting re-pricing are
 * never mirrored (their own pre-group estimate is theirs to keep), and no
 * amount ⇒ no write (an absent price is never a fabricated 0₫).
 */
export async function mirrorPlannedCarrierCost(tx: Tx, shipmentId: number, amount: string): Promise<void> {
  if (amount == null || Number(amount) === 0) return;
  const fulfillments = await tx.select({
    id: s.shipmentFulfillments.id,
    version: s.shipmentFulfillments.version,
  }).from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.shipmentId, shipmentId),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .orderBy(asc(s.shipmentFulfillments.id));
  for (const fulfillment of fulfillments) {
    await tx.update(s.shipmentFulfillments).set({
      plannedCarrierCost: amount,
      version: fulfillment.version + 1,
      updatedAt: new Date(),
    }).where(eq(s.shipmentFulfillments.id, fulfillment.id));
  }
}

/**
 * 161026232319 — Lô 1's cước trả ĐVVC at group assignment (spec 23/10: the
 * manual override wins whenever dispatch typed one, trip or no trip — the
 * sticky copy on `shipments.cost_group_freight_manual` is written by the
 * caller's row patch and rides the trip here).
 *
 * A board miss leaves Lô 1's own value untouched: an absent price is never
 * an invented 0₫ (and never a wiped freight).
 */
export async function applyPrincipalCostFreight(
  tx: Tx,
  args: {
    row: ShipmentRow;
    trip: LiveTripFacts | null;
    vehicleClassId: number;
    carrier: LclCostCarrier;
    manualFreightCost: number | undefined;
  },
): Promise<{ amount: string; source: 'MANUAL' | 'PRICE_BOARD' } | null> {
  const { row, trip, vehicleClassId, carrier, manualFreightCost } = args;
  if (manualFreightCost != null) {
    if (trip) await upsertTripCarrierInfo(tx, trip.tripId, { externalFreightCost: String(manualFreightCost) });
    // SIL-493 — the landed amount is the dispatcher's plan estimate too.
    await mirrorPlannedCarrierCost(tx, row.id, String(manualFreightCost));
    return { amount: String(manualFreightCost), source: 'MANUAL' };
  }
  if (trip == null) return null;
  if (row.routeId == null) return null;
  const date = row.expectedDeliveryDate ?? trip.departureDate;
  if (date == null) return null;
  const price = await resolveCarrierVehicleClassPrice({
    routeId: row.routeId,
    vehicleSizeClassId: vehicleClassId,
    supplierId: carrier.supplierId,
    date,
  });
  if (price == null) return null;
  await upsertTripCarrierInfo(tx, trip.tripId, { externalFreightCost: String(price.price) });
  await mirrorPlannedCarrierCost(tx, row.id, String(price.price));
  return { amount: String(price.price), source: 'PRICE_BOARD' };
}

/**
 * Card 171026142500 — the group's money law, applied to a NEWLY ISSUED trip.
 *
 * "Gán xe nhóm" happens on Kế hoạch Chi tiết BEFORE "phát lệnh" creates the
 * lots' trips, so at assignment time Lô 1 may have no live trip to price and
 * the members none to zero — `assignLclCostGroup` could only save the group
 * facts (the class stamp, BKS pair and the nhà xe identity on the lot's
 * "phân bổ xe" fulfillment channel). This hook runs when the issue flow
 * creates a lot's live trip, and lands the FB-092/161026232319 law on it:
 *
 *   - Lô 1 (costGroupOrder 1): the carrier price board is traced for the
 *     group's lane (tuyến × loại xe, the group nhà xe's own row first, the
 *     generic row as fallback) at the lot's delivery day — else the trip's
 *     departure day. A value already on the trip is never clobbered, and a
 *     board miss stays null ("Thiếu cước trả ĐV" — an absent price is never
 *     an invented 0₫), mirroring `applyPrincipalCostFreight` exactly.
 *   - members 2..N: external_freight_cost '0' ("nhảy tiền" — the group pays
 *     the vendor once), plus the 161026232329 internal-fleet container
 *     driver-money zeroing. Only fills a null value: a trip accounting
 *     already priced is left alone.
 *
 * Ungrouped / non-LCL lots are a no-op.
 */
export async function applyLclCostGroupFreightToNewTrip(
  tx: Tx,
  args: {
    shipment: ShipmentRow;
    /** The lot's active fulfillment — the "phân bổ xe" channel the group
     *  assignment persisted its nhà xe identity on. */
    fulfillment: Pick<typeof s.shipmentFulfillments.$inferSelect,
      'plannedCarrierType' | 'plannedExternalCarrierId'> | null;
    tripId: number;
    /** The trip's departure day (YYYY-MM-DD) — the fallback pricing date. */
    departureDate: string | null;
  },
): Promise<void> {
  const { shipment, fulfillment, tripId, departureDate } = args;
  if (shipment.cargoMode !== 'LCL' || shipment.costGroupId == null) return;

  const [existing] = await tx.select({ externalFreightCost: s.tripCarrierInfo.externalFreightCost })
    .from(s.tripCarrierInfo)
    .where(eq(s.tripCarrierInfo.tripId, tripId))
    .limit(1);

  if (shipment.costGroupOrder === 1) {
    if (existing?.externalFreightCost != null) return;
    // Spec 23/10 — the manual "Cước trả ĐVVC" the ĐV popup recorded on the
    // group principal survives to issuance and beats the board trace (the
    // popup law: blank = auto, nhập tay = override).
    if (shipment.costGroupFreightManual != null) {
      await upsertTripCarrierInfo(tx, tripId, { externalFreightCost: shipment.costGroupFreightManual });
      await mirrorPlannedCarrierCost(tx, shipment.id, shipment.costGroupFreightManual);
      return;
    }
    const vehicleClassId = shipment.costVehicleClassId;
    if (vehicleClassId == null || shipment.routeId == null) return;
    const date = shipment.expectedDeliveryDate ?? departureDate;
    if (date == null) return;
    // The group's nhà xe keys the "giá riêng" lane — the identity the group
    // assignment persisted, not the issue payload's partner (the group is a
    // fact of the lots; a reissued partner does not reprice the group).
    let supplierId: number | null = null;
    if (fulfillment?.plannedCarrierType === 'EXTERNAL' && fulfillment.plannedExternalCarrierId != null) {
      const [carrier] = await tx.select({ linkedSupplierId: s.customers.linkedSupplierId })
        .from(s.customers)
        .where(eq(s.customers.id, fulfillment.plannedExternalCarrierId))
        .limit(1);
      supplierId = carrier?.linkedSupplierId ?? null;
    }
    const price = await resolveCarrierVehicleClassPrice({
      routeId: shipment.routeId,
      vehicleSizeClassId: vehicleClassId,
      supplierId,
      date,
    });
    if (price == null) return;
    await upsertTripCarrierInfo(tx, tripId, { externalFreightCost: String(price.price) });
    await mirrorPlannedCarrierCost(tx, shipment.id, String(price.price));
    return;
  }

  // Member 2..N: the group pays the vendor once — 0₫ on this lot's trip.
  if (existing?.externalFreightCost == null) {
    await upsertTripCarrierInfo(tx, tripId, { externalFreightCost: '0' });
  }
  // 161026232329 — an internal-fleet CONTAINER group pays one driver for the
  // whole run: members shed the driver's road money (lương chuyến + tiền
  // đường), pinned through road_allowance_override so a later "lưu số liệu"
  // cannot re-derive it away.
  if (fulfillment?.plannedCarrierType === 'OWN') {
    const [vehicleClass] = await tx.select({ isContainer: s.vehicleSizeClasses.isContainer })
      .from(s.vehicleSizeClasses)
      .where(eq(s.vehicleSizeClasses.id, shipment.costVehicleClassId ?? 0))
      .limit(1);
    if (vehicleClass?.isContainer) {
      await zeroMemberDriverMoney(tx, tripId);
    }
  }
}

/**
 * 161026232329 — the internal-fleet container group pays ONE driver for the
 * whole run: members 2..N shed the driver's road money.
 *
 * The two stored columns every salary surface sums are
 * `trip_financial_state.driver_salary` ("lương chuyến" — Lương SX on the
 * payslip) and `trip_financial_state.total_road_allowance` ("tiền đường";
 * driver-earnings.service reads exactly these two, and pnl/driver boards read
 * them too). `road_allowance_override` joins them as the stored INPUT the
 * road allowance is recomputed from — an explicit 0 there keeps the member at
 * 0₫ through a later "lưu số liệu" instead of re-deriving the route config
 * amount.
 */
export async function zeroMemberDriverMoney(tx: Tx, tripId: number): Promise<void> {
  await upsertTripFinancialState(tx, tripId, {
    driverSalary: '0',
    totalRoadAllowance: '0',
    roadAllowanceOverride: '0',
  });
}

/**
 * SIL-734 — removes the group's stamped 0₫ from the money holder's plan
 * estimate after a split: `mirrorPlannedCarrierCost` deliberately refuses
 * zero/null amounts ("no amount ⇒ no write"), so a dissolved member's
 * fulfillment would keep the merge's 0₫ forever. The clear is the honest
 * "chưa có giá" state — an absent price, never a fabricated number.
 */
export async function clearPlannedCarrierCost(tx: Tx, shipmentId: number): Promise<void> {
  const fulfillments = await tx.select({
    id: s.shipmentFulfillments.id,
    version: s.shipmentFulfillments.version,
  }).from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.shipmentId, shipmentId),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .orderBy(asc(s.shipmentFulfillments.id));
  for (const fulfillment of fulfillments) {
    await tx.update(s.shipmentFulfillments).set({
      plannedCarrierCost: null,
      version: fulfillment.version + 1,
      updatedAt: new Date(),
    }).where(eq(s.shipmentFulfillments.id, fulfillment.id));
  }
}

export interface CostSplitRepriceOutcome {
  shipmentId: number;
  /** 'kept' = own money (non-zero) or no live trip — nothing touched;
   *  'repriced' = the carrier board priced the lane; 'cleared' = the group's
   *  stamped 0₫ removed (board miss or no lane key) — honest "Thiếu". */
  outcome: 'repriced' | 'cleared' | 'kept';
  price?: number;
  matched?: 'SUPPLIER' | 'GENERIC';
}

/**
 * SIL-734 (KB §8.4) — a lot leaving a COST group ("Tách nhóm", cả nhóm hay
 * 1 lô) must not read the group's stamped 0₫ ("nhảy tiền", merge law) as a
 * price: it re-prices from the SAME carrier price board the merge used
 * (tuyến × loại xe, the nhà xe's own row first) with the class captured from
 * its in-memory row BEFORE the split cleared the column, at the lot's own
 * delivery day. Own money (non-zero) never re-prices; a board miss clears
 * the stamp to null — the boards' honest "Thiếu cước trả ĐV", never an
 * invented number. Mirrors the REV re-price law (SIL-734b / SIL-539).
 */
export async function repriceCostLotAfterSplit(
  tx: Tx,
  args: {
    row: ShipmentRow;
    trip: Pick<LiveTripFacts, 'tripId' | 'departureDate' | 'externalFreightCost'> | null;
    /** The class captured from the IN-MEMORY row before the split patch. */
    vehicleClassId: number | null;
  },
): Promise<CostSplitRepriceOutcome> {
  const { row, trip, vehicleClassId } = args;
  const kept: CostSplitRepriceOutcome = { shipmentId: row.id, outcome: 'kept' };
  if (trip == null) return kept;
  // The stamped 0₫ is the ONLY state this re-price owns: a non-zero amount is
  // the lot's own money (kept), null is already the honest missing state.
  if (trip.externalFreightCost == null || Number(trip.externalFreightCost) !== 0) return kept;

  const clearStamp = async (): Promise<CostSplitRepriceOutcome> => {
    await upsertTripCarrierInfo(tx, trip.tripId, { externalFreightCost: null });
    await clearPlannedCarrierCost(tx, row.id);
    return { shipmentId: row.id, outcome: 'cleared' };
  };
  if (vehicleClassId == null || row.routeId == null) return clearStamp();
  const date = row.expectedDeliveryDate ?? trip.departureDate;
  if (date == null) return clearStamp();

  // The group's nhà xe keys the "giá riêng" lane — the identity the group
  // assignment persisted on the lot's "phân bổ xe" fulfillment channel
  // (survives the split; the same source the issuance hook reads).
  let supplierId: number | null = null;
  const [fulfillment] = await tx.select({
    plannedCarrierType: s.shipmentFulfillments.plannedCarrierType,
    plannedExternalCarrierId: s.shipmentFulfillments.plannedExternalCarrierId,
  }).from(s.shipmentFulfillments)
    .where(and(
      eq(s.shipmentFulfillments.shipmentId, row.id),
      isNull(s.shipmentFulfillments.canceledAt),
    ))
    .orderBy(asc(s.shipmentFulfillments.id))
    .limit(1);
  if (fulfillment?.plannedCarrierType === 'EXTERNAL' && fulfillment.plannedExternalCarrierId != null) {
    const [carrier] = await tx.select({ linkedSupplierId: s.customers.linkedSupplierId })
      .from(s.customers)
      .where(eq(s.customers.id, fulfillment.plannedExternalCarrierId))
      .limit(1);
    supplierId = carrier?.linkedSupplierId ?? null;
  }
  const price = await resolveCarrierVehicleClassPrice({
    routeId: row.routeId,
    vehicleSizeClassId: vehicleClassId,
    supplierId,
    date,
  });
  if (price == null) return clearStamp();
  await upsertTripCarrierInfo(tx, trip.tripId, { externalFreightCost: String(price.price) });
  await mirrorPlannedCarrierCost(tx, row.id, String(price.price));
  return { shipmentId: row.id, outcome: 'repriced', price: price.price, matched: price.matched };
}
