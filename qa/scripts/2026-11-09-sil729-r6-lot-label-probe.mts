// SIL-729 r6 probe — the lot-label law + the deleted-lot exclusion, on the
// REAL dev DB (run: cd backend && npx tsx ../qa/scripts/2026-11-09-sil729-r6-lot-label-probe.mts).
//
// Owner ruling 09/11: 'Chưa xác định' = ONLY lot-less money. A trip-less chi hộ
// fee whose lot cannot name ONE carrier prints under the LOT's own code; a fee
// attached to a SOFT-DELETED lot is excluded from the report wholesale. A lot
// with a real carrier fact still resolves to the carrier first (r2/r4 laws).
//
// Fixture rows carry QA tokens, are tracked, and are HARD-deleted on exit —
// the probe writes only its own session rows (qa/scripts contract).
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db } from '../../backend/src/db';
import * as s from '../../backend/src/db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../../backend/src/lib/redis';
import { getPhoiPhieuPartyLots, getPhoiPhieuReport } from '../../backend/src/services/phoi-phieu-control.service';

const suffix = `${Date.now()}`;
// An isolated window: no other suite writes 2026-08-20 departures/paidAts.
const DAY = '2026-08-20';
const cleanup: Array<{ table: any; id: number }> = [];
function track(table: any, id: number) {
  cleanup.unshift({ table, id });
}

async function mkFee(shipmentId: number, userId: number, label: string, amount: number) {
  const code = `QA_R6_FEE_${suffix}_${label}`;
  const [type] = await db.insert(s.forwarderExpenseTypes).values({
    code, name: `QA r6 loại phí ${label}`, status: 'ACTIVE', category: null, requiresInvoice: false,
  }).returning({ id: s.forwarderExpenseTypes.id });
  track(s.forwarderExpenseTypes, type.id);
  const [entry] = await db.insert(s.opsExpenseEntries).values({
    shipmentId, expenseTypeCode: code, amount: String(amount), customerChargeAmount: '0',
    costGroup: 'OPS_REGULAR', payerKind: 'USER', paidById: userId, paidAt: DAY,
  }).returning({ id: s.opsExpenseEntries.id });
  track(s.opsExpenseEntries, entry.id);
  const [source] = await db.insert(s.expenseAccountingSources).values({
    sourceKind: 'OPS', sourceId: entry.id, shipmentId, tripId: null,
    confirmedAt: new Date(), version: 3,
  }).returning({ id: s.expenseAccountingSources.id });
  track(s.expenseAccountingSources, source.id);
  return { sourceId: source.id, amount };
}

