import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, or } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { TxnType } from '@tingting/shared';
import {
  applyPaymentRefundGovernanceAction,
  requestPaymentRefundGovernance,
} from '../services/payment-allocation.service';
import { autoApplyGovernanceAction } from '../services/adjustment-governance.service';
import { applyDirectMoneyGovernanceAction } from '../services/governance-transition.service';
import { applyGovernanceActionDirect } from '../services/governance-action-core.service';
import { getTreasuryPosition } from '../services/treasury.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: number[] = [];
const ledgerIds: number[] = [];
let customerId: number | null = null;
let paymentReceiptId: number | null = null;
let treasuryAccountId: number | null = null;
let treasuryMovementId: number | null = null;

after(async () => {
  try {
    if (treasuryMovementId != null) {
      await db.delete(s.treasuryMovements).where(
        or(
          eq(s.treasuryMovements.id, treasuryMovementId),
          eq(s.treasuryMovements.reversalOfId, treasuryMovementId),
        ),
      );
    }
    if (paymentReceiptId != null) {
      await db.delete(s.paymentRefunds).where(eq(s.paymentRefunds.paymentReceiptId, paymentReceiptId));
    }
    if (paymentReceiptId != null) {
      await db.delete(s.paymentReceipts).where(eq(s.paymentReceipts.id, paymentReceiptId));
    }
    if (treasuryAccountId != null) {
      await db.delete(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, treasuryAccountId));
    }
    if (ledgerIds.length > 0) {
      await db.delete(s.ledger).where(inArray(s.ledger.id, ledgerIds));
    }
    if (customerId != null) {
      await db.delete(s.customers).where(eq(s.customers.id, customerId));
    }
    if (userIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, userIds));
    }
  } finally {
    await client.end();
  }
});

async function createUser(role: 'ADMIN' | 'MANAGER' | 'ACCOUNTANT') {
  const [user] = await db.insert(s.users).values({
    username: `q03-refund-${role}-${suffix}`,
    passwordHash: 'x',
    role,
    status: 'ACTIVE',
  }).returning();
  userIds.push(user.id);
  return user;
}

