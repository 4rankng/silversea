import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Role, TxnType } from '@tingting/shared';
import { LedgerService } from '../services/ledger.service';
import { recordFundedOpsAdvance, createExpenseReconciliation, refundExpenseReconciliation } from '../services/expense-accounting-reconciliation.service';
import { createExpenseVoucher, reverseExpenseVoucher } from '../services/expense-accounting-voucher.service';
import { getExpenseReconciliation } from '../services/expense-accounting-reads.service';
import { and, eq } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { recordPaymentReceiptTx } from '../services/payment-allocation.service';
import type { Tx } from '../services/trip-shared';
import { allocateExpenseReceipt, reverseExpenseReceipt } from '../services/expense-receipt-allocation.service';
import { insertTripComposite } from '../services/trip-composite.service';
import { getAdvanceConsumedAmounts } from '../services/advance-consumption.service';
import { validateSettlementInputs } from '../services/settlement-validation';

const rolledBack = Symbol('rollback fixture');
async function fixture(run: (tx: Tx, customerId: number, accountId: number) => Promise<void>) {
  try {
    await db.transaction(async tx => {
      const [customer] = await tx.insert(s.customers).values({ name: 'Expense cash authority fixture' }).returning();
      const [account] = await tx.insert(s.treasuryAccounts).values({ code: `QA-${crypto.randomUUID()}`, name: 'Expense cash account', type: 'BANK', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: 1, updatedBy: 1 }).returning();
      await run(tx, customer.id, account.id);
      throw rolledBack;
    });
  } catch (error) { if (error !== rolledBack) throw error; }
}
after(async () => { await client.end(); });

test('a pre-trip collection creates one canonical unapplied receipt and one bank movement, and replays without new cash', async () => {
  await fixture(async (tx, customerId, treasuryAccountId) => {
    const input = { customerId, treasuryAccountId, receiptId: crypto.randomUUID(), physicalReference: crypto.randomUUID(), valueDate: '2026-09-16', amount: 100_000, allocatedBy: 1, unappliedOnly: true };
    const first = await recordPaymentReceiptTx(tx, input);
    const replay = await recordPaymentReceiptTx(tx, input);
    assert.equal(first.id, replay.id);
    assert.equal(first.receivedAmount, 100_000);
    assert.equal(first.unappliedAmount, 100_000);
    assert.equal(first.allocatedTotal, 0);
    const movements = await tx.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.paymentReceiptId, first.id));
    assert.equal(movements.length, 1);
    assert.equal(movements[0].ledgerEntryId, null, 'the movement links the receipt, never a competing ledger source');
    const ledger = await tx.select().from(s.ledger).where(and(eq(s.ledger.entityId, customerId), eq(s.ledger.receiptId, input.receiptId)));
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].credit, '100000');
    assert.equal(ledger[0].txnId, 0);
  });
});

test('reusing a receipt with a changed cash amount is rejected', async () => {
  await fixture(async (tx, customerId, treasuryAccountId) => {
    const input = { customerId, treasuryAccountId, receiptId: crypto.randomUUID(), physicalReference: crypto.randomUUID(), valueDate: '2026-09-16', amount: 100_000, allocatedBy: 1, unappliedOnly: true };
    await recordPaymentReceiptTx(tx, input);
    await assert.rejects(recordPaymentReceiptTx(tx, { ...input, amount: 200_000 }), /nội dung khác/);
  });
});

