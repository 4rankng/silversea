import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { db, client } from '../db';
import * as s from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import { disconnectRedis } from '../lib/redis';
import financialRoutes from '../routes/financial';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';

const app = express();
app.use(express.json());
app.use('/api', authMiddleware, casbinAuthz('financial'), financialRoutes);
app.use(globalErrorHandler);

let server: http.Server;
let baseUrl: string;
let adminToken: string;
let accountantToken: string;
let driverToken: string;

before(async () => {
  await initAuditService();
  await initEnforcer();

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const address = server.address() as AddressInfo;
      baseUrl = `http://localhost:${address.port}`;
      resolve();
    });
  });

  // Fetch admin and driver users (create mock ones if needed, or query existing ones).
  // Filter to ACTIVE rows: leftover INACTIVE users from other suites would
  // fail authMiddleware's status re-check with a 401.
  let [adm] = await db.select().from(s.users).where(and(eq(s.users.role, Role.ADMIN), eq(s.users.status, 'ACTIVE'))).limit(1);
  if (!adm) {
    [adm] = await db.insert(s.users).values({
      username: 'test_admin_export',
      passwordHash: 'dummy',
      role: Role.ADMIN,
      status: 'ACTIVE',
    }).returning();
  }

  let [acc] = await db.select().from(s.users).where(and(eq(s.users.role, Role.ACCOUNTANT), eq(s.users.status, 'ACTIVE'))).limit(1);
  if (!acc) {
    [acc] = await db.insert(s.users).values({
      username: 'test_acc_export',
      passwordHash: 'dummy',
      role: Role.ACCOUNTANT,
      status: 'ACTIVE',
    }).returning();
  }

  let [drv] = await db.select().from(s.users).where(and(eq(s.users.role, Role.DRIVER), eq(s.users.status, 'ACTIVE'))).limit(1);
  if (!drv) {
    [drv] = await db.insert(s.users).values({
      username: 'test_drv_export',
      passwordHash: 'dummy',
      role: Role.DRIVER,
      status: 'ACTIVE',
    }).returning();
  }

  adminToken = jwt.sign({ userId: adm.id, username: adm.username, role: Role.ADMIN }, config.jwtSecret);
  accountantToken = jwt.sign({ userId: acc.id, username: acc.username, role: Role.ACCOUNTANT }, config.jwtSecret);
  driverToken = jwt.sign({ userId: drv.id, username: drv.username, role: Role.DRIVER }, config.jwtSecret);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await client.end();
  await disconnectRedis();
});

test('GET /api/reports/receivables-aging/export — Access control & Excel generation', async () => {
  // 1. ADMIN should be allowed
  const adminRes = await fetch(`${baseUrl}/api/reports/receivables-aging/export`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });
  assert.strictEqual(adminRes.status, 200);
  assert.strictEqual(
    adminRes.headers.get('Content-Type'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  const disposition = adminRes.headers.get('Content-Disposition') || '';
  assert.ok(disposition.includes('attachment; filename="cong-no-phai-thu-'));
  assert.ok(disposition.includes('.xlsx'));

  const buffer = await adminRes.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  assert.ok(bytes.length > 0);
  // Zip file signature check (xlsx files are zips starting with 'PK' / [0x50, 0x4B])
  assert.strictEqual(bytes[0], 0x50);
  assert.strictEqual(bytes[1], 0x4B);

  // 2. ACCOUNTANT should be allowed
  const accRes = await fetch(`${baseUrl}/api/reports/receivables-aging/export`, {
    headers: {
      Authorization: `Bearer ${accountantToken}`,
    },
  });
  assert.strictEqual(accRes.status, 200);

  // 3. DRIVER should be denied (403 Forbidden via casbin/role)
  const drvRes = await fetch(`${baseUrl}/api/reports/receivables-aging/export`, {
    headers: {
      Authorization: `Bearer ${driverToken}`,
    },
  });
  assert.ok(drvRes.status === 403 || drvRes.status === 401);
});
