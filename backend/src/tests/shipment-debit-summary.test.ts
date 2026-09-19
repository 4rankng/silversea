import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { getShipmentDebitSummary } from '../services/shipment-debit-summary.service';
import { lockShipmentCost, createDebitNoteFromCostLock } from '../services/shipment-cost-lock.service';
import { saveDebitEdits } from '../services/shipment-debit-detail.service';
import { shipmentDebitSummaryQuerySchema } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<{ table: any; id: number }> = [];
async function track<T extends { id: number }>(table: any, row: T): Promise<T> {
  cleanup.unshift({ table, id: row.id });
  return row;
}

async function mkCustomer(name: string) {
  const [row] = await db.insert(s.customers).values({ name }).returning();
  return track(s.customers, row);
}
async function mkLot(customerId: number, edd: string | null, extra: Record<string, unknown> = {}) {
  const [row] = await db.insert(s.shipments).values({
    customerId, expectedDeliveryDate: edd, cargoMode: 'FCL', status: 'PENDING_DATE', ...extra,
  }).returning();
  return track(s.shipments, row);
}
async function mkRoute(name: string) {
  const [row] = await db.insert(s.routes).values({ name }).returning();
  return track(s.routes, row);
}
async function mkTrip(shipmentId: number, customerId: number, routeId: number) {
  const [row] = await db.insert(s.trips).values({
    shipmentId, customerId, routeId, status: 'CREATED', departureDate: '2026-09-20',
  }).returning();
  return track(s.trips, row);
}
async function mkExpense(tripId: number, buy: string, sell = '0', expenseType = 'PHI_CHI_HO') {
  const [row] = await db.insert(s.tripExpenses).values({
    tripId, expenseType, buyAmount: buy, sellAmount: sell,
  }).returning();
  return track(s.tripExpenses, row);
}
async function mkFreight(shipmentId: number, tripId: number, total: string) {
  const [row] = await db.insert(s.freightRateSnapshots).values({
    shipmentId, tripId,
    freightAmount: total, surchargeAmount: '0', totalAmount: total,
    rateTermsId: 1, pricingTableId: 1, fuelNormId: 1, fuelPricePeriodId: 1,
    billedKm: '10', liters: '0', fuelDelta: '0', sharePct: '0',
  }).returning();
  return track(s.freightRateSnapshots, row);
}

