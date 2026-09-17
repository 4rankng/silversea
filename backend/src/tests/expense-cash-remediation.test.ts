import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { Role, TxnType } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import type { Tx } from '../services/trip-shared';
import { createAdvanceRequest } from '../services/advance-request.service';
import { filterWholeSettlementAdvances } from '../services/advance-consumption.service';
import { getAdvanceFundedAmounts } from '../services/advance-funding.service';
import { getOpsWalletSummary } from '../services/ops-wallet.service';
import { createExpenseReconciliation, recordFundedOpsAdvance } from '../services/expense-accounting-reconciliation.service';
import { createExpenseVoucher, reverseExpenseVoucher } from '../services/expense-accounting-voucher.service';
import { getExpenseAccountingReport, getExpenseReconciliation, getExpenseAccountingCatalog } from '../services/expense-accounting-reads.service';
import { LedgerService } from '../services/ledger.service';
import { appendTreasuryReversal } from '../services/treasury.service';
import { createAccountingExpense } from '../services/expense-accounting-create.service';
import { insertTripComposite } from '../services/trip-composite.service';
import { confirmAccountingExpenses } from '../services/expense-accounting-write.service';

after(async () => { await client.end(); });
async function fixture(run: (tx: Tx, ctx: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const rollback = Symbol('rollback');
  try { await db.transaction(async tx => { await run(tx, await setup(tx)); throw rollback; }); }
  catch (error) { if (error !== rollback) throw error; }
}
async function setup(tx: Tx) {
  const key = crypto.randomUUID();
  const [ops] = await tx.insert(s.users).values({ username: key, passwordHash: 'fixture', role: Role.OPS, status: 'ACTIVE' }).returning();
  const [customer] = await tx.insert(s.customers).values({ name: key }).returning();
  const [shipment] = await tx.insert(s.shipments).values({ shipmentCode: key, customerId: customer.id }).returning();
  const [account] = await tx.insert(s.treasuryAccounts).values({ code: key, name: key, type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: 1, updatedBy: 1 }).returning();
  const actor = { userId: 1, role: Role.ACCOUNTANT };
  const fund = { treasuryAccountId: account.id, valueDate: '2026-09-10', physicalReference: crypto.randomUUID() };
  return { key, ops, customer, shipment, account, actor, fund };
}
async function source(tx: Tx, ctx: Awaited<ReturnType<typeof setup>>, amount: number, charge = 0) {
  const [expense] = await tx.insert(s.opsExpenseEntries).values({ shipmentId: ctx.shipment.id, expenseTypeCode: 'OTHER', amount: String(amount), customerChargeAmount: String(charge), paidAt: '2026-09-09', paidById: ctx.ops.id, payerKind: 'USER', costGroup: 'OPS_REGULAR', feeName: ctx.key, approvalStatus: 'RECORDED' }).returning();
  const [link] = await tx.insert(s.expenseAccountingSources).values({ sourceKind: 'OPS', sourceId: expense.id, shipmentId: ctx.shipment.id, confirmedAt: new Date(), confirmedById: 1, recordedById: ctx.ops.id }).returning();
  await LedgerService.postEntry(tx, { txnType: TxnType.VENDOR_EXPENSE, entityType: 'FORWARDER', entityId: ctx.ops.id, debit: amount, credit: 0, receiptId: `EXPENSE_SOURCE:${link.id}` });
  return { expense, link };
}
test('FIX17-CASH-01/02 request is not cash; explicit funding reuses request and posts one credit', async () => fixture(async (tx, ctx) => {
  const request = await createAdvanceRequest(ctx.ops.id, { amount: 1_000_000, reason: ctx.key }, tx);
  assert.equal((await getOpsWalletSummary(ctx.ops.id, tx)).totalAdvance, '0');
  assert.equal((await tx.select().from(s.ledger).where(and(eq(s.ledger.txnType, TxnType.OPS_ADVANCE), eq(s.ledger.txnId, request.id)))).length, 0);
  const pending = await getExpenseAccountingCatalog(ctx.actor, tx);
  assert.ok(pending.pendingAdvances?.some(row => row.id === request.id));
  const advance = await recordFundedOpsAdvance(tx, ctx.actor, { ...ctx.fund, opsUserId: ctx.ops.id, amount: 1_000_000, reason: ctx.key, advanceRequestId: request.id });
  assert.equal(advance.id, request.id);
  assert.equal((await getOpsWalletSummary(ctx.ops.id, tx)).totalAdvance, '1000000');
  assert.equal((await tx.select().from(s.advanceRequests).where(eq(s.advanceRequests.requesterId, ctx.ops.id))).length, 1);
  await assert.rejects(recordFundedOpsAdvance(tx, ctx.actor, { ...ctx.fund, physicalReference: crypto.randomUUID(), opsUserId: ctx.ops.id, amount: 1_000_000, reason: ctx.key, advanceRequestId: request.id }), /nguồn|giao dịch|liên kết/);
}));
test('FIX17-CASH-02/07 legacy credit needs cash evidence and net funding follows reversal', async () => fixture(async (tx, ctx) => {
  const request = await createAdvanceRequest(ctx.ops.id, { amount: 100000, reason: ctx.key }, tx);
  const credit = await LedgerService.postEntry(tx, { txnType: TxnType.OPS_ADVANCE, txnId: request.id, entityType: 'FORWARDER', entityId: ctx.ops.id, debit: 0, credit: 100000 });
  assert.equal((await getOpsWalletSummary(ctx.ops.id, tx)).totalAdvance, '0');
  await recordFundedOpsAdvance(tx, ctx.actor, { ...ctx.fund, opsUserId: ctx.ops.id, amount: 100000, reason: ctx.key, advanceRequestId: request.id });
  const entries = await tx.select().from(s.ledger).where(and(eq(s.ledger.txnType, TxnType.OPS_ADVANCE), eq(s.ledger.txnId, request.id)));
  assert.deepEqual(entries.map(row => row.id), [credit.id]);
  const [movement] = await tx.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.ledgerEntryId, credit.id));
  await appendTreasuryReversal(tx, { originalMovementId: movement.id, amount: 100000, valueDate: '2026-09-11', sourceVersion: 2, physicalReference: crypto.randomUUID(), createdBy: 1 });
  assert.equal((await getAdvanceFundedAmounts(tx, [request.id])).get(request.id), 0);
  assert.equal((await getOpsWalletSummary(ctx.ops.id, tx)).totalAdvance, '0');
}));
test('FIX17-CASH-05 selected batch payable is not rejected by unrelated funded advances; excess remains rejected', async () => fixture(async (tx, ctx) => {
  await recordFundedOpsAdvance(tx, ctx.actor, { ...ctx.fund, opsUserId: ctx.ops.id, amount: 5000000, reason: 'Other batch' });
  const advance = await recordFundedOpsAdvance(tx, ctx.actor, { ...ctx.fund, physicalReference: crypto.randomUUID(), opsUserId: ctx.ops.id, amount: 1000000, reason: ctx.key });
  const { expense } = await source(tx, ctx, 1200000);
  const batch = await createExpenseReconciliation(tx, ctx.actor, { opsUserId: ctx.ops.id, from: '2026-09-01', to: '2026-09-30', entries: [{ sourceKind: 'OPS', sourceId: expense.id, expectedVersion: 1 }], advances: [{ advanceRequestId: advance.id, amount: 1000000 }] });
  const input = { ...ctx.fund, direction: 'OUT' as const, physicalReference: crypto.randomUUID(), entries: [{ sourceKind: 'OPS' as const, sourceId: expense.id, expectedVersion: 2, amount: 100000 }] };
  const voucher = await createExpenseVoucher(tx, ctx.actor, input);
  assert.equal((await getExpenseReconciliation(ctx.actor, batch.id, tx)).remainingDifference, 100000);
  await assert.rejects(createExpenseVoucher(tx, ctx.actor, { ...input, physicalReference: crypto.randomUUID(), entries: [{ ...input.entries[0], expectedVersion: 3, amount: 100001 }] }), /chỉ còn/);
  await reverseExpenseVoucher(tx, ctx.actor, voucher.id, { expectedVersion: 1, valueDate: '2026-09-20', physicalReference: crypto.randomUUID(), reason: ctx.key });
  assert.equal((await getExpenseReconciliation(ctx.actor, batch.id, tx)).remainingDifference, 200000);
}));
for (const direction of ['IN', 'OUT'] as const) test(`FIX17-CASH-06 ${direction} report respects cash and reversal effective dates`, async () => fixture(async (tx, ctx) => {
  const { expense } = await source(tx, ctx, 500000, 300000);
  if (direction === 'OUT') await createExpenseReconciliation(tx, ctx.actor, { opsUserId: ctx.ops.id, from: '2026-09-01', to: '2026-09-30', entries: [{ sourceKind: 'OPS', sourceId: expense.id, expectedVersion: 1 }], advances: [] });
  const voucher = await createExpenseVoucher(tx, ctx.actor, { ...ctx.fund, direction, entries: [{ sourceKind: 'OPS', sourceId: expense.id, expectedVersion: direction === 'OUT' ? 2 : 1, amount: 100000 }] });
  await reverseExpenseVoucher(tx, ctx.actor, voucher.id, { expectedVersion: 1, valueDate: '2026-09-20', physicalReference: crypto.randomUUID(), reason: ctx.key });
  for (const [asOfDate, settled] of [['2026-09-09', 0], ['2026-09-10', 100000], ['2026-09-15', 100000], ['2026-09-20', 0], ['2026-09-21', 0]] as const) {
    const report = await getExpenseAccountingReport(ctx.actor, { direction, shipmentId: ctx.shipment.id, page: 1, limit: 100, asOfDate }, tx);
    assert.equal(report.totals.settled, settled, asOfDate);
    assert.equal(report.totals.outstanding, (direction === 'IN' ? 300000 : 500000) - settled, asOfDate);
  }
}));
test('FIX17-CASH-04 accountant OPS proxy uses one native expense, separate recorder and a single billing mirror', async () => fixture(async (tx, ctx) => {
  const [route] = await tx.insert(s.routes).values({ name: ctx.key }).returning();
  const [cargo] = await tx.insert(s.cargoTypes).values({ name: ctx.key }).returning();
  const [type] = await tx.insert(s.forwarderExpenseTypes).values({ code: ctx.key, name: ctx.key, status: 'ACTIVE' }).returning();
  const trip = await insertTripComposite(tx, { tripCode: ctx.key, shipmentId: ctx.shipment.id, customerId: ctx.customer.id, routeId: route.id, cargoTypeId: cargo.id, departureDate: '2026-09-10', status: 'CREATED', carrierType: 'OWN' });
  const entry = await createAccountingExpense(tx, ctx.actor, { tripId: trip.id, costGroup: 'OPS_REGULAR', expenseTypeCode: type.code, feeName: ctx.key, amount: 333000, customerChargeAmount: 0, expenseDate: '2026-09-10', payerKind: 'USER', payerUserId: ctx.ops.id });
  assert.equal(entry.sourceKind, 'OPS'); assert.equal(entry.payerUserId, ctx.ops.id); assert.equal(entry.recordedById, ctx.actor.userId);
  assert.ok(entry.linkedTripExpenseId); assert.equal((await getOpsWalletSummary(ctx.ops.id, tx)).approved, '333000');
  await confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: 'OPS', sourceId: entry.sourceId, expectedVersion: entry.version }]);
  assert.equal((await getOpsWalletSummary(ctx.ops.id, tx)).approved, '333000');
  assert.equal((await tx.select().from(s.tripExpenses).where(eq(s.tripExpenses.tripId, trip.id))).length, 1);
}));

