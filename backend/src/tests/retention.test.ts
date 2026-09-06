import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { inArray } from 'drizzle-orm';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import {
  runRetentionSweeps,
  sweepDurableEffectJobs,
  sweepMasterImportRowResults,
  sweepNotifications,
  sweepSchedulerRunLogs,
} from '../services/retention.service';

// Retention rules under test (see retention.service.ts policy header):
//   notifications       read > 30d OR any > 180d
//   scheduler_run_logs  started > 30d
//   durable_effect_jobs SUCCEEDED and created > 30d
//   import rows         created > 90d
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdNotificationIds: number[] = [];
const createdJobIds: number[] = [];
const createdLogIds: number[] = [];
const createdImportRowIds: number[] = [];
const createdBatchIds: number[] = [];

after(async () => {
  // Rows the sweeps intentionally keep are removed here.
  if (createdNotificationIds.length) {
    await db.delete(s.notifications).where(inArray(s.notifications.id, createdNotificationIds));
  }
  if (createdJobIds.length) {
    await db.delete(s.durableEffectJobs).where(inArray(s.durableEffectJobs.id, createdJobIds));
  }
  if (createdLogIds.length) {
    await db.delete(s.schedulerRunLogs).where(inArray(s.schedulerRunLogs.id, createdLogIds));
  }
  if (createdImportRowIds.length) {
    await db.delete(s.masterImportRowResults).where(inArray(s.masterImportRowResults.id, createdImportRowIds));
  }
  if (createdBatchIds.length) {
    await db.delete(s.masterImportBatches).where(inArray(s.masterImportBatches.id, createdBatchIds));
  }
  await disconnectRedis();
  await client.end();
});