test('fee-only debit allocation is capped, creates no second cash movement, and full reversal restores its remaining balance', async () => {
  await fixture(async (tx, customerId, treasuryAccountId) => {
    const [route] = await tx.insert(s.routes).values({ name: crypto.randomUUID() }).returning();
    const [cargo] = await tx.insert(s.cargoTypes).values({ name: crypto.randomUUID() }).returning();
    const trip = await insertTripComposite(tx, { tripCode: crypto.randomUUID(), customerId, routeId: route.id, cargoTypeId: cargo.id,
      departureDate: '2026-09-16', status: 'COMPLETED', carrierType: 'OWN' });
    const [expense] = await tx.insert(s.tripExpenses).values({ tripId: trip.id, expenseType: 'QA', buyAmount: '500000', sellAmount: '300000', settlementMethod: 'COMPANY_DIRECT' }).returning();
    const [document] = await tx.insert(s.billingDocuments).values({ type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: customerId,
      rangeFrom: '2026-09-01', rangeTo: '2026-09-30', totalInclVat: '300000', debitNoteStatus: 'SENT' }).returning();
    await tx.insert(s.billingDocumentLines).values({ documentId: document.id, sourceType: 'EXPENSE', sourceId: expense.id,
      lineType: 'SERVICE_FEE', description: 'Fee-only debit', baseAmount: '300000' });
    const source = { id: 1, customerId, tripId: trip.id, linkedTripExpenseId: expense.id };
    const input = { customerId, treasuryAccountId, receiptId: crypto.randomUUID(), physicalReference: crypto.randomUUID(), valueDate: '2026-09-16', amount: 100000, allocatedBy: 1, unappliedOnly: true };
    const receipt = await recordPaymentReceiptTx(tx, input);
    const mapping = await allocateExpenseReceipt(tx, receipt.id, [{ source, amount: 100000 }], 1);
    assert.equal(mapping.size, 1);
    const [allocation] = await tx.select().from(s.paymentAllocations).where(eq(s.paymentAllocations.id, mapping.get(1)!));
    assert.equal(allocation.targetType, 'BILLING_DOCUMENT'); assert.equal(allocation.targetId, document.id); assert.equal(allocation.amount, '100000');
    assert.equal((await tx.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.paymentReceiptId, receipt.id))).length, 1);
    const [allocatedReceipt] = await tx.select().from(s.paymentReceipts).where(eq(s.paymentReceipts.id, receipt.id));
    assert.equal(allocatedReceipt.allocatedTotal, '100000'); assert.equal(allocatedReceipt.unappliedAmount, '0');
    const second = await recordPaymentReceiptTx(tx, { ...input, receiptId: crypto.randomUUID(), physicalReference: crypto.randomUUID(), amount: 250000 });
    await assert.rejects(allocateExpenseReceipt(tx, second.id, [{ source, amount: 250000 }], 1), /vượt số dư/);
    await reverseExpenseReceipt(tx, receipt.id, 1, { reason: 'QA', valueDate: input.valueDate, physicalReference: crypto.randomUUID() });
    // The original fee's debit now has its full 300k outstanding again.
    await allocateExpenseReceipt(tx, second.id, [{ source, amount: 250000 }], 1);
    const allocations = await tx.select().from(s.paymentAllocations).where(and(eq(s.paymentAllocations.targetType, 'BILLING_DOCUMENT'), eq(s.paymentAllocations.targetId, document.id)));
    assert.equal(allocations.reduce((sum, row) => sum + Number(row.amount), 0), 250000);
    const [reversed] = await tx.select().from(s.paymentReceipts).where(eq(s.paymentReceipts.id, receipt.id));
    assert.equal(reversed.refundedAmount, '100000'); assert.equal(reversed.allocatedTotal, '0');
  });
});

test('old settlements and new reconciliations share the same advance availability', async () => {
  await fixture(async tx => {
    const [advance] = await tx.insert(s.advanceRequests).values({ requesterId: 1, amount: '1000000', reason: 'QA', status: 'RECORDED' }).returning();
    const [legacy] = await tx.insert(s.advanceSettlements).values({ code: crypto.randomUUID().slice(0, 20), forwarderId: 1, totalExpenseAmount: '200000', status: 'RECORDED' }).returning();
    await tx.insert(s.advanceSettlementRequests).values({ settlementId: legacy.id, advanceRequestId: advance.id, allocatedAmount: '200000' });
    const [batch] = await tx.insert(s.expenseReconciliations).values({ code: crypto.randomUUID(), opsUserId: 1, from: '2026-09-01', to: '2026-09-30', amount: '300000', advanceAmount: '300000', createdById: 1 }).returning();
    await tx.insert(s.expenseReconciliationAdvances).values({ reconciliationId: batch.id, advanceRequestId: advance.id, amount: '300000' });
    assert.equal((await getAdvanceConsumedAmounts(tx, [advance.id])).get(advance.id), 500000);
    await tx.update(s.advanceSettlements).set({ status: 'REVERSED' }).where(eq(s.advanceSettlements.id, legacy.id));
    assert.equal((await getAdvanceConsumedAmounts(tx, [advance.id])).get(advance.id), 300000);
    await assert.rejects(validateSettlementInputs({ dbOrTx: tx, forwarderId: 1, advanceRequestIds: [advance.id], checkAlreadyLinked: true }), /được phân bổ/);
  });
});

