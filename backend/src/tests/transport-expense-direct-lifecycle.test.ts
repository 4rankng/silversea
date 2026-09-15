import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { Role, TxnType } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import type { Tx } from '../services/trip-shared';
import { createTripExpense, updateTripExpense, updateForwarderTripExpenseInTx, deleteTripExpenseInTx, deleteTripExpenseGuarded } from '../services/forwarder.service';
import { createAdvanceSettlement, updateAdvanceSettlement } from '../services/advance-settlement.service';
import { adjustSettlementExpense, requestAdvanceSettlementReversal, applyAdvanceSettlementGovernanceAction } from '../services/advance-settlement-reversal.service';
import { applyGovernanceActionDirect } from '../services/governance-action-core.service';

async function isolated(run: (tx: Tx) => Promise<void>) {
  const rollback = new Error('rollback test fixture');
  try { await db.transaction(async tx => { await run(tx); throw rollback; }); } catch (error) { if (error !== rollback) throw error; }
}
async function fixture(tx: Tx) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const [actor] = await tx.insert(s.users).values({ username: `direct-exp-${suffix}`, passwordHash: 'test', role: Role.ACCOUNTANT, status: 'ACTIVE' }).returning();
  const [owner] = await tx.insert(s.users).values({ username: `direct-ops-${suffix}`, passwordHash: 'test', role: Role.OPS, status: 'ACTIVE' }).returning();
  const [customer] = await tx.insert(s.customers).values({ name: `Direct expense ${suffix}` }).returning();
  const [route] = await tx.insert(s.routes).values({ name: `Direct route ${suffix}` }).returning();
  const [shipment] = await tx.insert(s.shipments).values({ shipmentCode: `DIRECT-${suffix}`, customerId: customer.id, status: 'DISPATCHED' }).returning();
  const [trip] = await tx.insert(s.trips).values({ tripCode: `DIRECT-${suffix}`, customerId: customer.id, routeId: route.id, shipmentId: shipment.id, departureDate: '2026-09-15', status: 'IN_TRANSIT' }).returning();
  await tx.insert(s.userShipmentLinks).values({ userId: owner.id, shipmentId: shipment.id });
  return { actor, owner, customer, trip, shipment };
}
async function settlementFixture(tx: Tx) {
  const f = await fixture(tx);
  const [expense] = await tx.insert(s.tripExpenses).values({ tripId: f.trip.id, forwarderId: f.owner.id, createdBy: f.owner.id, expenseType: 'OTHER', buyAmount: '1000', sellAmount: '0', invoiceNumber: 'QA-EVIDENCE', approvalStatus: 'RECORDED', settlementMethod: 'OPS_ADVANCE' }).returning();
  const [advance] = await tx.insert(s.advanceRequests).values({ requesterId: f.owner.id, amount: '1500', reason: 'QA direct funds', status: 'RECORDED' }).returning();
  await tx.insert(s.tripExpenseCompletionScopes).values({ tripId: f.trip.id, tripContainerId: null, status: 'COMPLETED', completedBy: f.actor.id, completedAt: new Date() });
  return { ...f, expense, advance };
}

test('direct transport expense records immediately and remains editable without approval', () => isolated(async tx => {
  const f = await fixture(tx);
  const expense = await createTripExpense(tx, { tripId: f.trip.id, createdBy: f.actor.id, forwarderId: null, expenseType: 'OTHER', buyAmount: '1000', invoiceNumber: 'QA-EVIDENCE', note: null, settlementMethod: 'COMPANY_DIRECT' });
  assert.equal(expense.approvalStatus, 'RECORDED');
  await assert.rejects(updateTripExpense(tx, expense.id, { note: 'wrong trip' }, f.trip.id + 1), /Không tìm thấy/);
  const updated = await updateTripExpense(tx, expense.id, { buyAmount: '1200', note: 'corrected direct' });
  assert.equal(updated?.approvalStatus, 'RECORDED');
  assert.equal(updated?.buyAmount, '1200');
  assert.equal(updated?.version, expense.version + 1);
  assert.equal(updated?.approvedBy, null);
  assert.equal(updated?.approvedAt, null);
}));

