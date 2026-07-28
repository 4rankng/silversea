import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';
import { Role, routeSchema } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { globalErrorHandler } from '../middleware/errorHandler';
import configRoutes from '../routes/config';
import { createCrudRouter } from '../routes/utils/crud-factory';
import { buildCrudIdempotencyEndpoint } from '../services/idempotency.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const idempotencyKeys: string[] = [];
const routeIds: number[] = [];
const managementFeeIds: number[] = [];
const customerIds: number[] = [];
const partnerIds: number[] = [];
let actorId = 0;
let server: http.Server;
let baseUrl = '';

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
  expectedUpdatedAt?: string,
) {
  if (idempotencyKey) idempotencyKeys.push(idempotencyKey);
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(expectedUpdatedAt ? { 'If-Unmodified-Since': expectedUpdatedAt } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

before(async () => {
  const [actor] = await db.insert(s.users).values({
    username: `q23-config-${suffix}`,
    passwordHash: 'x',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  actorId = actor.id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      userId: actorId,
      username: `q23-config-${suffix}`,
      email: null,
      fullName: null,
      role: Role.ADMIN,
    };
    next();
  });
  app.use('/api/hook-routes', createCrudRouter(s.routes, routeSchema, {
    afterCreate: async (_item, _data, _req, tx) => {
      await tx.insert(s.cargoTypes).values({
        name: `Q23 hook side effect ${suffix}`,
      });
      throw new Error('Q23 hook rollback proof');
    },
  }));
  app.use('/api', configRoutes);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });

  const uniqueKeys = [...new Set(idempotencyKeys)];
  if (uniqueKeys.length > 0) {
    await db.delete(s.idempotencyKeys)
      .where(inArray(s.idempotencyKeys.idempotencyKey, uniqueKeys));
  }
  if (managementFeeIds.length > 0) {
    await db.delete(s.managementFees)
      .where(inArray(s.managementFees.id, managementFeeIds));
  }
  if (routeIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  }
  if (customerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  }
  if (partnerIds.length > 0) {
    await db.delete(s.partners).where(inArray(s.partners.id, partnerIds));
  }
  await db.delete(s.cargoTypes)
    .where(eq(s.cargoTypes.name, `Q23 hook side effect ${suffix}`));
  if (actorId > 0) {
    await db.delete(s.users).where(eq(s.users.id, actorId));
  }
  await disconnectRedis();
  await client.end();
});