for (const actualAmount of [800000, 1200000]) test(`OPS advance reconciliation ${actualAmount} records only actual partial settlements`, async () => {
  await fixture(async (tx, customerId, treasuryAccountId) => {
    const [ops] = await tx.insert(s.users).values({ username: crypto.randomUUID(), passwordHash: 'qa', role: Role.OPS, status: 'ACTIVE' }).returning();
    const actor = { userId: 1, role: Role.ACCOUNTANT };
    const fund = { treasuryAccountId, valueDate: '2026-09-16', physicalReference: crypto.randomUUID() };
    const advance = await recordFundedOpsAdvance(tx, actor, { ...fund, opsUserId: ops.id, amount: 1000000, reason: 'QA funded advance' });
    const [shipment] = await tx.insert(s.shipments).values({ customerId, shipmentCode: crypto.randomUUID() }).returning();
    const [expense] = await tx.insert(s.opsExpenseEntries).values({ shipmentId: shipment.id, expenseTypeCode: 'QA', amount: String(actualAmount), customerChargeAmount: '0',
      paidAt: fund.valueDate, paidById: ops.id, payerKind: 'USER', costGroup: 'OPS_REGULAR', feeName: 'QA actual expense' }).returning();
    const [source] = await tx.insert(s.expenseAccountingSources).values({ sourceKind: 'OPS', sourceId: expense.id, shipmentId: shipment.id, confirmedById: actor.userId, confirmedAt: new Date(), recordedById: ops.id }).returning();
    await LedgerService.postEntry(tx, { txnType: TxnType.VENDOR_EXPENSE, entityType: 'FORWARDER', entityId: ops.id, debit: actualAmount, credit: 0, receiptId: `EXPENSE_SOURCE:${source.id}` });
    const batch = await createExpenseReconciliation(tx, actor, { opsUserId: ops.id, from: '2026-09-01', to: '2026-09-30',
      entries: [{ sourceKind: 'OPS', sourceId: expense.id, expectedVersion: 1 }], advances: [{ advanceRequestId: advance.id, amount: 1000000 }] });
    const beforeCash = await getExpenseReconciliation(actor, batch.id, tx);
    assert.equal(beforeCash.remainingDifference, actualAmount - 1000000);
    assert.equal(beforeCash.paidAmount, 0); assert.equal(beforeCash.refundedAmount, 0);
    const voucher = actualAmount < 1000000
      ? await refundExpenseReconciliation(tx, actor, batch.id, { ...fund, physicalReference: crypto.randomUUID(), amount: 100000, reason: 'QA partial refund' })
      : await createExpenseVoucher(tx, actor, { ...fund, physicalReference: crypto.randomUUID(), direction: 'OUT', entries: [{ sourceKind: 'OPS', sourceId: expense.id, expectedVersion: 2, amount: 100000 }] });
    assert.equal((await getExpenseReconciliation(actor, batch.id, tx)).remainingDifference, actualAmount < 1000000 ? -100000 : 100000);
    await reverseExpenseVoucher(tx, actor, voucher.id, { expectedVersion: voucher.version, reason: 'QA reversal', valueDate: fund.valueDate, physicalReference: crypto.randomUUID() });
    assert.equal((await getExpenseReconciliation(actor, batch.id, tx)).remainingDifference, actualAmount - 1000000);
    await assert.rejects(createExpenseReconciliation(tx, actor, { opsUserId: ops.id, from: '2026-09-01', to: '2026-09-30',
      entries: [{ sourceKind: 'OPS', sourceId: expense.id, expectedVersion: 2 }], advances: [{ advanceRequestId: advance.id, amount: 1 }] }), /đã được phân bổ/);
  });
});

test('driver reimbursement uses the driver payable command and restores it on reversal without a second expense', async () => {
  await fixture(async (tx, customerId, treasuryAccountId) => {
    const actor = { userId: 1, role: Role.ACCOUNTANT };
    const [route] = await tx.insert(s.routes).values({ name: crypto.randomUUID() }).returning();
    const [cargo] = await tx.insert(s.cargoTypes).values({ name: crypto.randomUUID() }).returning();
    const [driver] = await tx.insert(s.drivers).values({ name: 'QA driver reimbursement' }).returning();
    const [shipment] = await tx.insert(s.shipments).values({ customerId, shipmentCode: crypto.randomUUID() }).returning();
    const trip = await insertTripComposite(tx, { tripCode: crypto.randomUUID(), customerId, routeId: route.id, cargoTypeId: cargo.id,
      shipmentId: shipment.id, driverId: driver.id, departureDate: '2026-09-16', status: 'COMPLETED', carrierType: 'OWN' });
    const [expense] = await tx.insert(s.driverIncidentalCosts).values({ tripId: trip.id, driverId: driver.id, costType: 'PARKING', amount: '200000',
      occurredAt: '2026-09-16', payerKind: 'USER', costGroup: 'DRIVER_ROAD', customerChargeAmount: '0' }).returning();
    const [source] = await tx.insert(s.expenseAccountingSources).values({ sourceKind: 'DRIVER', sourceId: expense.id, shipmentId: shipment.id,
      tripId: trip.id, confirmedAt: new Date(), confirmedById: actor.userId, recordedById: actor.userId }).returning();
    await LedgerService.postEntry(tx, { txnType: TxnType.VENDOR_EXPENSE, entityType: 'DRIVER', entityId: driver.id, debit: 0, credit: 200000, receiptId: `EXPENSE_SOURCE:${source.id}` });
    const voucher = await createExpenseVoucher(tx, actor, { direction: 'OUT', treasuryAccountId, valueDate: '2026-09-16', physicalReference: crypto.randomUUID(),
      entries: [{ sourceKind: 'DRIVER', sourceId: expense.id, expectedVersion: 1, amount: 100000 }] });
    const [entry] = await tx.select().from(s.ledger).where(eq(s.ledger.id, voucher.ledgerEntryId));
    assert.equal(entry.txnType, TxnType.DRIVER_PAYOUT); assert.equal(entry.debit, '100000');
    assert.equal(await LedgerService.getBalanceTx(tx, 'DRIVER', driver.id), 100000);
    await reverseExpenseVoucher(tx, actor, voucher.id, { expectedVersion: voucher.version, reason: 'QA reversal', valueDate: '2026-09-16', physicalReference: crypto.randomUUID() });
    assert.equal(await LedgerService.getBalanceTx(tx, 'DRIVER', driver.id), 200000);
    assert.equal((await tx.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.tripId, trip.id))).length, 1);
  });
});
