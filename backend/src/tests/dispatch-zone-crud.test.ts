// Dispatch-zone taxonomy CRUD contracts: ADMIN-managed dispatch_zones rows.
//
// Locks the configurable-taxonomy behavior added after the DB-owned zone
// genericization: codes are immutable, deactivation is blocked while live
// ports reference the zone (no FK would catch the dangle), delete is not
// offered, and writes stay admin-scoped even though casbin `config` grants
// MANAGER/ACCOUNTANT write on the config tree. The active-only GET stays the
// unchanged read surface every dispatch UI consumes.
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import express from 'express';
import { eq, isNull, and } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { initEnforcer } from '../casbin/enforcer';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import configRoutes from '../routes/config';

const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
const suffix = `${Date.now()}-${rand}`;
// Regex-safe zone code fragment (uppercase alnum only — suffix itself has a dash).
const zc = `Z${rand}`;
const createdZoneIds: number[] = [];
const createdPortIds: number[] = [];
const userIds: number[] = [];
let adminId = 0;
let managerId = 0;
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
      'Idempotency-Key': `zone-crud-${suffix}-${method}-${Math.random()}`,
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
    username: `zone-crud-${role}-${suffix}`,
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
  managerId = await createUser(Role.MANAGER);

  const app = express();
  app.use(express.json());
  // Test-only principal injection mirrors the auth middleware contract: the
  // config router trusts getUser(req) for actor identity and Casbin for authz.
  app.use((req, _res, next) => {
    const raw = req.headers['x-test-user-id'];
    const id = Array.isArray(raw) ? raw[0] : raw;
    (req as unknown as { user?: { userId: number; role: Role } }).user = {
      userId: Number(id),
      role: Number(id) === managerId ? Role.MANAGER : Role.ADMIN,
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
  for (const id of createdZoneIds) {
    await db.delete(s.dispatchZones).where(eq(s.dispatchZones.id, id)).catch(() => {});
  }
  for (const id of userIds) {
    await db.delete(s.users).where(eq(s.users.id, id)).catch(() => {});
  }
  await client.end();
  await disconnectRedis();
});

describe('dispatch_zones ADMIN CRUD contract', () => {
  test('admin creates a zone; duplicate code conflicts with 409', async () => {
    const created = await api('POST', '/dispatch-zones', adminId, {
      code: zc,
      label: 'Khu vực test',
      sortOrder: 90,
      isActive: true,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const zoneId = (created.body as { id: number }).id;
    createdZoneIds.push(zoneId);
    assert.equal(created.body.showPortFacet, true, 'new zones default to visible');

    const duplicate = await api('POST', '/dispatch-zones', adminId, {
      code: zc,
      label: 'Trùng mã',
    });
    assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));

    const invalidCode = await api('POST', '/dispatch-zones', adminId, {
      code: 'not-uppercase',
      label: 'Sai format',
    });
    assert.equal(invalidCode.status, 400);
  });

  test('port facet visibility is configurable, returned to readers, and stable across renames', async () => {
    const created = await api('POST', '/dispatch-zones', adminId, {
      code: `${zc}_FACET`, label: 'Configurable zone', showPortFacet: false,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const zoneId = (created.body as { id: number }).id;
    createdZoneIds.push(zoneId);
    assert.equal(created.body.showPortFacet, false);
    const renamed = await api('PUT', `/dispatch-zones/${zoneId}`, adminId, {
      label: 'Renamed configurable zone',
    }, String(created.body.updatedAt));
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal(renamed.body.showPortFacet, false, 'omitted visibility must preserve prior configuration');
    const active = await api('GET', '/dispatch-zones/active', managerId);
    const row = (active.body.items as Array<{ code: string; showPortFacet: boolean }>).find(zone => zone.code === `${zc}_FACET`);
    assert.equal(row?.showPortFacet, false);
    const shown = await api('PUT', `/dispatch-zones/${zoneId}`, adminId, {
      showPortFacet: true,
    }, String(renamed.body.updatedAt));
    assert.equal(shown.status, 200, JSON.stringify(shown.body));
    assert.equal(shown.body.showPortFacet, true);
    const forbidden = await api('PUT', `/dispatch-zones/${zoneId}`, managerId, {
      showPortFacet: false,
    }, String(shown.body.updatedAt));
    assert.equal(forbidden.status, 403);
  });

  test('update relabels and reorders; explicit code change is rejected', async () => {
    const [created] = await db.select().from(s.dispatchZones)
      .where(eq(s.dispatchZones.code, zc)).limit(1);
    assert.ok(created);
    const zoneId = created.id;
    if (!createdZoneIds.includes(zoneId)) createdZoneIds.push(zoneId);

    const relabeled = await api('PUT', `/dispatch-zones/${zoneId}`, adminId, {
      label: 'Khu vực test (sửa)',
      sortOrder: 95,
    }, created.updatedAt.toISOString());
    assert.equal(relabeled.status, 200, JSON.stringify(relabeled.body));
    assert.equal((relabeled.body as { label: string }).label, 'Khu vực test (sửa)');

    const [refreshed] = await db.select().from(s.dispatchZones).where(eq(s.dispatchZones.id, zoneId));
    const codeChange = await api('PUT', `/dispatch-zones/${zoneId}`, adminId, {
      code: 'OTHER_CODE',
      label: 'Khu vực test (sửa)',
    }, refreshed.updatedAt.toISOString());
    assert.equal(codeChange.status, 400, JSON.stringify(codeChange.body));
  });

  test('deactivating a referenced zone is blocked; an unreferenced one deactivates', async () => {
    const [lhZone] = await db.select().from(s.dispatchZones)
      .where(eq(s.dispatchZones.code, 'LACH_HUYEN')).limit(1);
    assert.ok(lhZone, 'seeded LACH_HUYEN zone must exist');

    // Seeded live ports reference LACH_HUYEN → deactivation must 400.
    const blocked = await api('PUT', `/dispatch-zones/${lhZone.id}`, adminId, {
      isActive: false,
    }, lhZone.updatedAt.toISOString());
    assert.equal(blocked.status, 400, JSON.stringify(blocked.body));
    assert.match(String((blocked.body as { error?: string }).error), /Còn cảng\/bãi/);

    // The test zone has no ports → deactivation succeeds and the zone leaves
    // the active-only read list.
    const [testZone] = await db.select().from(s.dispatchZones)
      .where(eq(s.dispatchZones.code, zc)).limit(1);
    const deactivated = await api('PUT', `/dispatch-zones/${testZone.id}`, adminId, {
      isActive: false,
    }, testZone.updatedAt.toISOString());
    assert.equal(deactivated.status, 200, JSON.stringify(deactivated.body));

    const activeList = await api('GET', '/dispatch-zones/active', adminId);
    assert.equal(activeList.status, 200);
    const codes = ((activeList.body as { items: Array<{ code: string }> }).items)
      .map((zone) => zone.code);
    assert.ok(!codes.includes(zc), 'inactive zone must leave the active read list');
    assert.ok(codes.includes('LACH_HUYEN'), 'active seeded zone stays readable');

    // The admin factory list must NOT be shadowed by the active-only read —
    // deactivate → still listed → reactivable is the whole management loop.
    const adminList = await api('GET', '/dispatch-zones', adminId);
    assert.equal(adminList.status, 200);
    const adminCodes = ((adminList.body as { items: Array<{ code: string }> }).items)
      .map((zone) => zone.code);
    assert.ok(adminCodes.includes(zc), 'inactive zone stays visible to the admin list');

    // Reactivate for cleanliness; also proves the toggle round-trips.
    const [inactive] = await db.select().from(s.dispatchZones).where(eq(s.dispatchZones.id, testZone.id));
    const reactivated = await api('PUT', `/dispatch-zones/${testZone.id}`, adminId, {
      isActive: true,
    }, inactive.updatedAt.toISOString());
    assert.equal(reactivated.status, 200);
  });

  test('delete is not offered; writes are admin-only', async () => {
    const [testZone] = await db.select().from(s.dispatchZones)
      .where(eq(s.dispatchZones.code, zc)).limit(1);

    const deleted = await api('DELETE', `/dispatch-zones/${testZone.id}`, adminId);
    assert.equal(deleted.status, 405, JSON.stringify(deleted.body));

    // casbin grants MANAGER config write, but the taxonomy is admin-scoped
    // (ports-catalog posture).
    const deniedCreate = await api('POST', '/dispatch-zones', managerId, {
      code: `MGR_Z_${suffix.slice(-6)}`,
      label: 'Không được',
    });
    assert.ok([401, 403].includes(deniedCreate.status), `expected denial, got ${deniedCreate.status}`);

    const deniedUpdate = await api('PUT', `/dispatch-zones/${testZone.id}`, managerId, {
      label: 'Không được sửa',
    });
    assert.ok([401, 403].includes(deniedUpdate.status), `expected denial, got ${deniedUpdate.status}`);

    // Reads stay open to every config reader — the active-only taxonomy read
    // is role-agnostic (dispatchers consume it), only the factory list is
    // admin-gated.
    const managerRead = await api('GET', '/dispatch-zones/active', managerId);
    assert.equal(managerRead.status, 200);
    const managerFactoryList = await api('GET', '/dispatch-zones', managerId);
    assert.ok([401, 403].includes(managerFactoryList.status), `expected denial, got ${managerFactoryList.status}`);
  });

  test('empty reference edge: port reassigned away frees the zone for deactivation', async () => {
    // A live port classified into the test zone blocks deactivation…
    const [testZone] = await db.select().from(s.dispatchZones)
      .where(eq(s.dispatchZones.code, zc)).limit(1);
    const [port] = await db.insert(s.ports).values({
      name: `Cảng zone crud ${suffix}`,
      dispatchZone: testZone.code,
    }).returning();
    createdPortIds.push(port.id);

    const blockedNow = await api('PUT', `/dispatch-zones/${testZone.id}`, adminId, {
      isActive: false,
    }, testZone.updatedAt.toISOString());
    assert.equal(blockedNow.status, 400);

    // …re-classifying the port (the operator flow the error message demands)
    // frees it again. Soft-deleting the port also stops counting.
    await db.update(s.ports)
      .set({ dispatchZone: null })
      .where(and(eq(s.ports.id, port.id), isNull(s.ports.deletedAt)));
    const [zoneNow] = await db.select().from(s.dispatchZones).where(eq(s.dispatchZones.id, testZone.id));
    const freed = await api('PUT', `/dispatch-zones/${testZone.id}`, adminId, {
      isActive: false,
    }, zoneNow.updatedAt.toISOString());
    assert.equal(freed.status, 200, JSON.stringify(freed.body));
  });
});