/** Base lot: customer + route + shipment(+code) + one fulfillment. */
async function mkLot(label: string, opts: { plannedCarrierType?: string; plate?: string }) {
  const [user] = await db.insert(s.users).values({
    username: `qa-r6-${suffix}-${label}`, passwordHash: 't', role: Role.ACCOUNTANT, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, user.id);
  const [customer] = await db.insert(s.customers).values({
    name: `QA R6 KH ${label} ${suffix}`,
  }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `QA r6 route ${label}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'READY_FOR_DISPATCH',
    expectedDeliveryDate: DAY, shipmentCode: `QA-R6-${suffix}-${label}`,
  }).returning({ id: s.shipments.id, shipmentCode: s.shipments.shipmentCode });
  track(s.shipments, shipment.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id, fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
    plannedCarrierType: opts.plannedCarrierType ?? null,
    plannedVehiclePlateNumber: opts.plate ?? null,
  }).returning({ id: s.shipmentFulfillments.id });
  track(s.shipmentFulfillments, fulfillment.id);
  return { userId: user.id, customerId: customer.id, shipment, fulfillmentId: fulfillment.id };
}

after(async () => {
  for (const { table, id } of cleanup) {
    await db.delete(table).where(eq(table.id, id));
  }
  await disconnectRedis();
});

const results: string[] = [];

// ── Lot A: live lot, 'Chưa phân xe' shape (planned OWN, plate-less, no trips).
const lotA = await mkLot('A', { plannedCarrierType: 'OWN' });
const feeA = await mkFee(lotA.shipment.id, lotA.userId, 'A', 150_000);

// ── Lot B: will be soft-deleted after its fee is recorded.
const lotB = await mkLot('B', {});
const feeB = await mkFee(lotB.shipment.id, lotB.userId, 'B', 60_000);

// ── Lot C: plated OWN fulfillment + an OWN live trip — the r4 carrier fact.
const lotC = await mkLot('C', { plannedCarrierType: 'OWN', plate: `QA${suffix.slice(-6)}-P` });
{
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `QA${suffix.slice(-6)}-T`, status: 'ACTIVE',
  }).returning({ id: s.trucks.id });
  track(s.trucks, truck.id);
  const [trip] = await db.insert(s.trips).values({
    fulfillmentId: lotC.fulfillmentId, shipmentId: lotC.shipment.id, customerId: lotC.customerId,
    routeId: (await db.select({ id: s.shipments.routeId }).from(s.shipments).where(eq(s.shipments.id, lotC.shipment.id)))[0]!.id,
    tripCode: `QA-R6-TRP-${suffix}`, departureDate: DAY, status: 'IN_TRANSIT', truckId: truck.id,
  }).returning({ id: s.trips.id });
  track(s.trips, trip.id);
  await db.insert(s.tripCarrierInfo).values({ tripId: trip.id, carrierType: 'OWN' });
  const feeC = await mkFee(lotC.shipment.id, lotC.userId, 'C', 500_000);
  results.push(`fixture C fee=${JSON.stringify(feeC)}`);
}

// ── Soft-delete lot B (owner ruling: deleted lot = excluded from the report).
await db.update(s.shipments).set({ deletedAt: new Date() }).where(eq(s.shipments.id, lotB.shipment.id));

const tra = await getPhoiPhieuReport({ kind: 'TRA', dateFrom: DAY, dateTo: DAY });
const thu = await getPhoiPhieuReport({ kind: 'THU', dateFrom: DAY, dateTo: DAY });

const unknownTra = tra.rows.filter((row) => row.party === 'Chưa xác định');
assert.equal(unknownTra.length, 0, `no TRA 'Chưa xác định' row may remain (got ${JSON.stringify(tra.rows.map((r) => r.party))})`);

const rowA = tra.rows.find((row) => row.party === lotA.shipment.shipmentCode);
assert.ok(rowA, `lot A (unassigned) must print under its own code ${lotA.shipment.shipmentCode}`);
assert.equal(rowA!.psKhac + rowA!.tienHa + rowA!.tienNang, feeA.amount, 'lot A row carries exactly its fee');
assert.equal(rowA!.partyId, null, 'the lot label is not a ledger entity');

const rowC = tra.rows.find((row) => row.party === 'XE NHÀ — SILVER SEA');
assert.ok(rowC, 'lot C (plated OWN fact) still resolves to the internal fleet carrier');
assert.equal(rowC!.psKhac + rowC!.tienHa + rowC!.tienNang, 500_000, 'lot C row carries exactly its fee');

const rowBAny = tra.rows.find((row) => row.party === lotB.shipment.shipmentCode);
assert.ok(rowBAny == null, 'soft-deleted lot B must not appear in the report');
assert.ok(!tra.grand.tongPhaiThuTra.toString().includes(String(360_000)), 'sanity: A+B sum never reported');

const thuUnknown = thu.rows.filter((row) => row.party === 'Chưa xác định');
assert.equal(thuUnknown.length, 0, 'THU keeps resolving its fixture customers (FB-061 untouched on live masters)');
const thuA = thu.rows.find((row) => row.party?.startsWith('QA R6 KH A'));
assert.ok(thuA, 'THU lot A still resolves under its customer name');

// The drill-down opens the lot-code row and lists its fee (shipment-keyed).
const lotsA = await getPhoiPhieuPartyLots({ kind: 'TRA', party: lotA.shipment.shipmentCode!, dateFrom: DAY, dateTo: DAY });
assert.ok(lotsA.items.some((lot) => lot.shipmentId === lotA.shipment.id && lot.tripId == null),
  'the lot-code drill-down lists the unassigned lot as a display-only row');

results.push(`TRA rows=${JSON.stringify(tra.rows.map((r) => ({ party: r.party, sl: r.soLuong, tong: r.tongPhaiThuTra })))}`);
results.push(`THU rows=${JSON.stringify(thu.rows.map((r) => ({ party: r.party, sl: r.soLuong, tong: r.tongPhaiThuTra })))}`);
results.push(`drill-down A items=${lotsA.items.length}`);
console.log(results.join('\n'));
console.log('PROBE PASS');
