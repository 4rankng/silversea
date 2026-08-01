import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { TxnType } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import {
  getTreasuryPosition,
  requestTreasuryMovementReversal,
} from '../services/treasury.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: number[] = [];
const ledgerIds: number[] = [];
const movementIds: number[] = [];
const actionIds: number[] = [];
let accountId: number | null = null;

after(async () => {
  try {
    if (movementIds.length > 0) {
      await db.delete(s.treasuryMovements).where(inArray(s.treasuryMovements.id, movementIds));
    }
    if (actionIds.length > 0) {
      await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, actionIds));
    }
    if (accountId != null) {
      await db.delete(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, accountId));
    }
    if (ledgerIds.length > 0) {
      await db.delete(s.ledger).where(inArray(s.ledger.id, ledgerIds));
    }
    if (userIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, userIds));
    }
  } finally {
    await client.end();
  }
});

test('source-linked treasury movements fail closed outside the owning reversal workflow', async () => {
  const users = await db.insert(s.users).values([
    { username: `treasury-maker-${suffix}`, passwordHash: 'x', role: 'ACCOUNTANT', status: 'ACTIVE' },
    { username: `treasury-checker-${suffix}`, passwordHash: 'x', role: 'MANAGER', status: 'ACTIVE' },
    { username: `treasury-approver-${suffix}`, passwordHash: 'x', role: 'ADMIN', status: 'ACTIVE' },
  ]).returning();
  userIds.push(...users.map(user => user.id));
  const [maker] = users;

  const [account] = await db.insert(s.treasuryAccounts).values({
    code: `REV-${suffix}`.slice(0, 50),
    name: `Treasury reversal ${suffix}`,
    type: 'BANK',
    currency: 'VND',
    openingBalance: '0',
    openingBalanceDate: '2026-07-31',
    cutoverAt: new Date('2026-07-01T00:00:00.000Z'),
    status: 'ACTIVE',
    createdBy: maker.id,
    updatedBy: maker.id,
  }).returning();
  accountId = account.id;

  for (const direction of ['IN', 'OUT'] as const) {
    const [ledger] = await db.insert(s.ledger).values({
      entityType: 'COMPANY',
      entityId: 0,
      txnType: TxnType.ADJUSTMENT,
      txnId: direction === 'IN' ? 1 : 2,
      debit: direction === 'OUT' ? '100' : '0',
      credit: direction === 'IN' ? '100' : '0',
      balance: '0',
      note: `Treasury ${direction} reversal source`,
    }).returning();
    ledgerIds.push(ledger.id);

    const [original] = await db.insert(s.treasuryMovements).values({
      treasuryAccountId: account.id,
      direction,
      amount: '100',
      valueDate: '2026-07-31',
      status: 'POSTED',
      ledgerEntryId: ledger.id,
      sourceVersion: 1,
      paymentContractVersion: 2,
      physicalReference: `${direction}-${suffix}`.slice(0, 160),
      createdBy: maker.id,
    }).returning();
    movementIds.push(original.id);

    const before = await getTreasuryPosition(account.id);

    await assert.rejects(
      () => requestTreasuryMovementReversal({
        movementId: original.id,
        expectedVersion: original.sourceVersion,
        reason: `Đảo lại giao dịch ${direction}`,
        reversalEvidence: `evidence-replay-${direction}-${suffix}`,
        makerId: maker.id,
        makerRole: maker.role,
      }),
      (error: Error & { statusCode?: number }) => error.statusCode === 409,
    );
    const [immutableOriginal] = await db.select().from(s.treasuryMovements)
      .where(eq(s.treasuryMovements.id, original.id)).limit(1);
    assert.equal(immutableOriginal.status, 'POSTED');
    assert.equal(immutableOriginal.reversalOfId, null);
    const afterPosition = await getTreasuryPosition(account.id);
    assert.equal(afterPosition.bookBalance, before.bookBalance);
    const [immutableLedger] = await db.select().from(s.ledger)
      .where(eq(s.ledger.id, ledger.id)).limit(1);
    assert.equal(Number(immutableLedger.debit), direction === 'OUT' ? 100 : 0);
    assert.equal(Number(immutableLedger.credit), direction === 'IN' ? 100 : 0);
  }
});
