import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { and, eq, inArray, or, sql } from 'drizzle-orm';

import { Role, TxnType } from '@tingting/shared';
import { initEnforcer } from '../casbin/enforcer';
import { config } from '../config';
import { client, db } from '../db';
import * as s from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { auditLogMiddleware } from '../middleware/audit';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';
import paymentsRoutes from '../routes/financial/payments.routes';
import penaltiesRoutes from '../routes/financial/penalties.routes';
import { ApiError } from '../errors';
import { LedgerService } from '../services/ledger.service';
import { registerAuditEvent } from '../services/audit-registry';
import { initAuditService } from '../services/audit.service';
import { AuditEvent } from '../services/audit-types';
import { initNotificationService } from '../services/notification.service';
import { createPenalty } from '../services/financial.service';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../services/idempotency.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdUserIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdCarrierIds: number[] = [];
const createdDriverIds: number[] = [];
const createdPenaltyIds: number[] = [];
const createdNotificationIds: number[] = [];
const createdAuditLogIds: number[] = [];

let makerUserId = 0;
let makerToken = '';
let checkerToken = '';
let approverToken = '';
let server: http.Server;
let baseUrl = '';
const overlongIdempotencyKey = 'k'.repeat(101);

function sign(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign(
    { userId: user.id, username: user.username ?? `${user.id}`, role: user.role as Role },
    config.jwtSecret,
  );
}

