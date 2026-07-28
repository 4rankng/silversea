import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { auditLogMiddleware } from '../middleware/audit';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import paymentsRoutes from '../routes/financial/payments.routes';
import { registerAuditEvent } from '../services/audit-registry';
import { initAuditService } from '../services/audit.service';
import { AuditEvent } from '../services/audit-types';
import { initNotificationService } from '../services/notification.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdTripIds: number[] = [];
const createdLedgerIds: number[] = [];
const createdPaymentReceiptIds: number[] = [];
const createdGovernanceActionIds: number[] = [];
const createdNotificationIds: number[] = [];
const createdAuditLogIds: number[] = [];

let adminToken: string;
let server: http.Server;
let baseUrl: string;

async function mkUser(username: string, role: Role) {
  const [user] = await db.insert(s.users).values({
    username,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

function sign(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign(
    { userId: user.id, username: user.username ?? `${user.id}`, role: user.role as Role },
    config.jwtSecret,
  );
}

async function mkCustomer() {
  const [customer] = await db.insert(s.customers)
    .values({ name: `Q03 route customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(customer.id);
  return customer;
}

async function mkRoute() {
  const [route] = await db.insert(s.routes)
    .values({ name: `Q03 route ${suffix}-${createdRouteIds.length}` })
    .returning();
  createdRouteIds.push(route.id);
  return route;
}

async function mkCargo() {
  const [cargo] = await db.insert(s.cargoTypes)
    .values({ name: `Q03 cargo ${suffix}-${createdCargoTypeIds.length}` })
    .returning();
  createdCargoTypeIds.push(cargo.id);
  return cargo;
}

async function mkTrip(customerId: number, routeId: number, cargoTypeId: number, departureDate: string) {
  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q03-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId,
    routeId,
    cargoTypeId,
    status: 'COMPLETED',
    departureDate,
    carrierType: 'OWN',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

async function mkRevenue(args: {
  customerId: number;
  tripId: number;
  amount: number;
  timestamp: string;
  originalDueDate: string;
  processingDueDate: string;
}) {
  const [entry] = await db.insert(s.ledger).values({
    entityType: 'CUSTOMER',
    entityId: args.customerId,
    txnType: 'TRIP_REVENUE',
    txnId: args.tripId,
    debit: String(args.amount),
    credit: '0',
    balance: String(args.amount),
    note: null,
    timestamp: new Date(args.timestamp),
    originalDueDate: args.originalDueDate,
    processingDueDate: args.processingDueDate,
  }).returning();
  createdLedgerIds.push(entry.id);
  return entry;
}

async function paymentFetch(body: Record<string, unknown>, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`,
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(`${baseUrl}/api/payments/receive`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (data?.result?.id && !createdGovernanceActionIds.includes(data.result.id)) {
    createdGovernanceActionIds.push(data.result.id);
  }
  return { status: res.status, data };
}

async function fetchNotificationCount(relatedEntityId: number) {
  const rows = await db.select().from(s.notifications).where(and(
    eq(s.notifications.relatedEntityType, 'payments'),
    eq(s.notifications.relatedEntityId, relatedEntityId),
  ));
  for (const row of rows) {
    if (!createdNotificationIds.includes(row.id)) createdNotificationIds.push(row.id);
  }
  return rows.length;
}

async function waitForNotificationCount(relatedEntityId: number, expectedAtLeast: number) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const count = await fetchNotificationCount(relatedEntityId);
    if (count >= expectedAtLeast) return count;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return fetchNotificationCount(relatedEntityId);
}

async function fetchReceiptCount(receiptId: string) {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.paymentReceipts)
    .where(eq(s.paymentReceipts.receiptId, receiptId));
  return Number(total ?? 0);
}

async function fetchAllocationCount(receiptId: string) {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.paymentAllocations)
    .where(eq(s.paymentAllocations.receiptId, receiptId));
  return Number(total ?? 0);
}

async function fetchPaymentLedgerCount(receiptId: string) {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.ledger)
    .where(and(
      eq(s.ledger.receiptId, receiptId),
      eq(s.ledger.txnType, 'PAYMENT_RECEIVED'),
    ));
  return Number(total ?? 0);
}

async function fetchGovernanceActionCount(receiptId: string) {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.actionKind, 'PAYMENT_RECEIPT'),
      sql`${s.governanceActions.subjectKey} like ${`%receipt:${receiptId}`}`,
    ));
  return Number(total ?? 0);
}

