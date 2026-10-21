// Card 20260928_177 — the customers-screen debt projection: per customer, its
// shipment/trip freight figures WITH the own-company-vehicle dimension, so the
// screen's "Bỏ xe công ty" tick can be answered by the server instead of by a
// client-side subtraction over data that never carried the dimension.
//
// WHERE OWNERSHIP IS ACTUALLY RECORDED (verified at HEAD, not assumed):
//   `trip_carrier_info.carrier_type` ∈ ('OWN','EXTERNAL') — NOT NULL, DEFAULT
//   'OWN' (db/schema/trips.ts:188). It is the trip's own/external axis that the
//   P&L already splits on (`pnl.service.ts` ownTrips / extTrips) and that the
//   dispatch plan writes (`dispatch-planning-commands.service.ts` →
//   trip_carrier_info + shipment_fulfillments.planned_carrier_type).
//   The key VOCABULARY is reused, never reinvented: `carrierKeyForEntry` from
//   ./debit-settlement-shared yields 'OWN' for an own-fleet truck (one with no
//   `carrier_id`) and `CUST:<id>` / `PLATE:<plate>` for an external carrier —
//   the same keys the Chọn Debit settlement and the shipments `carrierKeys=OWN`
//   facet use. A trip with no carrier sidecar reads as 'OWN' (the column's own
//   default, and the pnl precedent `carrierType ?? 'OWN'`).
//
// FREIGHT FIGURES: the chốt-debit board's grain (accounting-debit-close.service)
// — the latest `freight_rate_snapshots` row per (shipment, trip_id), additive
// legs, restricted to active trips; a shipment-level freeze (trip_id NULL) lands
// on the shipment's lowest-id active trip exactly once. Cước trả is
// `trip_carrier_info.external_freight_cost`, the board's own source.
//
// C5 (card 1016212936) — CƯỚC THU follows the F-2/§3.2 group law for an LCL lot
// that is REV-grouped or whose live trip carries an override stamp: the figure
// comes from the ONE shared helper (`revenue-override-read.service`), exactly
// like the CUS and Kế toán boards, so a per-lot merge cước (per boss 21/10 —
// mỗi lô tự tính đơn giá Tuyến×KH của chính nó) reaches this report too
// instead of the pre-merge snapshot. Everything else keeps the snapshot grain
// byte-for-byte (FCL included — the ruling's LCL-only caveat).
import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { activeTripConditions } from './active-trip-scope';
import { carrierKeyForEntry } from './debit-settlement-shared';
import { loadRevenueOverrideByLot } from './revenue-override-read.service';

/** One shipment/trip row of the projection — carries its own-vs-external identity. */
export interface CustomerFreightLine {
  shipmentId: number;
  tripId: number;
  shipmentCode: string | null;
  /** 'OWN' when the trip ran on a company vehicle — the same axis (and the same
   *  value) the Chọn Debit board and the accounting transport register filter on
   *  (`trip_carrier_info.carrier_type`). */
  ownership: 'OWN' | 'EXTERNAL';
  /** 'OWN' | 'CUST:<id>' | 'PLATE:<plate>' | 'UNKNOWN' — the debit-settlement
   *  carrier-key vocabulary; 'OWN' whenever `ownership` is 'OWN'. */
  carrierKey: string;
  /** Cước thu của chuyến (frozen freight amount). */
  freightRevenue: number;
  /** C5 (card 1016212936) — the group-law note that explains a grouped lot's
   *  cước thu line (per boss 21/10 — per-lot value, not a 0₫ member): the
   *  merge note ("Ghép cước cùng Bill X") or the trip's own override reason.
   *  Null whenever the line reads the historical snapshot channel. */
  freightOverrideReason: string | null;
  /** Cước trả của chuyến (external carrier cost). */
  freightPayable: number;
}

export interface CustomerDebtRow {
  customerId: number;
  customerName: string | null;
  customerShortName: string | null;
  /** Figures under the applied filter (own-vehicle lines dropped when ON). */
  tripCount: number;
  freightRevenue: number;
  freightPayable: number;
  /** The own-vehicle portion — always reported, so the tick's effect is auditable. */
  ownFleetTripCount: number;
  ownFleetFreightRevenue: number;
  ownFleetFreightPayable: number;
  /** Every line, unfiltered, each flagged — the evidence behind the figures. */
  lines: CustomerFreightLine[];
}

export interface CustomerDebtSummary {
  filter: {
    from: string | null;
    to: string | null;
    excludeOwnFleet: boolean;
    customerIds: number[] | null;
  };
  items: CustomerDebtRow[];
  totals: Omit<CustomerDebtRow, 'customerId' | 'customerName' | 'customerShortName' | 'lines'>;
}