async function mkUser(username: string, role: Role) {
  const [user] = await db.insert(s.users).values({
    username,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

async function mkSupplier() {
  const [supplier] = await db.insert(s.suppliers).values({
    name: `Q23 supplier ${suffix}-${createdSupplierIds.length}`,
  }).returning();
  createdSupplierIds.push(supplier.id);
  return supplier;
}

async function mkCarrier() {
  const [carrier] = await db.insert(s.customers).values({
    name: `Q23 carrier ${suffix}-${createdCarrierIds.length}`,
    isCarrier: true,
  }).returning();
  createdCarrierIds.push(carrier.id);
  return carrier;
}

async function mkDriver() {
  const user = await mkUser(`q23-driver-${suffix}-${createdDriverIds.length}`, Role.DRIVER);
  const [driver] = await db.insert(s.drivers).values({
    userId: user.id,
    name: `Q23 driver ${suffix}-${createdDriverIds.length}`,
  }).returning();
  createdDriverIds.push(driver.id);
  return driver;
}

async function seedVendorPayable(supplierId: number, amount: number, note = 'q23 vendor payable') {
  return (await db.insert(s.ledger).values({
    entityType: 'VENDOR',
    entityId: supplierId,
    txnType: TxnType.COMMISSION,
    txnId: 0,
    debit: '0',
    credit: String(amount),
    balance: String(amount),
    note,
    timestamp: new Date('2026-07-27T00:00:00+07:00'),
  }).returning())[0];
}

async function seedCarrierPayable(carrierId: number, amount: number, note = 'q23 carrier payable') {
  return (await db.insert(s.ledger).values({
    entityType: 'CUSTOMER',
    entityId: carrierId,
    txnType: TxnType.EXTERNAL_CARRIER_COST,
    txnId: 0,
    debit: '0',
    credit: String(amount),
    balance: String(-amount),
    note,
    timestamp: new Date('2026-07-27T00:00:00+07:00'),
  }).returning())[0];
}

async function seedDriverPayable(driverId: number, amount: number, note = 'q23 driver payable') {
  return (await db.insert(s.ledger).values({
    entityType: 'DRIVER',
    entityId: driverId,
    txnType: TxnType.DRIVER_SALARY,
    txnId: 0,
    debit: '0',
    credit: String(amount),
    balance: String(amount),
    note,
    timestamp: new Date('2026-07-27T00:00:00+07:00'),
  }).returning())[0];
}

async function postJson(
  path: string,
  body: Record<string, unknown>,
  options: { idempotencyKey?: string; actor?: 'maker' | 'checker' | 'approver' } = {},
) {
  const url = new URL(path, baseUrl);
  const actor = options.actor ?? 'maker';
  const token = actor === 'checker'
    ? checkerToken
    : actor === 'approver'
      ? approverToken
      : makerToken;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  const payload = JSON.stringify(body);

  return new Promise<{ status: number; data: Record<string, unknown> }>((resolve, reject) => {
    const request = http.request({
      host: url.hostname,
      port: Number(url.port),
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      agent: false,
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(payload).toString(),
        Connection: 'close',
      },
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        try {
          const data = raw ? JSON.parse(raw) as Record<string, unknown> : {};
          resolve({ status: response.statusCode ?? 0, data });
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

function trackGovernanceActionId(data: Record<string, unknown>) {
  // Transient direct-money records carry per-process synthetic ids; there is
  // no governance row to track or clean up anymore.
  return Number(data.id);
}

async function fetchIdempotencyCount(endpoint: string, key: string) {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.idempotencyKeys)
    .where(and(
      eq(s.idempotencyKeys.endpoint, endpoint),
      eq(s.idempotencyKeys.idempotencyKey, key),
    ));
  return Number(total ?? 0);
}

async function fetchLedgerCount(args: {
  entityType: 'VENDOR' | 'CARRIER' | 'DRIVER';
  entityId: number;
  txnType: TxnType;
  receiptId?: string;
  txnId?: number;
}) {
  const clauses = [
    eq(s.ledger.entityId, args.entityId),
    eq(s.ledger.txnType, args.txnType),
  ];
  if (args.receiptId) clauses.push(eq(s.ledger.receiptId, args.receiptId));
  if (args.txnId !== undefined) clauses.push(eq(s.ledger.txnId, args.txnId));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.ledger)
    .where(and(...clauses));
  return Number(total ?? 0);
}

async function fetchPenaltyLedgerCounts(penaltyId: number, driverId: number) {
  const rows = await db.select({
    txnType: s.ledger.txnType,
  }).from(s.ledger).where(and(
    eq(s.ledger.entityType, 'DRIVER'),
    eq(s.ledger.entityId, driverId),
    eq(s.ledger.txnId, penaltyId),
  ));
  return {
    penaltyRows: rows.filter((row) => row.txnType === TxnType.PENALTY).length,
    reversalRows: rows.filter((row) => row.txnType === TxnType.ADJUSTMENT).length,
  };
}

async function fetchPenaltyStatus(penaltyId: number) {
  const [row] = await db.select({ status: s.penalties.status })
    .from(s.penalties)
    .where(eq(s.penalties.id, penaltyId))
    .limit(1);
  return row?.status;
}

async function fetchPenaltyCount(customReason: string) {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.penalties)
    .where(eq(s.penalties.customReason, customReason));
  return Number(total ?? 0);
}

async function fetchNotificationCount(entityType: string, entityId: number) {
  const rows = await db.select({ id: s.notifications.id })
    .from(s.notifications)
    .where(and(
      eq(s.notifications.relatedEntityType, entityType),
      eq(s.notifications.relatedEntityId, entityId),
    ));
  for (const row of rows) {
    if (!createdNotificationIds.includes(row.id)) createdNotificationIds.push(row.id);
  }
  return rows.length;
}

async function fetchNotificationRecipients(entityType: string, entityId: number) {
  const rows = await db.select({
    id: s.notifications.id,
    userId: s.notifications.userId,
  }).from(s.notifications)
    .where(and(
      eq(s.notifications.relatedEntityType, entityType),
      eq(s.notifications.relatedEntityId, entityId),
    ))
    .orderBy(s.notifications.id);
  for (const row of rows) {
    if (!createdNotificationIds.includes(row.id)) createdNotificationIds.push(row.id);
  }
  return rows.map((row) => row.userId);
}

async function waitForNotificationCount(entityType: string, entityId: number, expectedAtLeast: number) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const count = await fetchNotificationCount(entityType, entityId);
    if (count >= expectedAtLeast) return count;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return fetchNotificationCount(entityType, entityId);
}

async function fetchVendorAudit(receiptId: string) {
  const rows = await db.select({
    id: s.auditLogs.id,
    event: sql<string>`${s.auditLogs.payload}->>'event'`,
    outcome: sql<string | null>`${s.auditLogs.payload}->>'outcome'`,
    statusCode: sql<number>`coalesce((${s.auditLogs.payload}->>'statusCode')::int, 0)`,
    idempotencyKeyPresent: sql<boolean>`coalesce((${s.auditLogs.payload}->>'idempotencyKeyPresent')::boolean, false)`,
  }).from(s.auditLogs).where(and(
    sql`${s.auditLogs.payload}->>'path' = '/api/payments/vendor'`,
    sql`${s.auditLogs.payload}->'body'->>'receiptId' = ${receiptId}`,
  )).orderBy(s.auditLogs.id);
  for (const row of rows) {
    if (!createdAuditLogIds.includes(row.id)) createdAuditLogIds.push(row.id);
  }
  return rows;
}

async function fetchCarrierAudit(receiptId: string) {
  const rows = await db.select({
    id: s.auditLogs.id,
    outcome: sql<string | null>`${s.auditLogs.payload}->>'outcome'`,
    statusCode: sql<number>`coalesce((${s.auditLogs.payload}->>'statusCode')::int, 0)`,
    idempotencyKeyPresent: sql<boolean>`coalesce((${s.auditLogs.payload}->>'idempotencyKeyPresent')::boolean, false)`,
  }).from(s.auditLogs).where(and(
    sql`${s.auditLogs.payload}->>'path' = '/api/payments/carrier'`,
    sql`${s.auditLogs.payload}->'body'->>'receiptId' = ${receiptId}`,
  )).orderBy(s.auditLogs.id);
  for (const row of rows) {
    if (!createdAuditLogIds.includes(row.id)) createdAuditLogIds.push(row.id);
  }
  return rows;
}

async function fetchPenaltyCancelAudit(reason: string) {
  const rows = await db.select({
    id: s.auditLogs.id,
    event: sql<string>`${s.auditLogs.payload}->>'event'`,
    outcome: sql<string | null>`${s.auditLogs.payload}->>'outcome'`,
    statusCode: sql<number>`coalesce((${s.auditLogs.payload}->>'statusCode')::int, 0)`,
    idempotencyKeyPresent: sql<boolean>`coalesce((${s.auditLogs.payload}->>'idempotencyKeyPresent')::boolean, false)`,
  }).from(s.auditLogs).where(and(
    sql`${s.auditLogs.payload}->>'path' like '/api/penalties/%/cancel'`,
    sql`${s.auditLogs.payload}->'body'->>'reason' = ${reason}`,
  )).orderBy(s.auditLogs.id);
  for (const row of rows) {
    if (!createdAuditLogIds.includes(row.id)) createdAuditLogIds.push(row.id);
  }
  return rows;
}

before(async () => {
  initNotificationService();
  initAuditService();
  await initEnforcer();
  registerAuditEvent('POST', '/api/payments/receive', AuditEvent.PAYMENT_RECEIVED);
  registerAuditEvent('POST', '/api/penalties', AuditEvent.PENALTY_CREATED);
  registerAuditEvent('POST', '/api/penalties/', '/cancel', AuditEvent.PENALTY_CANCELED);
  registerAuditEvent('POST', '/api/payments/vendor', AuditEvent.PAYMENT_RECEIVED);
  registerAuditEvent('POST', '/api/payments/carrier', AuditEvent.PAYMENT_RECEIVED);

  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware, auditLogMiddleware, casbinAuthz('financial'));
  app.use('/api', paymentsRoutes);
  app.use('/api', penaltiesRoutes);
  app.use(globalErrorHandler);

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const maker = await mkUser(`q23-maker-${suffix}`, Role.ACCOUNTANT);
  const checker = await mkUser(`q23-checker-${suffix}`, Role.MANAGER);
  const approver = await mkUser(`q23-approver-${suffix}`, Role.ADMIN);
  makerUserId = maker.id;
  makerToken = sign(maker);
  checkerToken = sign(checker);
  approverToken = sign(approver);
});

after(async () => {
  try {
    if (createdUserIds.length > 0) {
      await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, createdUserIds));
    }
    if (createdAuditLogIds.length > 0) {
      await db.delete(s.auditLogs).where(inArray(s.auditLogs.id, createdAuditLogIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, createdUserIds));
    }
    if (createdNotificationIds.length > 0 || createdPenaltyIds.length > 0) {
      const notificationClauses = [];
      if (createdNotificationIds.length > 0) {
        notificationClauses.push(inArray(s.notifications.id, createdNotificationIds));
      }
      if (createdPenaltyIds.length > 0) {
        notificationClauses.push(and(
          eq(s.notifications.relatedEntityType, 'penalties'),
          inArray(s.notifications.relatedEntityId, createdPenaltyIds),
        ));
      }
      await db.delete(s.notifications).where(
        notificationClauses.length === 1 ? notificationClauses[0] : or(...notificationClauses),
      );
    }
    if (createdPenaltyIds.length > 0) {
      await db.delete(s.penalties).where(inArray(s.penalties.id, createdPenaltyIds));
    }
    if (createdDriverIds.length > 0) {
      await db.delete(s.ledger).where(and(
        eq(s.ledger.entityType, 'DRIVER'),
        inArray(s.ledger.entityId, createdDriverIds),
      ));
    }
    if (createdCarrierIds.length > 0) {
      await db.delete(s.ledger).where(and(
        inArray(s.ledger.entityType, ['CUSTOMER', 'CARRIER']),
        inArray(s.ledger.entityId, createdCarrierIds),
      ));
    }
    if (createdSupplierIds.length > 0) {
      await db.delete(s.ledger).where(and(
        eq(s.ledger.entityType, 'VENDOR'),
        inArray(s.ledger.entityId, createdSupplierIds),
      ));
    }
    if (createdDriverIds.length > 0) {
      await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    }
    if (createdCarrierIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCarrierIds));
    }
    if (createdSupplierIds.length > 0) {
      await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.notifications).where(inArray(s.notifications.userId, createdUserIds));
      await db.delete(s.pushSubscriptions).where(inArray(s.pushSubscriptions.userId, createdUserIds));
      await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, createdUserIds));
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } catch (err) {
    console.warn('[q23-direct-money] cleanup:', (err as Error).message);
  }

  await new Promise<void>((resolve, reject) => {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  await disconnectRedis();
  await client.end();
});