test('FIX17-CASH-08 report dates advance allocation and retains history after release', async () => fixture(async (tx, ctx) => {
  const { releaseExpenseReconciliation } = await import('../services/expense-reconciliation-release.service');
  const { getAdvanceConsumedAmounts } = await import('../services/advance-consumption.service');
  const { expense } = await source(tx, ctx, 500000);
  const advance = await recordFundedOpsAdvance(tx, ctx.actor, { ...ctx.fund, opsUserId: ctx.ops.id, amount: 300000, reason: ctx.key });
  const batch = await createExpenseReconciliation(tx, ctx.actor, { opsUserId: ctx.ops.id, from: '2026-09-01', to: '2026-09-30', entries: [{ sourceKind: 'OPS', sourceId: expense.id, expectedVersion: 1 }], advances: [{ advanceRequestId: advance.id, amount: 300000 }] });
  await tx.update(s.expenseReconciliations).set({ createdAt: new Date('2026-09-12T08:00:00+07:00') }).where(eq(s.expenseReconciliations.id, batch.id));
  const report = (asOfDate: string) => getExpenseAccountingReport(ctx.actor, { direction: 'OUT', shipmentId: ctx.shipment.id, page: 1, limit: 100, asOfDate }, tx);
  assert.equal((await report('2026-09-09')).totals.settled, 0, 'cash not yet delivered');
  assert.equal((await report('2026-09-11')).totals.settled, 0, 'funded but not allocated');
  assert.equal((await report('2026-09-15')).totals.settled, 300000);
  await releaseExpenseReconciliation(tx, ctx.actor, batch.id, ctx.key);
  await tx.update(s.expenseReconciliations).set({ voidedAt: new Date('2026-09-20T08:00:00+07:00') }).where(eq(s.expenseReconciliations.id, batch.id));
  assert.equal((await report('2026-09-15')).totals.settled, 300000, 'later release preserves historical allocation');
  assert.equal((await report('2026-09-20')).totals.settled, 0);
  assert.equal((await report('2026-09-20')).totals.outstanding, 500000);
  assert.equal((await getAdvanceConsumedAmounts(tx, [advance.id])).get(advance.id) ?? 0, 0, 'release frees claim without deleting allocation history');
  assert.equal((await tx.select().from(s.expenseReconciliationAdvances).where(eq(s.expenseReconciliationAdvances.reconciliationId, batch.id))).length, 1);
}));

