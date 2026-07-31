import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { and, eq, sql } from 'drizzle-orm';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import {
  DURABLE_EFFECT_KIND,
  DURABLE_EFFECT_STATUS,
  STORAGE_DELETE_MODE,
  armStorageCleanupGuard,
  cancelStorageCleanupGuard,
  claimDueDurableEffectJobs,
  enqueueDurableEffect,
  enqueueStorageDelete,
  markDurableEffectJobSucceeded,
  processDurableEffectJob,
  processDueDurableEffectJobs,
  releaseStorageCleanupGuard,
} from '../services/durable-effect.service';
import { storageService } from '../services/storage.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const scopePrefix = `durable-effect-${suffix}`;
const migrationUrl = new URL('../../drizzle/0157_durable_effect_jobs.sql', import.meta.url);
const createdAuditLogIds: number[] = [];
const createdBackfillJobIds: number[] = [];
const createdBillingDocumentIds: number[] = [];
const createdCustomerIds: number[] = [];
let originalCompanyLogoSetting: string | null = null;
let companyLogoSettingExisted = false;

before(async () => {
  const [row] = await db.select({ value: s.appSettings.value })
    .from(s.appSettings)
    .where(eq(s.appSettings.key, 'company.logo_storage_key'))
    .limit(1);
  originalCompanyLogoSetting = row?.value ?? null;
  companyLogoSettingExisted = Boolean(row);
});

beforeEach(async () => {
  await cleanupScopeJobs();
  await restoreCompanyLogoSetting();
});