test('transport expense direct edits retain ownership and stale-version guards', () => isolated(async tx => {
  const f = await fixture(tx);
  const expense = await createTripExpense(tx, { tripId: f.trip.id, createdBy: f.owner.id, forwarderId: f.owner.id, expenseType: 'OTHER', buyAmount: '1000', invoiceNumber: 'QA-EVIDENCE', note: null, settlementMethod: 'OPS_ADVANCE' });
  await assert.rejects(updateForwarderTripExpenseInTx(tx, expense.id, f.actor.id, { note: 'wrong owner' }, expense.updatedAt), /quyền/);
  await assert.rejects(updateForwarderTripExpenseInTx(tx, expense.id, f.owner.id, { note: 'stale' }, new Date(0)), /thay đổi/);
  await tx.update(s.tripExpenses).set({ approvalStatus: 'VOIDED' }).where(eq(s.tripExpenses.id, expense.id));
  await assert.rejects(updateTripExpense(tx, expense.id, { note: 'mutate voided' }), /đã hủy/);
  await assert.rejects(deleteTripExpenseInTx(tx, expense.id, f.owner.id, expense.updatedAt), /đã hủy/);
  const deleted = await deleteTripExpenseGuarded(f.trip.id, expense.id, tx);
  assert.ok('error' in deleted);
  const [retained] = await tx.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, expense.id));
  assert.equal(retained.approvalStatus, 'VOIDED');
}));

test('settlement cannot promote an incomplete expense into a financial record', () => isolated(async tx => {
  const f = await settlementFixture(tx);
  await tx.update(s.tripExpenses).set({ approvalStatus: 'DRAFT', returnForEvidenceReason: 'Missing proof' }).where(eq(s.tripExpenses.id, f.expense.id));
  await assert.rejects(createAdvanceSettlement(f.owner.id, { advanceRequestIds: [f.advance.id], tripExpenseIds: [f.expense.id], refundAmount: 500 }, tx), /chưa được ghi nhận/);
  const [saved] = await tx.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, f.expense.id));
  assert.equal(saved.approvalStatus, 'DRAFT');
  assert.equal(saved.returnForEvidenceReason, 'Missing proof');
}));

test('recorded settlement posts its ledger atomically and rejects direct replacement of settled sources', () => isolated(async tx => {
  const f = await settlementFixture(tx);
  const settlement = await createAdvanceSettlement(f.owner.id, { advanceRequestIds: [f.advance.id], tripExpenseIds: [f.expense.id], refundAmount: 500 }, tx);
  assert.equal(settlement.status, 'RECORDED');
  const entries = await tx.select().from(s.ledger).where(and(eq(s.ledger.txnType, TxnType.OPS_SETTLEMENT), eq(s.ledger.txnId, settlement.id)));
  assert.equal(entries.length, 1);
  assert.equal(Number(entries[0].debit), 1500);
  await assert.rejects(updateTripExpense(tx, f.expense.id, { buyAmount: '999' }), /phiếu hoàn ứng/);
  await assert.rejects(deleteTripExpenseInTx(tx, f.expense.id, f.owner.id, f.expense.updatedAt), /không thể xóa/);
  const deleted = await deleteTripExpenseGuarded(f.trip.id, f.expense.id, tx);
  assert.ok('error' in deleted);
  await assert.rejects(updateAdvanceSettlement(settlement.id, { expectedVersion: settlement.version, advanceRequestIds: [f.advance.id], tripExpenseIds: [], refundAmount: 1500 }, { transaction: tx, emitNotification: false }), /không thể sửa danh sách/);
}));

