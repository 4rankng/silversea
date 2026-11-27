// SIL-1092 (K3.86 + K6.32) — the round-preview plate law is DIRECTION-AWARE:
//   THU (phải thu khách) — the Debit Note previews BKS BÁO KHÁCH only.
//   TRA (phải trả nhà xe) — the BẢN KÊ CÔNG NỢ NHÀ XE PHẢI TRẢ carries the
//   lot's BKS THỰC (trip plates: own-fleet truck plate + external carrier
//   plate) + loại xe TÍNH CƯỚC TRẢ (cost vehicle class), and the billing
//   plate goes out NULL so the customer-facing plate can never reach the nhà
//   xe ledger.
// Real dev DB, tracked cleanup (the house convention of
// phoi-phieu-report-own-fleet.test.ts).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { getDebitNoteRoundPreview } from '../services/debit-settlement-rounds.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DAY = '2026-08-27';
const cleanup: Array<() => Promise<unknown>> = [];
function track(run: () => Promise<unknown>) {
  cleanup.unshift(run);
}

after(async () => {
  for (const run of cleanup) await run();
  await disconnectRedis();
});

async function mkLotWithVehicleFacts(label: string): Promise<{ shipmentId: number; customerId: number; routeId: number }> {
  const [customer] = await db.insert(s.customers).values({
    name: `S92 ${label} ${suffix}`,
  }).returning({ id: s.customers.id });
  track(() => db.delete(s.customers).where(eq(s.customers.id, customer.id)));
  const [route] = await db.insert(s.routes).values({ name: `S92 route ${suffix}` }).returning({ id: s.routes.id });
  track(() => db.delete(s.routes).where(eq(s.routes.id, route.id)));
  const [costClass] = await db.insert(s.vehicleSizeClasses).values({
    code: `S92C${cleanup.length}${suffix.slice(0, 3).toUpperCase()}`,
    name: 'Xe tải 9 tấn',
  }).returning({ id: s.vehicleSizeClasses.id, name: s.vehicleSizeClasses.name });
  track(() => db.delete(s.vehicleSizeClasses).where(eq(s.vehicleSizeClasses.id, costClass.id)));

  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED',
    expectedDeliveryDate: DAY,
    blNumber: `S92BL${label}${cleanup.length}${suffix.slice(0, 4).toUpperCase()}`,
    tradeDirection: 'IMPORT',
    // The customer-facing plate exists on the lot — the TRA statement must
    // still NOT print it.
    billingTruckNo: `99K-${label}-BILL`,
    costVehicleClassId: costClass.id,
  }).returning({ id: s.shipments.id });
  track(() => db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)));

  return { shipmentId: shipment.id, customerId: customer.id, routeId: route.id };
}

async function mkTripWithPlate(lot: { shipmentId: number; customerId: number; routeId: number; cargoMode?: string }, plate: string, externalPlate: string | null, freightCost: number | null = null): Promise<void> {
  let truckId: number | null = null;
  if (externalPlate == null) {
    const [truck] = await db.insert(s.trucks).values({
      licensePlate: plate,
    }).returning({ id: s.trucks.id });
    track(() => db.delete(s.trucks).where(eq(s.trucks.id, truck.id)));
    truckId = truck.id;
  }
  // One live trip per (shipment, fulfillment): seed the fulfillment leg the
  // trip's FK points at (distinct per trip).
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: lot.shipmentId, fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL',
    sourceShipmentVersion: 1,
  }).returning({ id: s.shipmentFulfillments.id });
  track(() => db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillment.id)));
  const [trip] = await db.insert(s.trips).values({
    shipmentId: lot.shipmentId, customerId: lot.customerId, routeId: lot.routeId,
    tripCode: `TRP-S92-${cleanup.length}-${suffix}`,
    departureDate: DAY, status: 'IN_TRANSIT', truckId,
    fulfillmentId: fulfillment.id,
  }).returning({ id: s.trips.id });
  track(() => db.delete(s.trips).where(eq(s.trips.id, trip.id)));
  await db.insert(s.tripCarrierInfo).values({
    tripId: trip.id,
    carrierType: externalPlate != null ? 'EXTERNAL' : 'OWN',
    externalPlateNumber: externalPlate,
    externalFreightCost: freightCost,
  });
  track(() => db.delete(s.tripCarrierInfo).where(eq(s.tripCarrierInfo.tripId, trip.id)));
}