describe('shipment debit summary (Chi phí - Quyết toán L1)', () => {
  test('rolls up freight, chi hộ, receivable and profit for one lot', async () => {
    const customer = await mkCustomer(`Debit A ${suffix}`);
    const lot = await mkLot(customer.id, '2026-09-25');
    const route = await mkRoute(`Debit route ${suffix}`);
    const trip = await mkTrip(lot.id, customer.id, route.id);
    await mkFreight(lot.id, trip.id, '1000000');
    await mkExpense(trip.id, '300000', '2000000');
    const result = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    assert.equal(result.total, 1);
    const item = result.items.find((row) => row.shipmentId === lot.id)!;
    assert.equal(item.freightAuto, '1000000');
    assert.equal(item.chiHoTotal, '300000');
    assert.equal(item.receivableTotal, '1300000', 'freight snapshot 1.000.000 + pass-through recharge at cost 300.000');
    assert.equal(item.profit, '0');
    assert.equal(item.lockStatus, 'OPEN');
    assert.equal(item.lockedAt, null);
  });
  test('entered thu khách rolls up to Lớp 1 without any issued debit note (spec L138)', async () => {
    const customer = await mkCustomer(`Debit B ${suffix}`);
    const lot = await mkLot(customer.id, '2026-09-26');
    const route = await mkRoute(`Debit route ${suffix}`);
    const trip = await mkTrip(lot.id, customer.id, route.id);
    await mkFreight(lot.id, trip.id, '500000');
    await mkExpense(trip.id, '100000', '3900000', 'OTHER');
    const result = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const item = result.items.find((row) => row.shipmentId === lot.id)!;
    assert.equal(item.freightAuto, '500000');
    assert.equal(item.receivableTotal, '4400000', 'typed Phí khác thu khách + 2.1 freight roll up together');
    assert.equal(item.profit, '3800000');
  });
  test('a shared pair expense counts once — the other lot stays clean', async () => {
    const customer = await mkCustomer(`Debit C ${suffix}`);
    const lotA = await mkLot(customer.id, '2026-09-27');
    const lotB = await mkLot(customer.id, '2026-09-27');
    const route = await mkRoute(`Debit route ${suffix}`);
    const tripA = await mkTrip(lotA.id, customer.id, route.id);
    const tripB = await mkTrip(lotB.id, customer.id, route.id);
    await mkExpense(tripA.id, '250000');
    const result = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const itemA = result.items.find((row) => row.shipmentId === lotA.id)!;
    const itemB = result.items.find((row) => row.shipmentId === lotB.id)!;
    assert.equal(itemA.chiHoTotal, '250000');
    assert.equal(itemB.chiHoTotal, '0', 'a trip with no expenses is a known zero');
  });
  test('the delivery-date range filters on expected delivery date', async () => {
    const customer = await mkCustomer(`Debit D ${suffix}`);
    await mkLot(customer.id, '2026-09-01');
    const inside = await mkLot(customer.id, '2026-09-15');
    await mkLot(customer.id, '2026-09-30');
    const result = await getShipmentDebitSummary({
      customerId: customer.id,
      deliveryDateFrom: '2026-09-10',
      deliveryDateTo: '2026-09-20',
      lockStatus: 'ALL',
    });
    assert.deepEqual(result.items.map((row) => row.shipmentId), [inside.id]);
  });
  test('customer is mandatory and the lock filter follows the real locks', async () => {
    const customer = await mkCustomer(`Debit E ${suffix}`);
    const locked = await mkLot(customer.id, '2026-09-15');
    await mkLot(customer.id, '2026-09-16');
    await lockShipmentCost({ shipmentId: locked.id, expectedShipmentVersion: null, lockNote: null, actor: { userId: 0, role: 'ADMIN', username: 'p', email: 'p', fullName: 'p' } as never, idempotencyKey: `lock-filter-${suffix}` });
    const summary = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const lockedItem = summary.items.find((row) => row.shipmentId === locked.id)!;
    assert.equal(lockedItem.lockStatus, 'LOCKED', 'the active cost lock drives the status');
    assert.ok(lockedItem.lockedAt, 'lock time rides along');
    const openOnly = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'OPEN' });
    assert.equal(openOnly.items.some((row) => row.shipmentId === locked.id), false);
    const lockedOnly = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'LOCKED' });
    assert.deepEqual(lockedOnly.items.map((row) => row.shipmentId), [locked.id]);
    assert.equal(shipmentDebitSummaryQuerySchema.safeParse({}).success, false, 'customerId is required by the query contract');
  });
  test('TỔNG PHẢI TRẢ: live for open lots, frozen for locked lots, null stays null', async () => {
    const customer = await mkCustomer(`Debit payables ${suffix}`);
    const route = await mkRoute(`Debit payables route ${suffix}`);
    const lotFull = await mkLot(customer.id, '2026-09-28');
    const tripFull = await mkTrip(lotFull.id, customer.id, route.id);
    const [carrier] = await db.insert(s.tripCarrierInfo).values({ tripId: tripFull.id, externalFreightCost: '500000' }).returning();
    track(s.tripCarrierInfo, carrier);
    const [ops1] = await db.insert(s.opsExpenseEntries).values({ shipmentId: lotFull.id, expenseTypeCode: 'PHI_CHI_HO', amount: '250000', paidById: 0, paidAt: '2026-09-19' }).returning();
    track(s.opsExpenseEntries, ops1);
    const [ops2] = await db.insert(s.opsExpenseEntries).values({ shipmentId: lotFull.id, expenseTypeCode: 'PHI_CHI_HO', amount: '140000', paidById: 0, paidAt: '2026-09-19' }).returning();
    track(s.opsExpenseEntries, ops2);
    const lotNoCost = await mkLot(customer.id, '2026-09-28');
    const tripNoCost = await mkTrip(lotNoCost.id, customer.id, route.id);
    const [carrierNo] = await db.insert(s.tripCarrierInfo).values({ tripId: tripNoCost.id }).returning();
    track(s.tripCarrierInfo, carrierNo);
    const lotEmpty = await mkLot(customer.id, '2026-09-28');
    const result = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const full = result.items.find((row) => row.shipmentId === lotFull.id)!;
    assert.equal(full.payableTotal, '890000', '500000 cước trả + 390000 ops = 640000');
    assert.equal(full.receivableTotal, null, 'no entered thu khách rows → unknown, not 0');
    const noCost = result.items.find((row) => row.shipmentId === lotNoCost.id)!;
    assert.equal(noCost.payableTotal, null, 'unknown cước trả keeps the total unknown');
    const empty = result.items.find((row) => row.shipmentId === lotEmpty.id)!;
    assert.equal(empty.payableTotal, null, 'no trips and no ops rows → unknown');
    await lockShipmentCost({ shipmentId: lotFull.id, expectedShipmentVersion: null, lockNote: null, actor: { userId: 0, role: 'ADMIN', username: 'p', email: 'p', fullName: 'p' } as never, idempotencyKey: `c19-payables-lock-${suffix}` });
    const [ops3] = await db.insert(s.opsExpenseEntries).values({ shipmentId: lotFull.id, expenseTypeCode: 'PHI_CHI_HO', amount: '990000', paidById: 0, paidAt: '2026-09-19' }).returning();
    track(s.opsExpenseEntries, ops3);
    const frozen = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const frozenItem = frozen.items.find((row) => row.shipmentId === lotFull.id)!;
    assert.equal(frozenItem.payableTotal, '890000', 'locked lots read the frozen snapshot — later ops rows never move L1');
  });

  test('TỔNG PHẢI THU KHÁCH freeze: entered moves L1, lock freezes it, forced edits stay frozen (L1 + issued note)', async () => {
    const customer = await mkCustomer(`Debit freeze ${suffix}`);
    const lot = await mkLot(customer.id, '2026-09-29');
    const route = await mkRoute(`Debit freeze route ${suffix}`);
    const trip = await mkTrip(lot.id, customer.id, route.id);
    await mkFreight(lot.id, trip.id, '1000000');
    await mkExpense(trip.id, '300000', '3900000', 'OTHER');
    const open = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    assert.equal(open.items.find((row) => row.shipmentId === lot.id)!.receivableTotal, '4900000', 'leg 1: entered thu khách + 2.1 freight join the rollup');
    await lockShipmentCost({ shipmentId: lot.id, expectedShipmentVersion: null, lockNote: null, actor: { userId: 0, role: 'ADMIN', username: 'p', email: 'p', fullName: 'p' } as never, idempotencyKey: `c19-leg2-${suffix}` });
    const lockedOnce = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    assert.equal(lockedOnce.items.find((row) => row.shipmentId === lot.id)!.receivableTotal, '4900000', 'leg 2: L1 holds at the locked figure');
    const note = await createDebitNoteFromCostLock({ shipmentId: lot.id, actor: { userId: 0, role: 'ADMIN', username: 'p', email: 'p', fullName: 'p' } as never, idempotencyKey: `c19-leg3-note-${suffix}` });
    const docRows = await db.select().from(s.billingDocuments).where(eq(s.billingDocuments.id, note.id));
    assert.ok(docRows[0], 'the issued note exists');
    track(s.billingDocuments, docRows[0]);
    const readLines = async () => db.select().from(s.billingDocumentLines).where(eq(s.billingDocumentLines.documentId, note.id));
    const lines1 = await readLines();
    for (const line of lines1) track(s.billingDocumentLines, line);
    const sumBefore = lines1.reduce((sum, line) => sum + Number(line.baseAmount), 0);
    await db.update(s.tripExpenses).set({ sellAmount: '9999999' }).where(eq(s.tripExpenses.tripId, trip.id));
    const lockedTwice = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const lockedTwiceItem = lockedTwice.items.find((row) => row.shipmentId === lot.id)!;
    assert.equal(lockedTwiceItem.receivableTotal, '4900000', 'leg 3: forced edits behind the lock cannot move L1');
    const lines2 = await readLines();
    assert.equal(lines2.reduce((sum, line) => sum + Number(line.baseAmount), 0), sumBefore, 'the issued note stays frozen');
    const claimRows = await db.select().from(s.debitNoteLots).where(eq(s.debitNoteLots.documentId, note.id));
    for (const claim of claimRows) track(s.debitNoteLots, claim);
  });
  test('doc worked example: 2.1 + 2.2 roll up to exactly 13.100.000 and 5.500.000', async () => {
    const customer = await mkCustomer(`Debit docmath ${suffix}`);
    const route = await mkRoute(`Debit docmath route ${suffix}`);
    const lotA = await mkLot(customer.id, '2026-10-01');
    const tripA = await mkTrip(lotA.id, customer.id, route.id);
    await mkFreight(lotA.id, tripA.id, '9600000');
    await mkExpense(tripA.id, '0', '3500000', 'OTHER');
    const lotB = await mkLot(customer.id, '2026-10-02');
    const tripB = await mkTrip(lotB.id, customer.id, route.id);
    await mkFreight(lotB.id, tripB.id, '4500000');
    await mkExpense(tripB.id, '0', '1000000', 'OTHER');
    const result = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const itemA = result.items.find((row) => row.shipmentId === lotA.id)!;
    const itemB = result.items.find((row) => row.shipmentId === lotB.id)!;
    assert.equal(itemA.receivableTotal, '13100000', '9.600.000 + 3.500.000 — the doc’s own arithmetic');
    assert.equal(itemB.receivableTotal, '5500000', '4.500.000 + 1.000.000 — the second doc pair');
  });
  test('PS thực tế counts exactly once inside the 2.1 rollup', async () => {
    const customer = await mkCustomer(`Debit ps once ${suffix}`);
    const route = await mkRoute(`Debit ps once route ${suffix}`);
    const lot = await mkLot(customer.id, '2026-10-03');
    const trip = await mkTrip(lot.id, customer.id, route.id);
    await mkFreight(lot.id, trip.id, '1000000');
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: lot.id,
      containerNumber: `PS1-${suffix}`,
    }).returning();
    track(s.shipmentContainers, container);
    await db.update(s.shipmentContainers).set({ psActualAmount: '500000' }).where(eq(s.shipmentContainers.id, container.id));
    await mkExpense(trip.id, '0', '3500000', 'OTHER');
    const result = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const item = result.items.find((row) => row.shipmentId === lot.id)!;
    assert.equal(item.receivableTotal, '5000000', '1.000.000 freight + 500.000 PS + 3.500.000 = 5.000.000 — PS never double-counts');
  });
  test('sellAmount edits are refused on non-OTHER rows server-side', async () => {
    const customer = await mkCustomer(`Debit ro ${suffix}`);
    const route = await mkRoute(`Debit ro route ${suffix}`);
    const lot = await mkLot(customer.id, '2026-10-04');
    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: lot.id, fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
    }).returning();
    track(s.shipmentFulfillments, fulfillment);
    const [linkedTrip] = await db.insert(s.trips).values({
      fulfillmentId: fulfillment.id, shipmentId: lot.id, customerId: customer.id, routeId: route.id,
      departureDate: '2026-10-05', status: 'CREATED',
    }).returning();
    track(s.trips, linkedTrip);
    const expense = await mkExpense(linkedTrip.id, '500000');
    await assert.rejects(
      () => saveDebitEdits({ shipmentId: lot.id, actorId: 0, idempotencyKey: `ro-edit-${suffix}`, payload: { edits: [{ expenseId: expense.id, sellAmount: 999 }] } }),
      /Phí khác/,
      'invoiced/pass-through rows recharge from the type rule — CUS cannot type the customer figure',
    );
  });
});

