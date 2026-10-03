import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { insertTripComposite } from '../services/trip-composite.service';
import { createAccountingExpense } from '../services/expense-accounting-create.service';
import { getPhoiPhieuChiHo, listPhoiPhieuRows } from '../services/phoi-phieu-control.service';

// Card 20261002_292 rework (ruling A, lead 2026-10-03): the chi-hộ detail
// dialog must show EVERY recorded chi-hộ source of the shipment — including
// the TRIP-kind row its own ＋Thêm dòng panel creates through the
// COMPANY-payer branch of createAccountingExpense. The pre-fix read filtered
// sourceKind = 'OPS' and inner-joined ops_expense_entries, so a saved
// COMPANY-paid entry rendered "Chưa có khoản chi hộ" (qa repro: staging
// source 31, shipment 296, trip 108).

const tag = `chiho292-${Date.now()}`;
const userIds: number[] = [];
const shipmentIds: number[] = [];
const tripIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const fulfillmentIds: number[] = [];
const feeTypeIds: number[] = [];

let actor: { userId: number; role: Role; username: string };

before(async () => {
  const [admin] = await db.insert(s.users).values({
    username: `${tag}-admin`, fullName: `Admin ${tag}`, passwordHash: await bcrypt.hash('test-only', 10),
    role: Role.ADMIN, status: 'ACTIVE',
  }).returning({ id: s.users.id, username: s.users.username, role: s.users.role });
  userIds.push(admin.id);
  actor = { userId: admin.id, role: Role.ADMIN, username: admin.username ?? `${tag}-admin` };
});

test('chi-hộ read shows a COMPANY-paid (TRIP-kind) entry created for the trip', async () => {
  const [customer] = await db.insert(s.customers).values({ name: `Chiho292 customer ${tag}` }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Chiho292 route ${tag}` }).returning({ id: s.routes.id });
  routeIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `Chiho292 cargo ${tag}` }).returning({ id: s.cargoTypes.id });
  cargoTypeIds.push(cargoType.id);
  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `CHIHO292-SHP-${tag}`.slice(0, 50),
    customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id, cargoMode: 'LCL', status: 'NEW',
  }).returning();
  shipmentIds.push(shipment.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id, fulfillmentType: 'LCL_SHIPMENT', cargoMode: 'LCL', dispatchClassification: 'LCL',
    sourceShipmentVersion: shipment.version, siteSnapshot: {}, createdBy: null,
  }).returning();
  fulfillmentIds.push(fulfillment.id);
  const trip = await insertTripComposite(db, {
    tripCode: `CHIHO292-TRIP-${tag}`.slice(0, 50),
    customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
    shipmentId: shipment.id, fulfillmentId: fulfillment.id,
    departureDate: '2026-10-03', status: 'ACTIVE', carrierType: 'OWN',
  });
  tripIds.push(trip.id);

  const [feeType] = await db.insert(s.forwarderExpenseTypes).values({
    code: `CHIHO292-${tag}`.slice(0, 50), name: `Phí chi hộ khác ${tag}`, status: 'ACTIVE',
  }).returning();
  feeTypeIds.push(feeType.id);

  // The panel's write: COMPANY payer routes to trip_expenses + a TRIP-kind
  // source (the branch qa's taps exercised on staging).
  const recorded = await db.transaction(tx => createAccountingExpense(tx, actor, {
    tripId: trip.id,
    expenseTypeCode: feeType.code,
    amount: 150000,
    customerChargeAmount: 150000,
    expenseDate: '2026-10-03',
    costGroup: 'INVOICED_OTHER',
    feeName: `Phí chi hộ khác ${tag}`,
    payerKind: 'COMPANY',
    invoiceNumber: 'INV-CHIHO292',
  }));
  assert.equal(recorded.sourceKind, 'TRIP');

  // The dialog's read must now include the row it just created.
  const detail = await getPhoiPhieuChiHo(trip.id);
  assert.equal(detail.shipmentId, shipment.id);
  const row = detail.rows.find(entry => entry.feeName === `Phí chi hộ khác ${tag}`);
  assert.ok(row, `the TRIP-kind entry must appear in the chi-hộ rows (got ${detail.rows.length} rows)`);
  assert.equal(Number(row.amountTra), 150000);
  assert.equal(Number(row.amountThu), 150000);
  assert.equal(row.invoiceNumber, 'INV-CHIHO292');
  assert.equal(row.confirmed, false);
});

test('board projection keeps the trip row while the shipment lives, and drops it only when the shipment is soft-deleted (lead adjudication 2026-10-03)', async () => {
  // The dd9fb0d5 widening must never drop a row the pre-fix shape matched:
  // an alive shipment with ONLY a TRIP-kind source still projects its row.
  const withRow = await listPhoiPhieuRows({});
  const projected = withRow.find(row => row.tripId === tripIds[0]);
  assert.ok(projected, 'the alive shipment projects its board row');
  assert.equal(Number(projected.chiHoTripTra), 150000);
  assert.equal(Number(projected.chiHoTripThu), 150000);
  assert.ok(Number(projected.chiHoTra) >= 150000, 'the widened total includes the TRIP slice');

  // The vanish mechanism (staging trip 108): soft-delete the shipment and the
  // documented orphan contract excludes the row — a data event, not the code.
  await db.update(s.shipments).set({ deletedAt: new Date() }).where(inArray(s.shipments.id, shipmentIds));
  const afterDelete = await listPhoiPhieuRows({});
  assert.ok(!afterDelete.some(row => row.tripId === tripIds[0]), 'a soft-deleted shipment hides its live trip (documented orphan contract)');
});

after(async () => {
  if (tripIds.length) {
    await db.delete(s.expenseAccountingSources).where(inArray(s.expenseAccountingSources.tripId, tripIds));
    await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.tripId, tripIds));
    await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, tripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  }
  if (shipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  if (fulfillmentIds.length) await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, fulfillmentIds));
  if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  if (routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  if (cargoTypeIds.length) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, cargoTypeIds));
  if (feeTypeIds.length) await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.id, feeTypeIds));
  if (userIds.length) await db.delete(s.users).where(inArray(s.users.id, userIds));
  await disconnectRedis();
  await client.end();
});
