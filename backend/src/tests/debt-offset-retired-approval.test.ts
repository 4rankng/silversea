import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import express from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { Role, TxnType } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import routes from '../routes/financial/debt-offsets.routes';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';

const tag = `retired-offset-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let server: http.Server;
let baseUrl: string;
let actorId: number;
let customerId: number;
let supplierId: number;
let offsetId: number;
let ledgerIds: number[] = [];

before(async () => {
  const [actor] = await db.insert(s.users).values({ username: tag, passwordHash: 'test-only', role: Role.ADMIN }).returning();
  actorId = actor.id;
  const [customer] = await db.insert(s.customers).values({ name: tag }).returning();
  customerId = customer.id;
  const [supplier] = await db.insert(s.suppliers).values({ name: tag }).returning();
  supplierId = supplier.id;
  const [offset] = await db.insert(s.debtOffsets).values({ customerId, supplierId, amount: '100', offsetDate: '2026-09-15', createdBy: actorId, approvalStatus: 'PENDING', note: tag }).returning();
  offsetId = offset.id;
  const entries = await db.insert(s.ledger).values([
    { entityType: 'CUSTOMER' as const, entityId: customerId, txnType: TxnType.TRIP_REVENUE, txnId: offsetId, debit: '100', credit: '0', balance: '100', note: tag },
    { entityType: 'VENDOR' as const, entityId: supplierId, txnType: TxnType.VENDOR_EXPENSE, txnId: offsetId, debit: '0', credit: '100', balance: '100', note: tag },
  ]).returning({ id: s.ledger.id });
  ledgerIds = entries.map(row => row.id);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { userId: actorId, username: tag, fullName: tag, email: null, role: String(req.header('X-Test-Role') || Role.ADMIN) as Role };
    next();
  });
  app.use('/api', routes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test('retired debt-offset approval returns 410 without changing offset, balances, ledger, audit or idempotency state', async () => {
  const snapshot = async () => ({
    offset: await db.select().from(s.debtOffsets).where(eq(s.debtOffsets.id, offsetId)),
    customerLedger: await db.select().from(s.ledger).where(and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, customerId))),
    supplierLedger: await db.select().from(s.ledger).where(and(eq(s.ledger.entityType, 'VENDOR'), eq(s.ledger.entityId, supplierId))),
    audit: await db.select().from(s.auditLogs).where(eq(s.auditLogs.userId, actorId)),
    commands: await db.select().from(s.idempotencyKeys).where(eq(s.idempotencyKeys.createdBy, actorId)),
  });
  const original = await snapshot();
  for (const role of [Role.ADMIN, Role.MANAGER]) {
    const response = await fetch(`${baseUrl}/api/finance/debt-offsets/${offsetId}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test-Role': role, 'Idempotency-Key': `${tag}-${role}` },
      body: JSON.stringify({ expectedVersion: 1, reason: 'Retired client attempt' }),
    });
    assert.equal(response.status, 410);
    assert.match((await response.json()).error, /loại bỏ/);
    assert.deepEqual(await snapshot(), original);
  }
});

after(async () => {
  try {
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    if (offsetId) await db.delete(s.debtOffsets).where(eq(s.debtOffsets.id, offsetId));
    if (ledgerIds.length) await db.delete(s.ledger).where(inArray(s.ledger.id, ledgerIds));
    if (customerId) await db.delete(s.customers).where(eq(s.customers.id, customerId));
    if (supplierId) await db.delete(s.suppliers).where(eq(s.suppliers.id, supplierId));
    if (actorId) await db.delete(s.users).where(eq(s.users.id, actorId));
  } finally { await disconnectRedis(); await client.end(); }
});