test('recorded settlement correction preserves original snapshots and writes an applied audit action', () => isolated(async tx => {
  const f = await settlementFixture(tx);
  const settlement = await createAdvanceSettlement(f.owner.id, { advanceRequestIds: [f.advance.id], tripExpenseIds: [f.expense.id], refundAmount: 500 }, tx);
  const outcome = await adjustSettlementExpense(settlement.id, f.expense.id, f.actor.id, { expectedVersion: settlement.version, buyAmount: 1200, sellAmount: 0, adjustmentReason: 'Correct receipt' }, { transaction: tx, emitNotification: false, actorRole: Role.ACCOUNTANT });
  assert.ok(outcome.governanceAction?.appliedAt);
  const [link] = await tx.select().from(s.settlementExpenses).where(eq(s.settlementExpenses.settlementId, settlement.id));
  assert.equal(link.originalBuyAmount, '1000');
  assert.equal(link.adjustedBuyAmount, '1200');
  const [saved] = await tx.select().from(s.advanceSettlements).where(eq(s.advanceSettlements.id, settlement.id));
  assert.equal(saved.refundAmount, '300');
  assert.equal(saved.totalExpenseAmount, '1200');
  assert.equal(saved.status, 'RECORDED');
  assert.equal(saved.version, settlement.version + 1);
  const audit = await tx.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityType, 'financial-action'), eq(s.auditLogs.entityId, settlement.id)));
  assert.equal(audit.length, 1);
  assert.equal(audit[0].userId, f.actor.id);
  assert.equal(audit[0].payload?.event, 'FINANCIAL_ACTION_APPLIED');
}));

test('recorded settlement reversal retains audit and appends exactly one reversing ledger entry', () => isolated(async tx => {
  const f = await settlementFixture(tx);
  const settlement = await createAdvanceSettlement(f.owner.id, { advanceRequestIds: [f.advance.id], tripExpenseIds: [f.expense.id], refundAmount: 500 }, tx);
  const action = await requestAdvanceSettlementReversal({ settlementId: settlement.id, expectedVersion: settlement.version, reason: 'Duplicate settlement', makerId: f.actor.id, makerRole: Role.ACCOUNTANT, transaction: tx });
  const applied = await applyGovernanceActionDirect({ action, actorId: f.actor.id, actorRole: Role.ACCOUNTANT, apply: applyAdvanceSettlementGovernanceAction, transaction: tx });
  assert.ok(applied.action.appliedAt);
  const [saved] = await tx.select().from(s.advanceSettlements).where(eq(s.advanceSettlements.id, settlement.id));
  assert.equal(saved.status, 'REVERSED');
  const entries = await tx.select().from(s.ledger).where(and(eq(s.ledger.entityId, f.owner.id), eq(s.ledger.txnId, settlement.id)));
  assert.equal(entries.filter(e => e.txnType === TxnType.OPS_SETTLEMENT).length, 1);
  const reversals = entries.filter(e => e.txnType === TxnType.ADJUSTMENT);
  assert.equal(reversals.length, 1);
  assert.equal(Number(reversals[0].credit), 1500);
  const audit = await tx.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityType, 'financial-action'), eq(s.auditLogs.entityId, settlement.id)));
  assert.equal(audit.length, 1);
  assert.equal(audit[0].userId, f.actor.id);
  assert.equal(audit[0].payload?.event, 'FINANCIAL_ACTION_APPLIED');
  await assert.rejects(requestAdvanceSettlementReversal({ settlementId: settlement.id, expectedVersion: saved.version, reason: 'repeat', makerId: f.actor.id, makerRole: Role.ACCOUNTANT, transaction: tx }), /ghi nhận/);
}));

test('repeated completed-trip expense edits post only the remaining customer fee delta', () => isolated(async tx => {
  const f = await fixture(tx);
  await tx.update(s.trips).set({ status: 'COMPLETED' }).where(eq(s.trips.id, f.trip.id));
  const expense = await createTripExpense(tx, { tripId: f.trip.id, createdBy: f.actor.id, forwarderId: null, expenseType: 'OTHER', buyAmount: '0', sellAmount: '1000', invoiceNumber: 'QA-EVIDENCE', note: null, expenseDate: '2026-09-15', settlementMethod: 'COMPANY_DIRECT' });
  await updateTripExpense(tx, expense.id, { sellAmount: '1500' });
  await updateTripExpense(tx, expense.id, { note: 'No new charge' });
  const rows = await tx.select().from(s.ledger).where(and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, f.customer.id)));
  assert.equal(rows.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0), 1500);
  assert.equal(rows.length, 2);
}));

after(async () => { await disconnectRedis(); await client.end(); });