const ZERO_TOTALS = {
  tripCount: 0,
  freightRevenue: 0,
  freightPayable: 0,
  ownFleetTripCount: 0,
  ownFleetFreightRevenue: 0,
  ownFleetFreightPayable: 0,
};

function money(value: string | number | null | undefined): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

/**
 * The projection itself, pure: group the trip lines per customer, report the
 * own-vehicle portion, and — only when the tick is ON — drop the own-vehicle
 * lines from the figures. Same function the route calls, so the arithmetic the
 * tests pin is the arithmetic the CSV export shows.
 */
export function buildCustomerDebtSummary(input: {
  lines: CustomerFreightFact[];
  customers: Array<{ id: number; name: string | null; shortName: string | null }>;
  excludeOwnFleet: boolean;
  from?: string | null;
  to?: string | null;
  customerIds?: number[] | null;
}): CustomerDebtSummary {
  const grouped = new Map<number, CustomerFreightFact[]>();
  for (const fact of input.lines) {
    const list = grouped.get(fact.customerId);
    if (list) list.push(fact);
    else grouped.set(fact.customerId, [fact]);
  }

  const items: CustomerDebtRow[] = [];
  for (const customer of input.customers) {
    const facts = grouped.get(customer.id) ?? [];
    if (facts.length === 0) continue;
    const own = facts.filter((fact) => fact.ownership === 'OWN');
    const counted = input.excludeOwnFleet ? facts.filter((fact) => fact.ownership !== 'OWN') : facts;
    items.push({
      customerId: customer.id,
      customerName: customer.name,
      customerShortName: customer.shortName,
      tripCount: counted.length,
      freightRevenue: sum(counted, (fact) => fact.freightRevenue),
      freightPayable: sum(counted, (fact) => fact.freightPayable),
      ownFleetTripCount: own.length,
      ownFleetFreightRevenue: sum(own, (fact) => fact.freightRevenue),
      ownFleetFreightPayable: sum(own, (fact) => fact.freightPayable),
      lines: facts,
    });
  }

  const totals = items.reduce(
    (acc, row) => ({
      tripCount: acc.tripCount + row.tripCount,
      freightRevenue: acc.freightRevenue + row.freightRevenue,
      freightPayable: acc.freightPayable + row.freightPayable,
      ownFleetTripCount: acc.ownFleetTripCount + row.ownFleetTripCount,
      ownFleetFreightRevenue: acc.ownFleetFreightRevenue + row.ownFleetFreightRevenue,
      ownFleetFreightPayable: acc.ownFleetFreightPayable + row.ownFleetFreightPayable,
    }),
    { ...ZERO_TOTALS },
  );

  return {
    filter: {
      from: input.from ?? null,
      to: input.to ?? null,
      excludeOwnFleet: input.excludeOwnFleet,
      customerIds: input.customerIds ?? null,
    },
    items,
    totals,
  };
}

function sum(list: CustomerFreightLine[], pick: (line: CustomerFreightLine) => number): number {
  let total = 0;
  for (const item of list) total += pick(item);
  return total;
}

/** A line plus the customer it belongs to (the projection's grouping key). */
export interface CustomerFreightFact extends CustomerFreightLine {
  customerId: number;
}

export interface CustomerDebtSummaryQuery {
  from?: string;
  to?: string;
  excludeOwnFleet?: boolean;
  customerIds?: number[];
}

/**
 * Load the per-trip facts from the database and assemble the projection.
 * Read-only, one snapshot per call; inactive (deleted/canceled) trips are out of
 * scope exactly as on every other money surface.
 */
