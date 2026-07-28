/**
 * Wave 0 — `Audit-log every shipment write` regression test.
 *
 * Verifies that every shipment write endpoint produces an audit_logs row
 * with:
 *   - entityType = 'shipments'
 *   - payload->>'event' matching the expected SHIPMENT_* constant
 *   - entityId = the affected shipment id
 *   - entityKey surfaced in the message (the shipmentCode)
 *
 * Mirrors the HTTP+RBAC setup in shipment-routes.test.ts (Node http server +
 * JWT auth) and polls audit_logs for the row because the audit write is
 * asynchronous (event-bus listener writes after the response is sent).
 *
 * Coverage matrix (7 shipment writes):
 *   POST   /api/shipments             → SHIPMENT_CREATED
 *   PUT    /api/shipments/:id          → SHIPMENT_UPDATED
 *   POST   /api/shipments/:id/transition → SHIPMENT_STATUS_CHANGED
 *   POST   /api/shipments/:id/dispatch → SHIPMENT_DISPATCHED
 *   POST   /api/shipments/:id/documents → SHIPMENT_DOCUMENT_UPLOADED
 *   PUT    /api/shipments/:id/containers → SHIPMENT_CONTAINERS_UPDATED
 *   DELETE /api/shipments/:id          → SHIPMENT_DELETED
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray, desc } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { Role, ShipmentStatus, ShipmentDocumentType } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';

import shipmentRoutes from '../routes/shipments';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Scaffolding buckets — populated as rows are created; cleaned in `after`.
const createdShipmentIds: number[] = [];
const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdUserIds: number[] = [];
const createdAuditLogIds: number[] = [];

let adminToken: string;
let managerToken: string;
let managerUserId: number;
let customerId: number;
let routeId: number;
let cargoTypeId: number;
let containerTypeId: number;
let adminUserId: number;

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
    .values({ name: `ShipmentAudit customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkCatalogs() {
  const [route] = await db.insert(s.routes)
    .values({ name: `ShipmentAudit route ${suffix}` }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `ShipmentAudit cargo ${suffix}` }).returning();
  createdCargoTypeIds.push(cargoType.id);
  const shortCode = `SA${Math.random().toString(16).slice(2, 8)}`;
  const [containerType] = await db.insert(s.containerTypes)
    .values({ code: shortCode, name: `ShipmentAudit ct ${suffix}` }).returning();
  createdContainerTypeIds.push(containerType.id);
  return { route, cargoType, containerType };
}

interface TestFetchOptions {
  method?: string;
  body?: unknown;
  token?: string;
}

let requestSequence = 0;

async function testFetch(urlPath: string, options: TestFetchOptions = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.method && options.method !== 'GET') {
    headers['Idempotency-Key'] = `shipment-audit-${suffix}-${requestSequence++}`;
  }
  const fullUrl = `${baseUrl}/api/shipments${urlPath}`;
  const res = await fetch(fullUrl, {
    method: options.method ?? 'GET',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// Poll audit_logs for a row matching `predicate`, up to ~2s. The audit write
// is async (event bus → db insert) so we cannot assert immediately.
async function waitForAudit(
  predicate: (row: typeof s.auditLogs.$inferSelect) => boolean,
  timeoutMs = 2000,
): Promise<typeof s.auditLogs.$inferSelect | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await db.select().from(s.auditLogs)
      .where(eq(s.auditLogs.entityType, 'shipments'))
      .orderBy(desc(s.auditLogs.id))
      .limit(50);
    const match = rows.find(predicate);
    if (match) {
      createdAuditLogIds.push(match.id);
      return match;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

before(async () => {
  await initAuditService();
  await initEnforcer();

  const app = express();
  app.use(express.json());
  // Mount auditLogMiddleware BEFORE the routes — it wraps res.json to
  // capture the response body for entityKey extraction, so it must run
  // before the route handler. Matches the order in backend/src/index.ts.
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

  const admin = await mkUser(`sa-admin-${suffix}`, Role.ADMIN);
  const manager = await mkUser(`sa-manager-${suffix}`, Role.MANAGER);
  adminUserId = admin.id;
  managerUserId = manager.id;
  adminToken = sign(admin);
  managerToken = sign(manager);

  const customerRow = await mkCustomer();
  customerId = customerRow.id;
  const catalogs = await mkCatalogs();
  routeId = catalogs.route.id;
  cargoTypeId = catalogs.cargoType.id;
  containerTypeId = catalogs.containerType.id;
});

after(async () => {
  // Best-effort cleanup; tolerate FK failures from cross-test rows.
  try {
    if (createdAuditLogIds.length > 0) {
      await db.delete(s.auditLogs).where(inArray(s.auditLogs.id, createdAuditLogIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, createdUserIds));
      await db.delete(s.notifications).where(inArray(s.notifications.userId, createdUserIds));
      await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, createdUserIds));
    }
    if (createdTripIds.length > 0) {
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
      await db.delete(s.tripLegs).where(inArray(s.tripLegs.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdShipmentIds.length > 0) {
      await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, createdShipmentIds));
      await db.delete(s.shipmentDeclarations).where(inArray(s.shipmentDeclarations.shipmentId, createdShipmentIds));
      await db.delete(s.shipmentDocuments).where(inArray(s.shipmentDocuments.shipmentId, createdShipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdContainerTypeIds.length > 0) {
      await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
    }
    if (createdCargoTypeIds.length > 0) {
      await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    }
    if (createdRouteIds.length > 0) {
      await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } catch (err) {
    console.warn('[shipment-audit.test] cleanup partial:', (err as Error).message);
  }

  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await disconnectRedis();
  await client.end();
});

// Helper: create a shipment via the service (bypassing HTTP) for setup of
// downstream audit tests. Records the id for cleanup.
async function mkShipmentViaService(overrides: Record<string, unknown> = {}) {
  const { createShipment } = await import('../services/shipment.service');
  const shipment = await createShipment({ customerId, ...overrides });
  createdShipmentIds.push(shipment.id);
  return shipment;
}

describe('Audit-log every shipment write', () => {
  test('POST / → SHIPMENT_CREATED', async () => {
    // Use the trailing-slash form (`/api/shipments/`) to also exercise the
    // resolveAuditEvent trailing-slash normalization — without it, the
    // exact-match registry would miss and fall through to ENTITY_CREATED.
    const r = await testFetch('/', {
      method: 'POST', token: adminToken,
      body: { customerId },
    });
    assert.equal(r.status, 201);
    createdShipmentIds.push(r.data.id);

    const audit = await waitForAudit(
      (row) => (row.payload as { event?: string }).event === 'SHIPMENT_CREATED'
        && row.entityId === r.data.id,
    );
    assert.ok(audit, 'SHIPMENT_CREATED audit row written');
    assert.equal(audit!.entityType, 'shipments');
    assert.equal(audit!.userId, adminUserId);
    assert.match(audit!.message, /tạo mới lô hàng/);
    assert.match(audit!.message, /SHP-/);
  });

  test('PUT /:id → SHIPMENT_UPDATED', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}`, {
      method: 'PUT', token: adminToken,
      body: { version: shipment.version, bookingRef: `BK-AUDIT-${suffix}` },
    });
    assert.equal(r.status, 200);

    const audit = await waitForAudit(
      (row) => (row.payload as { event?: string }).event === 'SHIPMENT_UPDATED'
        && row.entityId === shipment.id,
    );
    assert.ok(audit, 'SHIPMENT_UPDATED audit row written');
    assert.equal(audit!.entityType, 'shipments');
    assert.match(audit!.message, /cập nhật thông tin lô hàng/);
  });

  test('stale PUT /:id → MUTATION_CONFLICT with failed-attempt metadata', async () => {
    const shipment = await mkShipmentViaService();
    const accepted = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: adminToken,
      body: { version: shipment.version, bookingRef: `BK-FIRST-${suffix}` },
    });
    assert.equal(accepted.status, 200);

    const stale = await testFetch(`/${shipment.id}`, {
      method: 'PUT',
      token: managerToken,
      body: { version: shipment.version, bookingRef: `BK-STALE-${suffix}` },
    });
    assert.equal(stale.status, 409);

    const audit = await waitForAudit(
      (row) => (row.payload as { event?: string }).event === 'MUTATION_CONFLICT'
        && row.entityId === shipment.id,
    );
    assert.ok(audit, 'stale write conflict audit row written');
    assert.equal(audit!.userId, managerUserId);
    assert.match(audit!.message, /xung đột/);
    const payload = audit!.payload as {
      outcome?: string;
      statusCode?: number;
      path?: string;
    };
    assert.equal(payload.outcome, 'CONFLICT');
    assert.equal(payload.statusCode, 409);
    assert.match(payload.path ?? '', /\/api\/shipments\//);
  });

  test('POST /:id/transition → SHIPMENT_STATUS_CHANGED', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}/transition`, {
      method: 'POST', token: adminToken,
      body: { status: ShipmentStatus.IN_PROGRESS, reason: 'audit test' },
    });
    assert.equal(r.status, 200);

    const audit = await waitForAudit(
      (row) => (row.payload as { event?: string }).event === 'SHIPMENT_STATUS_CHANGED'
        && row.entityId === shipment.id,
    );
    assert.ok(audit, 'SHIPMENT_STATUS_CHANGED audit row written');
    assert.equal(audit!.entityType, 'shipments');
    assert.match(audit!.message, /chuyển trạng thái lô hàng/);
  });

  test('POST /:id/documents → SHIPMENT_DOCUMENT_UPLOADED', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}/documents`, {
      method: 'POST', token: adminToken,
      body: { type: ShipmentDocumentType.BL, storageKey: `uploads/audit-test-${shipment.id}/bl.pdf` },
    });
    assert.equal(r.status, 201);

    const audit = await waitForAudit(
      (row) => (row.payload as { event?: string }).event === 'SHIPMENT_DOCUMENT_UPLOADED'
        && row.entityId === shipment.id,
    );
    assert.ok(audit, 'SHIPMENT_DOCUMENT_UPLOADED audit row written');
    assert.equal(audit!.entityType, 'shipments');
    assert.match(audit!.message, /đính kèm tài liệu cho lô hàng/);
  });

  test('PUT /:id/containers → SHIPMENT_CONTAINERS_UPDATED', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}/containers`, {
      method: 'PUT', token: adminToken,
      body: {
        expectedVersion: shipment.version,
        containers: [{ containerTypeId, containerNumber: 'MSKU1234565' }],
      },
    });
    assert.equal(r.status, 200);

    const audit = await waitForAudit(
      (row) => (row.payload as { event?: string }).event === 'SHIPMENT_CONTAINERS_UPDATED'
        && row.entityId === shipment.id,
    );
    assert.ok(audit, 'SHIPMENT_CONTAINERS_UPDATED audit row written');
    assert.equal(audit!.entityType, 'shipments');
    assert.match(audit!.message, /cập nhật danh sách container của lô hàng/);
  });

  test('POST /:id/dispatch → SHIPMENT_DISPATCHED', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}/dispatch`, {
      method: 'POST', token: managerToken,
      body: { routeId, cargoTypeId, containerTypeId, departureDate: '2026-09-01' },
    });
    assert.equal(r.status, 201);
    if (r.data?.trip?.id) createdTripIds.push(r.data.trip.id);

    const audit = await waitForAudit(
      (row) => (row.payload as { event?: string }).event === 'SHIPMENT_DISPATCHED'
        && row.entityId === shipment.id,
    );
    assert.ok(audit, 'SHIPMENT_DISPATCHED audit row written');
    assert.equal(audit!.entityType, 'shipments');
    assert.equal(audit!.userId, managerUserId, 'actor recorded (manager)');
    // The audit row is for the SHIPMENT, so entityKey must be the shipment
    // code (SHP-...), NOT the trip code (TRP-...). A regression that swaps
    // these would make dispatch events unsearchable by shipmentCode.
    assert.match(audit!.message, /điều vận lô hàng sang chuyến đi/);
    assert.match(audit!.message, new RegExp(shipment.shipmentCode ?? 'SHP-'),
      'message contains the SHIPMENT code (not the trip code)');
  });

  test('DELETE /:id → SHIPMENT_DELETED', async () => {
    const shipment = await mkShipmentViaService();
    const r = await testFetch(`/${shipment.id}?version=${shipment.version}`, {
      method: 'DELETE', token: managerToken,
    });
    assert.equal(r.status, 200);

    const audit = await waitForAudit(
      (row) => (row.payload as { event?: string }).event === 'SHIPMENT_DELETED'
        && row.entityId === shipment.id,
    );
    assert.ok(audit, 'SHIPMENT_DELETED audit row written');
    assert.equal(audit!.entityType, 'shipments');
    assert.equal(audit!.userId, managerUserId, 'actor recorded (manager)');
    assert.match(audit!.message, /xóa lô hàng/);
    assert.match(audit!.message, new RegExp(shipment.shipmentCode ?? 'SHP-'),
      'message contains the SHIPMENT code');
  });
});