after(async () => {
  for (const { table, id } of cleanup) {
    await db.delete(table).where(eq(table.id, id));
  }
  await client.end();
});

// Router-level pin: the literal /debit-summary LIST path must reach the
// rollup handler, not be captured by the core GET /:id leaf (Express resolves
// in registration order — QA cut-G proved the 400 'ID lô hàng không hợp lệ'
// when the literal lost that race).
describe('GET /debit-summary resolves through the real router', () => {
  test('the literal list path returns 200 with the rollup shape', async () => {
    const http = await import('node:http');
    const express = (await import('express')).default;
    const { initEnforcer } = await import('../casbin/enforcer');
    const { casbinAuthz } = await import('../middleware/casbin');
    const { globalErrorHandler } = await import('../middleware/errorHandler');
    const shipmentRoutes = (await import('../routes/shipments')).default;
    await initEnforcer();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { user?: unknown }).user = {
        userId: 0,
        username: 'router-pin', email: 'router-pin@x', fullName: 'router-pin',
        role: 'ADMIN' as const,
      };
      next();
    });
    app.use('/api/shipments', casbinAuthz('shipments'), shipmentRoutes);
    app.use(globalErrorHandler);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as import('node:net').AddressInfo).port;
    try {
      const customer = await mkCustomer(`Router pin ${suffix}`);
      await mkLot(customer.id, '2026-09-25');
      const response = await fetch(`http://127.0.0.1:${port}/api/shipments/debit-summary?customerId=${customer.id}`);
      assert.equal(response.status, 200, `the literal path must win over /:id — got ${response.status}`);
      const body = await response.json() as { items?: unknown[]; total?: number };
      assert.equal(body.total, 1);
      assert.ok(Array.isArray(body.items) && body.items.length === 1);
    } finally {
      server.close();
    }
  });
});

