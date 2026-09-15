/**
 * Wave 4 — duplicate-reference guard (customer feedback 2026-09-07,
 * BL `JJCTCHPDY260305`).
 *
 * Pins the behaviour:
 *  1. `POST /api/shipments/quick` rejects a second shipment whose Bill or
 *     Booking collides with an active sibling, with a structured 409 body
 *     carrying `code: SHIPMENT_REFERENCE_DUPLICATE` and the original
 *     creator's username/fullName/createdAt.
 *  2. `PUT /api/shipments/:id` rejects the same kind of collision (and
 *     tolerates resubmitting the row's own current value — exclude self).
 *  3. `POST /api/shipments/:id/declarations` blocks creating a declaration
 *     whose number already belongs to another active shipment.
 *  4. `GET /api/shipments/duplicate-check` surfaces conflicts for the form's
 *     pre-flight call.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';

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
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdUserIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdDeclarationIds: number[] = [];

let clerkToken: string;
let otherClerkToken: string;
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

function authedFetch(path: string, init: RequestInit = {}, token = clerkToken) {
  return fetch(`${baseUrl}/api/shipments${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

async function createIntakeShipment(
  blNumber: string,
  tradeDirection: 'IMPORT' | 'EXPORT',
  token = clerkToken,
  reference?: string,
) {
  const body = tradeDirection === 'IMPORT'
    ? { customerId, blNumber, tradeDirection, cargoMode: 'FCL' as const, bookingRef: null }
    : { customerId, bookingRef: blNumber, tradeDirection, cargoMode: 'FCL' as const, blNumber: null };
  const response = await authedFetch('/quick', {
    method: 'POST',
    body: JSON.stringify({ ...body, _requestId: reference ?? crypto.randomUUID() }),
  }, token);
  if (!response.ok && response.status !== 409) {
    const text = await response.text();
    throw new Error(`createIntakeShipment ${response.status}: ${text}`);
  }
  return response;
}

let customerId: number;
let clerkUserId: number;

before(async () => {
  await initEnforcer();
  await initAuditService();

  await mkUser(`dup-admin-${suffix}`, Role.ADMIN);
  
  const clerk = await mkUser(`dup-clerk-${suffix}`, Role.CUS);
  clerkUserId = clerk.id;
  clerkToken = jwt.sign(
    { userId: clerk.id, username: clerk.username ?? clerk.id.toString(), role: clerk.role },
    config.jwtSecret,
    { expiresIn: '1h' },
  );

  const otherClerk = await mkUser(`dup-clerk-other-${suffix}`, Role.CUS);
    otherClerkToken = jwt.sign(
    { userId: otherClerk.id, username: otherClerk.username ?? otherClerk.id.toString(), role: otherClerk.role },
    config.jwtSecret,
    { expiresIn: '1h' },
  );

  const [customer] = await db.insert(s.customers).values({
    name: `Dup customer ${suffix}`,
  }).returning();
  createdCustomerIds.push(customer.id);
  customerId = customer.id;

  const [containerType] = await db.insert(s.containerTypes).values({
    code: `DUP${suffix}`.slice(0, 20),
    name: `Dup CT ${suffix}`,
  }).returning();
  createdContainerTypeIds.push(containerType.id);
    // The duplicate-guard tests do not exercise routes, ports, or sites
  // (the quick-create payload only requires `customerId` + the reference);
  // keeping the references here would force a `siteType` enum insert
  // that pulls in catalog-state noise unrelated to the regression.

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(auditLogMiddleware);
  app.use('/api/shipments', authMiddleware, casbinAuthz('shipments'), shipmentRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (createdDeclarationIds.length > 0) {
    await db.delete(s.shipmentDeclarations).where(inArray(s.shipmentDeclarations.id, createdDeclarationIds));
  }
  if (createdShipmentIds.length > 0) {
    await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
  }
  if (createdContainerTypeIds.length > 0) {
    await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
  }
  if (createdCustomerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  await disconnectRedis();
  await client.end();
});

describe('duplicate Bill/Booking guard (2026-09-07 regression)', () => {
  test('create with a fresh BL succeeds (sanity)', async () => {
    const response = await createIntakeShipment(`BL-NEW-${suffix}`, 'IMPORT');
    assert.equal(response.status, 201);
    const body = await response.json() as { id: number };
    createdShipmentIds.push(body.id);
  });

  test('a trimmed, lowercase variant of an existing Bill is rejected (case-insensitive guard)', async () => {
    const bl = `BL-TRIM-${suffix}`;
    const first = await createIntakeShipment(bl, 'IMPORT');
    assert.equal(first.status, 201);
    const firstBody = await first.json() as { id: number };
    createdShipmentIds.push(firstBody.id);

    // The create schema trims + the guard matches case-insensitively (ilike),
    // so padded/lowercase resubmits are the SAME reference.
    const variant = await createIntakeShipment(`  ${bl.toLowerCase()}  ` as string, 'IMPORT');
    assert.equal(variant.status, 409, 'padded lowercase variant must conflict');
  });

  test('a second shipment with the same Bill is rejected with 409 + structured conflict', async () => {
    const bl = `BL-DUP-${suffix}`;
    const first = await createIntakeShipment(bl, 'IMPORT', clerkToken);
    assert.equal(first.status, 201);
    const firstBody = await first.json() as { id: number };
    createdShipmentIds.push(firstBody.id);

    // Different clerk (or same clerk, doesn't matter) attempts the same BL.
    const second = await createIntakeShipment(bl, 'IMPORT', otherClerkToken);
    assert.equal(second.status, 409, 'second POST with same BL must 409');
    const body = await second.json() as {
      code?: string;
      conflict?: {
        shipmentId: number;
        reference: string;
        field: string;
        createdBy: { id: number; username: string } | null;
        createdAt: string;
      };
    };
    assert.equal(body.code, 'SHIPMENT_REFERENCE_DUPLICATE');
    assert.ok(body.conflict, 'structured conflict payload is required');
    assert.equal(body.conflict!.reference, bl);
    assert.equal(body.conflict!.field, 'blNumber');
    assert.equal(body.conflict!.shipmentId, firstBody.id);
    assert.equal(body.conflict!.createdBy?.id, clerkUserId, 'creator must be the original clerk');

    // Sanity: no extra shipment row landed in DB for the rejected attempt.
    const matches = await db.select({ id: s.shipments.id })
      .from(s.shipments)
      .where(and(eq(s.shipments.customerId, customerId), eq(s.shipments.blNumber, bl)));
    assert.equal(matches.length, 1, 'only the first shipment should persist');
  });

  test('Booking collisions mirror Bill (different direction)', async () => {
    const bookingRef = `BK-DUP-${suffix}`;
    const first = await createIntakeShipment(bookingRef, 'EXPORT');
    assert.equal(first.status, 201);
    const firstBody = await first.json() as { id: number };
    createdShipmentIds.push(firstBody.id);

    const second = await createIntakeShipment(bookingRef, 'EXPORT');
    assert.equal(second.status, 409);
    const body = await second.json() as { code?: string; conflict?: { field: string; createdBy: { id: number } | null } };
    assert.equal(body.code, 'SHIPMENT_REFERENCE_DUPLICATE');
    assert.equal(body.conflict?.field, 'bookingRef');
  });

  test('update may resubmit the row\'s own current value (exclude self)', async () => {
    const bl = `BL-UPD-${suffix}`;
    const first = await createIntakeShipment(bl, 'IMPORT');
    assert.equal(first.status, 201);
    const firstBody = await first.json() as { id: number; version: number };
    createdShipmentIds.push(firstBody.id);

    // Update without changing BL — must NOT 409.
    const updateSame = await authedFetch(`/${firstBody.id}`, {
      method: 'PUT',
      body: JSON.stringify({ expectedVersion: firstBody.version, customerId, blNumber: bl, tradeDirection: 'IMPORT', cargoMode: 'FCL', _requestId: crypto.randomUUID() }),
    });
    assert.equal(updateSame.status, 200, 'self-update must not 409');
  });

  test('update that switches to a colliding BL is blocked', async () => {
    const source = await createIntakeShipment(`BL-UPD2-${suffix}`, 'IMPORT');
    assert.equal(source.status, 201);
    const sourceBody = await source.json() as { id: number; version: number };
    createdShipmentIds.push(sourceBody.id);

    const target = await createIntakeShipment(`BL-UPD3-${suffix}`, 'IMPORT');
    assert.equal(target.status, 201);
    const targetBody = await target.json() as { id: number; version: number };
    createdShipmentIds.push(targetBody.id);

    const collision = await authedFetch(`/${sourceBody.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        expectedVersion: sourceBody.version,
        customerId,
        blNumber: `BL-UPD3-${suffix}`,
        tradeDirection: 'IMPORT',
        cargoMode: 'FCL',
        _requestId: crypto.randomUUID(),
      }),
    });
    assert.equal(collision.status, 409);
    const body = await collision.json() as { code?: string };
    assert.equal(body.code, 'SHIPMENT_REFERENCE_DUPLICATE');
  });

  test('GET /duplicate-check returns the existing conflict with creator info', async () => {
    const bl = `BL-PRECHECK-${suffix}`;
    const first = await createIntakeShipment(bl, 'IMPORT');
    assert.equal(first.status, 201);
    const firstBody = await first.json() as { id: number };
    createdShipmentIds.push(firstBody.id);

    const check = await authedFetch(`/duplicate-check?blNumber=${encodeURIComponent(bl)}`);
    assert.equal(check.status, 200);
    const body = await check.json() as {
      conflicts: Array<{ reference: string; field: string; createdBy: { username: string; id: number } | null }>;
    };
    assert.equal(body.conflicts.length, 1, 'exactly one conflict expected');
    assert.equal(body.conflicts[0].reference, bl);
    assert.equal(body.conflicts[0].field, 'blNumber');
    assert.equal(body.conflicts[0].createdBy?.id, clerkUserId);
  });

  test('declaration number is also guarded across active shipments', async () => {
    const shipment = await createIntakeShipment(`BL-DEC-${suffix}`, 'IMPORT');
    assert.equal(shipment.status, 201);
    const shipmentBody = await shipment.json() as { id: number };
    createdShipmentIds.push(shipmentBody.id);

    const create = await authedFetch(`/${shipmentBody.id}/declarations`, {
      method: 'POST',
      body: JSON.stringify({ declarationNumber: `TK-DUP-${suffix}`, scope: 'SINGLE', _requestId: crypto.randomUUID() }),
    });
    assert.equal(create.status, 201);
    const declBody = await create.json() as { id: number };
    createdDeclarationIds.push(declBody.id);

    // Now try to register the same declaration on a fresh shipment.
    const second = await createIntakeShipment(`BL-DEC2-${suffix}`, 'IMPORT');
    assert.equal(second.status, 201);
    const secondBody = await second.json() as { id: number };
    createdShipmentIds.push(secondBody.id);
    const secondDecl = await authedFetch(`/${secondBody.id}/declarations`, {
      method: 'POST',
      body: JSON.stringify({ declarationNumber: `TK-DUP-${suffix}`, scope: 'SINGLE', _requestId: crypto.randomUUID() }),
    });
    assert.equal(secondDecl.status, 409);
    const body = await secondDecl.json() as { code?: string };
    assert.equal(body.code, 'SHIPMENT_REFERENCE_DUPLICATE');
  });

  test('VID-CUS-02: reference punctuation is literal and declaration conflicts identify their field', async () => {
    const original = await createIntakeShipment(`BL-LITERAL-A-${suffix}`, 'IMPORT');
    const originalBody = await original.json() as { id: number };
    createdShipmentIds.push(originalBody.id);
    for (const punctuation of ['_', '%']) {
      const response = await createIntakeShipment(`BL-LITERAL-${punctuation}-${suffix}`, 'IMPORT');
      assert.equal(response.status, 201, 'SQL wildcard characters must be literal references');
      createdShipmentIds.push((await response.json() as { id: number }).id);
    }
    const declarationNumber = `TK-LITERAL-A-${suffix}`;
    const declaration = await authedFetch(`/${originalBody.id}/declarations`, {
      method: 'POST', body: JSON.stringify({ declarationNumber, _requestId: crypto.randomUUID() }),
    });
    assert.equal(declaration.status, 201);
    createdDeclarationIds.push((await declaration.json() as { id: number }).id);
    const absent = await authedFetch(`/duplicate-check?declarationNumber=${encodeURIComponent(`TK-LITERAL-_-${suffix}`)}`);
    assert.deepEqual((await absent.json() as { conflicts: unknown[] }).conflicts, []);
    const exact = await authedFetch(`/duplicate-check?declarationNumber=${encodeURIComponent(declarationNumber.toLowerCase())}`);
    const conflicts = (await exact.json() as { conflicts: Array<{ field: string }> }).conflicts;
    assert.equal(conflicts[0]?.field, 'declaration');
  });

  test('VID-CUS-04: initial declaration is atomic and idempotent with quick intake', async () => {
    const declarationNumber = `VID-ATOMIC-${suffix}`;
    const payload = { customerId, blNumber: `VID-FIRST-${suffix}`, tradeDirection: 'IMPORT', cargoMode: 'FCL', declarationNumber, _requestId: crypto.randomUUID() };
    const first = await authedFetch('/quick', { method: 'POST', body: JSON.stringify(payload) });
    assert.equal(first.status, 201);
    const original = await first.json() as { id: number; initialDeclarationId: number | null };
    createdShipmentIds.push(original.id);
    assert.ok(original.initialDeclarationId, 'initial declaration is included in the intake response');
    createdDeclarationIds.push(original.initialDeclarationId);
    const replay = await authedFetch('/quick', { method: 'POST', body: JSON.stringify(payload) });
    assert.equal(replay.status, 200);
    const repeated = await replay.json() as typeof original;
    assert.equal(repeated.id, original.id);
    assert.equal(repeated.initialDeclarationId, original.initialDeclarationId);

    const duplicateBill = `VID-REJECTED-${suffix}`;
    const duplicate = await authedFetch('/quick', { method: 'POST', body: JSON.stringify({ ...payload, blNumber: duplicateBill, declarationNumber: declarationNumber.toLowerCase(), _requestId: crypto.randomUUID() }) });
    assert.equal(duplicate.status, 409);
    const conflict = await duplicate.json() as { conflict?: { field: string; createdBy?: { id: number } } };
    assert.equal(conflict.conflict?.field, 'declaration');
    assert.equal(conflict.conflict?.createdBy?.id, clerkUserId);
    const residue = await db.select({ id: s.shipments.id }).from(s.shipments).where(eq(s.shipments.blNumber, duplicateBill));
    assert.deepEqual(residue, [], 'duplicate declaration must not leave a partial shipment');

    await db.update(s.shipmentDeclarations).set({ declarationNumber: `EDITED-${declarationNumber}` }).where(eq(s.shipmentDeclarations.id, original.initialDeclarationId));
    const afterEdit = await authedFetch('/quick', { method: 'POST', body: JSON.stringify(payload) });
    assert.equal(afterEdit.status, 200);
    const replayAfterEdit = await afterEdit.json() as typeof original;
    assert.equal(replayAfterEdit.initialDeclarationId, original.initialDeclarationId, 'VID-CUS-13: replay preserves the original declaration identity after its text changes');
  });

  test('VID-CUS-12: concurrent duplicate references retain structured creator conflicts and atomic intake', async () => {
    for (const kind of ['declaration', 'blNumber', 'bookingRef'] as const) {
      const reference = `VID-RACE-${kind}-${suffix}`;
      const bills = Array.from({ length: 6 }, (_, index) => `VID-RACE-${kind}-${index}-${suffix}`);
      const responses = await Promise.all(bills.map((bill) => authedFetch('/quick', {
        method: 'POST', body: JSON.stringify({
          customerId, cargoMode: 'FCL', _requestId: crypto.randomUUID(),
          ...(kind === 'bookingRef'
            ? { tradeDirection: 'EXPORT', bookingRef: reference }
            : { tradeDirection: 'IMPORT', blNumber: kind === 'blNumber' ? reference : bill }),
          ...(kind === 'declaration' ? { declarationNumber: reference } : {}),
        }),
      })));
      const outcomes = await Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json() as { id: number; version: number; initialDeclarationId?: number; code?: string; conflict?: { field: string; shipmentId: number; createdBy?: { id: number } } } })));
      const accepted = outcomes.filter((outcome) => outcome.status === 201);
      assert.equal(accepted.length, 1);
      const original = accepted[0].body;
      createdShipmentIds.push(original.id);
      if (original.initialDeclarationId) createdDeclarationIds.push(original.initialDeclarationId);
      assert.equal(original.version, 1);
      for (const rejected of outcomes.filter((outcome) => outcome.status !== 201)) {
        assert.equal(rejected.status, 409);
        assert.equal(rejected.body.code, 'SHIPMENT_REFERENCE_DUPLICATE');
        assert.equal(rejected.body.conflict?.field, kind);
        assert.equal(rejected.body.conflict?.shipmentId, original.id);
        assert.equal(rejected.body.conflict?.createdBy?.id, clerkUserId);
      }
      if (kind === 'declaration') {
        const roots = await db.select({ id: s.shipments.id }).from(s.shipments).where(inArray(s.shipments.blNumber, bills));
        const declarations = await db.select({ id: s.shipmentDeclarations.id }).from(s.shipmentDeclarations).where(eq(s.shipmentDeclarations.declarationNumber, reference));
        assert.equal(roots.length, 1);
        assert.equal(declarations.length, 1);
      }
    }
  });

  test('VID-CUS-05: historical duplicate Bill does not prevent editing another field by record ID', async () => {
    const blNumber = `VID-HISTORICAL-${suffix}`;
    const inserted = await db.insert(s.shipments).values([
      { customerId, blNumber, tradeDirection: 'IMPORT', cargoMode: 'FCL', status: 'PENDING_DATE', createdBy: clerkUserId },
      { customerId, blNumber: ` ${blNumber} `, tradeDirection: 'IMPORT', cargoMode: 'FCL', status: 'PENDING_DATE', createdBy: clerkUserId },
    ]).returning();
    createdShipmentIds.push(...inserted.map((row) => row.id));
    const target = inserted[1];
    const response = await authedFetch(`/${target.id}`, { method: 'PUT', body: JSON.stringify({ expectedVersion: target.version, blNumber, customerNotes: 'Only target changes', _requestId: crypto.randomUUID() }) });
    assert.equal(response.status, 200);
    const rows = await db.select({ id: s.shipments.id, notes: s.shipments.customerNotes }).from(s.shipments).where(inArray(s.shipments.id, inserted.map((row) => row.id)));
    assert.equal(rows.find((row) => row.id === target.id)?.notes, 'Only target changes');
    assert.equal(rows.find((row) => row.id === inserted[0].id)?.notes, null);
  });

  // TC-EDGE-002 — duplicate guard is case-insensitive + whitespace-insensitive.
  test('Bill collision is case-insensitive (BL-X collides with bl-x)', async () => {
    const bl = `BL-CASE-${suffix}`;
    const first = await createIntakeShipment(bl, 'IMPORT', clerkToken);
    assert.equal(first.status, 201);
    const firstBody = await first.json() as { id: number };
    createdShipmentIds.push(firstBody.id);

    const lower = await createIntakeShipment(bl.toLowerCase(), 'IMPORT', otherClerkToken);
    assert.equal(lower.status, 409, 'lowercase Bill must collide with existing uppercase Bill');
    const lowerBody = await lower.json() as {
      code?: string;
      conflict?: { reference: string; field: string; shipmentId: number };
    };
    assert.equal(lowerBody.code, 'SHIPMENT_REFERENCE_DUPLICATE');
    assert.equal(lowerBody.conflict?.shipmentId, firstBody.id);
    assert.equal(lowerBody.conflict?.field, 'blNumber');

    const mixed = await createIntakeShipment(`Bl-Case-${suffix}`, 'IMPORT', otherClerkToken);
    assert.equal(mixed.status, 409, 'mixed-case Bill with same letters must also collide');
  });

  test('Bill collision is whitespace-insensitive (trims leading/trailing space)', async () => {
    const bl = `BL-WS-${suffix}`;
    const first = await createIntakeShipment(bl, 'IMPORT', clerkToken);
    assert.equal(first.status, 201);
    const firstBody = await first.json() as { id: number };
    createdShipmentIds.push(firstBody.id);

    const padded = await createIntakeShipment(`  ${bl}  `, 'IMPORT', otherClerkToken);
    assert.equal(padded.status, 409, 'padded Bill must collide with trimmed Bill');
    const paddedBody = await padded.json() as {
      code?: string;
      conflict?: { shipmentId: number; field: string };
    };
    assert.equal(paddedBody.code, 'SHIPMENT_REFERENCE_DUPLICATE');
    assert.equal(paddedBody.conflict?.shipmentId, firstBody.id);
    assert.equal(paddedBody.conflict?.field, 'blNumber');
  });

  test('declaration number collision is case + whitespace insensitive', async () => {
    const shipment = await createIntakeShipment(`BL-DECCASE-${suffix}`, 'IMPORT');
    assert.equal(shipment.status, 201);
    const shipmentBody = await shipment.json() as { id: number };
    createdShipmentIds.push(shipmentBody.id);

    const create = await authedFetch(`/${shipmentBody.id}/declarations`, {
      method: 'POST',
      body: JSON.stringify({ declarationNumber: `TK-CASE-${suffix}`, scope: 'SINGLE', _requestId: crypto.randomUUID() }),
    });
    assert.equal(create.status, 201);
    const declBody = await create.json() as { id: number };
    createdDeclarationIds.push(declBody.id);

    const second = await createIntakeShipment(`BL-DECCASE2-${suffix}`, 'IMPORT');
    assert.equal(second.status, 201);
    const secondBody = await second.json() as { id: number };
    createdShipmentIds.push(secondBody.id);

    const paddedLower = await authedFetch(`/${secondBody.id}/declarations`, {
      method: 'POST',
      body: JSON.stringify({ declarationNumber: `  tk-case-${suffix}  `, scope: 'SINGLE', _requestId: crypto.randomUUID() }),
    });
    assert.equal(paddedLower.status, 409, 'padded lowercase declaration must collide');
    const body = await paddedLower.json() as { code?: string };
    assert.equal(body.code, 'SHIPMENT_REFERENCE_DUPLICATE');
  });
});