test('Q03 refunds only unapplied credit through distinct maker, checker, and approver', async () => {
  const maker = await createUser('ACCOUNTANT');
  await createUser('MANAGER');
  await createUser('ADMIN');
  const [customer] = await db.insert(s.customers).values({
    name: `Q03 refund customer ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  customerId = customer.id;

  const [treasuryAccount] = await db.insert(s.treasuryAccounts).values({
    code: `Q03-${suffix}`.slice(0, 50),
    name: `Q03 refund treasury ${suffix}`,
    type: 'BANK',
    currency: 'VND',
    openingBalance: '0',
    openingBalanceDate: '2026-07-31',
    cutoverAt: new Date('2026-07-01T00:00:00.000Z'),
    status: 'ACTIVE',
    createdBy: maker.id,
    updatedBy: maker.id,
  }).returning();
  treasuryAccountId = treasuryAccount.id;

  const [receipt] = await db.insert(s.paymentReceipts).values({
    receiptId: `Q03-REFUND-${suffix}`.slice(0, 100),
    customerId: customer.id,
    receivedAmount: '10000000',
    allocatedTotal: '0',
    unappliedAmount: '10000000',
    refundedAmount: '0',
    allocationMethod: 'OLDEST_DUE',
    requestHash: 'a'.repeat(64),
    treasuryAccountId: treasuryAccount.id,
    valueDate: '2026-07-31',
    physicalReference: `Q03 RECEIPT ${suffix}`.slice(0, 160),
    paymentContractVersion: 2,
    createdBy: maker.id,
    version: 1,
  }).returning();
  paymentReceiptId = receipt.id;

  const [initialLedger] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER',
    entityId: customer.id,
    txnType: TxnType.PAYMENT_RECEIVED,
    txnId: receipt.id,
    receiptId: receipt.receiptId,
    debit: '0',
    credit: '10000000',
    balance: '-10000000',
    note: 'Q03 unapplied receipt fixture',
  }).returning();
  ledgerIds.push(initialLedger.id);

  const [treasuryMovement] = await db.insert(s.treasuryMovements).values({
    treasuryAccountId: treasuryAccount.id,
    direction: 'IN',
    amount: '10000000',
    valueDate: '2026-07-31',
    status: 'POSTED',
    paymentReceiptId: receipt.id,
    sourceVersion: receipt.version,
    paymentContractVersion: 2,
    physicalReference: `Q03 RECEIPT ${suffix}`.slice(0, 160),
    externalReference: receipt.receiptId,
    createdBy: maker.id,
  }).returning();
  treasuryMovementId = treasuryMovement.id;

  await assert.rejects(
    () => requestPaymentRefundGovernance({
      paymentReceiptId: receipt.id,
      amount: 10_000_001,
      reason: 'Vượt số tiền chưa phân bổ',
      makerId: maker.id,
      makerRole: maker.role,
    }),
    (error: Error & { statusCode?: number }) =>
      error.statusCode === 409 && /vượt quá khoản chưa phân bổ/i.test(error.message),
  );

  const requested = await autoApplyGovernanceAction({
    make: () => requestPaymentRefundGovernance({
      paymentReceiptId: receipt.id,
      amount: 4_000_000,
      reason: 'Khách chuyển thừa và gửi yêu cầu hoàn tiền',
      makerId: maker.id,
      makerRole: maker.role,
    }),
    actorId: maker.id,
    actorRole: maker.role,
    apply: applyDirectMoneyGovernanceAction,
  });
  assert.equal(requested.status, 'APPROVED');
  assert.equal(requested.approverId, maker.id);

  const [updatedReceipt] = await db.select().from(s.paymentReceipts)
    .where(eq(s.paymentReceipts.id, receipt.id));
  assert.equal(Number(updatedReceipt.unappliedAmount), 6_000_000);
  assert.equal(Number(updatedReceipt.refundedAmount), 4_000_000);
  assert.equal(updatedReceipt.version, 2);
  assert.equal(
    Number(updatedReceipt.receivedAmount),
    Number(updatedReceipt.allocatedTotal)
      + Number(updatedReceipt.unappliedAmount)
      + Number(updatedReceipt.refundedAmount),
  );

  const [refund] = await db.select().from(s.paymentRefunds)
    .where(eq(s.paymentRefunds.paymentReceiptId, receipt.id));
  assert.equal(Number(refund.amount), 4_000_000);
  assert.equal(refund.createdBy, maker.id);
  assert.equal(refund.approvedBy, maker.id);
  ledgerIds.push(refund.ledgerEntryId);

  const [refundLedger] = await db.select().from(s.ledger)
    .where(and(
      eq(s.ledger.id, refund.ledgerEntryId),
      eq(s.ledger.entityType, 'CUSTOMER'),
    ));
  assert.equal(refundLedger.txnType, TxnType.ADJUSTMENT);
  assert.equal(Number(refundLedger.debit), 4_000_000);
  assert.equal(Number(refundLedger.credit), 0);
  assert.equal(Number(refundLedger.balance), -6_000_000);

  const firstRefundMovements = await db.select().from(s.treasuryMovements)
    .where(eq(s.treasuryMovements.reversalOfId, treasuryMovement.id));
  assert.equal(firstRefundMovements.length, 1);
  assert.equal(firstRefundMovements[0].direction, 'OUT');
  assert.equal(Number(firstRefundMovements[0].amount), 4_000_000);
  assert.equal(firstRefundMovements[0].ledgerEntryId, refund.ledgerEntryId);
  assert.equal(firstRefundMovements[0].sourceVersion, 2);

  const [immutableOriginal] = await db.select().from(s.treasuryMovements)
    .where(eq(s.treasuryMovements.id, treasuryMovement.id));
  assert.equal(immutableOriginal.status, 'POSTED');

  // Staging mechanics are gone: re-running the apply stage against the already
  // applied action must refuse — the receipt version has moved on — instead of
  // replaying a parked approval row.
  await assert.rejects(
    () => applyGovernanceActionDirect({
      action: requested,
      actorId: maker.id,
      actorRole: maker.role,
      apply: applyPaymentRefundGovernanceAction,
    }),
    (error: Error & { statusCode?: number }) => error.statusCode === 409,
    'stale replay cannot post a duplicate refund',
  );

  const secondRequested = await autoApplyGovernanceAction({
    make: () => requestPaymentRefundGovernance({
      paymentReceiptId: receipt.id,
      amount: 2_000_000,
      reason: 'Hoàn tiếp phần tiền chưa phân bổ còn lại',
      makerId: maker.id,
      makerRole: maker.role,
    }),
    actorId: maker.id,
    actorRole: maker.role,
    apply: applyDirectMoneyGovernanceAction,
  });
  assert.equal(secondRequested.status, 'APPROVED');

  const refunds = await db.select().from(s.paymentRefunds)
    .where(eq(s.paymentRefunds.paymentReceiptId, receipt.id));
  assert.equal(refunds.length, 2);
  ledgerIds.push(...refunds.map(row => row.ledgerEntryId).filter(id => !ledgerIds.includes(id)));

  const refundMovements = await db.select().from(s.treasuryMovements)
    .where(eq(s.treasuryMovements.reversalOfId, treasuryMovement.id));
  assert.equal(refundMovements.length, 2);
  assert.deepEqual(
    refundMovements.map(row => Number(row.amount)).sort((a, b) => a - b),
    [2_000_000, 4_000_000],
  );
  assert.deepEqual(
    refundMovements.map(row => row.sourceVersion).sort((a, b) => a - b),
    [2, 3],
  );

  const position = await getTreasuryPosition(treasuryAccount.id);
  assert.equal(position.totalIn, 10_000_000);
  assert.equal(position.totalOut, 6_000_000);
  assert.equal(position.bookBalance, 4_000_000);
});
