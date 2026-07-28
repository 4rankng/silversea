import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { TxnType } from '@tingting/shared';
import {
  requestPaymentRefundGovernance,
} from '../services/payment-allocation.service';
import {
  approveDirectMoneyGovernanceAction,
  checkGovernanceAction,
} from '../services/governance-transition.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: number[] = [];
const governanceActionIds: number[] = [];
const ledgerIds: number[] = [];
let customerId: number | null = null;
let paymentReceiptId: number | null = null;

after(async () => {
  try {
    if (paymentReceiptId != null) {
      await db.delete(s.paymentRefunds).where(eq(s.paymentRefunds.paymentReceiptId, paymentReceiptId));
    }
    if (governanceActionIds.length > 0) {
      await db.delete(s.governanceActions)
        .where(inArray(s.governanceActions.id, governanceActionIds));
    }
    if (paymentReceiptId != null) {
      await db.delete(s.paymentReceipts).where(eq(s.paymentReceipts.id, paymentReceiptId));
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
  const checker = await createUser('MANAGER');
  const approver = await createUser('ADMIN');
  const [customer] = await db.insert(s.customers).values({
    name: `Q03 refund customer ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  customerId = customer.id;

  const [receipt] = await db.insert(s.paymentReceipts).values({
    receiptId: `Q03-REFUND-${suffix}`.slice(0, 100),
    customerId: customer.id,
    receivedAmount: '10000000',
    allocatedTotal: '0',
    unappliedAmount: '10000000',
    refundedAmount: '0',
    allocationMethod: 'OLDEST_DUE',
    requestHash: 'a'.repeat(64),
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

  const requested = await requestPaymentRefundGovernance({
    paymentReceiptId: receipt.id,
    amount: 4_000_000,
    reason: 'Khách chuyển thừa và gửi yêu cầu hoàn tiền',
    makerId: maker.id,
    makerRole: maker.role,
  });
  governanceActionIds.push(requested.id);
  assert.equal(requested.status, 'PENDING_CHECK');

  await assert.rejects(
    () => checkGovernanceAction({
      actionId: requested.id,
      checkerId: maker.id,
      checkerRole: maker.role,
      expectedVersion: requested.version,
    }),
    (error: Error & { statusCode?: number }) => error.statusCode === 403,
  );

  const checked = await checkGovernanceAction({
    actionId: requested.id,
    checkerId: checker.id,
    checkerRole: checker.role,
    expectedVersion: requested.version,
  });
  const approved = await approveDirectMoneyGovernanceAction({
    actionId: requested.id,
    approverId: approver.id,
    approverRole: approver.role,
    expectedVersion: checked.version,
  });
  assert.equal(approved.status, 'APPROVED');

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
    .where(eq(s.paymentRefunds.governanceActionId, requested.id));
  assert.equal(Number(refund.amount), 4_000_000);
  assert.equal(refund.createdBy, maker.id);
  assert.equal(refund.approvedBy, approver.id);
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

  await assert.rejects(
    () => approveDirectMoneyGovernanceAction({
      actionId: requested.id,
      approverId: approver.id,
      approverRole: approver.role,
      expectedVersion: checked.version,
    }),
    (error: Error & { statusCode?: number }) => error.statusCode === 409,
    'stale replay cannot post a duplicate refund',
  );
});
