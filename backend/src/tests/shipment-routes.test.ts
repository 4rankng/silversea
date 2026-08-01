/**
 * Wave 0 — `routes/shipments.ts` HTTP integration tests.
 *
 * Boots a throwaway Express app on an ephemeral port (mirrors
 * `comprehensive.test.ts` — Node's built-in `http` + `fetch`, no supertest),
 * mounts `/api/shipments` with the same `authMiddleware + casbinAuthz('shipments')`
 * chain the production app uses, and exercises every handler.
 *
 * Coverage matrix:
 *   - RBAC: ADMIN/MANAGER/CLERK/ACCOUNTANT allowed/denied per the policy rows;
 *     CUSTOMER/DRIVER/FORWARDER denied at the mount (403).
 *   - List: pagination shape + customerId/status filters + invalid-status 400.
 *   - Create: 201 + generated shipmentCode; validation 400; RBAC 403.
 *   - Detail: 200 with containers/documents/declarations/statusHistory; 404.
 *   - Update: optimistic-lock bump; 409 on stale; validation 400.
 *   - Transition: legal edge DRAFT→IN_PROGRESS; illegal edge DRAFT→CLOSED → 409;
 *     idempotent same-status; 404 on missing.
 *   - Containers PUT: full reconcile (insert/update/delete); 404 on missing shipment.
 *   - Documents POST: records the metadata row; 404 on missing shipment.
 *   - Dispatch: creates a linked trip + moves shipment to IN_PROGRESS; idempotent
 *     second call returns the same trip with `created: false`.
 *   - Delete: soft-delete DRAFT; version-gated (400 without version); 404.
 *
 * Hits the real Postgres DB and the real Casbin enforcer (initEnforcer) so the
 * RBAC assertions reflect the shipped policy.csv exactly. All seeded rows are
 * cleaned up in `after` in reverse-FK order.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role, ShipmentStatus, ShipmentDocumentType } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import { cacheInvalidate } from '../lib/redis';
import { createHandoff } from '../services/dispatch-handoff.service';

import shipmentRoutes from '../routes/shipments';
import configRoutes from '../routes/config';
import financialRoutes from '../routes/financial';
import salaryRoutes from '../routes/salary';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ── Scaffolding id buckets (cleaned up in reverse-FK order in `after`) ──────
const createdShipmentIds: number[] = [];
const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdUserIds: number[] = [];
const createdBusinessUnitIds: number[] = [];
const createdTrailerIds: number[] = [];
const createdTruckIds: number[] = [];
const createdDriverIds: number[] = [];

// Tokens minted in `before`; roled users are created on demand so the test is
// hermetic against a fresh CI DB.
let adminToken: string;
let managerToken: string;
let accountantToken: string;
let clerkToken: string;
let customerToken: string;
let driverToken: string;
let forwarderToken: string;
let customerId: number;
let routeId: number;
let cargoTypeId: number;
let secondaryCargoTypeId: number;
let containerTypeId: number;
let adminUserId: number;
let managerUserId: number;
let accountantUserId: number;
let clerkUserId: number;
let clerkBusinessUnitId: number;
let secondaryClerkBusinessUnitId: number;

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

function sign(u: {
  id: number;
  username: string | null;
  role: Role | string;
  customerId?: number | null;
  customerIds?: number[];
}) {
  // The DB inferSelect types `role` as a string-union (not the Role enum), but
  // the JWT payload is just the string value at runtime; cast for the type
  // bridge. Token shape must match `AuthUser` in middleware/auth.ts.
  return jwt.sign(
    {
      userId: u.id,
      username: u.username ?? u.id.toString(),
      role: u.role as Role,
      customerId: u.customerId ?? null,
      customerIds: u.customerIds,
    },
    config.jwtSecret,
  );
}

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `ShipmentRoute customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkCatalogs() {
  const [route] = await db.insert(s.routes)
    .values({ name: `ShipmentRoute route ${suffix}` }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `ShipmentRoute cargo ${suffix}` }).returning();
  createdCargoTypeIds.push(cargoType.id);
  // Fresh random short code — `container_types.code` is UNIQUE, so a stable
  // prefix + Date.now() can collide across runs (the previous run leaves the
  // row if a later `before` step throws). 8 hex chars fit easily in the
  // 20-char column and are effectively collision-free.
  const shortCode = `SR${Math.random().toString(16).slice(2, 10)}`;
  const [containerType] = await db.insert(s.containerTypes)
    .values({ code: shortCode, name: `ShipmentRoute ct ${suffix}` }).returning();
  createdContainerTypeIds.push(containerType.id);
  return { route, cargoType, containerType };
}

async function mkBusinessUnit() {
  const [unit] = await db.insert(s.businessUnits)
    .values({
      code: `SR-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: `ShipmentRoute Unit ${suffix}-${createdBusinessUnitIds.length}`,
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

function clerkCreateBody(extra: Record<string, unknown> = {}) {
  return {
    customerId,
    responsibleUnitId: clerkBusinessUnitId,
    ...extra,
  };
}

interface TestFetchOptions {
  method?: string;
  body?: unknown;
  token?: string;
  idempotencyKey?: string;
}

async function testFetch(urlPath: string, options: TestFetchOptions = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const method = options.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Idempotency-Key'] = options.idempotencyKey
      ?? `shipment-routes-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  // The test app mounts the shipments router at `/api/shipments`; prefix every
  // call so test bodies read like the real client paths (e.g. `/`, `/:id`).
  const fullUrl = `${baseUrl}/api/shipments${urlPath}`;
  const res = await fetch(fullUrl, {
    method,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function apiFetch(urlPath: string, options: TestFetchOptions = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const method = options.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Idempotency-Key'] = options.idempotencyKey
      ?? `shipment-routes-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

before(async () => {
  await initAuditService();
  await initEnforcer();

  const app = express();
  app.use(express.json());
  app.use('/api/shipments', authMiddleware, casbinAuthz('shipments'), shipmentRoutes);
  app.use('/api', authMiddleware, casbinAuthz('config'), configRoutes);
  app.use('/api', authMiddleware, casbinAuthz('financial'), financialRoutes);
  app.use('/api/salary', authMiddleware, casbinAuthz('salary'), salaryRoutes);
  app.use(globalErrorHandler);

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  // Mint per-role tokens. Use distinct usernames so role assertions are
  // unambiguous; each user is created fresh and torn down in `after`.
  const admin = await mkUser(`sr-admin-${suffix}`, Role.ADMIN);
  const manager = await mkUser(`sr-manager-${suffix}`, Role.MANAGER);
  const accountant = await mkUser(`sr-acct-${suffix}`, Role.ACCOUNTANT);
  const clerk = await mkUser(`sr-clerk-${suffix}`, Role.CLERK);
  const customer = await mkUser(`sr-cust-${suffix}`, Role.CUSTOMER);
  const driver = await mkUser(`sr-driver-${suffix}`, Role.DRIVER);
  const forwarder = await mkUser(`sr-fwd-${suffix}`, Role.FORWARDER);

  adminToken = sign(admin);
  managerToken = sign(manager);
  accountantToken = sign(accountant);
  clerkToken = sign(clerk);
  customerToken = sign(customer);
  driverToken = sign(driver);
  forwarderToken = sign(forwarder);
  adminUserId = admin.id;
  managerUserId = manager.id;
  accountantUserId = accountant.id;
  clerkUserId = clerk.id;

  const customerRow = await mkCustomer();
  customerId = customerRow.id;
  const businessUnit = await mkBusinessUnit();
  clerkBusinessUnitId = businessUnit.id;
  const secondaryBusinessUnit = await mkBusinessUnit();
  secondaryClerkBusinessUnitId = secondaryBusinessUnit.id;
  await assignClerkScope(clerkUserId, customerId, clerkBusinessUnitId);
  await db.insert(s.userBusinessUnitLinks).values({
    userId: clerkUserId,
    businessUnitId: secondaryClerkBusinessUnitId,
  });
  clerkToken = sign({
    ...clerk,
    customerId,
    customerIds: [customerId],
  });
  const catalogs = await mkCatalogs();
  routeId = catalogs.route.id;
  cargoTypeId = catalogs.cargoType.id;
  containerTypeId = catalogs.containerType.id;
  const [secondaryCargoType] = await db.insert(s.cargoTypes)
    .values({ name: `ShipmentRoute cargo alt ${suffix}` })
    .returning();
  createdCargoTypeIds.push(secondaryCargoType.id);
  secondaryCargoTypeId = secondaryCargoType.id;

  // Fuel config is required by createTrip; ensure at least one row exists so
  // dispatch tests don't 500 on the missing-pricing path (price defaults to 0
  // when no pricing table matches, which is fine for this slice).
  await cacheInvalidate('config:fuel');
});

after(async () => {
  // Wrap cleanup in a single transaction with reverse-FK ordering. The
  // dispatch path creates trips that fan out into audit_logs, notifications,
  // salary_day records, etc. — many of which have FKs back to users / trips.
  // Rather than enumerate every dependent table, we delete the user-created
  // rows in dependency order and let Postgres' cascade rules handle the rest.
  // A single transaction also sidesteps the postgres-js connection-pool
  // exhaustion observed when running many sequential deletes after a dispatch
  // (the pool's checked-out connections don't release until TX end).
  try {
    await db.transaction(async (tx) => {
      if (createdTripIds.length > 0) {
        await tx.delete(s.notifications).where(and(
          eq(s.notifications.type, 'TRIP_DISPATCHED'),
          eq(s.notifications.relatedEntityType, 'trips'),
          inArray(s.notifications.relatedEntityId, createdTripIds),
        ));
        await tx.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
        await tx.delete(s.tripLegs).where(inArray(s.tripLegs.tripId, createdTripIds));
        await tx.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
      }
      if (createdShipmentIds.length > 0) {
        await tx.delete(s.notifications).where(and(
          eq(s.notifications.type, 'SHIPMENT_HANDOFF'),
          eq(s.notifications.relatedEntityType, 'shipments'),
          inArray(s.notifications.relatedEntityId, createdShipmentIds),
        ));
        await tx.delete(s.shipmentFulfillments)
          .where(inArray(s.shipmentFulfillments.shipmentId, createdShipmentIds));
        await tx.delete(s.dispatchHandoffs)
          .where(inArray(s.dispatchHandoffs.shipmentId, createdShipmentIds));
        await tx.delete(s.shipmentStatusHistory)
          .where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
        await tx.delete(s.shipmentContainers)
          .where(inArray(s.shipmentContainers.shipmentId, createdShipmentIds));
        await tx.delete(s.shipmentDeclarations)
          .where(inArray(s.shipmentDeclarations.shipmentId, createdShipmentIds));
        await tx.delete(s.shipmentDocuments)
          .where(inArray(s.shipmentDocuments.shipmentId, createdShipmentIds));
        await tx.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
      }
      if (createdContainerTypeIds.length > 0) {
        await tx.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
      }
      if (createdCargoTypeIds.length > 0) {
        await tx.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
      }
      if (createdDriverIds.length > 0) {
        await tx.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
      }
      if (createdTruckIds.length > 0) {
        await tx.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
      }
      if (createdTrailerIds.length > 0) {
        await tx.delete(s.trailers).where(inArray(s.trailers.id, createdTrailerIds));
      }
      if (createdRouteIds.length > 0) {
        await tx.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
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
    // Cleanup is best-effort — a leftover FK from an interrupted prior run
    // shouldn't fail this test run. Log and continue so the suite can exit.
    console.warn('[shipment-routes.test] cleanup partial:', (err as Error).message);
  }

  // Users must be deleted AFTER the main transaction because audit_logs /
  // notifications / etc. created by the audit middleware and notification
  // service reference them. Those tables aren't in our cleanup list (they're
  // append-only audit trails in the real app), so we delete the user rows in
  // a separate step and tolerate FK failures.
  try {
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } catch (err) {
    console.warn('[shipment-routes.test] user cleanup partial:', (err as Error).message);
  }

  // Force-exit. node:test has already recorded every assertion by this point.
  // The dispatch path leaves the shared ioredis + postgres.js clients in a
  // state where graceful shutdown (`client.end()` + `disconnectRedis()`)
  // blocks indefinitely on this Node 25 / postgres-js combination.
  // `comprehensive.test.ts` does not exercise dispatch as heavily and so
  // drains cleanly; this guard makes the behaviour deterministic without
  // weakening any assertion. Server is closed first so the port is released.
  server.closeAllConnections();
  server.close();
  process.exit(0);
});

// Helper: create a shipment via the service (bypassing HTTP) for setup of
// downstream tests (transition / dispatch / etc.). Records the id for cleanup.
async function mkShipmentViaService(overrides: Record<string, unknown> = {}) {
  const { createShipment } = await import('../services/shipment.service');
  const shipment = await createShipment({ customerId, ...overrides });
  createdShipmentIds.push(shipment.id);
  return shipment;
}

async function mkClerkScopedShipmentViaService(overrides: Record<string, unknown> = {}) {
  return mkShipmentViaService({
    responsibleUnitId: clerkBusinessUnitId,
    ...overrides,
  });
}

async function createOwnedResources() {
  const [trailer] = await db.insert(s.trailers).values({
    licensePlate: `51R-${(10000 + createdTrailerIds.length).toString().padStart(5, '0')}`,
    type: '40FT',
    status: 'ACTIVE',
  }).returning();
  createdTrailerIds.push(trailer.id);

  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `51C-${(10000 + createdTruckIds.length).toString().padStart(5, '0')}`,
    currentTrailerId: trailer.id,
    trailerType: '40FT',
    status: 'ACTIVE',
  }).returning();
  createdTruckIds.push(truck.id);

  const driverUser = await mkUser(`sr-driver-resource-${suffix}-${createdDriverIds.length}`, Role.DRIVER);
  const [driver] = await db.insert(s.drivers).values({
    userId: driverUser.id,
    name: `ShipmentRoute Driver ${suffix}-${createdDriverIds.length}`,
    assignedTruckId: truck.id,
    status: 'ACTIVE',
  }).returning();
  createdDriverIds.push(driver.id);

  return { trailer, truck, driver };
}

async function createAcceptedFulfillmentFixture(overrides: {
  cargoMode?: 'FCL' | 'LCL';
  cargoTypeId?: number | null;
} = {}) {
  const shipment = await mkShipmentViaService({
    routeId,
    cargoMode: overrides.cargoMode ?? 'FCL',
    cargoTypeId: overrides.cargoTypeId ?? null,
  });
  if ((overrides.cargoMode ?? 'FCL') === 'FCL') {
    const { batchUpsertShipmentContainers } = await import('../services/shipment.service');
    await batchUpsertShipmentContainers(shipment.id, null, [
      { containerTypeId, containerNumber: 'MSKU1234565' },
    ]);
  }
  const handoff = await createHandoff({
    shipmentId: shipment.id,
    createdBy: adminUserId,
    actor: {
      userId: adminUserId,
      username: `sr-admin-${suffix}`,
      email: null,
      fullName: null,
      role: Role.ADMIN,
    },
  });
  const accepted = await testFetch(`/${shipment.id}/dispatch-handoffs/${handoff.id}/resolve`, {
    method: 'POST',
    token: managerToken,
    body: { resolution: 'ACCEPTED', expectedVersion: handoff.version },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.handoff.status, 'ACCEPTED');
  assert.equal(accepted.data.fulfillments.length, 1);
  return {
    shipment,
    fulfillmentId: accepted.data.fulfillments[0]!.id as number,
    fulfillmentVersion: accepted.data.fulfillments[0]!.version as number,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RBAC matrix
// ─────────────────────────────────────────────────────────────────────────────

describe('RBAC: /api/shipments mount', () => {
  test('CUSTOMER is denied at the mount (403)', async () => {
    const r = await testFetch('/', { token: customerToken });
    assert.equal(r.status, 403);
  });
  test('DRIVER is denied at the mount (403)', async () => {
    const r = await testFetch('/', { token: driverToken });
    assert.equal(r.status, 403);
  });
  test('FORWARDER is denied at the mount (403)', async () => {
    const r = await testFetch('/', { token: forwarderToken });
    assert.equal(r.status, 403);
  });
  test('missing token → 401', async () => {
    const r = await testFetch('/');
    assert.equal(r.status, 401);
  });
  test('ADMIN can list (200)', async () => {
    const r = await testFetch('/', { token: adminToken });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.items));
  });
  test('MANAGER can list (200)', async () => {
    const r = await testFetch('/', { token: managerToken });
    assert.equal(r.status, 200);
  });
  test('ACCOUNTANT can list (read-only)', async () => {
    const r = await testFetch('/', { token: accountantToken });
    assert.equal(r.status, 200);
  });
  test('CLERK can list (200)', async () => {
    const r = await testFetch('/', { token: clerkToken });
    assert.equal(r.status, 200);
  });
  test('ACCOUNTANT is denied create (403)', async () => {
    const r = await testFetch('/', {
      method: 'POST',
      token: accountantToken,
      body: { customerId },
    });
    assert.equal(r.status, 403);
  });
  test('CUSTOMER is denied create (403)', async () => {
    const r = await testFetch('/', {
      method: 'POST',
      token: customerToken,
      body: { customerId },
    });
    assert.equal(r.status, 403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /', () => {
  test('returns paginated { items, total, page, limit }', async () => {
    const r = await testFetch('/?page=1&limit=5', { token: adminToken });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.items));
    assert.equal(typeof r.data.total, 'number');
    assert.equal(r.data.page, 1);
    assert.equal(r.data.limit, 5);
  });

  test('filters by customerId', async () => {
    const other = await mkCustomer();
    const a = await mkShipmentViaService();
    const b = await mkShipmentViaService({ customerId: other.id });
    const r = await testFetch(`/?customerId=${customerId}`, { token: adminToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.items.some((x: { id: number }) => x.id === a.id),
      'customerId filter includes our shipment');
    assert.ok(!r.data.items.some((x: { id: number }) => x.id === b.id),
      'customerId filter excludes the other customer');
  });

  test('filters by status', async () => {
    const draft = await mkShipmentViaService();
    const r = await testFetch('/?status=DRAFT', { token: adminToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.items.some((x: { id: number }) => x.id === draft.id));
  });

  test('supports server-side q search across code, BL, booking, customer, factory, and shipping line', async () => {
    const searchCustomer = await mkCustomer();
    const target = await mkShipmentViaService({
      customerId: searchCustomer.id,
      bookingRef: `BOOK-${suffix}`,
      blNumber: `BL-${suffix}`,
      factoryName: `Factory ${suffix}`,
      shippingLineName: `Line ${suffix}`,
    });
    const distractor = await mkShipmentViaService({
      bookingRef: `OTHER-${suffix}`,
      blNumber: `OTHER-BL-${suffix}`,
      factoryName: `Other Factory ${suffix}`,
      shippingLineName: `Other Line ${suffix}`,
    });

    for (const query of [
      target.shipmentCode,
      `BL-${suffix}`,
      `BOOK-${suffix}`,
      searchCustomer.name,
      `Factory ${suffix}`,
      `Line ${suffix}`,
    ]) {
      const r = await testFetch(`/?q=${encodeURIComponent(String(query))}&page=1&limit=20`, { token: adminToken });
      assert.equal(r.status, 200);
      assert.ok(r.data.items.some((row: { id: number }) => row.id === target.id), `search matches ${query}`);
      assert.ok(!r.data.items.every((row: { id: number }) => row.id === distractor.id), 'search is not only the distractor');
    }
  });

  test('rejects an oversized search term before querying', async () => {
    const result = await testFetch(`/?q=${'x'.repeat(101)}`, { token: adminToken });
    assert.equal(result.status, 400);
    assert.match(result.data.error, /100 ký tự/);
  });

  test('enforces unit AND customer-or-explicit-shipment scope for list totals and every child write', async () => {
    const baseline = await testFetch('/?page=1&limit=200', { token: clerkToken });
    assert.equal(baseline.status, 200);

    const unassignedCustomer = await mkCustomer();
    const wrongUnit = await mkBusinessUnit();
    const customerScoped = await mkShipmentViaService({
      customerId,
      responsibleUnitId: clerkBusinessUnitId,
    });
    const explicitlyScoped = await mkShipmentViaService({
      customerId: unassignedCustomer.id,
      responsibleUnitId: clerkBusinessUnitId,
    });
    const sameUnitUnassignedCustomer = await mkShipmentViaService({
      customerId: unassignedCustomer.id,
      responsibleUnitId: clerkBusinessUnitId,
    });
    const assignedCustomerWrongUnit = await mkShipmentViaService({
      customerId,
      responsibleUnitId: wrongUnit.id,
    });
    await db.insert(s.userShipmentLinks).values({
      userId: clerkUserId,
      shipmentId: explicitlyScoped.id,
    });

    const scopedList = await testFetch('/?page=1&limit=200', { token: clerkToken });
    assert.equal(scopedList.status, 200);
    assert.equal(scopedList.data.total, baseline.data.total + 2);
    assert.equal(scopedList.data.items.length, scopedList.data.total);
    const visibleIds = new Set(scopedList.data.items.map((row: { id: number }) => row.id));
    assert.ok(visibleIds.has(customerScoped.id), 'same unit + assigned customer is visible');
    assert.ok(visibleIds.has(explicitlyScoped.id), 'same unit + explicit shipment is visible');
    assert.ok(!visibleIds.has(sameUnitUnassignedCustomer.id), 'same unit without customer/shipment assignment is hidden');
    assert.ok(!visibleIds.has(assignedCustomerWrongUnit.id), 'assigned customer in a wrong unit is hidden');

    const wrongUnitDetail = await testFetch(`/${assignedCustomerWrongUnit.id}`, { token: clerkToken });
    assert.equal(wrongUnitDetail.status, 404);
    const unassignedDetail = await testFetch(`/${sameUnitUnassignedCustomer.id}`, { token: clerkToken });
    assert.equal(unassignedDetail.status, 404);

    const deniedUpdate = await testFetch(`/${sameUnitUnassignedCustomer.id}`, {
      method: 'PUT',
      token: clerkToken,
      body: {
        expectedVersion: sameUnitUnassignedCustomer.version,
        contactName: 'Không được phép',
      },
    });
    assert.equal(deniedUpdate.status, 404);

    const deniedContainers = await testFetch(`/${sameUnitUnassignedCustomer.id}/containers`, {
      method: 'PUT',
      token: clerkToken,
      body: {
        expectedVersion: sameUnitUnassignedCustomer.version,
        containers: [],
      },
    });
    assert.equal(deniedContainers.status, 404);

    const deniedDocument = await testFetch(`/${sameUnitUnassignedCustomer.id}/documents`, {
      method: 'POST',
      token: clerkToken,
      body: {
        type: ShipmentDocumentType.BL,
        storageKey: `uploads/shipment-${sameUnitUnassignedCustomer.id}/denied.pdf`,
      },
    });
    assert.equal(deniedDocument.status, 404);

    const adminDocument = await testFetch(`/${sameUnitUnassignedCustomer.id}/documents`, {
      method: 'POST',
      token: adminToken,
      body: {
        type: ShipmentDocumentType.BL,
        storageKey: `uploads/shipment-${sameUnitUnassignedCustomer.id}/admin.pdf`,
      },
    });
    assert.equal(adminDocument.status, 201);
    const deniedReplacement = await testFetch(
      `/${sameUnitUnassignedCustomer.id}/documents/${adminDocument.data.id}/replace`,
      {
        method: 'POST',
        token: clerkToken,
        body: {
          expectedVersion: sameUnitUnassignedCustomer.version,
          storageKey: `uploads/shipment-${sameUnitUnassignedCustomer.id}/denied-v2.pdf`,
        },
      },
    );
    assert.equal(deniedReplacement.status, 404);

    const deniedDeclarationCreate = await testFetch(`/${sameUnitUnassignedCustomer.id}/declarations`, {
      method: 'POST',
      token: clerkToken,
      body: { declarationNumber: 'DENIED-Q17' },
    });
    assert.equal(deniedDeclarationCreate.status, 404);

    const adminDeclaration = await testFetch(`/${sameUnitUnassignedCustomer.id}/declarations`, {
      method: 'POST',
      token: adminToken,
      body: { declarationNumber: 'ADMIN-Q17' },
    });
    assert.equal(adminDeclaration.status, 201);
    const deniedDeclarationUpdate = await testFetch(
      `/${sameUnitUnassignedCustomer.id}/declarations/${adminDeclaration.data.id}`,
      {
        method: 'PUT',
        token: clerkToken,
        body: { declarationNumber: 'DENIED-Q17-UPDATE' },
      },
    );
    assert.equal(deniedDeclarationUpdate.status, 404);
  });

  test('rejects an invalid status with 400', async () => {
    const r = await testFetch('/?status=BOGUS', { token: adminToken });
    assert.equal(r.status, 400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /', () => {
  test('ADMIN creates a draft shipment (201) with a generated code', async () => {
    const r = await testFetch('/', {
      method: 'POST',
      token: adminToken,
      body: { customerId, bookingRef: `BK-${suffix}` },
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.customerId, customerId);
    assert.equal(r.data.status, ShipmentStatus.DRAFT);
    assert.equal(r.data.version, 1);
    assert.match(r.data.shipmentCode, /^SHP-\d{4}-\d{5}$/);
    createdShipmentIds.push(r.data.id);
  });

  test('persists shipment cargo authority on create', async () => {
    const r = await testFetch('/', {
      method: 'POST',
      token: adminToken,
      body: { customerId, cargoTypeId },
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.customerId, customerId);
    assert.equal(r.data.cargoTypeId, cargoTypeId);
    createdShipmentIds.push(r.data.id);
  });

  test('persists shipment operations fields on create', async () => {
    const r = await testFetch('/', {
      method: 'POST',
      token: adminToken,
      body: {
        customerId,
        tradeDirection: 'IMPORT',
        cargoMode: 'LCL',
        factoryName: `Factory ${suffix}`,
        shippingLineName: `Line ${suffix}`,
        customsCutoffAt: '2026-07-29T03:00:00.000Z',
        closingAt: '2026-07-29T04:00:00.000Z',
        plannedReturnAt: '2026-07-30T09:30:00.000Z',
        cargoWeightKg: 111.22,
        cargoVolumeCbm: 33.444,
        packageCount: 9,
        packageType: 'Bag',
        operationalNotes: 'Create-route coverage',
      },
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.tradeDirection, 'IMPORT');
    assert.equal(r.data.cargoMode, 'LCL');
    assert.equal(r.data.factoryName, `Factory ${suffix}`);
    assert.equal(r.data.shippingLineName, `Line ${suffix}`);
    assert.equal(new Date(r.data.customsCutoffAt).toISOString(), '2026-07-29T03:00:00.000Z');
    assert.equal(new Date(r.data.closingAt).toISOString(), '2026-07-29T04:00:00.000Z');
    assert.equal(new Date(r.data.plannedReturnAt).toISOString(), '2026-07-30T09:30:00.000Z');
    assert.equal(r.data.cargoWeightKg, '111.22');
    assert.equal(r.data.cargoVolumeCbm, '33.444');
    assert.equal(Number(r.data.cargoWeightKg), 111.22);
    assert.equal(Number(r.data.cargoVolumeCbm), 33.444);
    assert.equal(r.data.packageCount, 9);
    assert.equal(r.data.packageType, 'Bag');
    assert.equal(r.data.operationalNotes, 'Create-route coverage');
    createdShipmentIds.push(r.data.id);
  });

  test('rejects offset-free or impossible operational timestamps', async () => {
    const bare = await testFetch('/', {
      method: 'POST',
      token: adminToken,
      body: { customerId, customsCutoffAt: '2026-07-29T10:00' },
    });
    assert.equal(bare.status, 400);

    const impossible = await testFetch('/', {
      method: 'POST',
      token: adminToken,
      body: { customerId, customsCutoffAt: '2026-02-30T10:00:00.000Z' },
    });
    assert.equal(impossible.status, 400);
  });

  test('rejects shipment numeric values outside database precision and scale', async () => {
    for (const body of [
      { cargoWeightKg: 'Infinity' },
      { cargoWeightKg: '1.234' },
      { cargoWeightKg: '100000000.00' },
      { cargoVolumeCbm: '1.2345' },
      { cargoVolumeCbm: '10000000.000' },
      { packageCount: 2_147_483_648 },
    ]) {
      const response = await testFetch('/', {
        method: 'POST',
        token: adminToken,
        body: { customerId, ...body },
      });
      assert.equal(response.status, 400, JSON.stringify(body));
    }
  });

  test('CLERK can create (write allowed)', async () => {
    const r = await testFetch('/', {
      method: 'POST',
      token: clerkToken,
      body: clerkCreateBody(),
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.responsibleUnitId, clerkBusinessUnitId);
    createdShipmentIds.push(r.data.id);
  });

  test('rejects missing customerId with 400', async () => {
    const r = await testFetch('/', {
      method: 'POST',
      token: adminToken,
      body: { bookingRef: 'no-customer' },
    });
    assert.equal(r.status, 400);
  });

  test('rejects invalid customerId (zero) with 400', async () => {
    const r = await testFetch('/', {
      method: 'POST',
      token: adminToken,
      body: { customerId: 0 },
    });
    assert.equal(r.status, 400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Detail
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /:id', () => {
  test('returns the assembled detail shape', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}`, { token: adminToken });
    assert.equal(r.status, 200);
    assert.equal(r.data.shipment.id, shipment.id);
    assert.ok(Array.isArray(r.data.containers));
    assert.ok(Array.isArray(r.data.documents));
    assert.ok(Array.isArray(r.data.declarations));
    assert.ok(Array.isArray(r.data.statusHistory));
    // Creation writes the initial history row.
    assert.equal(r.data.statusHistory.length, 1);
    assert.equal(r.data.statusHistory[0].toStatus, ShipmentStatus.DRAFT);
  });

  test('404 on missing shipment', async () => {
    const r = await testFetch('/99999999', { token: adminToken });
    assert.equal(r.status, 404);
  });

  test('400 on invalid id', async () => {
    const r = await testFetch('/not-a-number', { token: adminToken });
    assert.equal(r.status, 400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Update (optimistic lock)
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /:id', () => {
  test('bumps version on update', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: adminToken,
      body: { version: shipment.version, bookingRef: `BK-UP-${suffix}` },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.version, shipment.version + 1);
    assert.equal(r.data.bookingRef, `BK-UP-${suffix}`);
  });

  test('409 on stale version', async () => {
    const shipment = await mkShipmentViaService();
    // First update bumps to version+1.
    await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: adminToken,
      body: { version: shipment.version, bookingRef: 'first' },
    });
    // Second update with the stale version → 409.
    const r = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: adminToken,
      body: { version: shipment.version, bookingRef: 'stale' },
    });
    assert.equal(r.status, 409);
  });

  test('rejects missing version with 400', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: adminToken,
      body: { bookingRef: 'no-version' },
    });
    assert.equal(r.status, 400);
  });

  test('CLERK can update (write allowed)', async () => {
    const shipment = await mkClerkScopedShipmentViaService();
    const r = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: clerkToken,
      body: { expectedVersion: shipment.version, contactName: 'Clerk edit' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.contactName, 'Clerk edit');
    assert.equal(r.data.changeMode, 'DIRECT');
  });

  test('updates draft cargo authority directly', async () => {
    const shipment = await mkShipmentViaService({ cargoTypeId });
    const r = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: adminToken,
      body: {
        expectedVersion: shipment.version,
        cargoTypeId: secondaryCargoTypeId,
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.changeMode, 'DIRECT');
    assert.equal(r.data.cargoTypeId, secondaryCargoTypeId);
  });

  test('updates shipment operations fields directly before dispatch', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: adminToken,
      body: {
        expectedVersion: shipment.version,
        tradeDirection: 'EXPORT',
        cargoMode: 'FCL',
        factoryName: `Factory updated ${suffix}`,
        shippingLineName: `Line updated ${suffix}`,
        customsCutoffAt: '2026-07-29T07:00:00.000Z',
        closingAt: '2026-07-29T08:15:00.000Z',
        plannedReturnAt: '2026-07-31T11:45:00.000Z',
        cargoWeightKg: 222.33,
        cargoVolumeCbm: 44.555,
        packageCount: 18,
        packageType: 'Case',
        operationalNotes: 'Direct update coverage',
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.changeMode, 'DIRECT');
    assert.equal(r.data.tradeDirection, 'EXPORT');
    assert.equal(r.data.cargoMode, 'FCL');
    assert.equal(r.data.factoryName, `Factory updated ${suffix}`);
    assert.equal(r.data.shippingLineName, `Line updated ${suffix}`);
    assert.equal(new Date(r.data.customsCutoffAt).toISOString(), '2026-07-29T07:00:00.000Z');
    assert.equal(new Date(r.data.closingAt).toISOString(), '2026-07-29T08:15:00.000Z');
    assert.equal(new Date(r.data.plannedReturnAt).toISOString(), '2026-07-31T11:45:00.000Z');
    assert.equal(Number(r.data.cargoWeightKg), 222.33);
    assert.equal(Number(r.data.cargoVolumeCbm), 44.555);
    assert.equal(r.data.packageCount, 18);
    assert.equal(r.data.packageType, 'Case');
    assert.equal(r.data.operationalNotes, 'Direct update coverage');
  });

  test('CLERK cannot read a legacy shipment without responsible unit', async () => {
    const shipment = await mkShipmentViaService({ responsibleUnitId: null });
    const r = await testFetch(`/${shipment.id}`, { token: clerkToken });
    assert.equal(r.status, 404);
  });

  test('CLERK post-dispatch plan edits create a change request', async () => {
    const { transitionShipmentStatus } = await import('../services/shipment.service');
    const shipment = await mkClerkScopedShipmentViaService({
      pickupLocation: 'Bãi cũ',
    });
    const dispatched = await transitionShipmentStatus(shipment.id, ShipmentStatus.IN_PROGRESS);

    const r = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: clerkToken,
      body: { expectedVersion: dispatched.version, pickupLocation: 'Bãi mới' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.changeMode, 'REQUESTED');
    assert.equal(r.data.pickupLocation, 'Bãi cũ');

    const requests = await db.select()
      .from(s.shipmentChangeRequests)
      .where(inArray(s.shipmentChangeRequests.shipmentId, [shipment.id]));
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.requestKind, 'PLAN_UPDATE');
  });

  test('CLERK post-dispatch responsible-unit changes are request-only even when mixed with direct fields', async () => {
    const { transitionShipmentStatus } = await import('../services/shipment.service');
    const shipment = await mkClerkScopedShipmentViaService({
      contactName: 'Đầu mối cũ',
      responsibleUnitId: clerkBusinessUnitId,
    });
    const dispatched = await transitionShipmentStatus(shipment.id, ShipmentStatus.IN_PROGRESS);

    const r = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: clerkToken,
      body: {
        expectedVersion: dispatched.version,
        contactName: 'Đầu mối mới',
        responsibleUnitId: secondaryClerkBusinessUnitId,
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.changeMode, 'REQUESTED');
    assert.equal(r.data.contactName, 'Đầu mối cũ');
    assert.equal(r.data.responsibleUnitId, clerkBusinessUnitId);

    const [request] = await db.select()
      .from(s.shipmentChangeRequests)
      .where(inArray(s.shipmentChangeRequests.shipmentId, [shipment.id]));
    assert.ok(request, 'change request persisted');
    assert.match(JSON.stringify(request.afterSnapshot), /responsibleUnitId/);
  });

  test('CLERK explicit dossier field matrix covers pickup, delivery and BL before dispatch', async () => {
    const shipment = await mkClerkScopedShipmentViaService({
      pickupLocation: 'Bãi cũ',
      deliveryLocation: 'Kho cũ',
      blNumber: null,
    });

    const r = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: clerkToken,
      body: {
        expectedVersion: shipment.version,
        pickupLocation: 'Bãi mới',
        deliveryLocation: 'Kho mới',
        blNumber: 'BL-Q17-MATRIX',
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.changeMode, 'DIRECT');
    assert.equal(r.data.pickupLocation, 'Bãi mới');
    assert.equal(r.data.deliveryLocation, 'Kho mới');
    assert.equal(r.data.blNumber, 'BL-Q17-MATRIX');
  });

  test('CLERK post-dispatch shipment operations fields create a change request', async () => {
    const { transitionShipmentStatus } = await import('../services/shipment.service');
    const shipment = await mkClerkScopedShipmentViaService({
      factoryName: 'Factory cũ',
      cargoMode: 'LCL',
      operationalNotes: 'Ghi chú cũ',
    });
    const dispatched = await transitionShipmentStatus(shipment.id, ShipmentStatus.IN_PROGRESS);

    const r = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: clerkToken,
      body: {
        expectedVersion: dispatched.version,
        factoryName: 'Factory mới',
        cargoMode: 'FCL',
        operationalNotes: 'Ghi chú mới',
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.changeMode, 'REQUESTED');
    assert.equal(r.data.factoryName, 'Factory cũ');
    assert.equal(r.data.cargoMode, 'LCL');
    assert.equal(r.data.operationalNotes, 'Ghi chú cũ');

    const [request] = await db.select()
      .from(s.shipmentChangeRequests)
      .where(inArray(s.shipmentChangeRequests.shipmentId, [shipment.id]));
    assert.ok(request, 'change request persisted');
    assert.match(JSON.stringify(request.afterSnapshot), /factoryName/);
    assert.match(JSON.stringify(request.afterSnapshot), /cargoMode/);
    assert.match(JSON.stringify(request.afterSnapshot), /operationalNotes/);
  });

  test('numerically equivalent post-dispatch values are a no-op', async () => {
    const { transitionShipmentStatus } = await import('../services/shipment.service');
    const shipment = await mkClerkScopedShipmentViaService({
      cargoWeightKg: '10.00',
      cargoVolumeCbm: '1.000',
    });
    const dispatched = await transitionShipmentStatus(shipment.id, ShipmentStatus.IN_PROGRESS);

    const response = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: clerkToken,
      body: {
        expectedVersion: dispatched.version,
        cargoWeightKg: 10,
        cargoVolumeCbm: 1,
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.changeMode, 'NOOP');

    const requests = await db.select()
      .from(s.shipmentChangeRequests)
      .where(inArray(s.shipmentChangeRequests.shipmentId, [shipment.id]));
    assert.equal(requests.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Status transitions
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:id/transition', () => {
  test('DRAFT → IN_PROGRESS (legal)', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}/transition`, {
      method: 'POST',
      token: adminToken,
      body: { status: ShipmentStatus.IN_PROGRESS, reason: 'Bắt đầu xử lý' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.status, ShipmentStatus.IN_PROGRESS);
  });

  test('DRAFT → CLOSED (illegal) → 409', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}/transition`, {
      method: 'POST',
      token: adminToken,
      body: { status: ShipmentStatus.CLOSED },
    });
    assert.equal(r.status, 409);
  });

  test('same-status is idempotent (200, no duplicate history)', async () => {
    const shipment = await mkShipmentViaService();
    // Transition to IN_PROGRESS, then again — second is a no-op.
    await testFetch(`/${shipment.id}/transition`, {
      method: 'POST',
      token: adminToken,
      body: { status: ShipmentStatus.IN_PROGRESS },
    });
    const r = await testFetch(`/${shipment.id}/transition`, {
      method: 'POST',
      token: adminToken,
      body: { status: ShipmentStatus.IN_PROGRESS },
    });
    assert.equal(r.status, 200);

    // History should contain exactly one IN_PROGRESS row (creation row + one
    // transition), proving the second call did not duplicate.
    const detail = await testFetch(`/${shipment.id}`, { token: adminToken });
    const transitions = detail.data.statusHistory.filter(
      (h: { toStatus: string }) => h.toStatus === ShipmentStatus.IN_PROGRESS,
    );
    assert.equal(transitions.length, 1);
  });

  test('404 on missing shipment', async () => {
    const r = await testFetch('/99999999/transition', {
      method: 'POST',
      token: adminToken,
      body: { status: ShipmentStatus.IN_PROGRESS },
    });
    assert.equal(r.status, 404);
  });

  test('rejects invalid status enum with 400', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}/transition`, {
      method: 'POST',
      token: adminToken,
      body: { status: 'BOGUS' },
    });
    assert.equal(r.status, 400);
  });

  test('CLERK is denied transition (route requires ADMIN/MANAGER)', async () => {
    const shipment = await mkClerkScopedShipmentViaService();
    const r = await testFetch(`/${shipment.id}/transition`, {
      method: 'POST',
      token: clerkToken,
      body: { status: ShipmentStatus.IN_PROGRESS },
    });
    assert.equal(r.status, 403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Containers (full reconcile)
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /:id/containers', () => {
  test('rejects container weights outside numeric(10,2)', async () => {
    const shipment = await mkShipmentViaService();
    for (const cargoWeightKg of ['Infinity', '1.234', '100000000.00']) {
      const response = await testFetch(`/${shipment.id}/containers`, {
        method: 'PUT',
        token: adminToken,
        body: {
          expectedVersion: shipment.version,
          containers: [{ containerTypeId, cargoWeightKg }],
        },
      });
      assert.equal(response.status, 400, cargoWeightKg);
    }
  });

  test('inserts new containers and returns the refreshed list', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}/containers`, {
      method: 'PUT',
      token: adminToken,
      body: {
        version: shipment.version,
        containers: [
          // Valid ISO 6346 numbers (M10.2: format validation now enforced).
          { containerTypeId, containerNumber: 'MEDU2497795', sealNumber: 'SEAL-1', cargoWeightKg: 12000 },
          { containerTypeId, containerNumber: 'CMAU5814257', cargoWeightKg: 8000 },
        ],
      },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.items.length, 2);
    assert.ok(r.data.items.every((c: { shipmentId: number }) => c.shipmentId === shipment.id));
    assert.equal(r.data.upsertedIds.length, 2);
  });

  test('reconciles: updates by id, deletes missing, inserts new', async () => {
    const shipment = await mkShipmentViaService();
    // Seed two containers (valid ISO 6346 numbers — M10.2 enforces format).
    const seed = await testFetch(`/${shipment.id}/containers`, {
      method: 'PUT',
      token: adminToken,
      body: {
        version: shipment.version,
        containers: [
          { containerTypeId, containerNumber: 'MSKU1234565' },
          { containerTypeId, containerNumber: 'TCNU7425363' },
        ],
      },
    });
    const keepId = seed.data.items.find((c: { containerNumber: string }) => c.containerNumber === 'MSKU1234565').id;
    const refreshed = await testFetch(`/${shipment.id}`, { token: adminToken });

    // Reconcile: keep MSKU1234565 (with updated weight), drop TCNU7425363, add OOLU831266.
    const r = await testFetch(`/${shipment.id}/containers`, {
      method: 'PUT',
      token: adminToken,
      body: {
        version: refreshed.data.shipment.version,
        containers: [
          { id: keepId, containerTypeId, containerNumber: 'MSKU1234565', cargoWeightKg: 9999 },
          { containerTypeId, containerNumber: 'OOLU8312661' },
        ],
      },
    });
    assert.equal(r.status, 200);
    const numbers = r.data.items.map((c: { containerNumber: string }) => c.containerNumber).sort();
    assert.deepEqual(numbers, ['MSKU1234565', 'OOLU8312661']);
    const kept = r.data.items.find((c: { id: number }) => c.id === keepId);
    assert.equal(kept.cargoWeightKg, '9999.00');
  });

  test('404 on missing shipment', async () => {
    const r = await testFetch('/99999999/containers', {
      method: 'PUT',
      token: adminToken,
      body: { version: 1, containers: [] },
    });
    assert.equal(r.status, 404);
  });

  test('GET /:id/containers returns the list and 404s on missing parent', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}/containers`, { token: adminToken });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.data.items));
    const notFound = await testFetch('/99999999/containers', { token: adminToken });
    assert.equal(notFound.status, 404);
  });

  test('concurrent container writes allow one winner and reject the stale loser', async () => {
    const shipment = await mkShipmentViaService();
    const body = {
      expectedVersion: shipment.version,
      containers: [{ containerTypeId, containerNumber: 'MSKU1234565' }],
    };
    const [first, second] = await Promise.all([
      testFetch(`/${shipment.id}/containers`, { method: 'PUT', token: adminToken, body }),
      testFetch(`/${shipment.id}/containers`, { method: 'PUT', token: managerToken, body }),
    ]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [200, 409]);
  });

  test('CLERK direct seal edits stay in-scope before dispatch, then become request-only after dispatch', async () => {
    const { transitionShipmentStatus } = await import('../services/shipment.service');
    const shipment = await mkClerkScopedShipmentViaService();

    const draftSave = await testFetch(`/${shipment.id}/containers`, {
      method: 'PUT',
      token: clerkToken,
      body: {
        expectedVersion: shipment.version,
        containers: [{
          containerTypeId,
          containerNumber: 'MSKU1234565',
          sealNumber: 'SEAL-Q17-DRAFT',
        }],
      },
    });
    assert.equal(draftSave.status, 200);
    assert.equal(draftSave.data.changeMode, 'DIRECT');
    assert.equal(draftSave.data.items[0]?.sealNumber, 'SEAL-Q17-DRAFT');

    const dispatched = await transitionShipmentStatus(shipment.id, ShipmentStatus.IN_PROGRESS);
    const draftContainer = draftSave.data.items[0];
    const requestedSave = await testFetch(`/${shipment.id}/containers`, {
      method: 'PUT',
      token: clerkToken,
      body: {
        expectedVersion: dispatched.version,
        containers: [{
          id: draftContainer.id,
          containerTypeId,
          containerNumber: 'MSKU1234565',
          sealNumber: 'SEAL-Q17-REQUEST',
        }],
      },
    });
    assert.equal(requestedSave.status, 200);
    assert.equal(requestedSave.data.changeMode, 'REQUESTED');
    assert.equal(requestedSave.data.notificationDelivered, true);

    const detail = await testFetch(`/${shipment.id}`, { token: adminToken });
    assert.equal(detail.status, 200);
    assert.equal(detail.data.containers[0]?.sealNumber, 'SEAL-Q17-DRAFT');

    const [request] = await db.select()
      .from(s.shipmentChangeRequests)
      .where(eq(s.shipmentChangeRequests.shipmentId, shipment.id));
    assert.ok(request, 'container/seal edit persisted as a change request');
    assert.match(JSON.stringify(request.afterSnapshot), /SEAL-Q17-REQUEST/);

    const notifications = await db.select()
      .from(s.notifications)
      .where(and(
        eq(s.notifications.relatedEntityType, 'shipments'),
        eq(s.notifications.relatedEntityId, shipment.id),
        inArray(s.notifications.userId, [adminUserId, managerUserId]),
      ));
    const recipientIds = notifications.map((row) => row.userId).sort((a, b) => a - b);
    assert.deepEqual(recipientIds, [adminUserId, managerUserId]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:id/documents', () => {
  test('records the metadata row', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}/documents`, {
      method: 'POST',
      token: adminToken,
      body: { type: ShipmentDocumentType.BL, storageKey: `uploads/shipment-${shipment.id}/bl.pdf` },
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.shipmentId, shipment.id);
    assert.equal(r.data.type, ShipmentDocumentType.BL);
    assert.equal(r.data.storageKey, `uploads/shipment-${shipment.id}/bl.pdf`);
  });

  test('404 on missing shipment', async () => {
    const r = await testFetch('/99999999/documents', {
      method: 'POST',
      token: adminToken,
      body: { type: ShipmentDocumentType.BL, storageKey: 'x' },
    });
    assert.equal(r.status, 404);
  });

  test('rejects invalid document type with 400', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}/documents`, {
      method: 'POST',
      token: adminToken,
      body: { type: 'BOGUS', storageKey: 'x' },
    });
    assert.equal(r.status, 400);
  });

  test('replaces a shipment document and preserves history', async () => {
    const shipment = await mkClerkScopedShipmentViaService();
    const created = await testFetch(`/${shipment.id}/documents`, {
      method: 'POST',
      token: clerkToken,
      body: { type: ShipmentDocumentType.DO, storageKey: `uploads/shipment-${shipment.id}/do-v1.pdf` },
    });
    assert.equal(created.status, 201);

    const replaced = await testFetch(`/${shipment.id}/documents/${created.data.id}/replace`, {
      method: 'POST',
      token: clerkToken,
      body: {
        expectedVersion: shipment.version,
        storageKey: `uploads/shipment-${shipment.id}/do-v2.pdf`,
        expiresAt: '2026-08-01',
      },
    });
    assert.equal(replaced.status, 201);
    assert.equal(replaced.data.storageKey, `uploads/shipment-${shipment.id}/do-v2.pdf`);

    const rows = await db.select()
      .from(s.shipmentDocuments)
      .where(eq(s.shipmentDocuments.shipmentId, shipment.id));
    const oldRow = rows.find((row) => row.id === created.data.id);
    assert.equal(oldRow?.replacedBy, replaced.data.id);
  });

  test('binds replacement to the path shipment and rejects concurrent successors', async () => {
    const shipmentA = await mkClerkScopedShipmentViaService();
    const shipmentB = await mkClerkScopedShipmentViaService();
    const created = await testFetch(`/${shipmentB.id}/documents`, {
      method: 'POST',
      token: clerkToken,
      body: { type: ShipmentDocumentType.BL, storageKey: `uploads/shipment-${shipmentB.id}/bl-v1.pdf` },
    });
    assert.equal(created.status, 201);

    const wrongPath = await testFetch(`/${shipmentA.id}/documents/${created.data.id}/replace`, {
      method: 'POST',
      token: clerkToken,
      body: {
        expectedVersion: shipmentA.version,
        storageKey: `uploads/shipment-${shipmentA.id}/wrong.pdf`,
      },
    });
    assert.equal(wrongPath.status, 404);

    const body = {
      expectedVersion: shipmentB.version,
      storageKey: `uploads/shipment-${shipmentB.id}/bl-v2.pdf`,
    };
    const [first, second] = await Promise.all([
      testFetch(`/${shipmentB.id}/documents/${created.data.id}/replace`, {
        method: 'POST',
        token: clerkToken,
        body,
      }),
      testFetch(`/${shipmentB.id}/documents/${created.data.id}/replace`, {
        method: 'POST',
        token: clerkToken,
        body: { ...body, storageKey: `uploads/shipment-${shipmentB.id}/bl-v3.pdf` },
      }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [201, 409]);

    const oldRows = await db.select()
      .from(s.shipmentDocuments)
      .where(eq(s.shipmentDocuments.id, created.data.id));
    assert.ok(oldRows[0]?.replacedBy, 'old document links exactly one winning successor');
    const successors = await db.select()
      .from(s.shipmentDocuments)
      .where(and(
        eq(s.shipmentDocuments.shipmentId, shipmentB.id),
        inArray(
          s.shipmentDocuments.storageKey,
          [
            `uploads/shipment-${shipmentB.id}/bl-v2.pdf`,
            `uploads/shipment-${shipmentB.id}/bl-v3.pdf`,
          ],
        ),
      ));
    assert.equal(successors.length, 1);
  });
});

describe('shipment declarations', () => {
  test('creates and updates a declaration within shipment scope', async () => {
    const shipment = await mkClerkScopedShipmentViaService();
    const created = await testFetch(`/${shipment.id}/declarations`, {
      method: 'POST',
      token: clerkToken,
      body: {
        declarationNumber: 'TK-001',
        issuedAt: '2026-07-27T09:00:00.000Z',
        scope: 'SHARED',
        note: 'Khai chung',
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.declarationNumber, 'TK-001');

    const updated = await testFetch(`/${shipment.id}/declarations/${created.data.id}`, {
      method: 'PUT',
      token: clerkToken,
      body: {
        declarationNumber: 'TK-001A',
        issuedAt: '2026-07-27T10:00:00.000Z',
        scope: 'SINGLE',
      },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.declarationNumber, 'TK-001A');
    assert.equal(updated.data.scope, 'SINGLE');
  });
});

describe('Q17 explicit dossier subtype matrix', () => {
  test('CLERK can create and replace a delivery order document and update a declaration inside scope', async () => {
    const shipment = await mkClerkScopedShipmentViaService();
    const created = await testFetch(`/${shipment.id}/documents`, {
      method: 'POST',
      token: clerkToken,
      body: { type: ShipmentDocumentType.DO, storageKey: `uploads/shipment-${shipment.id}/do-q17-v1.pdf` },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.type, ShipmentDocumentType.DO);

    const replaced = await testFetch(`/${shipment.id}/documents/${created.data.id}/replace`, {
      method: 'POST',
      token: clerkToken,
      body: {
        expectedVersion: shipment.version,
        storageKey: `uploads/shipment-${shipment.id}/do-q17-v2.pdf`,
      },
    });
    assert.equal(replaced.status, 201);
    assert.equal(replaced.data.type, ShipmentDocumentType.DO);
    assert.equal(replaced.data.storageKey, `uploads/shipment-${shipment.id}/do-q17-v2.pdf`);

    const declaration = await testFetch(`/${shipment.id}/declarations`, {
      method: 'POST',
      token: clerkToken,
      body: {
        declarationNumber: 'TK-Q17',
        issuedAt: '2026-07-28T09:15:00.000Z',
        scope: 'SHARED',
        note: 'Khai mở',
      },
    });
    assert.equal(declaration.status, 201);

    const declarationUpdate = await testFetch(`/${shipment.id}/declarations/${declaration.data.id}`, {
      method: 'PUT',
      token: clerkToken,
      body: {
        declarationNumber: 'TK-Q17-UPDATED',
        issuedAt: '2026-07-28T10:30:00.000Z',
        scope: 'SINGLE',
        note: 'Khai cập nhật',
      },
    });
    assert.equal(declarationUpdate.status, 200);
    assert.equal(declarationUpdate.data.declarationNumber, 'TK-Q17-UPDATED');
    assert.equal(declarationUpdate.data.scope, 'SINGLE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch (shipment → linked trip)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:id/dispatch', () => {
  test('dispatches an accepted LCL fulfillment without fabricated container rows', async () => {
    const accepted = await createAcceptedFulfillmentFixture({ cargoMode: 'LCL' });
    const resources = await createOwnedResources();
    const response = await testFetch(`/${accepted.shipment.id}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: accepted.fulfillmentId,
        expectedVersion: accepted.fulfillmentVersion,
        plannedStartAt: '2026-08-01T08:00:00+07:00',
        plannedEndAt: '2026-08-01T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: resources.truck.id,
        driverId: resources.driver.id,
        trailerId: resources.trailer.id,
      },
    });
    assert.equal(response.status, 201);
    createdTripIds.push(response.data.trip.id);
    const tripContainers = await db.select()
      .from(s.tripContainers)
      .where(eq(s.tripContainers.tripId, response.data.trip.id));
    assert.equal(tripContainers.length, 1);
    assert.match(tripContainers[0]!.notes ?? '', /__fulfillment_lcl:/);
  });

  test('creates a linked trip for an accepted fulfillment and snapshots the container', async () => {
    const accepted = await createAcceptedFulfillmentFixture({ cargoTypeId });
    const resources = await createOwnedResources();
    const r = await testFetch(`/${accepted.shipment.id}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: accepted.fulfillmentId,
        expectedVersion: accepted.fulfillmentVersion,
        plannedStartAt: '2026-08-01T08:00:00+07:00',
        plannedEndAt: '2026-08-01T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: resources.truck.id,
        driverId: resources.driver.id,
        trailerId: resources.trailer.id,
      },
    });
    assert.equal(r.status, 201);
    assert.ok(r.data.trip.id, 'trip id present');
    assert.equal(r.data.fulfillmentId, accepted.fulfillmentId);
    createdTripIds.push(r.data.trip.id);

    const [trip] = await db.select().from(s.trips).where(eq(s.trips.id, r.data.trip.id)).limit(1);
    assert.equal(trip?.shipmentId, accepted.shipment.id);
    assert.equal(trip?.fulfillmentId, accepted.fulfillmentId);
    assert.equal(trip?.truckId, resources.truck.id);
    const tripContainers = await db.select()
      .from(s.tripContainers)
      .where(eq(s.tripContainers.tripId, r.data.trip.id));
    assert.equal(tripContainers.length, 1);
    assert.match(tripContainers[0]!.notes ?? '', /__fulfillment_snapshot:/);
  });

  test('replays the same fulfillment dispatch idempotency key with the same trip', async () => {
    const accepted = await createAcceptedFulfillmentFixture({ cargoTypeId });
    const resources = await createOwnedResources();
    const idempotencyKey = `shipment-routes-dispatch-${suffix}`;
    const body = {
      fulfillmentId: accepted.fulfillmentId,
      expectedVersion: accepted.fulfillmentVersion,
      plannedStartAt: '2026-08-02T08:00:00+07:00',
      plannedEndAt: '2026-08-02T12:00:00+07:00',
      endTimeConfirmed: true,
      carrierType: 'OWN' as const,
      truckId: resources.truck.id,
      driverId: resources.driver.id,
      trailerId: resources.trailer.id,
    };
    const first = await testFetch(`/${accepted.shipment.id}/dispatch`, {
      method: 'POST',
      token: managerToken,
      idempotencyKey,
      body,
    });
    assert.equal(first.status, 201);
    createdTripIds.push(first.data.trip.id);

    const second = await testFetch(`/${accepted.shipment.id}/dispatch`, {
      method: 'POST',
      token: managerToken,
      idempotencyKey,
      body,
    });
    assert.equal(second.status, 200);
    assert.equal(second.data.replayed, true);
    assert.equal(second.data.trip.id, first.data.trip.id);
  });

  test('CLERK is denied dispatch (route requires ADMIN/MANAGER)', async () => {
    // CLERK has shipments write at the casbin layer, but the route handler
    // tightens dispatch to ADMIN/MANAGER only (creating a trip is an operator
    // decision). This guards the belt-and-suspenders requireRoles guard.
    const accepted = await createAcceptedFulfillmentFixture();
    const resources = await createOwnedResources();
    const r = await testFetch(`/${accepted.shipment.id}/dispatch`, {
      method: 'POST',
      token: clerkToken,
      body: {
        fulfillmentId: accepted.fulfillmentId,
        expectedVersion: accepted.fulfillmentVersion,
        plannedStartAt: '2026-08-03T08:00:00+07:00',
        plannedEndAt: '2026-08-03T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: resources.truck.id,
        driverId: resources.driver.id,
        trailerId: resources.trailer.id,
      },
    });
    assert.equal(r.status, 403);
  });

  test('rejects missing fulfillmentId with 400', async () => {
    const accepted = await createAcceptedFulfillmentFixture();
    const resources = await createOwnedResources();
    const r = await testFetch(`/${accepted.shipment.id}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        expectedVersion: accepted.fulfillmentVersion,
        plannedStartAt: '2026-08-04T08:00:00+07:00',
        plannedEndAt: '2026-08-04T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: resources.truck.id,
        driverId: resources.driver.id,
        trailerId: resources.trailer.id,
      },
    });
    assert.equal(r.status, 400);
  });

  test('rejects dispatch after the accepted shipment is canceled', async () => {
    const { transitionShipmentStatus } = await import('../services/shipment.service');
    const accepted = await createAcceptedFulfillmentFixture();
    const resources = await createOwnedResources();
    await transitionShipmentStatus(accepted.shipment.id, ShipmentStatus.CANCELED);

    const r = await testFetch(`/${accepted.shipment.id}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: accepted.fulfillmentId,
        expectedVersion: accepted.fulfillmentVersion,
        plannedStartAt: '2026-08-05T08:00:00+07:00',
        plannedEndAt: '2026-08-05T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: resources.truck.id,
        driverId: resources.driver.id,
        trailerId: resources.trailer.id,
      },
    });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /đã kết thúc/i);
  });

  test('rejects a stale fulfillment version with 409', async () => {
    const accepted = await createAcceptedFulfillmentFixture();
    const resources = await createOwnedResources();
    const r = await testFetch(`/${accepted.shipment.id}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        fulfillmentId: accepted.fulfillmentId,
        expectedVersion: accepted.fulfillmentVersion + 1,
        plannedStartAt: '2026-08-05T08:00:00+07:00',
        plannedEndAt: '2026-08-05T12:00:00+07:00',
        endTimeConfirmed: true,
        carrierType: 'OWN',
        truckId: resources.truck.id,
        driverId: resources.driver.id,
        trailerId: resources.trailer.id,
      },
    });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /đã thay đổi/i);
  });

  test('concurrent dispatches against one fulfillment keep exactly one live trip', async () => {
    const accepted = await createAcceptedFulfillmentFixture();
    const resources = await createOwnedResources();
    const body = {
      fulfillmentId: accepted.fulfillmentId,
      expectedVersion: accepted.fulfillmentVersion,
      plannedStartAt: '2026-08-07T08:00:00+07:00',
      plannedEndAt: '2026-08-07T12:00:00+07:00',
      endTimeConfirmed: true,
      carrierType: 'OWN' as const,
      truckId: resources.truck.id,
      driverId: resources.driver.id,
      trailerId: resources.trailer.id,
    };
    const [a, b] = await Promise.all([
      testFetch(`/${accepted.shipment.id}/dispatch`, { method: 'POST', token: managerToken, body }),
      testFetch(`/${accepted.shipment.id}/dispatch`, { method: 'POST', token: adminToken, body }),
    ]);

    const okStatuses = new Set([200, 201, 409]);
    assert.ok(okStatuses.has(a.status), `a.status=${a.status}`);
    assert.ok(okStatuses.has(b.status), `b.status=${b.status}`);

    const linked = await db.select()
      .from(s.trips)
      .where(inArray(s.trips.status, ['CREATED', 'IN_TRANSIT', 'COMPLETED', 'LOCKED']));
    const live = linked.filter((t) => t.fulfillmentId === accepted.fulfillmentId);
    assert.equal(live.length, 1, 'exactly one live trip linked to the fulfillment');
    if (live[0]) createdTripIds.push(live[0].id);
  });
});

describe('POST /:id/change-requests/:requestId/review', () => {
  test('MANAGER can apply a pending request and bump the shipment version', async () => {
    const { transitionShipmentStatus } = await import('../services/shipment.service');
    const shipment = await mkClerkScopedShipmentViaService({ pickupLocation: 'Kho cũ' });
    const dispatched = await transitionShipmentStatus(shipment.id, ShipmentStatus.IN_PROGRESS);
    const requestResponse = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: clerkToken,
      body: { expectedVersion: dispatched.version, pickupLocation: 'Kho mới' },
    });
    assert.equal(requestResponse.status, 200);
    const requestId = requestResponse.data.changeRequestId as number;

    const review = await testFetch(`/${shipment.id}/change-requests/${requestId}/review`, {
      method: 'POST',
      token: managerToken,
      body: { resolution: 'APPLIED' },
    });
    assert.equal(review.status, 200, JSON.stringify(review.data));
    assert.equal(review.data.resolution, 'APPLIED');
    assert.equal(review.data.shipmentVersion, dispatched.version + 1);

    const detail = await testFetch(`/${shipment.id}`, { token: adminToken });
    assert.equal(detail.data.shipment.pickupLocation, 'Kho mới');
    assert.equal(detail.data.pendingChangeRequests.length, 0);
  });

  test('request creation persists notifications for both manager and admin recipients', async () => {
    const { transitionShipmentStatus } = await import('../services/shipment.service');
    const shipment = await mkClerkScopedShipmentViaService({ pickupLocation: 'Kho A' });
    const dispatched = await transitionShipmentStatus(shipment.id, ShipmentStatus.IN_PROGRESS);
    const response = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: clerkToken,
      body: { expectedVersion: dispatched.version, pickupLocation: 'Kho B' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.notificationDelivered, true);

    const notifications = await db.select()
      .from(s.notifications)
      .where(and(
        eq(s.notifications.relatedEntityType, 'shipments'),
        eq(s.notifications.relatedEntityId, shipment.id),
        inArray(s.notifications.userId, [adminUserId, managerUserId]),
      ));
    const recipientIds = notifications.map((row) => row.userId).sort((a, b) => a - b);
    assert.deepEqual(recipientIds, [adminUserId, managerUserId]);
  });

  test('stale apply conflicts but stale reject closes the request and targets only its requester', async () => {
    const { transitionShipmentStatus } = await import('../services/shipment.service');
    const shipment = await mkClerkScopedShipmentViaService({ pickupLocation: 'Kho nguồn' });
    const dispatched = await transitionShipmentStatus(shipment.id, ShipmentStatus.IN_PROGRESS);
    const requestResponse = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: clerkToken,
      body: { expectedVersion: dispatched.version, pickupLocation: 'Kho đề xuất' },
    });
    assert.equal(requestResponse.status, 200);
    const requestId = requestResponse.data.changeRequestId as number;

    const directUpdate = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: adminToken,
      body: {
        expectedVersion: dispatched.version,
        contactName: 'Điều phối cập nhật',
      },
    });
    assert.equal(directUpdate.status, 200);
    assert.equal(directUpdate.data.version, dispatched.version + 1);

    const staleApply = await testFetch(`/${shipment.id}/change-requests/${requestId}/review`, {
      method: 'POST',
      token: managerToken,
      body: { resolution: 'APPLIED' },
    });
    assert.equal(staleApply.status, 409);

    const staleReject = await testFetch(`/${shipment.id}/change-requests/${requestId}/review`, {
      method: 'POST',
      token: managerToken,
      body: { resolution: 'REJECTED' },
    });
    assert.equal(staleReject.status, 200);
    assert.equal(staleReject.data.resolution, 'REJECTED');
    assert.equal(staleReject.data.shipmentVersion, dispatched.version + 1);

    const pending = await db.select({ id: s.shipmentChangeRequests.id })
      .from(s.shipmentChangeRequests)
      .where(eq(s.shipmentChangeRequests.id, requestId));
    assert.equal(pending.length, 0);

    const decisionRows = await db.select({ userId: s.notifications.userId })
      .from(s.notifications)
      .where(and(
        eq(s.notifications.relatedEntityType, 'shipments'),
        eq(s.notifications.relatedEntityId, shipment.id),
        eq(s.notifications.title, 'Yêu cầu thay đổi lô hàng đã bị từ chối'),
      ));
    assert.deepEqual(decisionRows.map((row) => row.userId), [clerkUserId]);
    assert.ok(!decisionRows.some((row) => row.userId === accountantUserId));
  });

  test('ADMIN and MANAGER first-decision review has exactly one winner', async () => {
    const { transitionShipmentStatus } = await import('../services/shipment.service');
    const shipment = await mkClerkScopedShipmentViaService({ deliveryLocation: 'Điểm cũ' });
    const dispatched = await transitionShipmentStatus(shipment.id, ShipmentStatus.IN_PROGRESS);
    const requestResponse = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: clerkToken,
      body: { expectedVersion: dispatched.version, deliveryLocation: 'Điểm mới' },
    });
    assert.equal(requestResponse.status, 200);
    const requestId = requestResponse.data.changeRequestId as number;

    const [apply, reject] = await Promise.all([
      testFetch(`/${shipment.id}/change-requests/${requestId}/review`, {
        method: 'POST',
        token: managerToken,
        body: { resolution: 'APPLIED' },
      }),
      testFetch(`/${shipment.id}/change-requests/${requestId}/review`, {
        method: 'POST',
        token: adminToken,
        body: { resolution: 'REJECTED' },
      }),
    ]);
    assert.deepEqual([apply.status, reject.status].sort(), [200, 404]);

    const pending = await db.select({ id: s.shipmentChangeRequests.id })
      .from(s.shipmentChangeRequests)
      .where(eq(s.shipmentChangeRequests.id, requestId));
    assert.equal(pending.length, 0);
    const decisionRows = await db.select({ id: s.notifications.id })
      .from(s.notifications)
      .where(and(
        eq(s.notifications.relatedEntityType, 'shipments'),
        eq(s.notifications.relatedEntityId, shipment.id),
        inArray(s.notifications.title, [
          'Yêu cầu thay đổi lô hàng đã được áp dụng',
          'Yêu cầu thay đổi lô hàng đã bị từ chối',
        ]),
      ));
    assert.equal(decisionRows.length, 1);
  });

  test('ACCOUNTANT cannot review a shipment change request', async () => {
    const { transitionShipmentStatus } = await import('../services/shipment.service');
    const shipment = await mkClerkScopedShipmentViaService({ pickupLocation: 'Kho A' });
    const dispatched = await transitionShipmentStatus(shipment.id, ShipmentStatus.IN_PROGRESS);
    const requestResponse = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: clerkToken,
      body: { expectedVersion: dispatched.version, pickupLocation: 'Kho B' },
    });
    assert.equal(requestResponse.status, 200);

    const denied = await testFetch(
      `/${shipment.id}/change-requests/${requestResponse.data.changeRequestId}/review`,
      {
        method: 'POST',
        token: accountantToken,
        body: { resolution: 'REJECTED' },
      },
    );
    assert.equal(denied.status, 403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Delete (soft-delete)
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /:id', () => {
  test('soft-deletes a DRAFT shipment', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}?version=${shipment.version}`, {
      method: 'DELETE',
      token: managerToken,
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);

    // Detail should now 404 (soft-deleted rows are excluded).
    const detail = await testFetch(`/${shipment.id}`, { token: adminToken });
    assert.equal(detail.status, 404);
  });

  test('requires version (400 without it)', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}`, {
      method: 'DELETE',
      token: managerToken,
    });
    assert.equal(r.status, 400);
  });

  test('CLERK is denied delete (route requires ADMIN/MANAGER)', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}?version=${shipment.version}`, {
      method: 'DELETE',
      token: clerkToken,
    });
    assert.equal(r.status, 403);
  });

  test('404 on missing shipment', async () => {
    const r = await testFetch('/99999999?version=1', {
      method: 'DELETE',
      token: managerToken,
    });
    assert.equal(r.status, 404);
  });
});

describe('Q17 CLERK forbidden financial/configuration route matrix', () => {
  test('authenticated CLERK requests are denied for representative price, cost, debt and salary mutations', async () => {
    const cases = [
      {
        label: 'price config create',
        method: 'POST',
        path: '/api/pricing-tables',
        body: {},
      },
      {
        label: 'company cost fuel invoice create',
        method: 'POST',
        path: '/api/finance/fuel-invoices',
        body: {},
      },
      {
        label: 'carrier cost payment create',
        method: 'POST',
        path: '/api/payments/carrier',
        body: {},
      },
      {
        label: 'debt offset create',
        method: 'POST',
        path: '/api/finance/debt-offsets',
        body: {},
      },
      {
        label: 'salary period close',
        method: 'POST',
        path: '/api/salary/periods/2026-07/close',
        body: {},
      },
    ] as const;

    for (const c of cases) {
      const response = await apiFetch(c.path, {
        method: c.method,
        token: clerkToken,
        body: c.body,
      });
      assert.equal(response.status, 403, `${c.label} should deny CLERK over public HTTP`);
    }
  });
});
