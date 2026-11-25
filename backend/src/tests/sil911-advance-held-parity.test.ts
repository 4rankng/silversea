// SIL-911 — audit KB 24/11 mục 1.6: "Tồn tạm ứng Ops = 0₫" (Yêu cầu tạm ứng,
// Sổ quỹ / treasury) while Báo cáo hoàn ứng / Quỹ cá nhân showed the same
// staff holding +23.800.000₫. The canonical held money now follows the KB
// closing law (§2.4.6/§5.4.5/§6.4) in ONE place —
// getOutstandingAdvanceBalances — and every surface reads it:
//   held = ĐÃ ỨNG (RECORDED phiếu) − ĐNTT (chi đã xác nhận) − ĐÃ NỘP LẠI,
// integer end to end, floored ≥ 0 per staff (deficits are the signed
// bookkeeping authority's answer, not held money).
// The repro below is the exact audit state: money disbursed (funded) and then
// fully allocated to a đợt (bookkeeping netting) with only 1.2M of confirmed
// costs — the old min(funded) − allocations math read 0₫.
// Fixture shape mirrors phoi-phieu-party-lots.test.ts (real dev DB, tracked
// cleanup, unique suffix so no other suite can bleed in).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { db } from '../db';
import * as s from '../db/schema';
import { Role, TxnType } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import {
  getOutstandingAdvanceBalances,
  getSignedOutstandingAdvanceBalances,
} from '../services/advance-shared.service';
import { listFundBook } from '../services/treasury-fund-book.service';
import { listMonthlyReconciliationReport } from '../services/ops-reconciliation-report.service';
import type { ExpenseActor } from '../services/expense-accounting-write.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DAY = '2026-11-24';
const ADVANCE = 25_000_000;
const DNTT = 1_200_000;
const HELD = ADVANCE - DNTT;
type TrackedTable = PgTable & { id: PgColumn };
const cleanup: Array<{ table: TrackedTable; id: number }> = [];
function track(table: TrackedTable, id: number) {
  cleanup.unshift({ table, id });
}

/** The audit state for one staff: 25M RECORDED + funded (cash left the
 *  treasury) and fully allocated to a đợt, 1.2M confirmed ĐNTT. */