async function fetchAuditEntries(receiptId: string) {
  const rows = await db.select({
    id: s.auditLogs.id,
    event: sql<string>`${s.auditLogs.payload}->>'event'`,
    outcome: sql<string>`${s.auditLogs.payload}->>'outcome'`,
    path: sql<string>`${s.auditLogs.payload}->>'path'`,
    statusCode: sql<number>`coalesce((${s.auditLogs.payload}->>'statusCode')::int, 0)`,
    idempotencyKeyPresent: sql<boolean>`coalesce((${s.auditLogs.payload}->>'idempotencyKeyPresent')::boolean, false)`,
  }).from(s.auditLogs)
    .where(and(
      eq(s.auditLogs.entityType, 'payments'),
      sql`${s.auditLogs.payload}->'body'->>'receiptId' = ${receiptId}`,
    ))
    .orderBy(s.auditLogs.id);

  for (const row of rows) {
    if (!createdAuditLogIds.includes(row.id)) createdAuditLogIds.push(row.id);
  }
  return rows;
}

async function waitForAuditEntries(receiptId: string, expectedAtLeast: number) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rows = await fetchAuditEntries(receiptId);
    if (rows.length >= expectedAtLeast) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return fetchAuditEntries(receiptId);
}

async function fetchTripOutstanding(customerId: number, tripId: number) {
  const [row] = await db.select({
    outstanding: sql<string>`coalesce(sum(${s.ledger.debit}), 0) - coalesce(sum(${s.ledger.credit}), 0)`,
  }).from(s.ledger)
    .where(and(
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, customerId),
      eq(s.ledger.txnId, tripId),
      sql`${s.ledger.txnType} IN ('TRIP_REVENUE', 'PAYMENT_RECEIVED', 'ADJUSTMENT', 'UNLOCK_REVERSAL')`,
    ));
  return Math.max(0, Number(row?.outstanding ?? 0));
}

before(async () => {
  initNotificationService();
  initAuditService();
  registerAuditEvent('POST', '/api/payments/receive', AuditEvent.PAYMENT_RECEIVED);
  await initEnforcer();

  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware, auditLogMiddleware, casbinAuthz('financial'), paymentsRoutes);
  app.use(globalErrorHandler);

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const admin = await mkUser(`q03-admin-${suffix}`, Role.ADMIN);
  adminToken = sign(admin);
});

after(async () => {
  const receiptPattern = `Q03-RCPT-${suffix}%`;
  const tripCodePattern = `Q03-${suffix}%`;
  const customerPattern = `Q03 route customer ${suffix}%`;
  const routePattern = `Q03 route ${suffix}%`;
  const cargoPattern = `Q03 cargo ${suffix}%`;
  const userPattern = `q03-admin-${suffix}`;
  try {
    if (createdGovernanceActionIds.length > 0) {
      await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, createdGovernanceActionIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, createdUserIds));
      await db.delete(s.notifications).where(inArray(s.notifications.userId, createdUserIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, createdUserIds));
    }
    if (createdAuditLogIds.length > 0) {
      await db.delete(s.auditLogs).where(inArray(s.auditLogs.id, createdAuditLogIds));
    }
    if (createdNotificationIds.length > 0) {
      await db.delete(s.notifications).where(inArray(s.notifications.id, createdNotificationIds));
    }
    await db.delete(s.paymentAllocations).where(sql`${s.paymentAllocations.receiptId} LIKE ${receiptPattern}`);
    await db.delete(s.paymentReceipts).where(sql`${s.paymentReceipts.receiptId} LIKE ${receiptPattern}`);
    await db.delete(s.ledger).where(sql`${s.ledger.receiptId} LIKE ${receiptPattern}`);
    if (createdLedgerIds.length > 0) {
      await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
    }
    await db.delete(s.trips).where(sql`${s.trips.tripCode} LIKE ${tripCodePattern}`);
    await db.delete(s.cargoTypes).where(sql`${s.cargoTypes.name} LIKE ${cargoPattern}`);
    await db.delete(s.routes).where(sql`${s.routes.name} LIKE ${routePattern}`);
    await db.delete(s.customers).where(sql`${s.customers.name} LIKE ${customerPattern}`);
    await db.delete(s.users).where(sql`${s.users.username} = ${userPattern}`);
  } catch (err) {
    console.warn('[q03-route] cleanup:', (err as Error).message);
  }
  server.closeAllConnections();
  server.close();
  await client.end();
  process.exit(0);
});