describe('durable effect jobs foundation', () => {
  test('transactional enqueue commits once and rolls back with the domain transaction', async () => {
    const committedKey = `${scopePrefix}:commit-cache`;
    const rolledBackKey = `${scopePrefix}:rollback-cache`;

    await db.transaction(async (tx) => {
      await enqueueDurableEffect(tx, {
        kind: DURABLE_EFFECT_KIND.CACHE_INVALIDATE,
        payloadVersion: 1,
        dedupeKey: committedKey,
        payload: { key: 'catalogs:bootstrap' },
      });
      await enqueueDurableEffect(tx, {
        kind: DURABLE_EFFECT_KIND.CACHE_INVALIDATE,
        payloadVersion: 1,
        dedupeKey: committedKey,
        payload: { key: 'catalogs:bootstrap' },
      });
    });
    await assert.rejects(
      () => db.transaction(async (tx) => {
        await enqueueDurableEffect(tx, {
          kind: DURABLE_EFFECT_KIND.CACHE_INVALIDATE,
          payloadVersion: 1,
          dedupeKey: rolledBackKey,
          payload: { key: 'catalogs:bootstrap' },
        });
        throw new Error('rollback on purpose');
      }),
      /rollback on purpose/,
    );

    const committedRows = await db.select().from(s.durableEffectJobs)
      .where(eq(s.durableEffectJobs.dedupeKey, committedKey));
    const rolledBackRows = await db.select().from(s.durableEffectJobs)
      .where(eq(s.durableEffectJobs.dedupeKey, rolledBackKey));

    assert.equal(committedRows.length, 1);
    assert.equal(committedRows[0]!.status, DURABLE_EFFECT_STATUS.PENDING);
    assert.equal(rolledBackRows.length, 0);
  });

  test('cache invalidation retries on failure, replays safely, and stale lease tokens cannot acknowledge', async () => {
    const dedupeKey = `${scopePrefix}:cache-retry`;
    const now = new Date(Date.now() + 60_000);

    await db.transaction(async (tx) => {
      await enqueueDurableEffect(tx, {
        kind: DURABLE_EFFECT_KIND.CACHE_INVALIDATE,
        payloadVersion: 1,
        dedupeKey,
        payload: { key: 'reports:dashboard' },
      });
    });
    await db.update(s.durableEffectJobs)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(s.durableEffectJobs.dedupeKey, dedupeKey));

    let invalidateCalls = 0;
    const firstRun = await processDueDurableEffectJobs(10, {
      now: () => now,
      cacheInvalidateKey: async (key) => {
        if (key === 'reports:dashboard') {
          invalidateCalls += 1;
          throw new Error('redis unavailable');
        }
      },
    });
    const failed = firstRun.find((job) => job.dedupeKey === dedupeKey);
    assert.ok(failed, 'expected the targeted cache invalidation job to be processed');
    assert.equal(invalidateCalls, 1);
    assert.equal(failed.status, DURABLE_EFFECT_STATUS.RETRY);
    assert.match(failed.lastError ?? '', /redis unavailable/);
    assert.equal(failed.attemptCount, 1);

    await db.transaction(async (tx) => {
      await enqueueDurableEffect(tx, {
        kind: DURABLE_EFFECT_KIND.CACHE_INVALIDATE,
        payloadVersion: 1,
        dedupeKey,
        payload: { key: 'reports:dashboard' },
      });
    });
    const replayRows = await db.select().from(s.durableEffectJobs)
      .where(eq(s.durableEffectJobs.dedupeKey, dedupeKey));
    assert.equal(replayRows.length, 1, 'exact replay must not create a duplicate job');

    const reclaimedAt = new Date(now.getTime() + 5 * 60_000);
    await db.update(s.durableEffectJobs).set({
      status: DURABLE_EFFECT_STATUS.RUNNING,
      leaseToken: 'expired-worker',
      leaseExpiresAt: new Date(reclaimedAt.getTime() - 1),
      nextAttemptAt: new Date(reclaimedAt.getTime() - 1),
    }).where(eq(s.durableEffectJobs.id, failed.id));

    const claims = await claimDueDurableEffectJobs(10, {
      now: () => reclaimedAt,
      uuid: () => 'fresh-worker',
    });
    assert.equal(claims.length, 1);
    assert.equal(claims[0]!.leaseToken, 'fresh-worker');

    const secondClaims = await claimDueDurableEffectJobs(10, {
      now: () => reclaimedAt,
      uuid: () => 'second-worker',
    });
    assert.equal(secondClaims.length, 0, 'active lease must fence a second claimer');

    const staleAck = await markDurableEffectJobSucceeded(failed.id, 'expired-worker', reclaimedAt);
    assert.equal(staleAck, null, 'stale lease token must not acknowledge another worker row');

    let recoveredCalls = 0;
    const recovered = await processDurableEffectJob(claims[0]!, {
      now: () => reclaimedAt,
      cacheInvalidateKey: async () => {
        recoveredCalls += 1;
      },
    });
    assert.equal(recoveredCalls, 1);
    assert.equal(recovered.status, DURABLE_EFFECT_STATUS.SUCCEEDED);
    assert.equal(recovered.attemptCount, 2);
  });

  test('orphan guards delete leaked uploads, cancel durable owners, and explicit cancel fences the worker', async () => {
    const dueNow = new Date(Date.now() + 60_000);
    const leakedStorageKey = `${scopePrefix}/orphan/leaked.txt`;
    const leakedGuard = await armStorageCleanupGuard({
      dedupeKey: `${scopePrefix}:guard-orphan`,
      storageKey: leakedStorageKey,
      entityType: 'TEST_UPLOAD',
    });
    await storageService.upload(Buffer.from('orphan'), leakedStorageKey);
    const released = await releaseStorageCleanupGuard(leakedGuard, new Error('db rollback'));
    assert.equal(released, true);
    await db.update(s.durableEffectJobs)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(s.durableEffectJobs.id, leakedGuard.jobId));

    const processedLeak = await processDueDurableEffectJobs(10, {
      now: () => dueNow,
    });
    const leakJob = processedLeak.find((job) => job.id === leakedGuard.jobId);
    assert.equal(leakJob?.status, DURABLE_EFFECT_STATUS.SUCCEEDED);
    assert.equal(await storageService.exists(leakedStorageKey), false);

    const durableOwnerStorageKey = `${scopePrefix}/orphan/company-logo.txt`;
    const durableOwnerGuard = await armStorageCleanupGuard({
      dedupeKey: `${scopePrefix}:guard-owned`,
      storageKey: durableOwnerStorageKey,
      entityType: 'COMPANY_LOGO',
    });
    await storageService.upload(Buffer.from('logo'), durableOwnerStorageKey);
    await upsertCompanyLogoSetting(durableOwnerStorageKey);
    const releasedOwner = await releaseStorageCleanupGuard(durableOwnerGuard, new Error('process died'));
    assert.equal(releasedOwner, true);
    await db.update(s.durableEffectJobs)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(s.durableEffectJobs.id, durableOwnerGuard.jobId));

    const processedOwned = await processDueDurableEffectJobs(10, {
      now: () => new Date(dueNow.getTime() + 5 * 60_000),
    });
    const ownedJob = processedOwned.find((job) => job.id === durableOwnerGuard.jobId);
    assert.equal(ownedJob?.status, DURABLE_EFFECT_STATUS.CANCELLED);
    assert.equal(await storageService.exists(durableOwnerStorageKey), true);
    await restoreCompanyLogoSetting();
    await storageService.delete(durableOwnerStorageKey);

    const explicitCancelStorageKey = `${scopePrefix}/orphan/cancelled.txt`;
    const explicitCancelGuard = await armStorageCleanupGuard({
      dedupeKey: `${scopePrefix}:guard-explicit-cancel`,
      storageKey: explicitCancelStorageKey,
      entityType: 'TEST_UPLOAD',
    });
    await storageService.upload(Buffer.from('keep-me'), explicitCancelStorageKey);
    const cancelled = await db.transaction((tx) => cancelStorageCleanupGuard(tx, explicitCancelGuard));
    assert.equal(cancelled, true);

    const afterCancel = await processDueDurableEffectJobs(10, {
      now: () => new Date(dueNow.getTime() + 10 * 60_000),
    });
    assert.equal(afterCancel.find((job) => job.id === explicitCancelGuard.jobId), undefined);
    assert.equal(await storageService.exists(explicitCancelStorageKey), true);
    await storageService.delete(explicitCancelStorageKey);
  });

  test('final delete retries after storage failure and missing storage still succeeds', async () => {
    const failingStorageKey = `${scopePrefix}/final-delete/failing.txt`;
    await storageService.upload(Buffer.from('delete-me'), failingStorageKey);
    const failingDedupe = `${scopePrefix}:final-delete-failing`;

    await db.transaction(async (tx) => {
      await enqueueStorageDelete(tx, {
        dedupeKey: failingDedupe,
        payload: {
          storageKey: failingStorageKey,
          mode: STORAGE_DELETE_MODE.FINAL_DELETE,
          entityType: 'TEST_DELETE',
          entityId: 1,
        },
      });
    });
    const [failingJob] = await db.update(s.durableEffectJobs)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(s.durableEffectJobs.dedupeKey, failingDedupe))
      .returning();
    assert.ok(failingJob);

    let failingCalls = 0;
    const firstAttemptAt = new Date(Date.now() + 60_000);
    const firstRun = await processDueDurableEffectJobs(10, {
      now: () => firstAttemptAt,
      storageDelete: async () => {
        failingCalls += 1;
        throw new Error('storage offline');
      },
    });
    assert.equal(failingCalls, 1);
    assert.equal(
      firstRun.find((job) => job.id === failingJob.id)?.status,
      DURABLE_EFFECT_STATUS.RETRY,
    );
    assert.equal(await storageService.exists(failingStorageKey), true);

    await db.update(s.durableEffectJobs)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(s.durableEffectJobs.id, failingJob.id));
    const secondRun = await processDueDurableEffectJobs(10, {
      now: () => new Date(firstAttemptAt.getTime() + 5 * 60_000),
    });
    assert.equal(
      secondRun.find((job) => job.id === failingJob.id)?.status,
      DURABLE_EFFECT_STATUS.SUCCEEDED,
    );
    assert.equal(await storageService.exists(failingStorageKey), false);

    const missingStorageKey = `${scopePrefix}/final-delete/missing.txt`;
    await db.transaction(async (tx) => {
      await enqueueStorageDelete(tx, {
        dedupeKey: `${scopePrefix}:final-delete-missing`,
        payload: {
          storageKey: missingStorageKey,
          mode: STORAGE_DELETE_MODE.FINAL_DELETE,
        },
      });
    });
    await db.update(s.durableEffectJobs)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(s.durableEffectJobs.dedupeKey, `${scopePrefix}:final-delete-missing`));

    const missingRun = await processDueDurableEffectJobs(10, {
      now: () => new Date(firstAttemptAt.getTime() + 10 * 60_000),
    });
    const missingJob = missingRun.find((job) => job.dedupeKey === `${scopePrefix}:final-delete-missing`);
    assert.equal(missingJob?.status, DURABLE_EFFECT_STATUS.SUCCEEDED);
  });

  test('legal invoice timeout records UNKNOWN and the retry probes before issuing again', async () => {
    const payloadHash = 'a'.repeat(64);
    const [customer] = await db.insert(s.customers).values({
      name: `Durable invoice customer ${suffix}`,
    }).returning({ id: s.customers.id });
    createdCustomerIds.push(customer!.id);
    const [document] = await db.insert(s.billingDocuments).values({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: customer!.id,
      entityName: `Durable invoice customer ${suffix}`,
      rangeFrom: '2026-07-01',
      rangeTo: '2026-07-31',
      totalInclVat: '1000000',
      debitNoteStatus: 'CONFIRMED',
      version: 2,
      legalInvoiceRef: {
        provider: 'TEST_PROVIDER',
        status: 'PENDING',
        requestVersion: 2,
        payloadHash,
        updatedAt: new Date().toISOString(),
      },
    }).returning({ id: s.billingDocuments.id });
    createdBillingDocumentIds.push(document!.id);

    const dedupeKey = `${scopePrefix}:legal-invoice-timeout`;
    await db.transaction((tx) => enqueueDurableEffect(tx, {
      kind: DURABLE_EFFECT_KIND.LEGAL_INVOICE_HANDOFF,
      payloadVersion: 1,
      dedupeKey,
      payload: {
        documentId: document!.id,
        confirmedVersion: 2,
        provider: 'TEST_PROVIDER',
        payloadHash,
      },
    }));

    const firstAttemptAt = new Date(Date.now() + 60_000);
    let issueCalls = 0;
    const firstRun = await processDueDurableEffectJobs(10, {
      now: () => firstAttemptAt,
      legalInvoiceHandoff: async () => {
        issueCalls += 1;
        throw new Error('provider response timed out');
      },
    });
    const retry = firstRun.find((job) => job.dedupeKey === dedupeKey);
    assert.equal(issueCalls, 1);
    assert.equal(retry?.status, DURABLE_EFFECT_STATUS.RETRY);
    const [unknownDocument] = await db.select({ legalInvoiceRef: s.billingDocuments.legalInvoiceRef })
      .from(s.billingDocuments)
      .where(eq(s.billingDocuments.id, document!.id));
    assert.equal(unknownDocument?.legalInvoiceRef?.status, 'UNKNOWN');

    await db.update(s.durableEffectJobs).set({ nextAttemptAt: new Date(0) })
      .where(eq(s.durableEffectJobs.dedupeKey, dedupeKey));
    let probeCalls = 0;
    const secondRun = await processDueDurableEffectJobs(10, {
      now: () => new Date(firstAttemptAt.getTime() + 5 * 60_000),
      legalInvoiceHandoff: async () => {
        throw new Error('retry must not issue again after an ambiguous timeout');
      },
      legalInvoiceStatusProbe: async () => {
        probeCalls += 1;
        return {
          status: 'ISSUED',
          providerReference: 'INV-TEST-001',
          checksum: 'checksum-001',
          issuedAt: '2026-07-31T12:00:00.000Z',
        };
      },
    });
    assert.equal(probeCalls, 1);
    assert.equal(secondRun.find((job) => job.dedupeKey === dedupeKey)?.status, DURABLE_EFFECT_STATUS.SUCCEEDED);
    const [issuedDocument] = await db.select({ legalInvoiceRef: s.billingDocuments.legalInvoiceRef })
      .from(s.billingDocuments)
      .where(eq(s.billingDocuments.id, document!.id));
    assert.equal(issuedDocument?.legalInvoiceRef?.status, 'ISSUED');
    assert.equal(issuedDocument?.legalInvoiceRef?.providerReference, 'INV-TEST-001');
  });

  test('unknown kind or version becomes DEAD and migration backfills legacy cleanup audits', async () => {
    const [unknown] = await db.insert(s.durableEffectJobs).values({
      kind: 'BOGUS_KIND',
      payloadVersion: 9,
      dedupeKey: `${scopePrefix}:unknown`,
      payload: { ignored: true },
      status: DURABLE_EFFECT_STATUS.PENDING,
      maxAttempts: 1,
    }).returning();
    await db.update(s.durableEffectJobs)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(s.durableEffectJobs.id, unknown!.id));

    const deadRun = await processDueDurableEffectJobs(10, {
      now: () => new Date(Date.now() + 60_000),
    });
    const deadJob = deadRun.find((job) => job.id === unknown!.id);
    assert.equal(deadJob?.status, DURABLE_EFFECT_STATUS.DEAD);
    assert.match(deadJob?.lastError ?? '', /unsupported durable effect kind\/version/i);

    const [auditRow] = await db.insert(s.auditLogs).values({
      actorName: 'durable effect test',
      message: 'legacy cleanup pending',
      entityType: 'TEST_UPLOAD',
      entityId: 99,
      payload: {
        event: 'STORAGE_CLEANUP_PENDING',
        cleanupPending: true,
        storageKey: `${scopePrefix}/legacy/backfill.txt`,
      },
    }).returning({ id: s.auditLogs.id });
    createdAuditLogIds.push(auditRow!.id);

    await runMigrationBackfillStatement();

    const [backfilled] = await db.select().from(s.durableEffectJobs)
      .where(and(
        eq(s.durableEffectJobs.kind, DURABLE_EFFECT_KIND.STORAGE_DELETE),
        eq(s.durableEffectJobs.dedupeKey, `legacy-cleanup-audit:${auditRow!.id}`),
      ))
      .limit(1);
    assert.ok(backfilled, 'migration backfill should create a runnable job');
    createdBackfillJobIds.push(backfilled!.id);
    assert.equal(backfilled!.status, DURABLE_EFFECT_STATUS.PENDING);
    assert.deepEqual(backfilled!.payload, {
      storageKey: `${scopePrefix}/legacy/backfill.txt`,
      mode: STORAGE_DELETE_MODE.ORPHAN_GUARD,
      entityType: 'TEST_UPLOAD',
      entityId: 99,
    });
  });
});