async function mkAuditState(): Promise<{ ops: number; accountant: number; requestId: number }> {
  const [ops] = await db.insert(s.users).values({
    username: `s911-ops-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.OPS, status: 'ACTIVE',
    fullName: `S911 Ops ${suffix}`,
  }).returning({ id: s.users.id });
  track(s.users, ops.id);
  const [accountant] = await db.insert(s.users).values({
    username: `s911-kt-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.ACCOUNTANT, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, accountant.id);
  const [customer] = await db.insert(s.customers).values({
    name: `S911 customer ${suffix}-${cleanup.length}`,
  }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: 'S911 route' }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED', expectedDeliveryDate: DAY,
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [request] = await db.insert(s.advanceRequests).values({
    requesterId: ops.id, amount: String(ADVANCE), reason: `S911 tạm ứng ${suffix}`, status: 'RECORDED',
    // The ĐÃ ỨNG (GỐC) read windows on coalesce(approvedAt, createdAt)::date —
    // stamp the disbursement INSIDE the hardcoded DAY window so the fixture
    // stays stable no matter which day the suite runs on.
    approvedAt: new Date('2026-11-24T03:00:00.000Z'),
  }).returning({ id: s.advanceRequests.id });
  track(s.advanceRequests, request.id);
  // Funding: the cash-left-the-treasury pair (ledger OPS_ADVANCE + OUT POSTED).
  const [ledgerEntry] = await db.insert(s.ledger).values({
    txnType: TxnType.OPS_ADVANCE, txnId: request.id, entityType: 'FORWARDER', entityId: ops.id,
    credit: '0', debit: String(ADVANCE), balance: '0', note: `S911 funding ${suffix}`,
  }).returning({ id: s.ledger.id });
  track(s.ledger, ledgerEntry.id);
  const [account] = await db.insert(s.treasuryAccounts).values({
    code: `S911-STK-${suffix}-${cleanup.length}`, name: 'STK quỹ', type: 'CASH', fundCode: 'COMPANY',
    status: 'ACTIVE', createdBy: accountant.id, updatedBy: accountant.id,
  }).returning({ id: s.treasuryAccounts.id });
  track(s.treasuryAccounts, account.id);
  const [outMovement] = await db.insert(s.treasuryMovements).values({
    treasuryAccountId: account.id, direction: 'OUT', amount: String(ADVANCE), valueDate: DAY,
    sourceVersion: 1, paymentContractVersion: 1, ledgerEntryId: ledgerEntry.id,
    physicalReference: `S911-OUT-${suffix}-${cleanup.length}`, createdBy: accountant.id,
  }).returning({ id: s.treasuryMovements.id });
  track(s.treasuryMovements, outMovement.id);
  // The bookkeeping that used to zero the held money: a đợt allocating the
  // whole advance (SIL-911 — allocations are not confirmed spending).
  const [lot] = await db.insert(s.expenseReconciliations).values({
    code: `S911-DOT-${suffix}-${cleanup.length}`, opsUserId: ops.id, from: DAY, to: DAY,
    amount: String(DNTT), advanceAmount: String(ADVANCE), createdById: accountant.id,
  }).returning({ id: s.expenseReconciliations.id });
  track(s.expenseReconciliations, lot.id);
  await db.insert(s.expenseReconciliationAdvances).values({
    reconciliationId: lot.id, advanceRequestId: request.id, amount: String(ADVANCE),
  });
  // Confirmed ĐNTT 1.2M.
  const [entry] = await db.insert(s.opsExpenseEntries).values({
    shipmentId: shipment.id, expenseTypeCode: `S911_LIFT_${suffix}`, amount: String(DNTT),
    costGroup: 'OPS_REGULAR', payerKind: 'USER', paidById: ops.id, paidAt: DAY,
  }).returning({ id: s.opsExpenseEntries.id });
  track(s.opsExpenseEntries, entry.id);
  const [source] = await db.insert(s.expenseAccountingSources).values({
    sourceKind: 'OPS', sourceId: entry.id, shipmentId: shipment.id, confirmedAt: new Date(), version: 3,
  }).returning({ id: s.expenseAccountingSources.id });
  track(s.expenseAccountingSources, source.id);
  return { ops: ops.id, accountant: accountant.id, requestId: request.id };
}

/** Phiếu THU hoàn ứng: the staff physically returns cash (IN movement +
 *  RECORDED FORWARDER voucher — the same class the wallet books as nộp lại). */
async function returnCash(opsId: number, byId: number, amount: number, accountId: number) {
  const [inMovement] = await db.insert(s.treasuryMovements).values({
    treasuryAccountId: accountId, direction: 'IN', amount: String(amount), valueDate: DAY,
    sourceVersion: 1, paymentContractVersion: 1,
    physicalReference: `S911-IN-${suffix}-${cleanup.length}`, createdBy: byId,
  }).returning({ id: s.treasuryMovements.id });
  track(s.treasuryMovements, inMovement.id);
  const [voucher] = await db.insert(s.expenseCashVouchers).values({
    code: `S911-THU-${suffix}-${cleanup.length}`, counterpartyType: 'FORWARDER', counterpartyId: opsId,
    treasuryMovementId: inMovement.id, status: 'RECORDED', createdById: byId,
  }).returning({ id: s.expenseCashVouchers.id });
  track(s.expenseCashVouchers, voucher.id);
}

async function heldOf(userId: number): Promise<{ total: number; item: number | undefined }> {
  const balances = await getOutstandingAdvanceBalances();
  return {
    total: balances.totalOutstanding,
    item: balances.items.find((row) => row.forwarderId === userId)?.outstanding,
  };
}

after(async () => {
  for (const { table, id } of cleanup) {
    await db.delete(table).where(eq(table.id, id));
  }
  await disconnectRedis();
});

describe('SIL-911 — một nguồn sự thật cho Tồn tạm ứng Ops', () => {
  test('audit repro: funded + fully allocated staff still shows held 23.800.000₫ everywhere', async () => {
    const fx = await mkAuditState();
    const actor: ExpenseActor = { userId: fx.accountant, role: Role.ADMIN };
    const summary = await heldOf(fx.ops);
    assert.equal(summary.item, HELD, 'Tồn tạm ứng (summary canonical) = ĐÃ ỨNG − ĐNTT');
    assert.equal(Number.isInteger(summary.total), true, 'money law VN: integer, never a float');
    const book = await listFundBook('COMPANY');
    const bookItem = book.opsAdvance.items.find((row) => row.staffId === fx.ops);
    assert.equal(bookItem?.outstanding, HELD, 'Sổ quỹ OPS row == summary (one truth)');
    const report = await listMonthlyReconciliationReport(actor, { from: DAY, to: DAY });
    const row = report.rows.find((item) => item.staffId === fx.ops);
    assert.ok(row, 'the staff belongs in the hoàn ứng report');
    assert.equal(row.advancedRecorded, ADVANCE);
    assert.equal(row.dntt, DNTT);
    assert.equal(row.remaining, HELD, 'report `remaining` == Sổ quỹ == summary (card 377 parity)');
    assert.equal(row.remainingSigned, HELD, 'Còn phải hoàn ứng = ĐÃ ỨNG − ĐNTT, đúng dấu (+)');
    assert.equal(row.needsCollection, true);
  });

  test('phiếu THU hoàn ứng reduces the held money exactly once (card 20260928_168)', async () => {
    const fx = await mkAuditState();
    const actor: ExpenseActor = { userId: fx.accountant, role: Role.ADMIN };
    const [account] = await db.select({ id: s.treasuryAccounts.id }).from(s.treasuryAccounts)
      .where(eq(s.treasuryAccounts.fundCode, 'COMPANY')).limit(1);
    const refund = 5_000_000;
    await returnCash(fx.ops, fx.accountant, refund, account.id);
    const summary = await heldOf(fx.ops);
    assert.equal(summary.item, HELD - refund, 'nộp lại 5M → còn giữ 18.8M');
    const book = await listFundBook('COMPANY');
    assert.equal(book.opsAdvance.items.find((row) => row.staffId === fx.ops)?.outstanding, HELD - refund);
    const report = await listMonthlyReconciliationReport(actor, { from: DAY, to: DAY });
    const row = report.rows.find((item) => item.staffId === fx.ops);
    assert.equal(row?.remaining, HELD - refund, 'report held converges with the book after the THU');
    assert.equal(row?.remainingSigned, HELD - refund, 'CR-011 single truth: the kỳ rail reads the SAME canonical formula as the phiếu (ĐÃ ỨNG − ĐNTT − đã tất toán)');
  });

  test('a deficit is not held money: floored 0, dropped from the summary, report keeps the sign', async () => {
    const fx = await mkAuditState();
    // The staff spent 30M confirmed on top of the 25M advance: signed −5M.
    const [customer] = await db.insert(s.customers).values({
      name: `S911 def customer ${suffix}`,
    }).returning({ id: s.customers.id });
    track(s.customers, customer.id);
    const [route] = await db.insert(s.routes).values({ name: 'S911 def route' }).returning({ id: s.routes.id });
    track(s.routes, route.id);
    const [shipment] = await db.insert(s.shipments).values({
      customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED', expectedDeliveryDate: DAY,
    }).returning({ id: s.shipments.id });
    track(s.shipments, shipment.id);
    const [entry] = await db.insert(s.opsExpenseEntries).values({
      shipmentId: shipment.id, expenseTypeCode: `S911_DEF_${suffix}`, amount: String(30_000_000),
      costGroup: 'OPS_REGULAR', payerKind: 'USER', paidById: fx.ops, paidAt: DAY,
    }).returning({ id: s.opsExpenseEntries.id });
    track(s.opsExpenseEntries, entry.id);
    const [source] = await db.insert(s.expenseAccountingSources).values({
      sourceKind: 'OPS', sourceId: entry.id, shipmentId: shipment.id, confirmedAt: new Date(), version: 3,
    }).returning({ id: s.expenseAccountingSources.id });
    track(s.expenseAccountingSources, source.id);
    const balances = await getOutstandingAdvanceBalances();
    assert.equal(balances.items.find((row) => row.forwarderId === fx.ops), undefined, 'deficit ⇒ not held');
    const signed = await getSignedOutstandingAdvanceBalances(fx.ops);
    // Per-request bookkeeping: min(granted, funded) − đợt allocation = 0 here —
    // the over-spend never rides this view. The deficit surfaces on the
    // report's signed rail below (KB sign law), not in held money.
    assert.equal(signed.items.find((row) => row.forwarderId === fx.ops)?.outstanding ?? 0, 0);
    const report = await listMonthlyReconciliationReport(
      { userId: fx.accountant, role: Role.ADMIN } satisfies ExpenseActor,
      { from: DAY, to: DAY },
    );
    const row = report.rows.find((item) => item.staffId === fx.ops);
    assert.equal(row?.remaining, 0, 'held floored at 0');
    // ĐNTT total 31.2M (1.2M fixture + 30M over-spend) vs 25M recorded ⇒ −6.2M.
    assert.equal(row?.remainingSigned, ADVANCE - (DNTT + 30_000_000), 'âm giữ dấu — công ty trả thêm, không kẹp 0');
  });

  test('per-staff scoping: one staff filter narrows the canonical without cross-staff bleed', async () => {
    const fx = await mkAuditState();
    const scoped = await getOutstandingAdvanceBalances(fx.ops);
    assert.deepEqual(scoped.items.map((row) => row.forwarderId), [fx.ops]);
    const andWhere = await db.select({ id: s.advanceRequests.id }).from(s.advanceRequests)
      .where(and(eq(s.advanceRequests.requesterId, fx.ops), eq(s.advanceRequests.status, 'RECORDED')));
    assert.equal(andWhere.length, 1);
  });
});
