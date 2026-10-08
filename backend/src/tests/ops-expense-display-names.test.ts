import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { TripStatus, Role } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { upsertExpenseAccountingSource } from '../services/expense-accounting-source.service';
import { listOpsExpenses } from '../services/ops-expenses.service';
import { getOpsFundBook } from '../services/ops-wallet.service';
import { pickExpenseDisplayName, loadExpenseTypeNames } from '../services/expense-type-display';

/**
 * Card 071026141580 — "khai chi hộ" trip rows must show the catalog label,
 * never the raw machine code.
 *
 * The QA repro: declare a trip disbursement of "Phí chi hộ khác" (code OTHER)
 * with no custom fee name → /ops/wallet shows "OTHER" in Lịch sử chi phí and
 * "Chi phí: OTHER" in Sổ quỹ. Both mappings resolved the display name as
 * `feeName ?? raw code`, and trip expenses carry no fee name at all.
 */

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
/** Child rows are pushed last and deleted first — FK-safe teardown. */
const cleanup: Array<() => unknown> = [];
function trackDelete(task: () => unknown): void {
  cleanup.unshift(task);
}

let opsUserId = 0;
let shipmentId = 0;
let fixtureCustomerId = 0;
let tripId = 0;
const expenseIds: number[] = [];

async function insertChiHoExpense(feeName: string | null): Promise<number> {
  const [entry] = await db.insert(s.tripExpenses).values({
    tripId,
    forwarderId: opsUserId,
    expenseType: 'OTHER',
    feeName,
    buyAmount: '20000',
    sellAmount: '0',
    expenseDate: '2026-10-07',
    settlementMethod: 'OPS_ADVANCE',
    approvalStatus: 'RECORDED',
    note: 'Vé cầu đường',
  }).returning();
  trackDelete(() => db.delete(s.tripExpenses).where(eq(s.tripExpenses.id, entry.id)));
  expenseIds.push(entry.id);
  const source = await upsertExpenseAccountingSource(db, {
    sourceKind: 'TRIP', sourceId: entry.id,
    shipmentId, tripId, customerId: fixtureCustomerId,
    expenseTypeCode: 'OTHER', costGroup: 'OPS_REGULAR',
    feeName: feeName ?? '', amount: 20000, customerChargeAmount: 0,
    expenseDate: '2026-10-07', payerKind: 'USER', payerUserId: opsUserId,
    recordedById: opsUserId, note: entry.note, linkedTripExpenseId: entry.id,
  });
  trackDelete(() => db.delete(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id)));
  return entry.id;
}

before(async () => {
  const [ops] = await db.insert(s.users).values({
    username: `disp-ops-${suffix}`.slice(0, 50),
    passwordHash: 'x',
    fullName: `Ops display ${suffix}`,
    role: Role.OPS,
    status: 'ACTIVE',
  }).returning();
  trackDelete(() => db.delete(s.users).where(eq(s.users.id, ops.id)));
  opsUserId = ops.id;

  const [customer] = await db.insert(s.customers)
    .values({ name: `Display customer ${suffix}` }).returning();
  trackDelete(() => db.delete(s.customers).where(eq(s.customers.id, customer.id)));
  const [route] = await db.insert(s.routes)
    .values({ name: `Display route ${suffix}` }).returning();
  trackDelete(() => db.delete(s.routes).where(eq(s.routes.id, route.id)));
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `Display cargo ${suffix}` }).returning();
  trackDelete(() => db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoType.id)));

  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `DSP-SHP-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: 'IN_TRANSIT',
    cargoMode: 'LCL',
  }).returning();
  trackDelete(() => db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)));
  shipmentId = shipment.id;
  fixtureCustomerId = customer.id;

  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
  }).returning();
  trackDelete(() => db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillment.id)));

  const trip = await insertTripComposite(db, {
    tripCode: `DSP-TRIP-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
    status: TripStatus.IN_TRANSIT,
    departureDate: '2026-10-07',
    revenue: '0',
    carrierType: 'OWN',
  });
  trackDelete(() => db.delete(s.trips).where(eq(s.trips.id, trip.id)));
  tripId = trip.id;

  await insertChiHoExpense(null); // the QA row: no custom fee name at all
  await insertChiHoExpense('OTHER'); // pre-fix rows wrote the code as fee_name
  await insertChiHoExpense('Vé cầu đường'); // a real custom name wins
});

after(async () => {
  for (const task of cleanup) await task();
});

describe('pickExpenseDisplayName precedence', () => {
  test('custom name wins; a code-like fee name is not a name; code is last resort', () => {
    assert.equal(pickExpenseDisplayName('Vé cầu đường', 'OTHER', 'Phí chi hộ khác'), 'Vé cầu đường');
    assert.equal(pickExpenseDisplayName(null, 'OTHER', 'Phí chi hộ khác'), 'Phí chi hộ khác');
    assert.equal(pickExpenseDisplayName('OTHER', 'OTHER', 'Phí chi hộ khác'), 'Phí chi hộ khác');
    assert.equal(pickExpenseDisplayName('', 'OTHER', 'Phí chi hộ khác'), 'Phí chi hộ khác');
    assert.equal(pickExpenseDisplayName(null, 'MYSTERY', undefined), 'MYSTERY');
  });

  test('catalog lookup resolves batched codes', async () => {
    const names = await loadExpenseTypeNames(['OTHER', 'OTHER', '']);
    assert.equal(names.get('OTHER'), 'Phí chi hộ khác');
  });
});

describe('wallet surfaces never print the machine code (card 071026141580)', () => {
  test('Lịch sử chi phí resolves the catalog label for feeName-less trip rows', async () => {
    const rows = (await listOpsExpenses({ paidById: opsUserId }))
      .filter((row) => expenseIds.includes(row.sourceId ?? -1));
    assert.equal(rows.length, 3, `expected the 3 seeded chi-hô rows, got ${rows.length}`);

    const [blankFee, codeFee, customFee] = expenseIds.map((id) => rows.find((row) => row.sourceId === id));
    assert.ok(blankFee, 'row without feeName must still be present');
    assert.equal(blankFee.expenseTypeName, 'Phí chi hộ khác');
    assert.equal(blankFee.tripId, tripId, 'the wallet row must carry its trip id for Sửa/Xóa');
    assert.equal(codeFee?.expenseTypeName, 'Phí chi hộ khác', 'code-like fee_name is not a name');
    assert.equal(customFee?.expenseTypeName, 'Vé cầu đường');
  });

  test('Sổ quỹ labels resolve the catalog name for trip-expense proxies', async () => {
    const fundBook = await getOpsFundBook(opsUserId);
    const labels = fundBook.items
      .filter((item) => item.key.startsWith('trip-expense-') && expenseIds.includes(Number(item.key.slice('trip-expense-'.length))))
      .map((item) => item.label);
    assert.equal(labels.length, 3, `expected 3 fund-book lines, got ${labels.length}`);
    // Proxy lines carry no note suffix (only native expense lines append one).
    assert.ok(labels.includes('Chi phí: Phí chi hộ khác'), `missing resolved label in ${JSON.stringify(labels)}`);
    assert.ok(labels.includes('Chi phí: Vé cầu đường'), `missing custom label in ${JSON.stringify(labels)}`);
    assert.ok(labels.every((label) => !label.includes('OTHER')), `raw code leaked into labels: ${JSON.stringify(labels)}`);
  });
});
