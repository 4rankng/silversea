// Card 20260928_161 — nhóm CHI HỘ có hóa đơn (Nâng / Hạ / Phí khác).
//
// Two criteria land here:
//  AC1 — the group of an Ops chi-hộ row follows the catalog row's settlement
//        `category` (LIFT → Nâng, DROP → Hạ, rest → Phí khác), not the fee
//        code. Before this, only the legacy `LIFTING` / `LOWERING` codes were
//        matched, so the chi-hộ codes `LIFT_EMPTY` / `LIFT_CARGO` /
//        `YARD_STORAGE_LIFT` (and the DROP equivalents) fell into the
//        INVOICED_OTHER catch-all, disagreeing with the catalog's own category
//        — and the rule lived twice, in the form and in the service.
//  AC4 — add / edit / delete a Nâng row and the LOT's tổng phải thu moves by
//        exactly the amount entered. The deltas are asserted, never a
//        hard-coded total.
//
// Modelled on `ops-no-invoice-charge-pair.test.ts` (the HTTP harness + the
// real ops route, so route validation and the service both run) and on the
// thu-khách parity pin `debit-detail.test.ts:537` — `getShipmentDebitSummary`
// is the service behind GET /api/shipments/debit-summary, whose `receivableTotal`
// is the lot's TỔNG PHẢI THU KHÁCH (it sums `customer_charge_amount`, per
// `shipment-debit-summary.service.ts`). `phoi-phieu-control.test.ts:276` covers
// the neighbouring half: a LIFT row landing in the báo cáo THU column.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { OPS_EXPENSE_TYPE_DEFAULTS, Role, opsInvoicedCostGroupOf } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { initEnforcer } from '../casbin/enforcer';
import { globalErrorHandler } from '../middleware/errorHandler';
import { getShipmentDebitSummary } from '../services/shipment-debit-summary.service';
import opsRoutes from '../routes/ops';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let server: http.Server;
let opsUserId = 0;

async function api(method: string, path: string, body?: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `c161-${suffix}-${Math.random()}`,
      'X-Test-User-Id': String(opsUserId),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: parsed };
}

const shipmentIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const typeIds: number[] = [];

/** A fee catalog row whose CODE carries no meaning: only `category` may decide
 *  the Nâng / Hạ / Phí khác group (the admin surface can re-categorise it). */
async function mkCatalogType(category: string, requiresInvoice = true) {
  const code = `QA161-${category}-${suffix.slice(-6)}-${typeIds.length}`;
  const [row] = await db.insert(s.forwarderExpenseTypes).values({
    code, name: `QA 161 ${category}`, category, requiresInvoice,
  }).returning({ id: s.forwarderExpenseTypes.id, code: s.forwarderExpenseTypes.code });
  typeIds.push(row.id);
  return row;
}

async function mkLot(): Promise<{ shipmentId: number; customerId: number }> {
  const [customer] = await db.insert(s.customers).values({ name: `C161 customer ${suffix}-${shipmentIds.length}` }).returning({ id: s.customers.id });
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `C161 route ${suffix}-${shipmentIds.length}` }).returning({ id: s.routes.id });
  routeIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning({ id: s.shipments.id });
  shipmentIds.push(shipment.id);
  await db.insert(s.userShipmentLinks).values({ userId: opsUserId, shipmentId: shipment.id });
  return { shipmentId: shipment.id, customerId: customer.id };
}

/** The lot's TỔNG PHẢI THU KHÁCH (Lớp 1) — null while nothing is known. */
async function lotReceivable(customerId: number, shipmentId: number): Promise<number | null> {
  const summary = await getShipmentDebitSummary({ customerId, lockStatus: 'ALL' });
  const item = summary.items.find((row) => row.shipmentId === shipmentId);
  assert.ok(item, 'the lot is in the summary');
  return item.receivableTotal == null ? null : Number(item.receivableTotal);
}

/** The persisted group of the Ops row: `upsertExpenseAccountingSource` writes
 *  the metadata (costGroup included) onto the native `ops_expense_entries`
 *  row and hydrates the source from it — the source table has no such column. */