describe('Q23 direct-money idempotency', () => {
  test('vendor payment replays the same keyed request, audits replay, and rejects changed payload', async () => {
    const supplier = await mkSupplier();
    await seedVendorPayable(supplier.id, 1_600_000, `q23 vendor seed ${suffix}`);

    const unkeyedReceiptId = `Q23-VENDOR-UNKEYED-${suffix}`;
    const unkeyed = await postJson('/api/payments/vendor', {
      supplierId: supplier.id,
      receiptId: unkeyedReceiptId,
      amount: 200_000,
      date: '2026-07-27',
      confirmOverpay: false,
    });

    assert.equal(unkeyed.status, 400);
    assert.equal(
      await fetchLedgerCount({ entityType: 'VENDOR', entityId: supplier.id, txnType: TxnType.VENDOR_PAYMENT, receiptId: unkeyedReceiptId }),
      0,
    );

    const invalidReceiptId = `Q23-VENDOR-INVALID-${suffix}`;
    const invalid = await postJson('/api/payments/vendor', {
      supplierId: supplier.id,
      receiptId: invalidReceiptId,
      amount: 50_000,
      date: '2026-07-27',
      confirmOverpay: false,
    }, { idempotencyKey: overlongIdempotencyKey });

    assert.equal(invalid.status, 400);
    assert.equal(
      await fetchLedgerCount({ entityType: 'VENDOR', entityId: supplier.id, txnType: TxnType.VENDOR_PAYMENT, receiptId: invalidReceiptId }),
      0,
    );
    assert.equal(await fetchIdempotencyCount(IDEMPOTENCY_ENDPOINTS.PAYMENTS_VENDOR, overlongIdempotencyKey), 0);

    const receiptId = `Q23-VENDOR-${suffix}`;
    const key = `q23-vendor-${suffix}`;
    const body = {
      supplierId: supplier.id,
      receiptId,
      amount: 500_000,
      date: '2026-07-27',
      confirmOverpay: false,
    };

    const first = await postJson('/api/payments/vendor', body, { idempotencyKey: key });
    const replay = await postJson('/api/payments/vendor', body, { idempotencyKey: key });
    const conflict = await postJson('/api/payments/vendor', { ...body, amount: 510_000 }, { idempotencyKey: key });

    trackGovernanceActionId(first.data);
    assert.equal(first.status, 201);
    assert.equal(first.data.replayed, false);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.id, first.data.id);
    assert.equal(conflict.status, 409);

    assert.equal(
      await fetchLedgerCount({ entityType: 'VENDOR', entityId: supplier.id, txnType: TxnType.VENDOR_PAYMENT, receiptId }),
      1,
    );
    assert.equal(await fetchIdempotencyCount(IDEMPOTENCY_ENDPOINTS.PAYMENTS_VENDOR, key), 1);

    assert.equal(
      await fetchLedgerCount({ entityType: 'VENDOR', entityId: supplier.id, txnType: TxnType.VENDOR_PAYMENT, receiptId }),
      1,
    );

    const auditRows = await fetchVendorAudit(receiptId);
    assert.deepEqual(
      auditRows.map((row) => [row.event, row.outcome, row.statusCode, row.idempotencyKeyPresent]),
      [
        ['PAYMENT_RECEIVED', 'SUCCEEDED', 201, true],
        ['PAYMENT_RECEIVED', 'REPLAYED', 200, true],
        ['MUTATION_CONFLICT', 'CONFLICT', 409, true],
      ],
    );
  });

  test('vendor concurrent submissions stay serialized on the supplier lock and stale-guard at approval time', async () => {
    const supplier = await mkSupplier();
    await seedVendorPayable(supplier.id, 500_000, `q23 vendor lock seed ${suffix}`);

    let releaseLock!: () => void;
    let markLockAcquired!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      markLockAcquired = resolve;
    });
    const lockRelease = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const blocker = db.transaction(async (tx) => {
      await LedgerService.lockEntity(tx, 'VENDOR', supplier.id);
      markLockAcquired();
      await lockRelease;
    });
    await lockAcquired;

    let raceSettled = false;
    const receiptA = `Q23-VENDOR-RACE-A-${suffix}`;
    const receiptB = `Q23-VENDOR-RACE-B-${suffix}`;
    const bodyA = {
      supplierId: supplier.id,
      receiptId: receiptA,
      amount: 400_000,
      date: '2026-07-27',
    };
    const bodyB = {
      supplierId: supplier.id,
      receiptId: receiptB,
      amount: 400_000,
      date: '2026-07-27',
    };
    const race = Promise.all([
      postJson('/api/payments/vendor', bodyA, { idempotencyKey: `q23-vendor-race-a-${suffix}` }),
      postJson('/api/payments/vendor', bodyB, { idempotencyKey: `q23-vendor-race-b-${suffix}` }),
    ]).finally(() => {
      raceSettled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(
      raceSettled,
      false,
      'both vendor payment requests must remain blocked behind the shared vendor lock until the blocker releases it',
    );

    releaseLock();
    await blocker;

    const results = await race;
    // 2026-09-10 (phê duyệt removed): apply-at-request means the second
    // submission hits the balance guard (422 overpayment) since the first
    // already applied and reduced the vendor balance.
    const successCount = results.filter((result) => result.status === 201).length;
    assert.equal(successCount, 1);
    assert.equal(results.filter((result) => result.status === 422).length, 1);
    results.forEach((result) => { if (result.status === 201) trackGovernanceActionId(result.data); });
    assert.equal(
      await fetchLedgerCount({ entityType: 'VENDOR', entityId: supplier.id, txnType: TxnType.VENDOR_PAYMENT }),
      1,
    );
  });

  test('carrier payment honors body _requestId fallback and replays exactly once', async () => {
    const carrier = await mkCarrier();
    await seedCarrierPayable(carrier.id, 1_400_000, `q23 carrier seed ${suffix}`);

    const unkeyedReceiptId = `Q23-CARRIER-UNKEYED-${suffix}`;
    const unkeyed = await postJson('/api/payments/carrier', {
      supplierId: carrier.id,
      receiptId: unkeyedReceiptId,
      amount: 150_000,
      date: '2026-07-27',
    });

    assert.equal(unkeyed.status, 400);
    assert.equal(
      await fetchLedgerCount({ entityType: 'CARRIER', entityId: carrier.id, txnType: TxnType.VENDOR_PAYMENT, receiptId: unkeyedReceiptId }),
      0,
    );

    const invalidReceiptId = `Q23-CARRIER-INVALID-${suffix}`;
    const invalid = await postJson('/api/payments/carrier', {
      _requestId: overlongIdempotencyKey,
      supplierId: carrier.id,
      receiptId: invalidReceiptId,
      amount: 150_000,
      date: '2026-07-27',
    });

    assert.equal(invalid.status, 400);
    assert.equal(
      await fetchLedgerCount({ entityType: 'CARRIER', entityId: carrier.id, txnType: TxnType.VENDOR_PAYMENT, receiptId: invalidReceiptId }),
      0,
    );
    assert.equal(await fetchIdempotencyCount(IDEMPOTENCY_ENDPOINTS.PAYMENTS_CARRIER, overlongIdempotencyKey), 0);

    const requestId = `q23-carrier-body-${suffix}`;
    const receiptId = `Q23-CARRIER-${suffix}`;
    const body = {
      _requestId: requestId,
      supplierId: carrier.id,
      receiptId,
      amount: 300_000,
      date: '2026-07-27',
    };

    const first = await postJson('/api/payments/carrier', body);
    const replay = await postJson('/api/payments/carrier', body);

    trackGovernanceActionId(first.data);
    assert.equal(first.status, 201);
    assert.equal(first.data.replayed, false);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.id, first.data.id);
    assert.equal(
      await fetchLedgerCount({ entityType: 'CARRIER', entityId: carrier.id, txnType: TxnType.VENDOR_PAYMENT, receiptId }),
      1,
    );
    assert.equal(await fetchIdempotencyCount(IDEMPOTENCY_ENDPOINTS.PAYMENTS_CARRIER, requestId), 1);

    assert.equal(
      await fetchLedgerCount({ entityType: 'CARRIER', entityId: carrier.id, txnType: TxnType.VENDOR_PAYMENT, receiptId }),
      1,
    );

    const auditRows = await fetchCarrierAudit(receiptId);
    assert.deepEqual(
      auditRows.map((row) => [row.outcome, row.statusCode, row.idempotencyKeyPresent]),
      [
        ['SUCCEEDED', 201, true],
        ['REPLAYED', 200, true],
      ],
    );
  });

  test('driver payout keyed replay posts exactly one DRIVER_PAYOUT ledger row', async () => {
    const driver = await mkDriver();
    await seedDriverPayable(driver.id, 800_000, `q23 driver seed ${suffix}`);

    const unkeyedReceiptId = `Q23-DRIVER-UNKEYED-${suffix}`;
    const unkeyed = await postJson(`/api/drivers/${driver.id}/payouts`, {
      amount: 100_000,
      method: 'BANK',
      payoutDate: '2026-07-27',
      receiptId: unkeyedReceiptId,
      note: `Q23 payout unkeyed ${suffix}`,
    });

    assert.equal(unkeyed.status, 400);
    assert.equal(
      await fetchLedgerCount({ entityType: 'DRIVER', entityId: driver.id, txnType: TxnType.DRIVER_PAYOUT, receiptId: unkeyedReceiptId }),
      0,
    );

    const key = `q23-driver-payout-${suffix}`;
    const receiptId = `Q23-DRIVER-${suffix}`;
    const body = {
      amount: 500_000,
      method: 'BANK',
      payoutDate: '2026-07-27',
      receiptId,
      note: `Q23 payout ${suffix}`,
    };

    const first = await postJson(`/api/drivers/${driver.id}/payouts`, body, { idempotencyKey: key });
    const replay = await postJson(`/api/drivers/${driver.id}/payouts`, body, { idempotencyKey: key });

    trackGovernanceActionId(first.data);
    assert.equal(first.status, 201);
    assert.equal(first.data.replayed, false);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.id, first.data.id);
    assert.equal(
      await fetchLedgerCount({ entityType: 'DRIVER', entityId: driver.id, txnType: TxnType.DRIVER_PAYOUT, receiptId }),
      1,
    );
    assert.equal(await fetchIdempotencyCount(IDEMPOTENCY_ENDPOINTS.DRIVER_PAYOUT, key), 1);

    assert.equal(
      await fetchLedgerCount({ entityType: 'DRIVER', entityId: driver.id, txnType: TxnType.DRIVER_PAYOUT, receiptId }),
      1,
    );
  });

  test('commission keyed replay returns the original ledger id and writes once', async () => {
    const supplier = await mkSupplier();
    const unkeyed = await postJson('/api/commissions', {
      supplierId: supplier.id,
      amount: 80_000,
      note: `Q23 commission unkeyed ${suffix}`,
    });

    assert.equal(unkeyed.status, 400);
    assert.equal(
      await fetchLedgerCount({ entityType: 'VENDOR', entityId: supplier.id, txnType: TxnType.COMMISSION }),
      0,
    );

    const key = `q23-commission-${suffix}`;
    const body = {
      supplierId: supplier.id,
      amount: 120_000,
      note: `Q23 commission ${suffix}`,
    };

    const first = await postJson('/api/commissions', body, { idempotencyKey: key });
    const replay = await postJson('/api/commissions', body, { idempotencyKey: key });

    trackGovernanceActionId(first.data);
    assert.equal(first.status, 201);
    assert.equal(first.data.replayed, false);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.id, first.data.id);
    assert.equal(
      await fetchLedgerCount({ entityType: 'VENDOR', entityId: supplier.id, txnType: TxnType.COMMISSION }),
      1,
    );
    assert.equal(await fetchIdempotencyCount(IDEMPOTENCY_ENDPOINTS.COMMISSIONS_CREATE, key), 1);
    // 2026-09-10 (phê duyệt removed): commission applies immediately via auto-apply.
    assert.equal(
      await fetchLedgerCount({ entityType: 'VENDOR', entityId: supplier.id, txnType: TxnType.COMMISSION }),
      1,
    );
  });

  test('penalty create keyed replay creates one penalty row, one ledger row, and no duplicate notifications', async () => {
    const driver = await mkDriver();
    const unkeyed = await postJson('/api/penalties', {
      driverId: driver.id,
      amount: 95_000,
      date: '2026-07-27',
      customReason: `Q23 penalty unkeyed ${suffix}`,
    });

    assert.equal(unkeyed.status, 400);
    assert.equal(await fetchPenaltyCount(`Q23 penalty unkeyed ${suffix}`), 0);

    const key = `q23-penalty-create-${suffix}`;
    const reason = `Q23 penalty create ${suffix}`;
    const body = {
      driverId: driver.id,
      amount: 210_000,
      date: '2026-07-27',
      customReason: reason,
    };

    const first = await postJson('/api/penalties', body, { idempotencyKey: key });
    const replay = await postJson('/api/penalties', body, { idempotencyKey: key });

    trackGovernanceActionId(first.data);
    assert.equal(first.status, 201);
    assert.equal(first.data.replayed, false);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.id, first.data.id);
    // 2026-09-10 (phê duyệt removed): the penalty applies immediately via auto-apply.
    assert.equal(await fetchPenaltyCount(reason), 1);
    assert.equal(await fetchIdempotencyCount(IDEMPOTENCY_ENDPOINTS.PENALTIES_CREATE, key), 1);
    const penaltyResult = (first.data.applicationResult ?? {}) as Record<string, unknown>;
    const penaltyId = Number(penaltyResult.penaltyId);
    createdPenaltyIds.push(penaltyId);
    const ledgerCountsAfterApply = await fetchPenaltyLedgerCounts(penaltyId, driver.id);
    assert.equal(ledgerCountsAfterApply.penaltyRows, 1);
    const afterApprovalNotificationCount = await waitForNotificationCount('penalties', penaltyId, 1);
    assert.deepEqual(await fetchNotificationRecipients('penalties', penaltyId), [driver.userId]);

    const ledgerCountsBeforeCancel = await fetchPenaltyLedgerCounts(penaltyId, driver.id);
    assert.equal(ledgerCountsBeforeCancel.penaltyRows, 1);
    assert.equal(ledgerCountsBeforeCancel.reversalRows, 0);

    const cancelKey = `q23-penalty-create-cancel-${suffix}`;
    const cancel = await postJson(
      `/api/penalties/${penaltyId}/cancel`,
      { reason: `Q23 create replay cancel ${suffix}` },
      { idempotencyKey: cancelKey, actor: 'checker' },
    );
    trackGovernanceActionId(cancel.data);
    assert.equal(cancel.status, 200);
    // 2026-09-10 (phê duyệt removed): cancel applies immediately.
    assert.equal(await fetchPenaltyStatus(penaltyId), 'CANCELED');

    const notificationCountAfterCancel = await waitForNotificationCount(
      'penalties',
      penaltyId,
      afterApprovalNotificationCount + 1,
    );
    assert.ok(notificationCountAfterCancel > afterApprovalNotificationCount);
    assert.deepEqual(
      await fetchNotificationRecipients('penalties', penaltyId),
      [driver.userId, driver.userId],
    );

    const replayAfterCancel = await postJson('/api/penalties', body, { idempotencyKey: key });
    assert.equal(replayAfterCancel.status, 200);
    assert.deepEqual(replayAfterCancel.data, { ...first.data, replayed: true });
    assert.equal(
      await fetchNotificationCount('penalties', penaltyId),
      notificationCountAfterCancel,
    );
    assert.deepEqual(
      await fetchNotificationRecipients('penalties', penaltyId),
      [driver.userId, driver.userId],
    );

    const ledgerCountsAfterCancel = await fetchPenaltyLedgerCounts(penaltyId, driver.id);
    assert.equal(ledgerCountsAfterCancel.penaltyRows, 1);
    assert.equal(ledgerCountsAfterCancel.reversalRows, 1);
  });

  test('penalty cancel replays exactly once, rejects changed payload, and posts one reversal only', async () => {
    const driver = await mkDriver();
    const unkeyedPenalty = await createPenalty({
      driverId: driver.id,
      amount: 125_000,
      date: '2026-07-27',
      customReason: `Q23 cancel unkeyed ${suffix}`,
    });
    createdPenaltyIds.push(unkeyedPenalty.id);

    const unkeyed = await postJson(
      `/api/penalties/${unkeyedPenalty.id}/cancel`,
      { reason: `Q23 cancel unkeyed reason ${suffix}` },
      { actor: 'checker' },
    );
    assert.equal(unkeyed.status, 400);
    assert.equal(await fetchPenaltyStatus(unkeyedPenalty.id), 'ACTIVE');

    const penalty = await createPenalty({
      driverId: driver.id,
      amount: 275_000,
      date: '2026-07-27',
      customReason: `Q23 cancel seed ${suffix}`,
    });
    createdPenaltyIds.push(penalty.id);

    const key = `q23-penalty-cancel-${suffix}`;
    const reason = `Q23 cancel reason ${suffix}`;

    const first = await postJson(`/api/penalties/${penalty.id}/cancel`, { reason }, { idempotencyKey: key, actor: 'checker' });
    const replay = await postJson(`/api/penalties/${penalty.id}/cancel`, { reason }, { idempotencyKey: key, actor: 'checker' });
    const conflict = await postJson(`/api/penalties/${penalty.id}/cancel`, { reason: `${reason} changed` }, { idempotencyKey: key, actor: 'checker' });

    trackGovernanceActionId(first.data);
    assert.equal(first.status, 200);
    assert.equal(first.data.replayed, false);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal(conflict.status, 409);
    // 2026-09-10 (phê duyệt removed): the cancel applies immediately.
    assert.equal(await fetchPenaltyStatus(penalty.id), 'CANCELED');
    assert.equal(await fetchIdempotencyCount(IDEMPOTENCY_ENDPOINTS.PENALTIES_CANCEL, key), 1);
    // 2026-09-10: notification is emitted during the cancel route itself.
    const notificationCountAfterCancel = await waitForNotificationCount('penalties', penalty.id, 1);
    assert.equal(await fetchNotificationCount('penalties', penalty.id), notificationCountAfterCancel);

    const ledgerCounts = await fetchPenaltyLedgerCounts(penalty.id, driver.id);
    assert.equal(ledgerCounts.penaltyRows, 1);
    assert.equal(ledgerCounts.reversalRows, 1);

    const auditRows = await fetchPenaltyCancelAudit(reason);
    assert.deepEqual(
      auditRows.map((row) => [row.event, row.outcome, row.statusCode, row.idempotencyKeyPresent]),
      [
        ['PENALTY_CANCELED', 'SUCCEEDED', 200, true],
        ['PENALTY_CANCELED', 'REPLAYED', 200, true],
      ],
    );
  });

  test('rollback removes both the transient direct-money row and the idempotency key when create throws', async () => {
    const supplier = await mkSupplier();
    const key = `q23-rollback-${suffix}`;
    const note = `q23 rollback ${suffix}`;

    await assert.rejects(
      runIdempotent({
        endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENTS_VENDOR,
        idempotencyKey: key,
        payload: {
          supplierId: supplier.id,
          amount: 50_000,
          date: '2026-07-27',
          receiptId: `Q23-ROLLBACK-${suffix}`,
        },
        createdBy: makerUserId,
        entityType: 'ledger',
        create: async (tx) => {
          const [row] = await tx.insert(s.ledger).values({
            entityType: 'VENDOR',
            entityId: supplier.id,
            txnType: TxnType.VENDOR_PAYMENT,
            txnId: 0,
            debit: '50000',
            credit: '0',
            balance: '-50000',
            note,
          }).returning();
          throw new ApiError(500, `forced rollback after ledger ${row.id}`);
        },
        load: async () => {
          throw new Error('load should never run for rollback test');
        },
      }),
      (error: unknown) =>
        error instanceof ApiError && error.statusCode === 500,
    );

    const [{ ledgerTotal }] = await db.select({ ledgerTotal: sql<number>`count(*)::int` })
      .from(s.ledger)
      .where(eq(s.ledger.note, note));
    assert.equal(Number(ledgerTotal ?? 0), 0);
    assert.equal(await fetchIdempotencyCount(IDEMPOTENCY_ENDPOINTS.PAYMENTS_VENDOR, key), 0);
  });

  test('pool-sized unique vendor writes complete without duplicates', async () => {
    const batchSize = 8;
    const suppliers = await Promise.all(Array.from({ length: batchSize }, () => mkSupplier()));
    await Promise.all(
      suppliers.map((supplier, index) =>
        seedVendorPayable(supplier.id, 350_000, `q23 pool seed ${suffix}-${index}`)),
    );

    const results = await Promise.all(
      suppliers.map((supplier, index) =>
        postJson('/api/payments/vendor', {
          supplierId: supplier.id,
          receiptId: `Q23-POOL-${suffix}-${index}`,
          amount: 150_000,
          date: '2026-07-27',
        }, { idempotencyKey: `q23-pool-${suffix}-${index}` })),
    );

    assert.equal(results.filter((result) => result.status === 201).length, batchSize);
    results.forEach((result) => trackGovernanceActionId(result.data));
    // 2026-09-10 (phê duyệt removed): each vendor write posts its ledger row
    // immediately at request time.
    for (let index = 0; index < suppliers.length; index += 1) {
      assert.equal(
        await fetchLedgerCount({
          entityType: 'VENDOR',
          entityId: suppliers[index].id,
          txnType: TxnType.VENDOR_PAYMENT,
          receiptId: `Q23-POOL-${suffix}-${index}`,
        }),
        1,
      );
    }

    // 2026-09-10 (phê duyệt removed): the writes above already applied via auto-apply.

    for (let index = 0; index < suppliers.length; index += 1) {
      assert.equal(
        await fetchLedgerCount({
          entityType: 'VENDOR',
          entityId: suppliers[index].id,
          txnType: TxnType.VENDOR_PAYMENT,
          receiptId: `Q23-POOL-${suffix}-${index}`,
        }),
        1,
      );
      assert.equal(
        await fetchIdempotencyCount(IDEMPOTENCY_ENDPOINTS.PAYMENTS_VENDOR, `q23-pool-${suffix}-${index}`),
        1,
      );
    }
  });
});
