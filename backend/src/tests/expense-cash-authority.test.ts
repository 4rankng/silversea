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

// Case QA-2026-09-24-01 (approval-precedes-payment, payer scope split): the
// cash-voucher chain pays APPROVED sources only — the refusal names the
// unapproved fees, never a bare kind-id, and allocations decrement the
// source's remaining to the đồng.
test('t5: the cash voucher refuses an unapproved DRIVER source and names the fee, not the id', async () => {
  await fixture(async (tx, customerId, treasuryAccountId) => {
    const actor = { userId: 1, role: Role.ACCOUNTANT };
    const [route] = await tx.insert(s.routes).values({ name: crypto.randomUUID() }).returning();
    const [cargo] = await tx.insert(s.cargoTypes).values({ name: crypto.randomUUID() }).returning();
    const [driver] = await tx.insert(s.drivers).values({ name: 'QA driver unapproved payout probe' }).returning();
    const [shipment] = await tx.insert(s.shipments).values({ customerId, shipmentCode: crypto.randomUUID() }).returning();
    const trip = await insertTripComposite(tx, { tripCode: crypto.randomUUID(), customerId, routeId: route.id, cargoTypeId: cargo.id,
      shipmentId: shipment.id, driverId: driver.id, departureDate: '2026-09-16', status: 'COMPLETED', carrierType: 'OWN' });
    const [expense] = await tx.insert(s.driverIncidentalCosts).values({ tripId: trip.id, driverId: driver.id, costType: 'PARKING', amount: '200000',
      occurredAt: '2026-09-16', payerKind: 'USER', costGroup: 'DRIVER_ROAD', customerChargeAmount: '0', feeName: 'Phí giữ xe kiểm thử' }).returning();
    await tx.insert(s.expenseAccountingSources).values({ sourceKind: 'DRIVER', sourceId: expense.id, shipmentId: shipment.id,
      tripId: trip.id, confirmedAt: null, recordedById: actor.userId }).returning();
    await assert.rejects(
      () => createExpenseVoucher(tx, actor, { direction: 'OUT', treasuryAccountId, valueDate: '2026-09-16', physicalReference: crypto.randomUUID(),
        entries: [{ sourceKind: 'DRIVER', sourceId: expense.id, expectedVersion: 1, amount: 100000 }] }),
      (error: unknown) => {
        assert.match((error as Error).message, /Phí giữ xe kiểm thử/);
        assert.doesNotMatch((error as Error).message, /DRIVER-\d/);
        return true;
      },
      'the refusal names the unapproved fee, never a bare kind-id',
    );
  });
});

test('t6: the payout consumes approved-only money — allocations decrement the remaining', async () => {
  await fixture(async (tx, customerId, treasuryAccountId) => {
    const actor = { userId: 1, role: Role.ACCOUNTANT };
    const [route] = await tx.insert(s.routes).values({ name: crypto.randomUUID() }).returning();
    const [cargo] = await tx.insert(s.cargoTypes).values({ name: crypto.randomUUID() }).returning();
    const [driver] = await tx.insert(s.drivers).values({ name: 'QA driver approved payout' }).returning();
    const [shipment] = await tx.insert(s.shipments).values({ customerId, shipmentCode: crypto.randomUUID() }).returning();
    const trip = await insertTripComposite(tx, { tripCode: crypto.randomUUID(), customerId, routeId: route.id, cargoTypeId: cargo.id,
      shipmentId: shipment.id, driverId: driver.id, departureDate: '2026-09-16', status: 'COMPLETED', carrierType: 'OWN' });
    const [expense] = await tx.insert(s.driverIncidentalCosts).values({ tripId: trip.id, driverId: driver.id, costType: 'PARKING', amount: '300000',
      occurredAt: '2026-09-16', payerKind: 'USER', costGroup: 'DRIVER_ROAD', customerChargeAmount: '0', feeName: 'Phí đường kiểm thử' }).returning();
    const [source] = await tx.insert(s.expenseAccountingSources).values({ sourceKind: 'DRIVER', sourceId: expense.id, shipmentId: shipment.id,
      tripId: trip.id, confirmedAt: new Date(), confirmedById: actor.userId, recordedById: actor.userId }).returning();
    await LedgerService.postEntry(tx, { txnType: TxnType.VENDOR_EXPENSE, entityType: 'DRIVER', entityId: driver.id, debit: 0, credit: 300000, receiptId: `EXPENSE_SOURCE:${source.id}` });
    await createExpenseVoucher(tx, actor, { direction: 'OUT', treasuryAccountId, valueDate: '2026-09-16', physicalReference: crypto.randomUUID(),
      entries: [{ sourceKind: 'DRIVER', sourceId: expense.id, expectedVersion: 1, amount: 100000 }] });
    const allocations = await tx.select({ amount: s.expenseCashAllocations.amount }).from(s.expenseCashAllocations)
      .where(eq(s.expenseCashAllocations.expenseAccountingSourceId, source.id));
    assert.equal(String(allocations[0]!.amount), '100000', 'the allocation lands at the paid amount');
    await assert.rejects(
      createExpenseVoucher(tx, actor, { direction: 'OUT', treasuryAccountId, valueDate: '2026-09-16', physicalReference: crypto.randomUUID(),
        entries: [{ sourceKind: 'DRIVER', sourceId: expense.id, expectedVersion: source.version + 1, amount: 250000 }] }),
      /chỉ còn 200000/,
      'the second payout caps at the cash-adjusted remaining',
    );
  });
});

