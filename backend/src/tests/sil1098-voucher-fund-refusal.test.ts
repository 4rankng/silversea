// SIL-1098 (KB §5.4.5 K5.35 = §6.2 K6.12; QuyTrinhO2C.md §7.5) — nguồn quỹ của
// phiếu phải khớp dòng chi: chọn sai thì phiếu bị từ chối KÈM TÊN dòng sai
// quỹ; trộn dòng hai nguồn thì yêu cầu tách phiếu. Repro QA 26/11 (staging
// d568cbae): POST /expense-accounting/vouchers với dòng chi hộ INVOICED_LIFT
// (FORWARDER phải trả, chưa hoàn ứng) + tài khoản Quỹ công ty chỉ nhận được
// rào chắn "Lập bảng hoàn ứng trước…" — câu "Dòng sai quỹ" không bao giờ
// hiển thị. Ba pin dưới khoá đúng thứ tự từ chối: sai quỹ / trộn quỹ TRƯỚC
// rào chắn hoàn ứng, rào chắn vẫn chạy khi quỹ ĐÚNG.
// Fixture shape mirrors ops-receipt-photo-required.test.ts (real dev DB,
// tracked cleanup, unique suffix so no other suite can bleed in).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { db } from '../db';
import * as s from '../db/schema';
import { Role, TxnType, type ExpenseVoucherInput } from '@tingting/shared';
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
    username: `sil1098-${tag}`, passwordHash: 't', role: Role.ADMIN, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, admin.id);
  const [customer] = await db.insert(s.customers).values({ name: `SIL1098 customer ${tag}` })
    .returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `SIL1098 route ${tag}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED', expectedDeliveryDate: PAID_AT,
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [companyAccount] = await db.insert(s.treasuryAccounts).values({
    code: `SIL1098-CTY-${tag}`, name: `SIL1098 Quỹ công ty ${tag}`, type: 'BANK',
    fundCode: 'COMPANY', status: 'ACTIVE', createdBy: admin.id, updatedBy: admin.id,
  }).returning({ id: s.treasuryAccounts.id });
  track(s.treasuryAccounts, companyAccount.id);
  const [cashAccount] = await db.insert(s.treasuryAccounts).values({
    code: `SIL1098-TM-${tag}`, name: `SIL1098 Quỹ tiền mặt ${tag}`, type: 'CASH',
    fundCode: 'TM', status: 'ACTIVE', createdBy: admin.id, updatedBy: admin.id,
  }).returning({ id: s.treasuryAccounts.id });
  track(s.treasuryAccounts, cashAccount.id);

  const mkLine = async (costGroup: 'INVOICED_LIFT' | 'OPS_INCIDENTAL', feeName: string) => {
    const [entry] = await db.insert(s.opsExpenseEntries).values({
      shipmentId: shipment.id, expenseTypeCode: 'SIL1098_PROBE', amount: '200000',
      // payerKind USER → hydrate đặt payable FORWARDER/… — đúng hình repro
      // (khoản phải trả cho người chi hộ, chưa lập hoàn ứng).
      paidById: admin.id, paidAt: PAID_AT, approvalStatus: 'RECORDED',
      payerKind: 'USER', costGroup, feeName, customerChargeAmount: '200000',
    }).returning({ id: s.opsExpenseEntries.id });
    track(s.opsExpenseEntries, entry.id);
    const [link] = await db.insert(s.expenseAccountingSources).values({
      sourceKind: 'OPS', sourceId: entry.id, shipmentId: shipment.id, recordedById: admin.id,
      confirmedById: admin.id, confirmedAt: new Date(),
    }).returning({ id: s.expenseAccountingSources.id });
    track(s.expenseAccountingSources, link.id);
    return entry.id;
  };

  return {
    adminId: admin.id,
    invoicedLiftId: await mkLine('INVOICED_LIFT', `Nâng vỏ ${tag}`),
    psOpsId: await mkLine('OPS_INCIDENTAL', `Phát sinh Ops ${tag}`),
    companyAccountId: companyAccount.id,
    cashAccountId: cashAccount.id,
    liftFeeName: `Nâng vỏ ${tag}`,
  };
}

function postVoucher(actorUserId: number, input: ExpenseVoucherInput) {
  return db.transaction((tx) => createExpenseVoucher(tx, { userId: actorUserId, role: Role.ADMIN }, input));
}

after(async () => {
  for (const { table, id } of cleanup) await db.delete(table).where(eq(table.id, id));
  await disconnectRedis();
});

describe('SIL-1098 — phiếu sai nguồn quỹ bị từ chối kèm tên dòng sai quỹ (BE)', () => {
  test('repro: dòng "Nâng có hóa đơn" + TK Quỹ công ty → từ chối nêu tên dòng, KHÔNG chết ở rào chắn hoàn ứng', async () => {
    const fx = await mkFixture();
    await assert.rejects(
      () => postVoucher(fx.adminId, {
        direction: 'OUT', treasuryAccountId: fx.companyAccountId, valueDate: '2026-11-26',
        physicalReference: `SIL1098-A-${suffix}`,
        entries: [{ sourceKind: 'OPS', sourceId: fx.invoicedLiftId, expectedVersion: 1, amount: 100000 }],
      }),
      (error: Error) => {
        assert.match(error.message, /sai quỹ/i);
        assert.ok(error.message.includes(fx.liftFeeName), `phải nêu tên dòng sai quỹ: ${error.message}`);
        assert.ok(error.message.includes('Quỹ tiền mặt'), `phải nêu quỹ bắt buộc: ${error.message}`);
        assert.doesNotMatch(error.message, /Lập bảng hoàn ứng/, 'kiểm tra quỹ phải tới được trước rào chắn hoàn ứng');
        return true;
      },
    );
  });

  test('quỹ đúng thì rào chắn hoàn ứng vẫn giữ nguyên khi giao nhận còn GIỮ tạm ứng (SIL-1100 law: barrier nets held advances)', async () => {
    const fx = await mkFixture();
    // SIL-1100 — the barrier now demands held advance balance; fund this staff so
    // the barrier (fund-check ordering pin) still fires exactly as before.
    const tag = `${suffix}-adv`;
    const [request] = await db.insert(s.advanceRequests).values({
      requesterId: fx.adminId, amount: '500000', reason: `SIL1098 tạm ứng ${tag}`, status: 'RECORDED',
      approvedAt: new Date('2026-11-20T03:00:00.000Z'),
    }).returning({ id: s.advanceRequests.id });
    track(s.advanceRequests, request.id);
    const [ledgerEntry] = await db.insert(s.ledger).values({
      txnType: TxnType.OPS_ADVANCE, txnId: request.id, entityType: 'FORWARDER', entityId: fx.adminId,
      credit: '0', debit: '500000', balance: '0', note: `SIL1098 funding ${tag}`,
    }).returning({ id: s.ledger.id });
    track(s.ledger, ledgerEntry.id);
    await db.insert(s.treasuryMovements).values({
      treasuryAccountId: fx.cashAccountId, direction: 'OUT', amount: '500000', valueDate: '2026-11-20',
      status: 'POSTED', physicalReference: `SIL1098-ADV-${tag}`, sourceVersion: 1,
      paymentContractVersion: 1, ledgerEntryId: ledgerEntry.id, createdBy: fx.adminId,
    });
    await assert.rejects(
      () => postVoucher(fx.adminId, {
        direction: 'OUT', treasuryAccountId: fx.cashAccountId, valueDate: '2026-11-26',
        physicalReference: `SIL1098-B-${suffix}`,
        entries: [{ sourceKind: 'OPS', sourceId: fx.invoicedLiftId, expectedVersion: 1, amount: 100000 }],
      }),
      (error: Error) => {
        assert.match(error.message, /Lập bảng hoàn ứng trước/);
        return true;
      },
    );
  });

  test('trộn hai nguồn quỹ trên một phiếu → từ chối yêu cầu tách phiếu, nêu tên dòng hai phía', async () => {
    const fx = await mkFixture();
    await assert.rejects(
      () => postVoucher(fx.adminId, {
        direction: 'OUT', treasuryAccountId: fx.cashAccountId, valueDate: '2026-11-26',
        physicalReference: `SIL1098-C-${suffix}`,
        entries: [
          { sourceKind: 'OPS', sourceId: fx.invoicedLiftId, expectedVersion: 1, amount: 50000 },
          { sourceKind: 'OPS', sourceId: fx.psOpsId, expectedVersion: 1, amount: 50000 },
        ],
      }),
      (error: Error) => {
        assert.match(error.message, /trộn hai nguồn quỹ/);
        assert.match(error.message, /tách phiếu/);
        assert.ok(error.message.includes(fx.liftFeeName), `phải nêu tên dòng phía Quỹ tiền mặt: ${error.message}`);
        assert.ok(error.message.includes('Phát sinh Ops'), `phải nêu tên dòng phía Quỹ công ty: ${error.message}`);
        return true;
      },
    );
  });
});
