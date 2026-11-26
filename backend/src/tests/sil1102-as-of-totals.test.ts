// SIL-1102 (K2.124) — the phoi-phieu report's Đã thu/Đã trả must answer AS OF the
// close date with the reversal law the expense reads already apply: a phiếu with an
// old value date counts at every close it predates; a later reversal erases it only
// from closes AFTER the reversal. QA 26/11 repro: phiếu 500.000₫ value date 10/11
// (trip 574), reversed on 26/11 — at a 15/11 close it must still count; the old
// point-in-time batch totals answered 0 everywhere.
// Direct fixture rows (real dev DB, tracked cleanup) so the totals join is the unit
// under test, not the whole voucher write path.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { getExpenseCashTotalsAsOfBatch, getExpenseCashTotalsBatch } from '../services/expense-accounting-voucher.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
type TrackedTable = PgTable & { id: PgColumn };
const cleanup: Array<{ table: TrackedTable; id: number }> = [];
function track(table: TrackedTable, id: number) {
  cleanup.unshift({ table, id });
}

after(async () => {
  for (const { table, id } of cleanup) await db.delete(table).where(eq(table.id, id));
  await disconnectRedis();
});

interface Fixture {
  adminId: number;
  sourceId: number;
  voucherId: number;
  movementId: number;
  movementAccountId: number;
  movementAmount: string;
  movementReference: string;
}

async function mkAllocationAsOf(): Promise<Fixture> {
  const tag = `${suffix}-${cleanup.length}`;
  const [admin] = await db.insert(s.users).values({
    username: `sil1102-${tag}`, passwordHash: 't', role: Role.ADMIN, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, admin.id);
  const [customer] = await db.insert(s.customers).values({ name: `SIL1102 customer ${tag}` })
    .returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `SIL1102 route ${tag}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED', expectedDeliveryDate: '2026-11-10',
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [entry] = await db.insert(s.opsExpenseEntries).values({
    shipmentId: shipment.id, expenseTypeCode: 'SIL1102_PROBE', amount: '500000',
    paidById: admin.id, paidAt: '2026-11-10', approvalStatus: 'RECORDED',
    payerKind: 'USER', costGroup: 'INVOICED_LIFT', feeName: `Nâng vỏ ${tag}`, customerChargeAmount: '500000',
  }).returning({ id: s.opsExpenseEntries.id });
  track(s.opsExpenseEntries, entry.id);
  const [link] = await db.insert(s.expenseAccountingSources).values({
    sourceKind: 'OPS', sourceId: entry.id, shipmentId: shipment.id, recordedById: admin.id,
    confirmedById: admin.id, confirmedAt: new Date(),
  }).returning({ id: s.expenseAccountingSources.id });
  track(s.expenseAccountingSources, link.id);
  const [account] = await db.insert(s.treasuryAccounts).values({
    code: `SIL1102-STK-${tag}`, name: `SIL1102 STK ${tag}`, type: 'BANK',
    fundCode: 'COMPANY', status: 'ACTIVE', createdBy: admin.id, updatedBy: admin.id,
  }).returning({ id: s.treasuryAccounts.id });
  track(s.treasuryAccounts, account.id);
  const [movement] = await db.insert(s.treasuryMovements).values({
    treasuryAccountId: account.id, direction: 'IN', amount: '500000', valueDate: '2026-11-10',
    status: 'POSTED', physicalReference: `SIL1102-PT-${tag}`, sourceVersion: 1,
    paymentContractVersion: 2, createdBy: admin.id,
  }).returning({ id: s.treasuryMovements.id });
  track(s.treasuryMovements, movement.id);
  const [voucher] = await db.insert(s.expenseCashVouchers).values({
    code: `SIL1102-PT-${tag}`, counterpartyType: 'CUSTOMER', counterpartyId: customer.id,
    treasuryMovementId: movement.id, createdById: admin.id, note: `SIL1102 phiếu thu ${tag}`,
  }).returning({ id: s.expenseCashVouchers.id });
  track(s.expenseCashVouchers, voucher.id);
  await db.insert(s.expenseCashAllocations).values({
    voucherId: voucher.id, expenseAccountingSourceId: link.id, sourceVersion: 1, amount: '500000',
  });
  return { adminId: admin.id, sourceId: link.id, voucherId: voucher.id, movementId: movement.id,
    movementAccountId: account.id, movementAmount: '500000', movementReference: `SIL1102-PT-${tag}` };
}

describe('SIL-1102 — tổng thu trả theo ngày chốt (as-of) có đảo bút toán đúng chiều thời gian (BE)', () => {
  test('phiếu ngày giá trị 10/11, đảo 26/11 → đếm tại chốt 15/11, mất tại chốt 30/11', async () => {
    const fx = await mkAllocationAsOf();
    const atClose15 = await getExpenseCashTotalsAsOfBatch(db, [fx.sourceId], '2026-11-15');
    assert.equal(atClose15.get(fx.sourceId)?.IN, 500000, 'chốt 15/11 (trước khi đảo) phải còn thấy 500.000');
    const beforeValueDate = await getExpenseCashTotalsAsOfBatch(db, [fx.sourceId], '2026-11-09');
    assert.equal(beforeValueDate.get(fx.sourceId)?.IN, 0, 'trước ngày giá trị thì chưa có tiền');

    // Reverse on 26/11 — AFTER the 15/11 close, mirroring the QA repro order.
    await db.update(s.expenseCashVouchers).set({ status: 'REVERSED' }).where(eq(s.expenseCashVouchers.id, fx.voucherId));
    await db.insert(s.treasuryMovements).values({
      treasuryAccountId: fx.movementAccountId, direction: 'OUT', amount: fx.movementAmount,
      valueDate: '2026-11-26', status: 'POSTED', physicalReference: `${fx.movementReference}-REV`,
      sourceVersion: 2, paymentContractVersion: 2, reversalOfId: fx.movementId, createdBy: fx.adminId,
    });

    const stillAt15 = await getExpenseCashTotalsAsOfBatch(db, [fx.sourceId], '2026-11-15');
    assert.equal(stillAt15.get(fx.sourceId)?.IN, 500000, 'đảo sau chốt không viết lại lịch sử chốt 15/11');
    const goneAt30 = await getExpenseCashTotalsAsOfBatch(db, [fx.sourceId], '2026-11-30');
    assert.equal(goneAt30.get(fx.sourceId)?.IN, 0, 'sau khi đảo thì chốt 30/11 phải về 0');
    const pointInTime = await getExpenseCashTotalsBatch(db, [fx.sourceId]);
    assert.equal(pointInTime.get(fx.sourceId)?.IN, 0, 'tổng tại-thời-điểm-nay giữ nguyên hành vi cũ (đã đảo → 0)');
  });
});
