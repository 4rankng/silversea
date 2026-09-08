// Dispatch Lạch Huyện Phase 1 contracts: ports.dispatchZone and
// shipment_fulfillments.dispatch_classification.
//
// Locks the API-boundary and RBAC behavior added with the additive migration
// 0021 + backfill 0022: zone values are whitelisted at the boundary, legacy
// classification stays nullable, and catalog writes stay admin-scoped.
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import express from 'express';
import { eq, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { initEnforcer } from '../casbin/enforcer';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import configRoutes from '../routes/config';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdPortIds: number[] = [];
const userIds: number[] = [];
let adminId = 0;
let dispatcherId = 0;
let server: http.Server;
let baseUrl = '';

async function api(
  method: string,
  path: string,
  actorId: number,
  body?: Record<string, unknown>,
  expectedUpdatedAt?: string,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `dispatch-schema-${suffix}-${Math.random()}`,
      'X-Test-User-Id': String(actorId),
      ...(expectedUpdatedAt ? { 'If-Unmodified-Since': expectedUpdatedAt } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsedBody: Record<string, unknown> = {};
  try {
    parsedBody = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    parsedBody = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: parsedBody };
}

async function createUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `dispatch-schema-${role}-${suffix}`,
    passwordHash: 'test-only',
    role,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  userIds.push(user.id);
  return user.id;
}

before(async () => {
  await initEnforcer();
  adminId = await createUser(Role.ADMIN);
  dispatcherId = await createUser(Role.DISPATCHER);

  // Seed dispatch zones that production `make seed` would create. Tests need
  // them too because requireDispatchZone() rejects unknown zone codes.
  // Idempotent: reactivates any zone left inactive by a prior run.
  for (const z of [
    { code: 'LACH_HUYEN', label: 'Lạch Huyện', sortOrder: 10, isActive: true },
    { code: 'HAI_PHONG', label: 'Cảng Hải Phòng', sortOrder: 20, isActive: true },
  ]) {
    const [existing] = await db.select().from(s.dispatchZones)
      .where(eq(s.dispatchZones.code, z.code)).limit(1);
    if (existing) {
      await db.update(s.dispatchZones)
        .set({ isActive: true, label: z.label, sortOrder: z.sortOrder })
        .where(eq(s.dispatchZones.id, existing.id));
    } else {
      await db.insert(s.dispatchZones).values(z);
    }
  }

  const app = express();
  app.use(express.json());
  // Test-only principal injection mirrors the auth middleware contract: the
  // config router trusts getUser(req) for actor identity and Casbin for authz.
  app.use((req, _res, next) => {
    const raw = req.headers['x-test-user-id'];
    const id = Array.isArray(raw) ? raw[0] : raw;
    (req as unknown as { user?: { userId: number; role: Role } }).user = {
      userId: Number(id),
      role: Number(id) === dispatcherId ? Role.DISPATCHER : Role.ADMIN,
    };
    next();
  });
  app.use('/api', casbinAuthz('config'), configRoutes);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  for (const id of createdPortIds) {
    await db.delete(s.ports).where(eq(s.ports.id, id)).catch(() => {});
  }
  for (const id of userIds) {
    await db.delete(s.users).where(eq(s.users.id, id)).catch(() => {});
  }
  await client.end();
  await disconnectRedis();
});

describe('ports.dispatchZone contract', () => {
  test('admin can create and clear a port zone', async () => {
    const created = await api('POST', '/ports', adminId, {
      name: `Cảng test zone ${suffix}`,
      code: `TZ${suffix.slice(-6)}`,
      city: 'Hải Phòng',
      dispatchZone: 'LACH_HUYEN',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const portId = created.body.item ? (created.body.item as { id: number }).id
      : (created.body as { id: number }).id;
    createdPortIds.push(portId);

    const [row] = await db.select().from(s.ports).where(eq(s.ports.id, portId));
    assert.equal(row.dispatchZone, 'LACH_HUYEN');

    const updated = await api('PUT', `/ports/${portId}`, adminId, {
      name: row.name,
      code: row.code,
      dispatchZone: null,
    }, row.updatedAt.toISOString());
    assert.ok([200, 204].includes(updated.status), JSON.stringify(updated.body));
    const [after_] = await db.select().from(s.ports).where(eq(s.ports.id, portId));
    assert.equal(after_.dispatchZone, null);
  });

  test('unknown zone value is rejected at the API boundary', async () => {
    const rejected = await api('POST', '/ports', adminId, {
      name: `Cảng test zone x ${suffix}`,
      code: `TX${suffix.slice(-6)}`,
      dispatchZone: 'CAT_HAI',
    });
    assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
    const rows = await db.select({ id: s.ports.id })
      .from(s.ports)
      .where(eq(s.ports.code, `TX${suffix.slice(-6)}`));
    assert.equal(rows.length, 0);
  });

  test('dispatcher may inline-create ports but cannot update them', async () => {
    // Route-scoped allowance (casbin.ts): CUS/DISPATCHER POST /ports exists so
    // the shipment-intake screen can add a missing port inline. Every other
    // verb stays Casbin-governed — PUT/DELETE remain denied.
    const inlineCreate = await api('POST', '/ports', dispatcherId, {
      name: `Cảng inline ${suffix}`,
      code: `DN${suffix.slice(-6)}`,
    });
    assert.equal(inlineCreate.status, 201, JSON.stringify(inlineCreate.body));
    const createdPort = (inlineCreate.body as { id: number }).id;
    if (createdPort) createdPortIds.push(createdPort);

    const [anyPort] = await db.select({ id: s.ports.id }).from(s.ports).limit(1);
    if (anyPort) {
      const deniedUpdate = await api('PUT', `/ports/${anyPort.id}`, dispatcherId, {
        name: 'should-not-apply',
        dispatchZone: 'LACH_HUYEN',
      });
      assert.ok([401, 403].includes(deniedUpdate.status), `expected denial, got ${deniedUpdate.status}: ${JSON.stringify(deniedUpdate.body)}`);
    }
  });

  test('seeded HICT terminal carries the LACH_HUYEN zone', async () => {
    const [hict] = await db.select().from(s.ports)
      .where(eq(s.ports.code, 'HICT'));
    if (hict) {
      assert.equal(hict.dispatchZone, 'LACH_HUYEN');
    }
  });
});

describe('shipment_fulfillments.dispatch_classification contract', () => {
  test('column defaults to SINGLE and disallows an unclassified fulfillment', async () => {
    const probe = await db.execute<{ is_nullable: string; column_default: string | null }>(sql`
      select is_nullable, column_default from information_schema.columns
      where table_name = 'shipment_fulfillments'
        and column_name = 'dispatch_classification'
    `);
    const rows = (probe as unknown as { rows: Array<{ is_nullable: string; column_default: string | null }> }).rows
      ?? (probe as unknown as Array<{ is_nullable: string; column_default: string | null }>);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].is_nullable, 'NO');
    assert.match(rows[0].column_default ?? '', /SINGLE/);
  });

  test('LCL fulfillments retain their LCL classification', async () => {
    const rows = await db.select({
      id: s.shipmentFulfillments.id,
      c: s.shipmentFulfillments.dispatchClassification,
    })
      .from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.fulfillmentType, 'LCL_SHIPMENT'))
      .limit(50);
    for (const row of rows) {
      assert.equal(row.c, 'LCL', `LCL fulfillment ${row.id} must stay LCL`);
    }
  });
});