async function storedGroup(expenseId: number): Promise<string | null> {
  const [entry] = await db.select({ costGroup: s.opsExpenseEntries.costGroup })
    .from(s.opsExpenseEntries)
    .where(eq(s.opsExpenseEntries.id, expenseId));
  return entry?.costGroup ?? null;
}

before(async () => {
  await initEnforcer();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const header = req.header('X-Test-User-Id');
    if (header) (req as express.Request & { user?: unknown }).user = {
      userId: Number(header), username: 'test', email: 'test@x', fullName: 'test', role: Role.OPS,
    };
    next();
  });
  app.use('/api/ops', opsRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));

  const [user] = await db.insert(s.users).values({
    username: `c161-${suffix}`, passwordHash: 't', role: Role.OPS, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  opsUserId = user.id;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    // Scoped to this run's fixtures only — the dev DB is shared with every
    // other lane, so nothing here may delete by a bare kind/flag.
    if (shipmentIds.length) {
      await db.delete(s.expenseAccountingSources).where(inArray(s.expenseAccountingSources.shipmentId, shipmentIds));
      await db.delete(s.opsExpenseEntries).where(inArray(s.opsExpenseEntries.shipmentId, shipmentIds));
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, shipmentIds));
      await db.delete(s.userShipmentLinks).where(inArray(s.userShipmentLinks.shipmentId, shipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    }
    if (typeIds.length) await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.id, typeIds));
    if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    if (routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    await db.delete(s.auditLogs).where(eq(s.auditLogs.userId, opsUserId));
    await db.delete(s.users).where(eq(s.users.id, opsUserId));
  } catch {
    // best-effort cleanup
  }
  await disconnectRedis();
});

describe('card 20260928_161 AC1 — nhóm Nâng / Hạ / Phí khác từ danh mục', () => {
  test('the seeded chi-hộ catalog maps to the three groups the PM named', () => {
    // The PM list: Nâng (nâng vỏ / nâng hàng / lưu bãi), Hạ (hạ vỏ / hạ hàng /
    // lưu vỏ / lưu bãi), Phí khác (gia hạn, vệ sinh, soi chiếu, bốc xếp, công
    // nhân, lưu kho…). Grouping is asserted through the SAME rule the Ops form
    // and the Ops create path call.
    const expected: Record<string, 'INVOICED_LIFT' | 'INVOICED_DROP' | 'INVOICED_OTHER'> = {
      LIFTING: 'INVOICED_LIFT', LIFT_EMPTY: 'INVOICED_LIFT', LIFT_CARGO: 'INVOICED_LIFT', YARD_STORAGE_LIFT: 'INVOICED_LIFT',
      LOWERING: 'INVOICED_DROP', LOWER_EMPTY: 'INVOICED_DROP', LOWER_CARGO: 'INVOICED_DROP', YARD_STORAGE: 'INVOICED_DROP',
      CONTAINER_DEMURRAGE: 'INVOICED_DROP',
      FEE_EXTENSION: 'INVOICED_OTHER', FEE_CLEANING: 'INVOICED_OTHER', FEE_SCANNING: 'INVOICED_OTHER',
      FEE_STEVEDORING: 'INVOICED_OTHER', FEE_LABOR: 'INVOICED_OTHER', FEE_WAREHOUSE: 'INVOICED_OTHER',
    };
    for (const [code, group] of Object.entries(expected)) {
      const row = OPS_EXPENSE_TYPE_DEFAULTS[code];
      assert.ok(row, `catalog carries ${code}`);
      assert.equal(opsInvoicedCostGroupOf(row.category), group,
        `${code} (category ${row.category}) must land in ${group}`);
    }
    // Un-categorised / non-LIFT/DROP categories keep the Phí khác catch-all.
    assert.equal(opsInvoicedCostGroupOf(undefined), 'INVOICED_OTHER');
    assert.equal(opsInvoicedCostGroupOf(null), 'INVOICED_OTHER');
    assert.equal(opsInvoicedCostGroupOf('CSHT'), 'INVOICED_OTHER');
  });

  test('the create path derives the group from the category, not from the code', async () => {
    const { shipmentId } = await mkLot();
    const cases = [
      { category: 'LIFT', expected: 'INVOICED_LIFT' },
      { category: 'DROP', expected: 'INVOICED_DROP' },
      { category: 'KHAC', expected: 'INVOICED_OTHER' },
    ] as const;
    for (const { category, expected } of cases) {
      const type = await mkCatalogType(category);
      const created = await api('POST', '/api/ops/expenses', {
        shipmentId, expenseTypeCode: type.code, amount: 120000, paidAt: '2026-09-22',
      });
      assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 200));
      assert.equal(created.body.costGroup, expected,
        `a category-${category} fee must derive ${expected} (no costGroup was sent)`);
      assert.equal(await storedGroup(Number(created.body.id)), expected, 'the stored accounting source carries the same group');
    }
  });

  test('a non-invoice fee keeps OPS_REGULAR — the rule must not over-reach', async () => {
    const { shipmentId } = await mkLot();
    const type = await mkCatalogType('LIFT', false);
    const created = await api('POST', '/api/ops/expenses', {
      shipmentId, expenseTypeCode: type.code, amount: 90000, paidAt: '2026-09-22',
      customerChargeAmount: 90000,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 200));
    assert.equal(created.body.costGroup, 'OPS_REGULAR', 'no-invoice rows never take a chi-hộ group');
  });
});