// Dist-resolution guard (rework C, staging 157): the prod build compiles to
// dist ESM where a dynamic `await import('./x')` stays extensionless and
// Node cannot resolve it — the lock 500'd live while every tsx-level pin was
// green. Local-module imports must be STATIC in anything the compiled tree
// runs (or carry the explicit .js extension if ever dynamic).
describe('debit services compile-safe for the dist build (no extensionless dynamic imports)', () => {
  test('lock and rollup services use static local imports only', async () => {
    const { readFileSync } = await import('node:fs');
    const sources = [
      '/Volumes/LexarSSD/projects/silversea-prod/backend/src/services/shipment-cost-lock.service.ts',
      '/Volumes/LexarSSD/projects/silversea-prod/backend/src/services/shipment-debit-summary.service.ts',
    ];
    for (const path of sources) {
      const text = readFileSync(path, 'utf8');
      const offenders = [...text.matchAll(/await import\((['"])(\.[^'"]+)\1\)/g)]
        .filter((match) => !match[2]!.endsWith('.js'))
        .map((match) => match[2]);
      assert.deepEqual(offenders, [], `extensionless dynamic imports break the dist build: ${offenders.join(', ')}`);
    }
  });
});

// Audit-context pin (rework C round two, staging log): the lock write must
// flow through the REAL audit middleware — an unregistered material-write
// POST aborts the transaction with 'Material write audit context is
// incomplete' (500) even though direct-handler pins were green. This pin
// mounts auditLogMiddleware exactly like the production app.
describe('POST /lock flows through the real audit middleware', () => {
  test('lock succeeds with the audit chain mounted', async () => {
    const http = await import('node:http');
    const express = (await import('express')).default;
    const { initEnforcer } = await import('../casbin/enforcer');
    const { initAuditService } = await import('../services/audit.service');
    const { auditLogMiddleware } = await import('../middleware/audit');
    const { casbinAuthz } = await import('../middleware/casbin');
    const { globalErrorHandler } = await import('../middleware/errorHandler');
    const shipmentRoutes = (await import('../routes/shipments')).default;
    await Promise.all([initEnforcer(), initAuditService()]);
    const app = express();
    app.use(express.json());
    app.use(auditLogMiddleware);
    app.use((req, _res, next) => {
      (req as unknown as { user?: unknown }).user = {
        userId: 0, username: 'audit-pin', email: 'a@x', fullName: 'audit-pin',
        role: 'ADMIN' as const,
      };
      next();
    });
    app.use('/api/shipments', casbinAuthz('shipments'), shipmentRoutes);
    app.use(globalErrorHandler);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as import('node:net').AddressInfo).port;
    try {
      const customer = await mkCustomer(`Audit pin ${suffix}`);
      const lot = await mkLot(customer.id, '2026-09-25');
      const response = await fetch(`http://127.0.0.1:${port}/api/shipments/${lot.id}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `audit-pin-${suffix}-${lot.id}` },
      });
      const text = await response.text();
      assert.equal(response.status, 201, `lock must succeed under the audit middleware — ${text.slice(0, 120)}`);
      const [row] = await db.select().from(s.shipmentCostLocks).where(eq(s.shipmentCostLocks.shipmentId, lot.id));
      assert.ok(row, 'the lock row must exist');
    } finally {
      server.close();
    }
  });
});