describe('POST /api/payments/receive', () => {
  test('submits one governed request, replays the same keyed body, and leaves money unchanged before approval', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargo();
    const trip = await mkTrip(customer.id, route.id, cargo.id, '2026-07-20');
    await mkRevenue({
      customerId: customer.id,
      tripId: trip.id,
      amount: 1_500_000,
      timestamp: '2026-07-20T08:00:00.000Z',
      originalDueDate: '2026-07-25',
      processingDueDate: '2026-07-25',
    });

    const receiptId = `Q03-RCPT-${suffix}-1`;
    const key = `q03-route-key-${suffix}-1`;
    const body = { customerId: customer.id, receiptId, amount: 2_000_000 };

    const first = await paymentFetch(body, key);
    assert.equal(first.status, 201);
    assert.equal(first.data.replayed, false);
    assert.equal(first.data.result.status, 'PENDING_CHECK');
    assert.equal(first.data.result.actionKind, 'PAYMENT_RECEIPT');

    const notificationCountAfterFirst = await waitForNotificationCount(first.data.result.id, 0);
    assert.equal(notificationCountAfterFirst, 0);

    const replay = await paymentFetch(body, key);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.result.id, first.data.result.id);
    assert.equal(await fetchGovernanceActionCount(receiptId), 1);
    assert.equal(await fetchReceiptCount(receiptId), 0);
    assert.equal(await fetchAllocationCount(receiptId), 0);
    assert.equal(await fetchPaymentLedgerCount(receiptId), 0);
    assert.equal(await fetchTripOutstanding(customer.id, trip.id), 1_500_000);

    await new Promise((resolve) => setTimeout(resolve, 100));
    const notificationCountAfterReplay = await fetchNotificationCount(first.data.result.id);
    assert.equal(notificationCountAfterReplay, notificationCountAfterFirst);

    const auditRows = await waitForAuditEntries(receiptId, 2);
    assert.deepEqual(
      auditRows.map((row) => [row.event, row.outcome, row.idempotencyKeyPresent]),
      [
        [AuditEvent.PAYMENT_RECEIVED, 'SUCCEEDED', true],
        [AuditEvent.PAYMENT_RECEIVED, 'REPLAYED', true],
      ],
    );
  });

  test('same header with a different payload returns 409', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargo();
    const trip = await mkTrip(customer.id, route.id, cargo.id, '2026-07-21');
    await mkRevenue({
      customerId: customer.id,
      tripId: trip.id,
      amount: 1_000_000,
      timestamp: '2026-07-21T08:00:00.000Z',
      originalDueDate: '2026-07-26',
      processingDueDate: '2026-07-26',
    });

    const receiptId = `Q03-RCPT-${suffix}-2`;
    const key = `q03-route-key-${suffix}-2`;
    const first = await paymentFetch({ customerId: customer.id, receiptId, amount: 1_000_000 }, key);
    assert.equal(first.status, 201);

    const conflict = await paymentFetch({ customerId: customer.id, receiptId, amount: 900_000 }, key);
    assert.equal(conflict.status, 409);
    assert.match(String(conflict.data.error ?? ''), /Khóa giao dịch trùng/);

    const auditRows = await waitForAuditEntries(receiptId, 2);
    const conflictRow = auditRows.find((row) => row.event === AuditEvent.MUTATION_CONFLICT);
    assert.ok(conflictRow, 'conflict audit row is written');
    assert.equal(conflictRow!.path, '/api/payments/receive');
    assert.equal(conflictRow!.statusCode, 409);
    assert.equal(conflictRow!.idempotencyKeyPresent, true);
  });

  test('same receipt body without an idempotency header is rejected by the mandatory-header contract', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargo();
    const trip = await mkTrip(customer.id, route.id, cargo.id, '2026-07-21');
    await mkRevenue({
      customerId: customer.id,
      tripId: trip.id,
      amount: 750_000,
      timestamp: '2026-07-21T08:00:00.000Z',
      originalDueDate: '2026-07-26',
      processingDueDate: '2026-07-26',
    });

    const receiptId = `Q03-RCPT-${suffix}-no-key`;
    const body = { customerId: customer.id, receiptId, amount: 750_000 };

    const first = await paymentFetch(body);
    const replay = await paymentFetch(body);

    assert.equal(first.status, 400);
    assert.equal(replay.status, 400);
    assert.match(String(first.data.error ?? ''), /Idempotency-Key.*bắt buộc/);
    assert.match(String(replay.data.error ?? ''), /Idempotency-Key.*bắt buộc/);
    assert.equal(await fetchGovernanceActionCount(receiptId), 0);
    assert.equal(await fetchReceiptCount(receiptId), 0);
    assert.equal(await fetchAllocationCount(receiptId), 0);
    assert.equal(await fetchPaymentLedgerCount(receiptId), 0);
  });

  test('concurrent first submit with the same header creates one governed action and one replay', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargo();
    const trip = await mkTrip(customer.id, route.id, cargo.id, '2026-07-22');
    await mkRevenue({
      customerId: customer.id,
      tripId: trip.id,
      amount: 1_000_000,
      timestamp: '2026-07-22T08:00:00.000Z',
      originalDueDate: '2026-07-27',
      processingDueDate: '2026-07-27',
    });

    const receiptId = `Q03-RCPT-${suffix}-3`;
    const key = `q03-route-key-${suffix}-3`;
    const body = { customerId: customer.id, receiptId, amount: 1_000_000 };

    const [a, b] = await Promise.all([
      paymentFetch(body, key),
      paymentFetch(body, key),
    ]);
    const statuses = [a.status, b.status].sort((left, right) => left - right);
    assert.deepEqual(statuses, [200, 201]);
    assert.equal(await fetchGovernanceActionCount(receiptId), 1);
    assert.equal(await fetchReceiptCount(receiptId), 0);
    assert.equal(await fetchAllocationCount(receiptId), 0);
    assert.equal(await fetchPaymentLedgerCount(receiptId), 0);
    const ids = [a.data.result.id, b.data.result.id];
    assert.equal(ids[0], ids[1]);
  });

  test('different request keys racing on the same receipt leave one active governed request', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargo();
    const trip = await mkTrip(customer.id, route.id, cargo.id, '2026-07-22');
    await mkRevenue({
      customerId: customer.id,
      tripId: trip.id,
      amount: 900_000,
      timestamp: '2026-07-22T08:00:00.000Z',
      originalDueDate: '2026-07-27',
      processingDueDate: '2026-07-27',
    });

    const receiptId = `Q03-RCPT-${suffix}-4`;
    const body = { customerId: customer.id, receiptId, amount: 900_000 };
    const [a, b] = await Promise.all([
      paymentFetch(body, `q03-route-key-${suffix}-4a`),
      paymentFetch(body, `q03-route-key-${suffix}-4b`),
    ]);

    const statuses = [a.status, b.status].sort((left, right) => left - right);
    assert.deepEqual(statuses, [201, 409]);
    assert.equal(await fetchGovernanceActionCount(receiptId), 1);
    assert.equal(await fetchReceiptCount(receiptId), 0);
    assert.equal(await fetchAllocationCount(receiptId), 0);
    assert.equal(await fetchPaymentLedgerCount(receiptId), 0);
  });

  test('different receipts racing on the same customer create separate governed requests without applying money yet', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargo = await mkCargo();
    const trip = await mkTrip(customer.id, route.id, cargo.id, '2026-07-23');
    await mkRevenue({
      customerId: customer.id,
      tripId: trip.id,
      amount: 1_000_000,
      timestamp: '2026-07-23T08:00:00.000Z',
      originalDueDate: '2026-07-28',
      processingDueDate: '2026-07-28',
    });

    const [a, b] = await Promise.all([
      paymentFetch({ customerId: customer.id, receiptId: `Q03-RCPT-${suffix}-5a`, amount: 700_000 }, `q03-route-key-${suffix}-5a`),
      paymentFetch({ customerId: customer.id, receiptId: `Q03-RCPT-${suffix}-5b`, amount: 700_000 }, `q03-route-key-${suffix}-5b`),
    ]);

    assert.deepEqual([a.status, b.status].sort((left, right) => left - right), [201, 201]);
    assert.equal(await fetchTripOutstanding(customer.id, trip.id), 1_000_000);
    assert.equal(await fetchGovernanceActionCount(`Q03-RCPT-${suffix}-5a`), 1);
    assert.equal(await fetchGovernanceActionCount(`Q03-RCPT-${suffix}-5b`), 1);
    assert.equal(await fetchReceiptCount(`Q03-RCPT-${suffix}-5a`), 0);
    assert.equal(await fetchReceiptCount(`Q03-RCPT-${suffix}-5b`), 0);
    assert.equal(await fetchPaymentLedgerCount(`Q03-RCPT-${suffix}-5a`) + await fetchPaymentLedgerCount(`Q03-RCPT-${suffix}-5b`), 0);
  });
});