test('FIX17-CASH-08 incomplete cash evidence at cutoff is unknown instead of guessed allocation', async () => fixture(async (tx, ctx) => {
  const { expense } = await source(tx, ctx, 500000);
  const advance = await recordFundedOpsAdvance(tx, ctx.actor, { ...ctx.fund, valueDate: '2026-09-20', opsUserId: ctx.ops.id, amount: 300000, reason: ctx.key });
  const batch = await createExpenseReconciliation(tx, ctx.actor, { opsUserId: ctx.ops.id, from: '2026-09-01', to: '2026-09-30', entries: [{ sourceKind: 'OPS', sourceId: expense.id, expectedVersion: 1 }], advances: [{ advanceRequestId: advance.id, amount: 300000 }] });
  await tx.update(s.expenseReconciliations).set({ createdAt: new Date('2026-09-12T08:00:00+07:00') }).where(eq(s.expenseReconciliations.id, batch.id));
  const early = await getExpenseAccountingReport(ctx.actor, { direction: 'OUT', shipmentId: ctx.shipment.id, page: 1, limit: 100, asOfDate: '2026-09-15' }, tx);
  assert.equal(early.totals.settled, null); assert.equal(early.totals.outstanding, null); assert.equal(early.unknownCount, 1);
}));

test('FIX17-CASH-09 legacy settlement refund field is not cash; actual refund and reversal count once', async () => fixture(async (tx, ctx) => {
  const { insertTreasuryMovement } = await import('../services/treasury.service');
  const [settlement] = await tx.insert(s.advanceSettlements).values({ code: ctx.key.slice(0, 20), forwarderId: ctx.ops.id, totalExpenseAmount: '800000', refundAmount: '200000', status: 'RECORDED' }).returning();
  const ledger = await LedgerService.postEntry(tx, { txnType: TxnType.OPS_SETTLEMENT, txnId: settlement.id, entityType: 'FORWARDER', entityId: ctx.ops.id, debit: 1000000, credit: 0 });
  assert.equal((await getOpsWalletSummary(ctx.ops.id, tx)).returned, '0');
  const movement = await insertTreasuryMovement(tx, { ...ctx.fund, direction: 'IN', amount: 200000, ledgerEntryId: ledger.id, sourceVersion: 1, paymentContractVersion: 2, createdBy: 1 });
  assert.equal((await getOpsWalletSummary(ctx.ops.id, tx)).returned, '200000');
  await appendTreasuryReversal(tx, { originalMovementId: movement.id, amount: 200000, valueDate: '2026-09-11', sourceVersion: 2, physicalReference: crypto.randomUUID(), createdBy: 1 });
  assert.equal((await getOpsWalletSummary(ctx.ops.id, tx)).returned, '0');
}));


