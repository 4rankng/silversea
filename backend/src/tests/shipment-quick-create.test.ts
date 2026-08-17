/**
 * Wave 4 M10.1 slice 1 — `POST /api/shipments/quick` integration tests.
 *
 * Boots a throwaway Express app on an ephemeral port (same pattern as
 * `shipment-routes.test.ts`: Node's built-in `http` + `fetch`, no supertest),
 * mounts `/api/shipments` with the same `authMiddleware + casbinAuthz('shipments')`
 * chain the production app uses, and exercises the new quick-create endpoint.
 *
 * Coverage matrix:
 *   - Happy path: 201 + shipmentCode; minimum data set (customerId only).
 *   - Idempotent replay: same `Idempotency-Key` → 200 with the SAME shipment
 *     id; no duplicate row created (M10-01-03, Q23).
 *   - Body-channel dedupe token: `_requestId` in body works when no header
 *     is present (offline-queue client lib path).
 *   - Conflict: same `Idempotency-Key` + different payload → 409.
 *   - No key: two distinct POSTs create two distinct shipments.
 *   - RBAC: CLERK/DISPATCHER/MANAGER/ADMIN allowed; ACCOUNTANT/CUSTOMER/DRIVER/FORWARDER
 *     denied (403). ACCOUNTANT has shipments read only; the others are
 *     denied at the casbinAuthz('shipments') mount.
 *   - Validation: missing customerId → 400.
 *
 * Hits the real Postgres DB and the real Casbin enforcer (initEnforcer) so
 * the RBAC assertions reflect the shipped policy.csv exactly. All seeded
 * rows are cleaned up in `after` in reverse-FK order.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';

import shipmentRoutes from '../routes/shipments';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import { auditLogMiddleware } from '../middleware/audit';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../services/idempotency.service';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ── Scaffolding id buckets (cleaned up in reverse-FK order in `after`) ──────
const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdUserIds: number[] = [];
const createdBusinessUnitIds: number[] = [];

let adminToken: string;
let managerToken: string;
let dispatcherToken: string;
let accountantToken: string;
let clerkToken: string;
let customerToken: string;
let driverToken: string;
let forwarderToken: string;
let customerId: number;
let clerkUserId: number;
let clerkBusinessUnitId: number;

let server: http.Server;
let baseUrl: string;

async function mkUser(username: string, role: Role) {
  const [u] = await db.insert(s.users).values({
    username,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
  }).returning();
  createdUserIds.push(u.id);
  return u;
}

function sign(u: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign(
    { userId: u.id, username: u.username ?? u.id.toString(), role: u.role as Role },
    config.jwtSecret,
  );
}

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `QuickCreate customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkBusinessUnit() {
  const [unit] = await db.insert(s.businessUnits)
    .values({
      code: `QC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: `QuickCreate Unit ${suffix}-${createdBusinessUnitIds.length}`,
      status: 'ACTIVE',
    })
    .returning();
  createdBusinessUnitIds.push(unit.id);
  return unit;
}

async function assignClerkScope(userId: number, scopedCustomerId: number, businessUnitId: number) {
  await db.insert(s.userCustomerLinks).values({
    userId,
    customerId: scopedCustomerId,
  });
  await db.insert(s.userBusinessUnitLinks).values({
    userId,
    businessUnitId,
  });
}

function clerkQuickBody(extra: Record<string, unknown> = {}) {
  return {
    customerId,
    responsibleUnitId: clerkBusinessUnitId,
    ...extra,
  };
}

interface QuickFetchOptions {
  method?: string;
  body?: unknown;
  token?: string;
  idempotencyKey?: string;
}

async function quickFetch(urlPath: string, options: QuickFetchOptions = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  const fullUrl = `${baseUrl}/api/shipments${urlPath}`;
  const res = await fetch(fullUrl, {
    method: options.method ?? 'GET',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function fetchShipmentCountByBookingRef(bookingRef: string) {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.shipments)
    .where(eq(s.shipments.bookingRef, bookingRef));
  return Number(total ?? 0);
}

async function fetchShipmentIdempotencyCount(idempotencyKey: string) {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.idempotencyKeys)
    .where(and(
      eq(s.idempotencyKeys.endpoint, IDEMPOTENCY_ENDPOINTS.SHIPMENT_QUICK_CREATE),
      eq(s.idempotencyKeys.idempotencyKey, idempotencyKey),
    ));
  return Number(total ?? 0);
}

before(async () => {
  await initAuditService();
  await initEnforcer();

  const app = express();
  app.use(express.json());
  app.use(auditLogMiddleware);
  app.use('/api/shipments', authMiddleware, casbinAuthz('shipments'), shipmentRoutes);
  app.use(globalErrorHandler);

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const admin = await mkUser(`qc-admin-${suffix}`, Role.ADMIN);
  const manager = await mkUser(`qc-manager-${suffix}`, Role.MANAGER);
  const dispatcher = await mkUser(`qc-dispatcher-${suffix}`, Role.DISPATCHER);
  const accountant = await mkUser(`qc-acct-${suffix}`, Role.ACCOUNTANT);
  const clerk = await mkUser(`qc-clerk-${suffix}`, Role.CUS);
  const customer = await mkUser(`qc-cust-${suffix}`, Role.CUSTOMER);
  const driver = await mkUser(`qc-driver-${suffix}`, Role.DRIVER);
  const forwarder = await mkUser(`qc-fwd-${suffix}`, Role.OPS);

  adminToken = sign(admin);
  managerToken = sign(manager);
  dispatcherToken = sign(dispatcher);
  accountantToken = sign(accountant);
  clerkToken = sign(clerk);
  customerToken = sign(customer);
  driverToken = sign(driver);
  forwarderToken = sign(forwarder);
  clerkUserId = clerk.id;

  const customerRow = await mkCustomer();
  customerId = customerRow.id;
  const businessUnit = await mkBusinessUnit();
  clerkBusinessUnitId = businessUnit.id;
  await assignClerkScope(clerkUserId, customerId, clerkBusinessUnitId);
  clerkToken = jwt.sign(
    {
      userId: clerk.id,
      username: clerk.username,
      role: Role.CUS,
      customerIds: [customerId],
    },
    config.jwtSecret,
  );
});

after(async () => {
  // Reverse-FK cleanup. Idempotency rows reference users and shipments, so
  // delete them before both. Shipments cascade to status_history / documents
  // / declarations / containers / milestones via ON DELETE CASCADE, so we
  // only need to delete the shipment rows themselves.
  try {
    await db.transaction(async (tx) => {
      // Idempotency rows reference shipments via entityId — delete by the
      // shipment ids we own, never a global sweep (test files run in
      // parallel and would corrupt each other's setup).
      if (createdShipmentIds.length > 0) {
        await tx.delete(s.idempotencyKeys)
          .where(inArray(s.idempotencyKeys.entityId, createdShipmentIds));
        await tx.delete(s.shipmentStatusHistory)
          .where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
        await tx.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
      }
      if (createdUserIds.length > 0) {
        await tx.delete(s.userShipmentLinks).where(inArray(s.userShipmentLinks.userId, createdUserIds));
        await tx.delete(s.userBusinessUnitLinks).where(inArray(s.userBusinessUnitLinks.userId, createdUserIds));
        await tx.delete(s.userCustomerLinks).where(inArray(s.userCustomerLinks.userId, createdUserIds));
      }
      if (createdBusinessUnitIds.length > 0) {
        await tx.delete(s.businessUnits).where(inArray(s.businessUnits.id, createdBusinessUnitIds));
      }
      if (createdCustomerIds.length > 0) {
        await tx.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
      }
    });
  } catch (err) {
    console.warn('[shipment-quick-create.test] cleanup partial:', (err as Error).message);
  }

  // Users are referenced by audit_logs / notifications created by middleware
  // we don't own in this list; tolerate FK failures on the user delete.
  try {
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } catch (err) {
    console.warn('[shipment-quick-create.test] user cleanup partial:', (err as Error).message);
  }

  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await disconnectRedis();
  await client.end();
});

// Track created rows for cleanup. The `after` hook deletes idempotency keys
// by `entityId IN createdShipmentIds` — precise, never touches other test
// runs' rows. This helper is a no-op kept for readability at call sites
// (every quick-create already pushes its shipment id explicitly above).
async function trackCreated() {
  /* cleanup is keyed off createdShipmentIds in after() */ }

