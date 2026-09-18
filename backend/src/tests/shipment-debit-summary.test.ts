import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { getShipmentDebitSummary } from '../services/shipment-debit-summary.service';
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
async function mkExpense(tripId: number, buy: string) {
  const [row] = await db.insert(s.tripExpenses).values({
    tripId, expenseType: 'PHI_CHI_HO', buyAmount: buy, sellAmount: '0',
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
async function mkDebitNote(trip: { id: number; shipmentId: number }, line: { sourceType?: string; sourceId?: number | null; base: string }) {
  const [doc] = await db.insert(s.billingDocuments).values({
    type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: trip.shipmentId,
    rangeFrom: '2026-09-01', rangeTo: '2026-09-30',
    issuedAt: new Date(), debitNoteStatus: 'SENT',
    authorityState: 'CURRENT', authorityWarningAt: null,
  }).returning();
  track(s.billingDocuments, doc);
  const [claim] = await db.insert(s.billingDocumentTripClaims).values({
    documentId: doc.id, tripId: trip.id,
    financialPostingId: 0, financialPostingVersion: 0,
    postingChecksum: `test-${doc.id}`, rangeFrom: '2026-09-01', rangeTo: '2026-09-30',
  }).returning();
  track(s.billingDocumentTripClaims, claim);
  const [lineRow] = await db.insert(s.billingDocumentLines).values({
    documentId: doc.id, sourceType: line.sourceType ?? 'TRIP', sourceId: line.sourceId ?? trip.id,
    lineType: 'FREIGHT', description: 'Test line', baseAmount: line.base,
    grossAmount: line.base,
  }).returning();
  track(s.billingDocumentLines, lineRow);
  return { doc, claim, line: lineRow };
}

describe('shipment debit summary (Chi phí - Quyết toán L1)', () => {
  test('rolls up freight, chi hộ, receivable and profit for one lot', async () => {
    const customer = await mkCustomer(`Debit A ${suffix}`);
    const lot = await mkLot(customer.id, '2026-09-25');
    const route = await mkRoute(`Debit route ${suffix}`);
    const trip = await mkTrip(lot.id, customer.id, route.id);
    await mkFreight(lot.id, trip.id, '1000000');
    await mkExpense(trip.id, '300000');
    await mkDebitNote({ id: trip.id, shipmentId: trip.shipmentId! }, { sourceType: 'TRIP', sourceId: trip.id, base: '2000000' });
    const result = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    assert.equal(result.total, 1);
    const item = result.items.find((row) => row.shipmentId === lot.id)!;
    assert.equal(item.freightAuto, '1000000');
    assert.equal(item.chiHoTotal, '300000');
    assert.equal(item.receivableTotal, '2000000');
    assert.equal(item.profit, '700000');
    assert.equal(item.lockStatus, 'OPEN');
    assert.equal(item.lockedAt, null);
  });
  test('unattributable debit lines make the receivable unknown, not zero', async () => {
    const customer = await mkCustomer(`Debit B ${suffix}`);
    const lot = await mkLot(customer.id, '2026-09-26');
    const route = await mkRoute(`Debit route ${suffix}`);
    const trip = await mkTrip(lot.id, customer.id, route.id);
    await mkFreight(lot.id, trip.id, '500000');
    await mkDebitNote({ id: trip.id, shipmentId: trip.shipmentId! }, { sourceType: 'ADHOC', sourceId: null, base: '900000' });
    const result = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const item = result.items.find((row) => row.shipmentId === lot.id)!;
    assert.equal(item.freightAuto, '500000');
    assert.equal(item.receivableTotal, null);
    assert.equal(item.profit, null, 'unknown components must not fabricate a profit');
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
  test('customer is mandatory and the placeholder lock filter applies', async () => {
    const customer = await mkCustomer(`Debit E ${suffix}`);
    await mkLot(customer.id, '2026-09-15');
    assert.equal(shipmentDebitSummaryQuerySchema.safeParse({}).success, false, 'customerId is required by the query contract');
    const locked = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'LOCKED' });
    assert.equal(locked.total, 0, 'no lot is debit-locked until card _19 ships');
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
