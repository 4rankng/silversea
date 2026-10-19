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
import { eq } from 'drizzle-orm';
import type { Tx } from '../db';
import * as s from '../db/schema';
import { upsertTripCarrierInfo, upsertTripFinancialState } from './trip-composite.service';
import { resolveCarrierVehicleClassPrice } from './pricing.service';
import type { LclCostCarrier, LiveTripFacts, ShipmentRow } from './lcl-grouping.service';

/**
 * 161026232319 — Lô 1's cước trả ĐV at group assignment (live-trip case).
 *
 * The manual entry ("Điều vận nhập tay") wins; otherwise the carrier price
 * board is traced for the lane (tuyến × loại xe, nhà xe's own row first, the
 * generic row as fallback), dated at the lot's delivery day — else the trip's
 * departure day. A board miss leaves Lô 1's own value untouched: an absent
 * price is never an invented 0₫ (and never a wiped freight).
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
  if (trip == null) return null;
  if (manualFreightCost != null) {
    await upsertTripCarrierInfo(tx, trip.tripId, { externalFreightCost: String(manualFreightCost) });
    return { amount: String(manualFreightCost), source: 'MANUAL' };
  }
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