after(async () => {
  await restoreCompanyLogoSetting();
  if (createdBackfillJobIds.length > 0) {
    await db.delete(s.durableEffectJobs)
      .where(sql`${s.durableEffectJobs.id} in (${sql.join(createdBackfillJobIds.map((id) => sql`${id}`), sql`, `)})`);
  }
  await db.delete(s.durableEffectJobs)
    .where(sql`${s.durableEffectJobs.dedupeKey} like ${`${scopePrefix}%`}`);
  if (createdAuditLogIds.length > 0) {
    await db.delete(s.auditLogs)
      .where(sql`${s.auditLogs.id} in (${sql.join(createdAuditLogIds.map((id) => sql`${id}`), sql`, `)})`);
  }
  if (createdBillingDocumentIds.length > 0) {
    await db.delete(s.billingDocuments)
      .where(sql`${s.billingDocuments.id} in (${sql.join(createdBillingDocumentIds.map((id) => sql`${id}`), sql`, `)})`);
  }
  if (createdCustomerIds.length > 0) {
    await db.delete(s.customers)
      .where(sql`${s.customers.id} in (${sql.join(createdCustomerIds.map((id) => sql`${id}`), sql`, `)})`);
  }
  await disconnectRedis();
  await client.end();
});

async function upsertCompanyLogoSetting(value: string): Promise<void> {
  const now = new Date();
  await db.insert(s.appSettings).values({
    key: 'company.logo_storage_key',
    value,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: s.appSettings.key,
    set: {
      value,
      updatedAt: now,
    },
  });
}

async function restoreCompanyLogoSetting(): Promise<void> {
  if (companyLogoSettingExisted) {
    const now = new Date();
    await db.insert(s.appSettings).values({
      key: 'company.logo_storage_key',
      value: originalCompanyLogoSetting ?? '',
      updatedAt: now,
    }).onConflictDoUpdate({
      target: s.appSettings.key,
      set: {
        value: originalCompanyLogoSetting ?? '',
        updatedAt: now,
      },
    });
    return;
  }
  await db.delete(s.appSettings).where(eq(s.appSettings.key, 'company.logo_storage_key'));
}

async function runMigrationBackfillStatement(): Promise<void> {
  const migrationSql = await readFile(migrationUrl, 'utf8');
  const backfillStatement = migrationSql
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  assert.ok(backfillStatement, 'expected backfill statement in migration file');
  await client.unsafe(backfillStatement);
}

async function cleanupScopeJobs(): Promise<void> {
  await db.delete(s.durableEffectJobs)
    .where(sql`${s.durableEffectJobs.dedupeKey} like ${`${scopePrefix}%`}`);
}
