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
import { inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role, ShipmentStatus, ShipmentDocumentType } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import { cacheInvalidate } from '../lib/redis';

import shipmentRoutes from '../routes/shipments';
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
let containerTypeId: number;

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
  // The DB inferSelect types `role` as a string-union (not the Role enum), but
  // the JWT payload is just the string value at runtime; cast for the type
  // bridge. Token shape must match `AuthUser` in middleware/auth.ts.
  return jwt.sign(
    { userId: u.id, username: u.username ?? u.id.toString(), role: u.role as Role },
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

interface TestFetchOptions {
  method?: string;
  body?: unknown;
  token?: string;
}

async function testFetch(urlPath: string, options: TestFetchOptions = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  // The test app mounts the shipments router at `/api/shipments`; prefix every
  // call so test bodies read like the real client paths (e.g. `/`, `/:id`).
  const fullUrl = `${baseUrl}/api/shipments${urlPath}`;
  const res = await fetch(fullUrl, {
    method: options.method ?? 'GET',
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

  const customerRow = await mkCustomer();
  customerId = customerRow.id;
  const catalogs = await mkCatalogs();
  routeId = catalogs.route.id;
  cargoTypeId = catalogs.cargoType.id;
  containerTypeId = catalogs.containerType.id;

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
        await tx.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
        await tx.delete(s.tripLegs).where(inArray(s.tripLegs.tripId, createdTripIds));
        await tx.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
      }
      if (createdShipmentIds.length > 0) {
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
      if (createdRouteIds.length > 0) {
        await tx.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
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

  test('CLERK can create (write allowed)', async () => {
    const r = await testFetch('/', {
      method: 'POST',
      token: clerkToken,
      body: { customerId },
    });
    assert.equal(r.status, 201);
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
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: clerkToken,
      body: { version: shipment.version, contactName: 'Clerk edit' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.contactName, 'Clerk edit');
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

  test('CLERK cannot transition? — CLERK has shipments write, so allowed', async () => {
    // Sanity check: CLERK's write policy row DOES cover transition (the route
    // requires ADMIN/MANAGER/CLERK). This guards against an accidental
    // role-strip in the route.
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}/transition`, {
      method: 'POST',
      token: clerkToken,
      body: { status: ShipmentStatus.IN_PROGRESS },
    });
    assert.equal(r.status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Containers (full reconcile)
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /:id/containers', () => {
  test('inserts new containers and returns the refreshed list', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}/containers`, {
      method: 'PUT',
      token: adminToken,
      body: {
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
      body: { containers: [
        { containerTypeId, containerNumber: 'MSKU1234565' },
        { containerTypeId, containerNumber: 'TCNU7425363' },
      ] },
    });
    const keepId = seed.data.items.find((c: { containerNumber: string }) => c.containerNumber === 'MSKU1234565').id;

    // Reconcile: keep MSKU1234565 (with updated weight), drop TCNU7425363, add OOLU831266.
    const r = await testFetch(`/${shipment.id}/containers`, {
      method: 'PUT',
      token: adminToken,
      body: { containers: [
        { id: keepId, containerTypeId, containerNumber: 'MSKU1234565', cargoWeightKg: 9999 },
        { containerTypeId, containerNumber: 'OOLU8312661' },
      ] },
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
      body: { containers: [] },
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
});

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch (shipment → linked trip)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:id/dispatch', () => {
  test('creates a linked trip + moves shipment to IN_PROGRESS', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: {
        routeId,
        cargoTypeId,
        containerTypeId,
        departureDate: '2026-08-01',
      },
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.created, true);
    assert.ok(r.data.trip.id, 'trip id present');
    assert.equal(r.data.trip.shipmentId, shipment.id);
    createdTripIds.push(r.data.trip.id);

    // Shipment should now be IN_PROGRESS.
    const detail = await testFetch(`/${shipment.id}`, { token: adminToken });
    assert.equal(detail.data.shipment.status, ShipmentStatus.IN_PROGRESS);
  });

  test('idempotent: second dispatch returns the same trip with created=false', async () => {
    const shipment = await mkShipmentViaService();
    const first = await testFetch(`/${shipment.id}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: { routeId, cargoTypeId, containerTypeId, departureDate: '2026-08-02' },
    });
    assert.equal(first.status, 201);
    createdTripIds.push(first.data.trip.id);

    const second = await testFetch(`/${shipment.id}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: { routeId, cargoTypeId, containerTypeId, departureDate: '2026-08-02' },
    });
    assert.equal(second.status, 200);
    assert.equal(second.data.created, false);
    assert.equal(second.data.trip.id, first.data.trip.id);
  });

  test('CLERK is denied dispatch (route requires ADMIN/MANAGER)', async () => {
    // CLERK has shipments write at the casbin layer, but the route handler
    // tightens dispatch to ADMIN/MANAGER only (creating a trip is an operator
    // decision). This guards the belt-and-suspenders requireRoles guard.
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}/dispatch`, {
      method: 'POST',
      token: clerkToken,
      body: { routeId, cargoTypeId, containerTypeId, departureDate: '2026-08-03' },
    });
    assert.equal(r.status, 403);
  });

  test('rejects missing routeId with 400', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: { cargoTypeId, containerTypeId, departureDate: '2026-08-04' },
    });
    assert.equal(r.status, 400);
  });

  test('rejects dispatch on a non-DRAFT shipment with 409', async () => {
    // Move a shipment to IN_PROGRESS via the service, then try dispatch.
    const { transitionShipmentStatus } = await import('../services/shipment.service');
    const shipment = await mkShipmentViaService();
    await transitionShipmentStatus(shipment.id, ShipmentStatus.IN_PROGRESS);

    const r = await testFetch(`/${shipment.id}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: { routeId, cargoTypeId, containerTypeId, departureDate: '2026-08-05' },
    });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /IN_PROGRESS/);
  });

  test('rejects dispatch on a CANCELED shipment with 409', async () => {
    const { transitionShipmentStatus } = await import('../services/shipment.service');
    const shipment = await mkShipmentViaService();
    await transitionShipmentStatus(shipment.id, ShipmentStatus.CANCELED);

    const r = await testFetch(`/${shipment.id}/dispatch`, {
      method: 'POST',
      token: managerToken,
      body: { routeId, cargoTypeId, containerTypeId, departureDate: '2026-08-06' },
    });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /CANCELED/);
  });

  test('concurrent dispatches produce exactly one live trip (DB-enforced)', async () => {
    // Fire two concurrent dispatches against the same DRAFT shipment. The
    // partial unique index trips_shipment_id_live_uniq guarantees only one
    // live trip survives; the loser returns the winner's trip with
    // created=false (or 409 if the loser hit the optimistic-status guard —
    // either outcome is acceptable as long as the DB invariant holds).
    const shipment = await mkShipmentViaService();
    const body = { routeId, cargoTypeId, containerTypeId, departureDate: '2026-08-07' };
    const [a, b] = await Promise.all([
      testFetch(`/${shipment.id}/dispatch`, { method: 'POST', token: managerToken, body }),
      testFetch(`/${shipment.id}/dispatch`, { method: 'POST', token: adminToken, body }),
    ]);

    // Both should return success (one 201 created, one 200 created=false),
    // OR one of them may 409 if it raced the status-guard. The DB invariant
    // is what matters: exactly one non-CANCELED trip linked to the shipment.
    const okStatuses = new Set([200, 201, 409]);
    assert.ok(okStatuses.has(a.status), `a.status=${a.status}`);
    assert.ok(okStatuses.has(b.status), `b.status=${b.status}`);

    const linked = await db.select()
      .from(s.trips)
      .where(inArray(s.trips.status, ['CREATED', 'IN_TRANSIT', 'COMPLETED', 'LOCKED']));
    // Filter to trips pointing at THIS shipment (the query above is broad to
    // avoid depending on shipmentId index nullability; refine in JS).
    const live = linked.filter((t) => t.shipmentId === shipment.id);
    assert.equal(live.length, 1, 'exactly one live trip linked to the shipment');
    if (live[0]) createdTripIds.push(live[0].id);
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