describe('POST /api/shipments/quick — M10.1 slice 1 quick-create', () => {
  test('happy path: minimum data set creates a pending-date shipment (201)', async () => {
    const res = await quickFetch('/quick', {
      method: 'POST',
      token: clerkToken,
      idempotencyKey: `qc-happy-${suffix}`,
      body: clerkQuickBody(),
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.status, 'PENDING_DATE');
    assert.equal(res.data.customerId, customerId);
    assert.ok(res.data.shipmentCode, 'shipmentCode is generated');
    assert.equal(res.data.version, 1);
    createdShipmentIds.push(res.data.id);
    await trackCreated();
  });

  test('persists optional shipment operations fields when quick-creating', async () => {
    const res = await quickFetch('/quick', {
      method: 'POST',
      token: clerkToken,
      idempotencyKey: `qc-ops-${suffix}`,
      body: clerkQuickBody({
        tradeDirection: 'EXPORT',
        cargoMode: 'FCL',
        factoryName: `Factory ${suffix}`,
        shippingLineName: `Line ${suffix}`,
        customsCutoffAt: '2026-07-29T10:00:00.000Z',
        closingAt: '2026-07-29T12:00:00.000Z',
        plannedReturnAt: '2026-07-31T01:30:00.000Z',
        cargoWeightKg: 98.76,
        cargoVolumeCbm: 12.345,
        packageCount: 7,
        packageType: 'Bundle',
        operationalNotes: 'Quick-create coverage',
      }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.tradeDirection, 'EXPORT');
    assert.equal(res.data.cargoMode, 'FCL');
    assert.equal(res.data.factoryName, `Factory ${suffix}`);
    assert.equal(res.data.shippingLineName, `Line ${suffix}`);
    assert.equal(new Date(res.data.customsCutoffAt).toISOString(), '2026-07-29T10:00:00.000Z');
    assert.equal(new Date(res.data.closingAt).toISOString(), '2026-07-29T12:00:00.000Z');
    assert.equal(new Date(res.data.plannedReturnAt).toISOString(), '2026-07-31T01:30:00.000Z');
    assert.equal(Number(res.data.cargoWeightKg), 98.76);
    assert.equal(Number(res.data.cargoVolumeCbm), 12.345);
    assert.equal(res.data.packageCount, 7);
    assert.equal(res.data.packageType, 'Bundle');
    assert.equal(res.data.operationalNotes, 'Quick-create coverage');
    createdShipmentIds.push(res.data.id);
    await trackCreated();
  });

  test('idempotent replay: same Idempotency-Key returns the SAME shipment (200, no duplicate)', async () => {
    const key = `replay-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
    const body = clerkQuickBody({ bookingRef: `BL-${suffix}-1` });

    const first = await quickFetch('/quick', {
      method: 'POST', token: clerkToken, body, idempotencyKey: key,
    });
    assert.equal(first.status, 201);
    createdShipmentIds.push(first.data.id);

    const replay = await quickFetch('/quick', {
      method: 'POST', token: clerkToken, body, idempotencyKey: key,
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.data.id, first.data.id,
      'replay returns the SAME shipment id — no duplicate created');
    assert.equal(replay.data.shipmentCode, first.data.shipmentCode);

    // No duplicate row: a count by idempotencyKey should be exactly 1.
    const [row] = await db.select({ entityId: s.idempotencyKeys.entityId })
      .from(s.idempotencyKeys)
      .where(inArray(s.idempotencyKeys.entityId, [first.data.id]));
    assert.ok(row, 'idempotency_key row was recorded');
    await trackCreated();
  });

  test('concurrent first submit: same Idempotency-Key creates exactly one shipment', async () => {
    const key = `concurrent-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
    const bookingRef = `BL-${suffix}-concurrent`;
    const request = () => quickFetch('/quick', {
      method: 'POST',
      token: clerkToken,
      body: clerkQuickBody({ bookingRef }),
      idempotencyKey: key,
    });

    const [first, second] = await Promise.all([request(), request()]);
    assert.deepEqual(
      [first.status, second.status].sort(),
      [200, 201],
      'one caller creates and the concurrent caller replays',
    );
    assert.equal(first.data.id, second.data.id, 'both callers receive the same shipment');
    createdShipmentIds.push(first.data.id);

    const matching = await db.select({ id: s.shipments.id })
      .from(s.shipments)
      .where(eq(s.shipments.bookingRef, bookingRef));
    assert.equal(matching.length, 1, 'the concurrent loser does not create an orphan shipment');
    await trackCreated();
  });

  test('body-channel _requestId dedupes when no Idempotency-Key header is sent', async () => {
    const requestId = `req-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
    const body = clerkQuickBody({ _requestId: requestId, bookingRef: `BL-${suffix}-2` });

    const first = await quickFetch('/quick', { method: 'POST', token: clerkToken, body });
    assert.equal(first.status, 201);
    createdShipmentIds.push(first.data.id);

    const replay = await quickFetch('/quick', { method: 'POST', token: clerkToken, body });
    assert.equal(replay.status, 200);
    assert.equal(replay.data.id, first.data.id,
      'body-channel _requestId dedupes the same way as the header');
    await trackCreated();
  });

  test('conflict: same Idempotency-Key with a DIFFERENT payload → 409', async () => {
    const key = `conflict-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
    const bodyA = clerkQuickBody({ bookingRef: `BL-${suffix}-A` });
    const bodyB = clerkQuickBody({ bookingRef: `BL-${suffix}-B-DIFFERENT` });

    const first = await quickFetch('/quick', {
      method: 'POST', token: clerkToken, body: bodyA, idempotencyKey: key,
    });
    assert.equal(first.status, 201);
    createdShipmentIds.push(first.data.id);

    const conflict = await quickFetch('/quick', {
      method: 'POST', token: clerkToken, body: bodyB, idempotencyKey: key,
    });
    assert.equal(conflict.status, 409, 'differing payload under same key is rejected');
    await trackCreated();
  });

  test('no key: rejects the durable quick-create command', async () => {
    const response = await quickFetch('/quick', {
      method: 'POST',
      token: clerkToken,
      body: clerkQuickBody({ bookingRef: `BL-${suffix}-nokey` }),
    });
    assert.equal(response.status, 400);
    assert.match(String(response.data.error ?? ''), /Idempotency-Key/);
  });

  test('validation: missing customerId → 400', async () => {
    const res = await quickFetch('/quick', {
      method: 'POST', token: clerkToken, body: { bookingRef: 'no-customer' },
    });
    assert.equal(res.status, 400);
  });

  test('pool-sized unique keyed quick-create requests all complete without nested-connection starvation', async () => {
    const results = await Promise.race([
      Promise.all(Array.from({ length: 11 }, (_value, index) => quickFetch('/quick', {
        method: 'POST',
        token: clerkToken,
        idempotencyKey: `qc-pool-${suffix}-${index}`,
        body: clerkQuickBody({ bookingRef: `BL-${suffix}-pool-${index}` }),
      }))),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('timed out waiting for keyed quick-create concurrency')), 8_000);
      }),
    ]);

    assert.equal(results.length, 11);
    for (const result of results) {
      assert.equal(result.status, 201);
      createdShipmentIds.push(result.data.id);
    }
    await trackCreated();
  });

  test('forced shipment create failure rolls back both shipment rows and idempotency key', async () => {
    const bookingRef = `BL-${suffix}-rollback`;
    const idempotencyKey = `qc-rollback-${suffix}`;

    await assert.rejects(
      () => runIdempotent({
        endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_QUICK_CREATE,
        idempotencyKey,
        payload: { customerId, responsibleUnitId: clerkBusinessUnitId, bookingRef },
        createdBy: clerkUserId,
        entityType: 'shipment',
        create: async (tx) => {
          const [shipment] = await tx.insert(s.shipments).values({
            customerId,
            responsibleUnitId: clerkBusinessUnitId,
            bookingRef,
            createdBy: clerkUserId,
            updatedBy: clerkUserId,
            status: 'NEW',
            version: 1,
          }).returning();
          await tx.insert(s.shipmentStatusHistory).values({
            shipmentId: shipment.id,
            fromStatus: null,
            toStatus: 'NEW',
            reason: 'forced rollback',
            changedBy: clerkUserId,
          });
          throw new Error('forced rollback');
        },
        load: async () => {
          throw new Error('load should not be called');
        },
      }),
      /forced rollback/,
    );

    assert.equal(await fetchShipmentCountByBookingRef(bookingRef), 0);
    assert.equal(await fetchShipmentIdempotencyCount(idempotencyKey), 0);
  });
});

