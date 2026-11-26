// SIL-1100 (KB ttransport Ch.7 §2) — the "Lập bảng hoàn ứng trước" barrier nets a
// FORWARDER payout against money the staff ACTUALLY holds as advance. A forwarder
// party with NO outstanding advance has nothing to net: the payout must proceed
// instead of deadlocking (QA 26/11 repro: trip 591's confirmed 10.000₫ expense
// 409'd on both quỹ). A staff still HOLDING advance keeps the barrier, now naming
// the staff, the khoản and the held amount.
// Fixture mirrors sil1098-voucher-fund-refusal.test.ts (real dev DB, tracked cleanup).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { db } from '../db';
import * as s from '../db/schema';
import { Role, TxnType } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { createExpenseVoucher } from '../services/expense-accounting-voucher.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PAID_AT = '2026-11-25';
type TrackedTable = PgTable & { id: PgColumn };
const cleanup: Array<{ table: TrackedTable; id: number }> = [];
function track(table: TrackedTable, id: number) {
  cleanup.unshift({ table, id });
}

async function mkFixture() {
  const tag = `${suffix}-${cleanup.length}`;
  const [admin] = await db.insert(s.users).values({
    username: `sil1100-${tag}`, passwordHash: 't', role: Role.ADMIN, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, admin.id);
  const [customer] = await db.insert(s.customers).values({ name: `SIL1100 customer ${tag}` })
    .returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `SIL1100 route ${tag}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED', expectedDeliveryDate: PAID_AT,
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [cashAccount] = await db.insert(s.treasuryAccounts).values({
    code: `SIL1100-TM-${tag}`, name: `SIL1100 Quỹ tiền mặt ${tag}`, type: 'CASH',
    fundCode: 'TM', status: 'ACTIVE', createdBy: admin.id, updatedBy: admin.id,
  }).returning({ id: s.treasuryAccounts.id });
  track(s.treasuryAccounts, cashAccount.id);
  const [entry] = await db.insert(s.opsExpenseEntries).values({
    shipmentId: shipment.id, expenseTypeCode: 'SIL1100_PROBE', amount: '200000',
    paidById: admin.id, paidAt: PAID_AT, approvalStatus: 'RECORDED',
    payerKind: 'USER', costGroup: 'INVOICED_LIFT', feeName: `Nâng vỏ ${tag}`, customerChargeAmount: '200000',
  }).returning({ id: s.opsExpenseEntries.id });
  track(s.opsExpenseEntries, entry.id);
  const [link] = await db.insert(s.expenseAccountingSources).values({
    sourceKind: 'OPS', sourceId: entry.id, shipmentId: shipment.id, recordedById: admin.id,
    confirmedById: admin.id, confirmedAt: new Date(),
  }).returning({ id: s.expenseAccountingSources.id });
  track(s.expenseAccountingSources, link.id);
  return { adminId: admin.id, entryId: entry.id, cashAccountId: cashAccount.id, feeName: `Nâng vỏ ${tag}` };
}

/** Funded advance for the staff: the cash-left-the-treasury pair (KB §1 — duyệt =
 *  đã giao tiền), the same shape sil911's fixture pins. */
async function mkFundedAdvance(adminId: number, cashAccountId: number, amount = '500000') {
  const tag = `${suffix}-${cleanup.length}`;
  const [request] = await db.insert(s.advanceRequests).values({
    requesterId: adminId, amount, reason: `SIL1100 tạm ứng ${tag}`, status: 'RECORDED',
    approvedAt: new Date('2026-11-20T03:00:00.000Z'),
  }).returning({ id: s.advanceRequests.id });
  track(s.advanceRequests, request.id);
  const [ledgerEntry] = await db.insert(s.ledger).values({
    txnType: TxnType.OPS_ADVANCE, txnId: request.id, entityType: 'FORWARDER', entityId: adminId,
    credit: '0', debit: amount, balance: '0', note: `SIL1100 funding ${tag}`,
  }).returning({ id: s.ledger.id });
  track(s.ledger, ledgerEntry.id);
  const [movement] = await db.insert(s.treasuryMovements).values({
    treasuryAccountId: cashAccountId, direction: 'OUT', amount, valueDate: '2026-11-20',
    status: 'POSTED', physicalReference: `SIL1100-ADV-${tag}`, sourceVersion: 1,
    paymentContractVersion: 1, ledgerEntryId: ledgerEntry.id, createdBy: adminId,
  }).returning({ id: s.treasuryMovements.id });
  track(s.treasuryMovements, movement.id);
  return request.id;
}

function postVoucher(actorUserId: number, cashAccountId: number, entryId: number, physicalReference: string) {
  return db.transaction((tx) => createExpenseVoucher(tx, { userId: actorUserId, role: Role.ADMIN }, {
    direction: 'OUT', treasuryAccountId: cashAccountId, valueDate: '2026-11-26',
    physicalReference,
    entries: [{ sourceKind: 'OPS', sourceId: entryId, expectedVersion: 1, amount: 100000 }],
  }));
}

after(async () => {
  for (const { table, id } of cleanup) await db.delete(table).where(eq(table.id, id));
  await disconnectRedis();
});

describe('SIL-1100 — rào chắn hoàn ứng chỉ chặn khi giao nhận còn giữ tiền ứng (BE)', () => {
  test('repro QA: FORWARDER chưa hoàn ứng nhưng KHÔNG còn tạm ứng → phiếu chi đi được, không 409', async () => {
    const fx = await mkFixture();
    const voucher = await postVoucher(fx.adminId, fx.cashAccountId, fx.entryId, `SIL1100-OK-${suffix}`);
    assert.ok(voucher.code, 'phiếu phải được ghi nhận khi không còn tiền ứng để trừ');
  });

  test('giao nhận còn GIỮ tạm ứng → rào chắn vẫn chặn và nêu tên người + số tiền đang giữ', async () => {
    const fx = await mkFixture();
    await mkFundedAdvance(fx.adminId, fx.cashAccountId);
    await assert.rejects(
      () => postVoucher(fx.adminId, fx.cashAccountId, fx.entryId, `SIL1100-BAR-${suffix}`),
      (error: Error) => {
        assert.match(error.message, /Lập bảng hoàn ứng trước/);
        assert.ok(error.message.includes(fx.feeName), `phải nêu tên khoản: ${error.message}`);
        assert.match(error.message, /đang giữ/, `phải nêu số tiền đang giữ: ${error.message}`);
        return true;
      },
    );
  });
});