// Case QA-2026-09-24-01 correction (Director payer-split ruling round 3):

// Card 20260927_147 — the basket's receivable state is now read once per call instead of
// once per item. These two cases pin what a wrong batch would break.
test('t7: one basket on two trips caps each trip against its OWN receivable state', async () => {
  await fixture(async (tx, customerId, treasuryAccountId) => {
    const [route] = await tx.insert(s.routes).values({ name: crypto.randomUUID() }).returning();
    const [cargo] = await tx.insert(s.cargoTypes).values({ name: crypto.randomUUID() }).returning();
    const tripA = await insertTripComposite(tx, { tripCode: crypto.randomUUID(), customerId, routeId: route.id, cargoTypeId: cargo.id,
      departureDate: '2026-09-16', status: 'COMPLETED', carrierType: 'OWN' });
    const tripB = await insertTripComposite(tx, { tripCode: crypto.randomUUID(), customerId, routeId: route.id, cargoTypeId: cargo.id,
      departureDate: '2026-09-16', status: 'COMPLETED', carrierType: 'OWN' });
    await LedgerService.postEntry(tx, { txnType: TxnType.TRIP_REVENUE, txnId: tripA.id, entityType: 'CUSTOMER', entityId: customerId,
      debit: 300_000, credit: 0, receiptId: `TRIP:${tripA.tripCode}` });
    await LedgerService.postEntry(tx, { txnType: TxnType.TRIP_REVENUE, txnId: tripB.id, entityType: 'CUSTOMER', entityId: customerId,
      debit: 100_000, credit: 0, receiptId: `TRIP:${tripB.tripCode}` });
    const receipt = await recordPaymentReceiptTx(tx, { customerId, treasuryAccountId, receiptId: crypto.randomUUID(),
      physicalReference: crypto.randomUUID(), valueDate: '2026-09-16', amount: 250_000, allocatedBy: 1, unappliedOnly: true });
    const mapping = await allocateExpenseReceipt(tx, receipt.id, [
      { source: { id: 901, customerId, tripId: tripA.id, linkedTripExpenseId: null }, amount: 150_000 },
      { source: { id: 902, customerId, tripId: tripB.id, linkedTripExpenseId: null }, amount: 100_000 },
    ], 1);
    assert.ok(mapping.get(901), 'the first item maps to an allocation');
    assert.ok(mapping.get(902), 'the second item maps to an allocation');
    assert.notEqual(mapping.get(901), mapping.get(902), 'the two trips never collapse into one allocation');
    const rows = await tx.select().from(s.paymentAllocations).where(eq(s.paymentAllocations.customerId, customerId));
    assert.deepEqual(rows.map(row => `${row.targetType}:${row.targetId}:${row.sourceTripId}:${row.amount}`).sort(),
      [`TRIP:${tripA.id}:${tripA.id}:150000`, `TRIP:${tripB.id}:${tripB.id}:100000`].sort(),
      'each trip keeps its own target — never the first trip of the basket');
    const second = await recordPaymentReceiptTx(tx, { customerId, treasuryAccountId, receiptId: crypto.randomUUID(),
      physicalReference: crypto.randomUUID(), valueDate: '2026-09-16', amount: 500_000, allocatedBy: 1, unappliedOnly: true });
    await assert.rejects(allocateExpenseReceipt(tx, second.id,
      [{ source: { id: 903, customerId, tripId: tripB.id, linkedTripExpenseId: null }, amount: 1 }], 1), /vượt số dư/,
      'trip B is exhausted by its own 100k');
    await allocateExpenseReceipt(tx, second.id,
      [{ source: { id: 904, customerId, tripId: tripA.id, linkedTripExpenseId: null }, amount: 150_000 }], 1);
    await assert.rejects(allocateExpenseReceipt(tx, second.id,
      [{ source: { id: 905, customerId, tripId: tripA.id, linkedTripExpenseId: null }, amount: 1 }], 1), /vượt số dư/,
      'trip A is exhausted at its own 150k remainder, not at trip B\'s');
  });
});