async function mkTraRound(customerId: number, shipmentId: number, roundNo: number): Promise<number> {
  const [round] = await db.insert(s.debitSettlementRounds).values({
    customerId, direction: 'TRA', carrierKey: 'PLATE:51B-999.99',
    periodKey: '2026-08', roundNo,
    dateFrom: DAY, dateTo: DAY,
    amount: '1000000', vatRate: 0, createdBy: 1,
  }).returning({ id: s.debitSettlementRounds.id });
  track(() => db.delete(s.debitSettlementRounds).where(eq(s.debitSettlementRounds.id, round.id)));
  await db.insert(s.debitSettlementRoundLots).values({ roundId: round.id, shipmentId });
  track(() => db.delete(s.debitSettlementRoundLots).where(eq(s.debitSettlementRoundLots.roundId, round.id)));
  // The frozen lock the preview reads (legacy law: receivableTotal present,
  // no pricing-basis key) — 1,000,000 net, VAT 0.
  const [lock] = await db.insert(s.shipmentCostLocks).values({
    shipmentId, shipmentVersionAtLock: 1, lockedBy: 1,
    costSnapshot: { receivableTotal: '1000000', freightAuto: '1000000' },
  }).returning({ id: s.shipmentCostLocks.id });
  track(() => db.delete(s.shipmentCostLocks).where(eq(s.shipmentCostLocks.id, lock.id)));
  return round.id;
}

describe('SIL-1092 — bản kê nhà xe phải trả in BKS thực + loại xe tính cước trả', () => {
  test('TRA round: billing plate never printed; trip real plates + cost class ride the wire', async () => {
    const lot = await mkLotWithVehicleFacts('TRA');
    // Cước trả ĐV rides the trips (the board's cuocTraDv channel): 600k own +
    // 400k external = 1,000,000 Tổng 1 — the SAME ladder the chốt summed
    // (SIL-1092 live-verify money law, 27/11).
    await mkTripWithPlate(lot, '29H-888.88', null, 600_000); // own-fleet plated truck
    await mkTripWithPlate(lot, '', '51B-999.99', 400_000);   // external carrier plate
    const roundId = await mkTraRound(lot.customerId, lot.shipmentId, 1);

    const preview = await getDebitNoteRoundPreview(roundId);
    assert.equal(preview.round.direction, 'TRA');
    assert.equal(preview.items.length, 1);
    const item = preview.items[0]!;
    // The customer-facing plate exists on the lot but NEVER reaches the TRA
    // statement — the wire field goes out null.
    assert.equal(item.billingTruckNo, null);
    // BKS thực = the trips' real plates (own truck plate + external plate).
    assert.ok(item.actualTruckNo?.includes('29H-888.88'), `own plate in real plates, got ${item.actualTruckNo}`);
    assert.ok(item.actualTruckNo?.includes('51B-999.99'), `external plate in real plates, got ${item.actualTruckNo}`);
    assert.ok(!item.actualTruckNo?.includes('BILL'), 'no billing plate anywhere in the real-plate column');
    // Loại xe tính cước trả = the lot's cost vehicle class name.
    assert.equal(item.vehicleType, 'Xe tải 9 tấn');
    assert.equal(preview.totals.net, 1_000_000);
  });

  test('THU round keeps the customer Debit Note law: BKS báo khách prints', async () => {
    const lot = await mkLotWithVehicleFacts('THU');
    await mkTripWithPlate(lot, '29H-777.77', null);
    const [round] = await db.insert(s.debitSettlementRounds).values({
      customerId: lot.customerId, direction: 'THU', carrierKey: 'MIXED',
      periodKey: '2026-08', roundNo: 2,
      dateFrom: DAY, dateTo: DAY,
      amount: '1000000', vatRate: 0, createdBy: 1,
    }).returning({ id: s.debitSettlementRounds.id });
    track(() => db.delete(s.debitSettlementRounds).where(eq(s.debitSettlementRounds.id, round.id)));
    await db.insert(s.debitSettlementRoundLots).values({ roundId: round.id, shipmentId: lot.shipmentId });
    track(() => db.delete(s.debitSettlementRoundLots).where(eq(s.debitSettlementRoundLots.roundId, round.id)));
    const [lock] = await db.insert(s.shipmentCostLocks).values({
      shipmentId: lot.shipmentId, shipmentVersionAtLock: 1, lockedBy: 1,
      costSnapshot: { receivableTotal: '1000000', freightAuto: '1000000' },
    }).returning({ id: s.shipmentCostLocks.id });
    track(() => db.delete(s.shipmentCostLocks).where(eq(s.shipmentCostLocks.id, lock.id)));

    const preview = await getDebitNoteRoundPreview(round.id);
    assert.equal(preview.round.direction, 'THU');
    const item = preview.items[0]!;
    // K3.86 — the customer Debit Note still prints the BKS BÁO KHÁCH.
    assert.ok(item.billingTruckNo?.includes('BILL'), `billing plate prints on THU, got ${item.billingTruckNo}`);
    assert.equal(item.billingTruckNo?.includes('29H-777.77'), false, 'the real plate does not masquerade as the billing plate');
    // The payable facts still ride the wire (unused by the THU table).
    assert.ok(item.actualTruckNo?.includes('29H-777.77'));
    assert.equal(item.vehicleType, 'Xe tải 9 tấn');
  });
});