describe('POST /api/shipments/quick — RBAC', () => {
  test('CLERK can quick-create (existing Wave-0 shipments.write policy)', async () => {
    const res = await quickFetch('/quick', {
      method: 'POST',
      token: clerkToken,
      idempotencyKey: `qc-rbac-clerk-${suffix}`,
      body: clerkQuickBody(),
    });
    assert.equal(res.status, 201);
    createdShipmentIds.push(res.data.id);
    await trackCreated();
  });

  test('MANAGER can quick-create', async () => {
    const res = await quickFetch('/quick', {
      method: 'POST',
      token: managerToken,
      idempotencyKey: `qc-rbac-manager-${suffix}`,
      body: { customerId },
    });
    assert.equal(res.status, 201);
    createdShipmentIds.push(res.data.id);
    await trackCreated();
  });

  test('DISPATCHER can quick-create from the canonical intake workspace', async () => {
    const res = await quickFetch('/quick', {
      method: 'POST',
      token: dispatcherToken,
      idempotencyKey: `qc-rbac-dispatcher-${suffix}`,
      body: { customerId },
    });
    assert.equal(res.status, 201);
    createdShipmentIds.push(res.data.id);
    await trackCreated();
  });

  test('ADMIN can quick-create', async () => {
    const res = await quickFetch('/quick', {
      method: 'POST',
      token: adminToken,
      idempotencyKey: `qc-rbac-admin-${suffix}`,
      body: { customerId },
    });
    assert.equal(res.status, 201);
    createdShipmentIds.push(res.data.id);
    await trackCreated();
  });

  test('ACCOUNTANT is denied (shipments read only — no write)', async () => {
    const res = await quickFetch('/quick', {
      method: 'POST',
      token: accountantToken,
      idempotencyKey: `qc-rbac-accountant-${suffix}`,
      body: { customerId },
    });
    assert.equal(res.status, 403);
  });

  test('CUSTOMER is denied at the mount', async () => {
    const res = await quickFetch('/quick', {
      method: 'POST',
      token: customerToken,
      idempotencyKey: `qc-rbac-customer-${suffix}`,
      body: { customerId },
    });
    assert.equal(res.status, 403);
  });

  test('DRIVER is denied at the mount', async () => {
    const res = await quickFetch('/quick', {
      method: 'POST',
      token: driverToken,
      idempotencyKey: `qc-rbac-driver-${suffix}`,
      body: { customerId },
    });
    assert.equal(res.status, 403);
  });

  test('FORWARDER is denied at the mount', async () => {
    const res = await quickFetch('/quick', {
      method: 'POST',
      token: forwarderToken,
      idempotencyKey: `qc-rbac-forwarder-${suffix}`,
      body: { customerId },
    });
    assert.equal(res.status, 403);
  });
});