test('t8: a group that credits a trip makes the next group on that trip re-read the balance', async () => {
  await fixture(async (tx, customerId, treasuryAccountId) => {
    const [route] = await tx.insert(s.routes).values({ name: crypto.randomUUID() }).returning();
    const [cargo] = await tx.insert(s.cargoTypes).values({ name: crypto.randomUUID() }).returning();
    const trip = await insertTripComposite(tx, { tripCode: crypto.randomUUID(), customerId, routeId: route.id, cargoTypeId: cargo.id,
      departureDate: '2026-09-16', status: 'COMPLETED', carrierType: 'OWN' });
    await LedgerService.postEntry(tx, { txnType: TxnType.TRIP_REVENUE, txnId: trip.id, entityType: 'CUSTOMER', entityId: customerId,
      debit: 300_000, credit: 0, receiptId: `TRIP:${trip.tripCode}` });
    const [expense] = await tx.insert(s.tripExpenses).values({ tripId: trip.id, expenseType: 'QA', buyAmount: '200000', sellAmount: '100000',
      settlementMethod: 'COMPANY_DIRECT' }).returning();
    const [document] = await tx.insert(s.billingDocuments).values({ type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: customerId,
      rangeFrom: '2026-09-01', rangeTo: '2026-09-30', totalInclVat: '100000', debitNoteStatus: 'SENT' }).returning();
    await tx.insert(s.billingDocumentLines).values({ documentId: document.id, sourceType: 'EXPENSE', sourceId: expense.id,
      lineType: 'SERVICE_FEE', description: 'QA doc-billed expense', baseAmount: '100000' });
    const receipt = await recordPaymentReceiptTx(tx, { customerId, treasuryAccountId, receiptId: crypto.randomUUID(),
      physicalReference: crypto.randomUUID(), valueDate: '2026-09-16', amount: 350_000, allocatedBy: 1, unappliedOnly: true });
    // Group 1 settles the debit note and thereby credits trip T's ledger with 100k;
    // group 2 settles the trip itself. 250k fits the stale 300k snapshot but not the
    // live 200k, so a snapshot-only batch would weaken this cap.
    await assert.rejects(allocateExpenseReceipt(tx, receipt.id, [
      { source: { id: 911, customerId, tripId: trip.id, linkedTripExpenseId: expense.id }, amount: 100_000 },
      { source: { id: 912, customerId, tripId: trip.id, linkedTripExpenseId: null }, amount: 250_000 },
    ], 1), /vượt số dư/);
    // Control: the live remainder really is 200k (300k revenue − 100k credited above).
    const mapping = await allocateExpenseReceipt(tx, receipt.id,
      [{ source: { id: 914, customerId, tripId: trip.id, linkedTripExpenseId: null }, amount: 200_000 }], 1);
    assert.ok(mapping.get(914)!);
  });
});