export async function getCustomerDebtSummary(
  query: CustomerDebtSummaryQuery,
): Promise<CustomerDebtSummary> {
  const customerIds = query.customerIds && query.customerIds.length > 0 ? query.customerIds : null;
  const lotConditions = [isNull(s.shipments.deletedAt)];
  if (query.from) lotConditions.push(gte(s.shipments.expectedDeliveryDate, query.from));
  if (query.to) lotConditions.push(lte(s.shipments.expectedDeliveryDate, query.to));
  if (customerIds) lotConditions.push(inArray(s.shipments.customerId, customerIds));

  const lots = await db.select({
    id: s.shipments.id,
    code: s.shipments.shipmentCode,
    customerId: s.shipments.customerId,
    // C5 — the qualification facts the boards read (LCL + REV group), plus the
    // principal reference the member note cites.
    cargoMode: s.shipments.cargoMode,
    revGroupId: s.shipments.revGroupId,
    revGroupOrder: s.shipments.revGroupOrder,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
  })
    .from(s.shipments)
    .where(and(...lotConditions))
    .orderBy(s.shipments.id);
  if (lots.length === 0) {
    return buildCustomerDebtSummary({
      lines: [],
      customers: [],
      excludeOwnFleet: query.excludeOwnFleet === true,
      from: query.from,
      to: query.to,
      customerIds,
    });
  }
  const lotIds = lots.map((lot) => lot.id);
  const codeByLot = new Map(lots.map((lot) => [lot.id, lot.code]));
  const lotById = new Map(lots.map((lot) => [lot.id, lot] as const));

  // C5 — the rev-group principal's reference, for the member note
  // ("Ghép cước cùng Bill X"). Same lookup the money boards use: the member at
  // rev group order 1 is the principal, cited by its Bill number (booking ref
  // as the fallback). LIVE order-1 rows only: a soft-deleted principal keeps
  // its group id AND its order-1 slot (the delete renumbering never strips
  // the leaver), so the ghost row must never shadow the promoted principal.
  const revGroupIds = [...new Set(lots.map((lot) => lot.revGroupId).filter((id): id is string => id != null))];
  const revPrincipalRefs = new Map<string, string>();
  if (revGroupIds.length > 0) {
    const principals = await db.select({
      groupId: s.shipments.revGroupId,
      blNumber: s.shipments.blNumber,
      bookingRef: s.shipments.bookingRef,
    }).from(s.shipments)
      .where(and(
        isNull(s.shipments.deletedAt),
        eq(s.shipments.revGroupOrder, 1),
        inArray(s.shipments.revGroupId, revGroupIds),
      ));
    for (const principal of principals) {
      const ref = principal.blNumber ?? principal.bookingRef ?? '';
      if (principal.groupId != null && ref !== '') revPrincipalRefs.set(principal.groupId, ref);
    }
  }
  // C5 (card 1016212936) — the ONE shared read law, never a forked one: the
  // same helper the CUS and Kế toán boards call. Its grain is the LOT; this
  // report's grain is the trip line, so the lot's effective figure is anchored
  // on the lot's first active trip below (the device this function already uses
  // for a shipment-level freeze) and the lot's remaining legs carry no freight
  // line (per-lot cước appears once, on its first leg).
  const overrideByLot = await loadRevenueOverrideByLot(db, lotIds);

  // Cước trả + the own/external axis + the carrier identity, per active trip.
  const tripRows = await db.select({
    tripId: s.trips.id,
    shipmentId: s.trips.shipmentId,
    customerId: s.trips.customerId,
    licensePlate: s.trucks.licensePlate,
    truckCarrierId: s.trucks.carrierId,
    carrierType: s.tripCarrierInfo.carrierType,
    externalEntityId: s.tripCarrierInfo.externalEntityId,
    externalEntityType: s.tripCarrierInfo.externalEntityType,
    externalPlate: s.tripCarrierInfo.externalPlateNumber,
    externalFreightCost: s.tripCarrierInfo.externalFreightCost,
  }).from(s.trips)
    .leftJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .where(and(inArray(s.trips.shipmentId, lotIds), ...activeTripConditions()))
    .orderBy(s.trips.id);

  // Cước thu: the chốt-debit board's grain — latest snapshot per
  // (shipment, trip_id), trip-bound rows restricted to active trips.
  const snapshotRows = await db.select({
    id: s.freightRateSnapshots.id,
    shipmentId: s.freightRateSnapshots.shipmentId,
    tripId: s.freightRateSnapshots.tripId,
    freightAmount: s.freightRateSnapshots.freightAmount,
  }).from(s.freightRateSnapshots)
    .leftJoin(s.trips, eq(s.trips.id, s.freightRateSnapshots.tripId))
    .where(and(
      inArray(s.freightRateSnapshots.shipmentId, lotIds),
      or(isNull(s.freightRateSnapshots.tripId), and(...activeTripConditions())),
      sql`(${s.freightRateSnapshots.id}) = (
        select max(latest.id) from ${s.freightRateSnapshots} latest
        where latest.shipment_id = ${s.freightRateSnapshots.shipmentId}
          and latest.trip_id is not distinct from ${s.freightRateSnapshots.tripId}
      )`,
    ));
  const revenueByTrip = new Map<number, number>();
  const shipmentLevelRevenue = new Map<number, number>();
  for (const row of snapshotRows) {
    if (row.shipmentId == null) continue;
    const amount = money(row.freightAmount);
    if (row.tripId != null) revenueByTrip.set(row.tripId, (revenueByTrip.get(row.tripId) ?? 0) + amount);
    else shipmentLevelRevenue.set(row.shipmentId, (shipmentLevelRevenue.get(row.shipmentId) ?? 0) + amount);
  }

  const facts: CustomerFreightFact[] = [];
  const firstActiveTripByLot = new Map<number, number>();
  for (const row of tripRows) {
    if (row.shipmentId == null || row.customerId == null) continue;
    if (!firstActiveTripByLot.has(row.shipmentId)) firstActiveTripByLot.set(row.shipmentId, row.tripId);
    const ownership: 'OWN' | 'EXTERNAL' = (row.carrierType ?? 'OWN') === 'OWN' ? 'OWN' : 'EXTERNAL';
    const derivedKey = carrierKeyForEntry({
      plate: row.truckCarrierId == null ? row.licensePlate : null,
      carrierId: row.truckCarrierId,
      externalId: row.externalEntityType === 'CUSTOMER' && row.externalEntityId != null
        ? row.externalEntityId
        : null,
      externalPlate: row.externalPlate,
    });
    // The column is the authority on own-vs-external, so the key never
    // contradicts it: an EXTERNAL leg whose only fingerprint is an own-fleet
    // plate reads 'UNKNOWN' rather than being mislabelled 'OWN'.
    const carrierKey = ownership === 'OWN'
      ? 'OWN'
      : (derivedKey && derivedKey !== 'OWN' ? derivedKey : 'UNKNOWN');
    // A shipment-level freeze has no trip of its own: it lands on the
    // shipment's first active trip, so the row total equals the board's lot
    // total and never double counts across legs.
    const shipmentLevel = firstActiveTripByLot.get(row.shipmentId) === row.tripId
      ? shipmentLevelRevenue.get(row.shipmentId) ?? 0
      : 0;
    facts.push({
      customerId: row.customerId,
      shipmentId: row.shipmentId,
      tripId: row.tripId,
      shipmentCode: codeByLot.get(row.shipmentId) ?? null,
      carrierKey,
      ownership,
      freightRevenue: (revenueByTrip.get(row.tripId) ?? 0) + shipmentLevel,
      freightOverrideReason: null,
      freightPayable: money(row.externalFreightCost),
    });
  }

  // C5 — the group law owns the lot's CƯỚC THU for an LCL lot that is
  // REV-grouped (FB-093 re-prices the principal with no override marker) or
  // whose live trip carries an override stamp (FB-095 transfers/re-stamps, and
  // the survivor of a dissolved group is ungrouped). The figure comes from the
  // shared helper; only when that channel holds no total does the snapshot
  // channel stand (161026204709: a merged lot's money may live in a
  // shipment-level snapshot). FCL and unqualified lots are untouched.
  const snapshotTotalByLot = new Map<number, number>();
  for (const fact of facts) {
    snapshotTotalByLot.set(fact.shipmentId, (snapshotTotalByLot.get(fact.shipmentId) ?? 0) + fact.freightRevenue);
  }
  for (const fact of facts) {
    const lot = lotById.get(fact.shipmentId);
    if (!lot) continue;
    const override = overrideByLot.get(fact.shipmentId);
    if (lot.cargoMode !== 'LCL' || (lot.revGroupId == null && !(override?.stamped ?? false))) continue;
    const effective = override?.total ?? snapshotTotalByLot.get(fact.shipmentId) ?? 0;
    fact.freightRevenue = firstActiveTripByLot.get(fact.shipmentId) === fact.tripId ? effective : 0;
    fact.freightOverrideReason = override?.reason
      ?? ((lot.revGroupOrder ?? 1) > 1
        ? `Ghép cước cùng Bill ${revPrincipalRefs.get(lot.revGroupId!) ?? ''}`.trim()
        : null);
  }

  const ids = [...new Set(facts.map((fact) => fact.customerId))];
  const customerRows = ids.length > 0
    ? await db.select({
        id: s.customers.id,
        name: s.customers.name,
        shortName: s.customers.shortName,
      }).from(s.customers).where(inArray(s.customers.id, ids)).orderBy(s.customers.id)
    : [];

  return buildCustomerDebtSummary({
    lines: facts,
    customers: customerRows.map((row) => ({ id: row.id, name: row.name, shortName: row.shortName })),
    excludeOwnFleet: query.excludeOwnFleet === true,
    from: query.from,
    to: query.to,
    customerIds,
  });
}