describe('card 20260928_161 AC4 — a Nâng row moves the lot receivable by its amount', () => {
  test('add / edit / delete move TỔNG PHẢI THU KHÁCH by exactly the amount', async () => {
    const { shipmentId, customerId } = await mkLot();
    const otherType = await mkCatalogType('KHAC');
    const liftType = await mkCatalogType('LIFT');

    // Baseline: one chi-hộ row of another family, so the delta is measured
    // against a known figure instead of a hard-coded total.
    const base = await api('POST', '/api/ops/expenses', {
      shipmentId, expenseTypeCode: otherType.code, amount: 100000, paidAt: '2026-09-22',
    });
    assert.equal(base.status, 201, JSON.stringify(base.body).slice(0, 200));
    const r0 = await lotReceivable(customerId, shipmentId);
    assert.equal(r0, 100000, 'the invoice group charges the customer the amount (AC2)');

    // ADD a Nâng row.
    const added = await api('POST', '/api/ops/expenses', {
      shipmentId, expenseTypeCode: liftType.code, amount: 250000, paidAt: '2026-09-22',
    });
    assert.equal(added.status, 201, JSON.stringify(added.body).slice(0, 200));
    assert.equal(added.body.costGroup, 'INVOICED_LIFT', 'the Nâng row lands in the Nâng group');
    const r1 = await lotReceivable(customerId, shipmentId);
    assert.equal((r1 ?? 0) - (r0 ?? 0), 250000, 'adding a Nâng row adds exactly its amount to phải thu');

    // EDIT that row to a larger amount. The patch is version-guarded
    // (`ops-expenses.service.ts:254`), so it carries the version the create
    // returned — the same figure the form sends as `expectedVersion`.
    const expenseId = Number(added.body.id);
    const edited = await api('PATCH', `/api/ops/expenses/${expenseId}`, {
      reason: 'QA 161 — sửa số tiền dòng Nâng', amount: 310000, expectedVersion: Number(added.body.version),
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body).slice(0, 200));
    assert.equal(edited.body.costGroup, 'INVOICED_LIFT', 'editing the amount keeps the Nâng group');
    const r2 = await lotReceivable(customerId, shipmentId);
    assert.equal((r2 ?? 0) - (r1 ?? 0), 60000, 'the edit moves phải thu by the difference only');

    // DELETE it: the voided row leaves the receivable again.
    const removed = await api('DELETE', `/api/ops/expenses/${expenseId}`, { reason: 'QA 161 — xoá dòng Nâng' });
    assert.equal(removed.status, 200, JSON.stringify(removed.body).slice(0, 200));
    const r3 = await lotReceivable(customerId, shipmentId);
    assert.equal((r3 ?? 0) - (r2 ?? 0), -310000, 'deleting the row removes exactly its amount');
    assert.equal(r3, r0, 'the lot is back to its baseline once the Nâng row is gone');
    assert.equal(await storedGroup(expenseId), 'INVOICED_LIFT', 'the voided source keeps its Nâng group as history');
  });
});