describe('Q23 generated configuration CRUD replay', () => {
  it('requires an idempotency key for material generated writes', async () => {
    const response = await api('POST', '/api/routes', {
      name: `Q23 missing key ${suffix}`,
    });
    assert.equal(response.status, 400);
    assert.match(String(response.body.error ?? response.body.message ?? ''), /Idempotency-Key/);
  });

  it('replays a financial-authority create exactly and rejects key reuse with another payload', async () => {
    const key = `q23-fee-${suffix}`;
    const payload = { month: 7, year: 2099, amount: 1234567 };
    const first = await api('POST', '/api/management-fees', payload, key);
    const replay = await api('POST', '/api/management-fees', payload, key);

    assert.equal(first.status, 201);
    assert.equal(replay.status, 201);
    assert.deepEqual(replay.body, first.body);
    managementFeeIds.push(Number(first.body.id));

    const rows = await db.select()
      .from(s.managementFees)
      .where(eq(s.managementFees.id, Number(first.body.id)));
    assert.equal(rows.length, 1);

    const conflict = await api('POST', '/api/management-fees', {
      ...payload,
      amount: 7654321,
    }, key);
    assert.equal(conflict.status, 409);
  });

  it('serializes concurrent ordinary-catalog creates to one winner and one exact replay', async () => {
    const key = `q23-route-race-${suffix}`;
    const payload = { name: `Q23 concurrent route ${suffix}` };
    const [left, right] = await Promise.all([
      api('POST', '/api/routes', payload, key),
      api('POST', '/api/routes', payload, key),
    ]);

    assert.equal(left.status, 201);
    assert.equal(right.status, 201);
    assert.deepEqual(right.body, left.body);
    routeIds.push(Number(left.body.id));

    const rows = await db.select()
      .from(s.routes)
      .where(eq(s.routes.name, payload.name));
    assert.equal(rows.length, 1);
  });

  it('commits the existing customer partner hook in the same replay transaction', async () => {
    const key = `q23-customer-hook-${suffix}`;
    const payload = {
      name: `Q23 atomic customer ${suffix}`,
      taxCode: `Q23${Date.now()}`.slice(0, 20),
      status: 'ACTIVE',
    };
    const first = await api('POST', '/api/customers', payload, key);
    const replay = await api('POST', '/api/customers', payload, key);
    assert.equal(first.status, 201);
    assert.deepEqual(replay, first);
    customerIds.push(Number(first.body.id));

    const [customer] = await db.select()
      .from(s.customers)
      .where(eq(s.customers.id, Number(first.body.id)));
    assert.ok(customer.partnerId != null);
    partnerIds.push(customer.partnerId);
  });

  it('uses independent stable update/delete endpoints and replays their original results', async () => {
    const createKey = `q23-route-lifecycle-create-${suffix}`;
    const created = await api('POST', '/api/routes', {
      name: `Q23 lifecycle route ${suffix}`,
    }, createKey);
    assert.equal(created.status, 201);
    const routeId = Number(created.body.id);
    routeIds.push(routeId);

    const updateKey = `q23-route-lifecycle-update-${suffix}`;
    const updateBody = { name: `Q23 lifecycle route updated ${suffix}` };
    const createdVersion = String(created.body.updatedAt);
    const updated = await api(
      'PUT',
      `/api/routes/${routeId}`,
      updateBody,
      updateKey,
      createdVersion,
    );
    const updateReplay = await api(
      'PUT',
      `/api/routes/${routeId}`,
      updateBody,
      updateKey,
      createdVersion,
    );
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.deepEqual(updateReplay, updated);

    const deleteKey = `q23-route-lifecycle-delete-${suffix}`;
    const updatedVersion = String(updated.body.updatedAt);
    const deleted = await api(
      'DELETE',
      `/api/routes/${routeId}`,
      undefined,
      deleteKey,
      updatedVersion,
    );
    const deleteReplay = await api(
      'DELETE',
      `/api/routes/${routeId}`,
      undefined,
      deleteKey,
      updatedVersion,
    );
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleteReplay, deleted);

    const [row] = await db.select()
      .from(s.routes)
      .where(eq(s.routes.id, routeId));
    assert.ok(row.deletedAt instanceof Date);

    assert.notEqual(
      buildCrudIdempotencyEndpoint('routes', 'update'),
      buildCrudIdempotencyEndpoint('routes', 'delete'),
    );
  });

  it('requires a row version and rejects stale or concurrent generated updates', async () => {
    const created = await api('POST', '/api/routes', {
      name: `Q23 version route ${suffix}`,
    }, `q23-route-version-create-${suffix}`);
    assert.equal(created.status, 201);
    const routeId = Number(created.body.id);
    routeIds.push(routeId);
    const originalVersion = String(created.body.updatedAt);

    const missingVersion = await api(
      'PUT',
      `/api/routes/${routeId}`,
      { name: `Q23 missing version update ${suffix}` },
      `q23-route-version-missing-${suffix}`,
    );
    assert.equal(missingVersion.status, 428);

    const [left, right] = await Promise.all([
      api(
        'PUT',
        `/api/routes/${routeId}`,
        { name: `Q23 version winner left ${suffix}` },
        `q23-route-version-left-${suffix}`,
        originalVersion,
      ),
      api(
        'PUT',
        `/api/routes/${routeId}`,
        { name: `Q23 version winner right ${suffix}` },
        `q23-route-version-right-${suffix}`,
        originalVersion,
      ),
    ]);
    assert.deepEqual(
      [left.status, right.status].sort(),
      [200, 409],
      JSON.stringify({ left, right }),
    );

    const winner = left.status === 200 ? left : right;
    const staleDelete = await api(
      'DELETE',
      `/api/routes/${routeId}`,
      undefined,
      `q23-route-version-stale-delete-${suffix}`,
      originalVersion,
    );
    assert.equal(staleDelete.status, 409);

    const [row] = await db.select()
      .from(s.routes)
      .where(eq(s.routes.id, routeId));
    assert.equal(row.name, winner.body.name);
    assert.equal(row.updatedAt.toISOString(), String(winner.body.updatedAt));
  });

  it('rolls back the generated row, hook writes, and replay record when an atomic hook fails', async () => {
    const key = `q23-hook-rollback-${suffix}`;
    const routeName = `Q23 failed hook route ${suffix}`;
    const response = await api('POST', '/api/hook-routes', { name: routeName }, key);
    assert.equal(response.status, 500);

    const routes = await db.select()
      .from(s.routes)
      .where(eq(s.routes.name, routeName));
    const cargoTypes = await db.select()
      .from(s.cargoTypes)
      .where(eq(s.cargoTypes.name, `Q23 hook side effect ${suffix}`));
    const receipts = await db.select()
      .from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, key));
    assert.equal(routes.length, 0);
    assert.equal(cargoTypes.length, 0);
    assert.equal(receipts.length, 0);
  });

  it('Q21 permits monthly/weekly writes but treats PER_BATCH as unchanged legacy data only', async () => {
    const rejectedCreate = await api('POST', '/api/customers', {
      name: `Q21 rejected legacy ${suffix}`,
      debitNoteMode: 'PER_BATCH',
    }, `q21-customer-rejected-create-${suffix}`);
    assert.equal(rejectedCreate.status, 400);

    const created = await api('POST', '/api/customers', {
      name: `Q21 current ${suffix}`,
      debitNoteMode: 'MONTHLY',
    }, `q21-customer-create-${suffix}`);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const customerId = Number(created.body.id);
    customerIds.push(customerId);

    const rejectedTransition = await api(
      'PUT',
      `/api/customers/${customerId}`,
      { debitNoteMode: 'PER_BATCH' },
      `q21-customer-rejected-transition-${suffix}`,
      String(created.body.updatedAt),
    );
    assert.equal(rejectedTransition.status, 400);

    const weekly = await api(
      'PUT',
      `/api/customers/${customerId}`,
      { debitNoteMode: 'WEEKLY' },
      `q21-customer-weekly-${suffix}`,
      String(created.body.updatedAt),
    );
    assert.equal(weekly.status, 200, JSON.stringify(weekly.body));
    assert.equal(weekly.body.debitNoteMode, 'WEEKLY');

    const [legacy] = await db.insert(s.customers).values({
      name: `Q21 legacy ${suffix}`,
      debitNoteMode: 'PER_BATCH',
    }).returning();
    customerIds.push(legacy.id);
    const preserved = await api(
      'PUT',
      `/api/customers/${legacy.id}`,
      { name: `${legacy.name} preserved`, debitNoteMode: 'PER_BATCH' },
      `q21-customer-preserve-legacy-${suffix}`,
      legacy.updatedAt.toISOString(),
    );
    assert.equal(preserved.status, 200, JSON.stringify(preserved.body));
    assert.equal(preserved.body.debitNoteMode, 'PER_BATCH');
  });
});