test('NO-APP-08B whole-request selector shares funding and cross-flow consumption authority', async () => fixture(async (tx, ctx) => {
  const unfunded = await createAdvanceRequest(ctx.ops.id, { amount: 1000000, reason: 'Requested but unpaid' }, tx);
  const available = await recordFundedOpsAdvance(tx, ctx.actor, { ...ctx.fund, opsUserId: ctx.ops.id, amount: 1000000, reason: 'Actual funding' });
  const rows = await tx.select().from(s.advanceRequests).where(eq(s.advanceRequests.requesterId, ctx.ops.id));
  assert.deepEqual((await filterWholeSettlementAdvances(tx, rows)).map(row => row.id), [available.id]);
  assert.ok(!((await filterWholeSettlementAdvances(tx, rows)).some(row => row.id === unfunded.id)));
  const [batch] = await tx.insert(s.expenseReconciliations).values({ code: crypto.randomUUID(), opsUserId: ctx.ops.id,
    from: '2026-09-01', to: '2026-09-30', amount: '100000', advanceAmount: '100000', createdById: 1 }).returning();
  await tx.insert(s.expenseReconciliationAdvances).values({ reconciliationId: batch.id, advanceRequestId: available.id, amount: '100000' });
  assert.deepEqual(await filterWholeSettlementAdvances(tx, rows), [], 'even a partial claim makes the whole-request selector ineligible');
  await tx.update(s.expenseReconciliations).set({ voidedAt: new Date() }).where(eq(s.expenseReconciliations.id, batch.id));
  assert.deepEqual((await filterWholeSettlementAdvances(tx, rows)).map(row => row.id), [available.id], 'release restores eligibility without deleting history');
  const [legacy] = await tx.insert(s.advanceSettlements).values({ code: crypto.randomUUID().slice(0, 20), forwarderId: ctx.ops.id,
    totalExpenseAmount: '1000000', status: 'RECORDED' }).returning();
  await tx.insert(s.advanceSettlementRequests).values({ settlementId: legacy.id, advanceRequestId: available.id, allocatedAmount: '1000000' });
  assert.deepEqual(await filterWholeSettlementAdvances(tx, rows), [], 'legacy claim uses the same selector boundary');
  assert.deepEqual((await filterWholeSettlementAdvances(tx, rows, legacy.id)).map(row => row.id), [available.id], 'editing its own settlement preserves the existing selection');
}));