describe('retention sweeps', () => {
  test('notifications: read>30d or any>180d deleted; fresh and unread-recent kept', async () => {
    const [user] = await db.select({ id: s.users.id }).from(s.users).limit(1);
    assert.ok(user, 'test requires at least one user');

    const inserted = await db.insert(s.notifications).values([
      { userId: user.id, type: 'SYSTEM_ANNOUNCEMENT' as const, title: `ret-old-read-${suffix}`, message: 'x', isRead: true, createdAt: daysAgo(40) },
      { userId: user.id, type: 'SYSTEM_ANNOUNCEMENT' as const, title: `ret-fresh-read-${suffix}`, message: 'x', isRead: true, createdAt: daysAgo(10) },
      { userId: user.id, type: 'SYSTEM_ANNOUNCEMENT' as const, title: `ret-ancient-unread-${suffix}`, message: 'x', isRead: false, createdAt: daysAgo(200) },
      { userId: user.id, type: 'SYSTEM_ANNOUNCEMENT' as const, title: `ret-fresh-unread-${suffix}`, message: 'x', isRead: false, createdAt: daysAgo(10) },
    ]).returning({ id: s.notifications.id, title: s.notifications.title });
    createdNotificationIds.push(...inserted.map(r => r.id));

    const result = await sweepNotifications();
    assert.equal(result.table, 'notifications');
    assert.ok(result.deleted >= 2, 'sweep reports the rows it removed');

    const survivors = await db.select({ id: s.notifications.id, title: s.notifications.title })
      .from(s.notifications)
      .where(inArray(s.notifications.id, createdNotificationIds));
    const survivorTitles = new Set(survivors.map(r => r.title));
    assert.ok(!survivorTitles.has(`ret-old-read-${suffix}`), 'read + 40d old must be deleted');
    assert.ok(!survivorTitles.has(`ret-ancient-unread-${suffix}`), 'unread + 200d old must be deleted');
    assert.ok(survivorTitles.has(`ret-fresh-read-${suffix}`), 'read + 10d old must survive');
    assert.ok(survivorTitles.has(`ret-fresh-unread-${suffix}`), 'unread + 10d old must survive');
  });

  test('scheduler_run_logs: started>30d deleted, recent kept', async () => {
    const inserted = await db.insert(s.schedulerRunLogs).values([
      { jobName: `ret-old-${suffix}`, cron: '* * * * *', status: 'SUCCESS' as const, startedAt: daysAgo(40) },
      { jobName: `ret-fresh-${suffix}`, cron: '* * * * *', status: 'SUCCESS' as const, startedAt: daysAgo(10) },
    ]).returning({ id: s.schedulerRunLogs.id, jobName: s.schedulerRunLogs.jobName });
    createdLogIds.push(...inserted.map(r => r.id));

    const result = await sweepSchedulerRunLogs();
    assert.equal(result.table, 'scheduler_run_logs');
    assert.ok(result.deleted >= 1);

    const survivors = await db.select({ jobName: s.schedulerRunLogs.jobName })
      .from(s.schedulerRunLogs)
      .where(inArray(s.schedulerRunLogs.id, createdLogIds));
    assert.deepEqual(survivors.map(r => r.jobName), [`ret-fresh-${suffix}`]);
  });

  test('durable_effect_jobs: only SUCCEEDED>30d deleted; PENDING-old and fresh kept', async () => {
    const inserted = await db.insert(s.durableEffectJobs).values([
      { kind: 'CACHE_INVALIDATE', dedupeKey: `ret-ok-old-${suffix}`, payload: {}, status: 'SUCCEEDED', createdAt: daysAgo(40), nextAttemptAt: daysAgo(40) },
      { kind: 'CACHE_INVALIDATE', dedupeKey: `ret-ok-fresh-${suffix}`, payload: {}, status: 'SUCCEEDED', createdAt: daysAgo(10), nextAttemptAt: daysAgo(10) },
      { kind: 'CACHE_INVALIDATE', dedupeKey: `ret-pending-old-${suffix}`, payload: {}, status: 'PENDING', createdAt: daysAgo(40), nextAttemptAt: daysAgo(40) },
    ]).returning({ id: s.durableEffectJobs.id, dedupeKey: s.durableEffectJobs.dedupeKey });
    createdJobIds.push(...inserted.map(r => r.id));

    const result = await sweepDurableEffectJobs();
    assert.equal(result.table, 'durable_effect_jobs');
    assert.ok(result.deleted >= 1);

    const survivors = await db.select({ dedupeKey: s.durableEffectJobs.dedupeKey })
      .from(s.durableEffectJobs)
      .where(inArray(s.durableEffectJobs.id, createdJobIds));
    const keys = new Set(survivors.map(r => r.dedupeKey));
    assert.ok(!keys.has(`ret-ok-old-${suffix}`), 'SUCCEEDED + 40d must be deleted');
    assert.ok(keys.has(`ret-ok-fresh-${suffix}`), 'SUCCEEDED + 10d must survive');
    assert.ok(keys.has(`ret-pending-old-${suffix}`), 'PENDING must never be swept regardless of age');
  });

  test('master_import_row_results: created>90d deleted, recent kept', async () => {
    const [user] = await db.select({ id: s.users.id }).from(s.users).limit(1);
    assert.ok(user, 'test requires at least one user');
    const [batch] = await db.insert(s.masterImportBatches).values({
      sourceFileName: `ret-${suffix}.xlsx`,
      sourceFileHash: `ret-${suffix}`,
      parserVersion: 'test',
      analyzedBy: user.id,
    }).returning({ id: s.masterImportBatches.id });
    createdBatchIds.push(batch.id);

    const inserted = await db.insert(s.masterImportRowResults).values([
      { batchId: batch.id, sheetName: 'KH', rowNumber: 1, entityType: 'CUSTOMER', classification: 'ACCEPTED', createdAt: daysAgo(100) },
      { batchId: batch.id, sheetName: 'KH', rowNumber: 2, entityType: 'CUSTOMER', classification: 'ACCEPTED', createdAt: daysAgo(10) },
    ]).returning({ id: s.masterImportRowResults.id, rowNumber: s.masterImportRowResults.rowNumber });
    createdImportRowIds.push(...inserted.map(r => r.id));

    const result = await sweepMasterImportRowResults();
    assert.equal(result.table, 'master_import_row_results');
    assert.ok(result.deleted >= 1);

    const survivors = await db.select({ rowNumber: s.masterImportRowResults.rowNumber })
      .from(s.masterImportRowResults)
      .where(inArray(s.masterImportRowResults.id, createdImportRowIds));
    assert.deepEqual(survivors.map(r => r.rowNumber), [2]);
  });

  test('runRetentionSweeps returns one result per table', async () => {
    const results = await runRetentionSweeps();
    assert.deepEqual(results.map(r => r.table), [
      'notifications',
      'scheduler_run_logs',
      'durable_effect_jobs',
      'master_import_row_results',
    ]);
    for (const r of results) assert.ok(Number.isFinite(r.deleted) && r.deleted >= 0);
  });
});
