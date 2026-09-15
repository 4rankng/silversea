import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { Role, TxnType } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { applyGovernanceActionDirect, buildGovernanceAction } from '../services/governance-action-core.service';
import { runIdempotent } from '../services/idempotency.service';
import { LedgerService } from '../services/ledger.service';

const tag = `direct-audit-${Date.now()}`;
let userId: number;
let customerId: number;
let malformedEvidence = true;

test('direct financial action atomically persists original evidence and retries once after audit serialization failure', async () => {
  const [user] = await db.insert(s.users).values({ username: tag, passwordHash: 'test-only', role: Role.ADMIN }).returning();
  const [customer] = await db.insert(s.customers).values({ name: tag }).returning();
  userId = user.id; customerId = customer.id;
  const key = `${tag}-operation`;
  const command = () => runIdempotent({
    endpoint: 'qa.direct-financial-audit', idempotencyKey: key,
    payload: { customerId, amount: 100 }, createdBy: userId, entityType: 'customer',
    getEntityId: () => customerId,
    create: tx => applyGovernanceActionDirect({
      action: buildGovernanceAction({ actionKind: 'COMPANY_EXPENSE', subjectType: 'COMPANY_EXPENSE', subjectId: customerId, subjectKey: tag, makerId: userId, makerRole: Role.ADMIN, reason: 'Correct supplier debt', originalVersion: 7,
        beforeSnapshot: malformedEvidence ? { amount: BigInt(0) } : { amount: 0 }, afterSnapshot: { amount: 100 }, deltaSnapshot: { amount: 100 },
      }), actorId: userId, actorRole: Role.ADMIN, transaction: tx,
      apply: async transaction => {
        await transaction.update(s.customers).set({ name: `${tag}-changed` }).where(eq(s.customers.id, customerId));
        const entry = await LedgerService.postEntry(transaction, { txnType: TxnType.ADJUSTMENT, txnId: customerId, entityType: 'CUSTOMER', entityId: customerId, debit: 100, credit: 0, note: tag });
        return { ledgerEntryId: entry.id, applicationResult: { customerId, amount: 100 } };
      },
    }),
  });
  await assert.rejects(command(), /BigInt|serializ/i);
  const [unchanged] = await db.select().from(s.customers).where(eq(s.customers.id, customerId));
  assert.equal(unchanged.name, tag);
  const ledgerRows = () => db.select().from(s.ledger).where(and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, customerId)));
  const auditRows = () => db.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityType, 'financial-action'), eq(s.auditLogs.entityId, customerId)));
  assert.equal((await ledgerRows()).length, 0);
  assert.equal((await auditRows()).length, 0);
  malformedEvidence = false;
  const first = await command();
  const replay = await command();
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  const entries = await ledgerRows(); const audits = await auditRows();
  assert.equal(entries.length, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].userId, userId);
  const evidence = audits[0].payload!;
  assert.equal(evidence.event, 'FINANCIAL_ACTION_APPLIED');
  assert.equal(evidence.actionKind, 'COMPANY_EXPENSE');
  assert.equal(evidence.reason, 'Correct supplier debt');
  assert.equal(evidence.originalVersion, 7);
  assert.deepEqual(evidence.beforeSnapshot, { amount: 0 });
  assert.deepEqual(evidence.afterSnapshot, { amount: 100 });
  assert.deepEqual(evidence.deltaSnapshot, { amount: 100 });
  assert.equal(evidence.actorId, userId);
  assert.equal(evidence.ledgerEntryId, entries[0].id);
  assert.deepEqual(evidence.applicationResult, { customerId, amount: 100 });
});

test('unauthorized direct action never executes an adapter or writes applied audit', async () => {
  let applied = false;
  await assert.rejects(applyGovernanceActionDirect({
    action: buildGovernanceAction({ actionKind: 'COMPANY_EXPENSE', subjectType: 'COMPANY_EXPENSE', subjectId: customerId, makerId: userId, makerRole: Role.DRIVER }),
    actorId: userId, actorRole: Role.DRIVER, apply: async () => { applied = true; },
  }), /quyền/);
  assert.equal(applied, false);
  const audits = await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityType, 'financial-action'), eq(s.auditLogs.entityId, customerId)));
  assert.equal(audits.length, 1);
});

after(async () => {
  try {
    if (userId) {
      await db.delete(s.idempotencyKeys).where(eq(s.idempotencyKeys.createdBy, userId));
      await db.delete(s.auditLogs).where(eq(s.auditLogs.userId, userId));
      await db.delete(s.users).where(eq(s.users.id, userId));
    }
    if (customerId) {
      await db.delete(s.ledger).where(and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, customerId)));
      await db.delete(s.customers).where(eq(s.customers.id, customerId));
    }
  } finally { await disconnectRedis(); await client.end(); }
});
