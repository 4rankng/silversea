/**
 * Master-import batch read path (P6): GET /api/config/master-data-imports/:id.
 * Pins the DTO shape, admin-only access, and 400/404 paths. Apply/reject
 * workflows are covered by their own suites; this file only pins the read.
 */
import { before, after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { db, client } from '../db';
import * as s from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import { disconnectRedis } from '../lib/redis';
import configRoutes from '../routes/config';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminToken = '';
let driverToken = '';
let adminUserId = 0;
let driverUserId = 0;
let batchId = 0;
const rowIds: number[] = [];

const app = express();
app.use(express.json());
app.use('/api', authMiddleware, casbinAuthz('config'), configRoutes);
app.use(globalErrorHandler);

let server: http.Server;
let baseUrl = '';

interface TestFetchOptions { token?: string; }
async function testFetch(urlPath: string, options: TestFetchOptions = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

before(async () => {
  await initAuditService();
  await initEnforcer();
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const [adm] = await db.insert(s.users).values({
    username: `mimport-admin-${suffix}`, passwordHash: 'x',
    role: Role.ADMIN, status: 'ACTIVE',
  }).returning();
  const [drv] = await db.insert(s.users).values({
    username: `mimport-driver-${suffix}`, passwordHash: 'x',
    role: Role.DRIVER, status: 'ACTIVE',
  }).returning();
  adminUserId = adm.id;
  driverUserId = drv.id;
  adminToken = jwt.sign({ userId: adm.id, username: adm.username, role: Role.ADMIN }, config.jwtSecret);
  driverToken = jwt.sign({ userId: drv.id, username: drv.username, role: Role.DRIVER }, config.jwtSecret);

  const [batch] = await db.insert(s.masterImportBatches).values({
    sourceFileName: `master-import-${suffix}.xlsx`,
    sourceFileHash: `hash-${suffix}`,
    parserVersion: 'test-v1',
    status: 'ANALYZED',
    summary: { ACCEPTED: 2 },
    analyzedBy: adm.id,
  }).returning();
  batchId = batch.id;
  const rows = await db.insert(s.masterImportRowResults).values([
    { batchId, sheetName: 'Customers', rowNumber: 1, entityType: 'customer', classification: 'ACCEPTED' },
    { batchId, sheetName: 'Customers', rowNumber: 2, entityType: 'customer', classification: 'ACCEPTED' },
  ]).returning();
  rowIds.push(...rows.map((r) => r.id));
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    if (rowIds.length > 0) await db.delete(s.masterImportRowResults).where(inArray(s.masterImportRowResults.id, rowIds));
    if (batchId) await db.delete(s.masterImportBatches).where(eq(s.masterImportBatches.id, batchId));
    const userIds = [adminUserId, driverUserId].filter((id) => id > 0);
    if (userIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, userIds));
  } catch (err) { console.warn('[master-import-read] cleanup:', (err as Error).message); }
  await disconnectRedis();
  await client.end();
});

describe('master-import batch read path', () => {
  test('403 for a non-admin actor (service-level requireAdmin)', async () => {
    const res = await testFetch(`/api/config/master-data-imports/${batchId}`, { token: driverToken });
    assert.equal(res.status, 403);
  });

  test('404 for an unknown batch id', async () => {
    const res = await testFetch('/api/config/master-data-imports/2147483000', { token: adminToken });
    assert.equal(res.status, 404);
  });

  test('400 for a non-integer batch id', async () => {
    const res = await testFetch('/api/config/master-data-imports/abc', { token: adminToken });
    assert.equal(res.status, 400);
  });

  test('200 returns the batch DTO with redacted row outcomes', async () => {
    const res = await testFetch(`/api/config/master-data-imports/${batchId}`, { token: adminToken });
    assert.equal(res.status, 200);
    const body = res.body as {
      id: number; sourceFileName: string; status: string; summary: Record<string, number>;
      warningCodes: string[]; version: number; rows: Array<{ sheetName: string; rowNumber: number; classification: string; appliedEntityType: string | null }>;
    };
    assert.equal(body.id, batchId);
    assert.equal(body.status, 'ANALYZED');
    assert.equal(body.version, 1);
    assert.deepEqual(body.summary, { ACCEPTED: 2 });
    assert.deepEqual(body.warningCodes, []);
    assert.equal(body.rows.length, 2);
    for (const row of body.rows) {
      assert.equal(row.sheetName, 'Customers');
      assert.equal(row.classification, 'ACCEPTED');
      assert.equal(row.appliedEntityType, null);
    }
  });
});
