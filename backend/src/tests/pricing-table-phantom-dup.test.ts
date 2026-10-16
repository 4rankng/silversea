/**
 * Card 161026121500 (residual, 2026-10-17) — phantom duplicate after
 * delete + re-add: the soft-delete tombstone stayed in pricing_tables
 * beside the recreated live row, so a raw table read showed one 'active'
 * and one stale row for the same selector.
 *
 * Regression case BGX05 in testplan/2026-10-16-bang-gia-xoa-roi-them-lai.md.
 * Drives the real config routes (factory + governance create/delete path):
 *   1. POST /api/pricing-tables (selector X)         → 201
 *   2. DELETE the row (soft-delete)                  → 200
 *   3. POST /api/pricing-tables (selector X again)   → 201
 *   4. only the live row may remain — tombstone purged (hard-delete on re-add)
 *   5. a second LIVE row on selector X is still blocked with 409
 *   6. an update that moves a row onto a tombstoned selector also purges
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { and, eq } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import configRoutes from '../routes/config';
import { globalErrorHandler } from '../middleware/errorHandler';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let server: http.Server;
let baseUrl = '';
let actorId = 0;
const customerIds: number[] = [];
const routeIds: number[] = [];
let requestCounter = 0;

async function api(
  method: string,
  path: string,
  options: {
    body?: Record<string, unknown>;
    idempotencyKey?: string;
    expectedUpdatedAt?: Date | string;
  } = {},
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': options.idempotencyKey
      ?? `phantom-dup-${suffix}-${requestCounter++}`,
  };
  if (options.expectedUpdatedAt) {
    headers['If-Unmodified-Since'] = options.expectedUpdatedAt instanceof Date
      ? options.expectedUpdatedAt.toISOString()
      : options.expectedUpdatedAt;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function allRowsForSelector(customerId: number, routeId: number, effectiveDate: string) {
  return db.select({
    id: s.pricingTables.id,
    price: s.pricingTables.price,
    deletedAt: s.pricingTables.deletedAt,
  }).from(s.pricingTables)
    .where(and(
      eq(s.pricingTables.customerId, customerId),
      eq(s.pricingTables.routeId, routeId),
      eq(s.pricingTables.effectiveDate, effectiveDate),
    ))
    .orderBy(s.pricingTables.id);
}

before(async () => {
  const [actor] = await db.insert(s.users).values({
    username: `phantom-dup-admin-${suffix}`,
    passwordHash: 'x',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  actorId = actor.id;

  const app = express();
  app.use(express.json());
  app.use('/api', (req, _res, next) => {
    req.user = {
      userId: actorId,
      username: `phantom-dup-${actorId}`,
      email: null,
      fullName: null,
      role: Role.ADMIN,
    };
    next();
  });
  app.use('/api', configRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  try {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  } finally {
    try {
      // Hard-delete every fixture row this test created (incl. tombstones —
      // the defect under test leaves exactly those behind).
      if (customerIds.length > 0) {
        await db.delete(s.pricingTables).where(eq(s.pricingTables.customerId, customerIds[0]!));
        await db.delete(s.customers).where(eq(s.customers.id, customerIds[0]!));
      }
      if (routeIds.length > 0) {
        await db.delete(s.routes).where(eq(s.routes.id, routeIds[0]!));
      }
      if (actorId > 0) {
        await db.delete(s.idempotencyKeys).where(eq(s.idempotencyKeys.createdBy, actorId));
        await db.delete(s.users).where(eq(s.users.id, actorId));
      }
    } finally {
      await disconnectRedis();
      await client.end();
    }
  }
});

describe('card 161026121500 residual — phantom duplicate after delete + re-add', () => {
  it('create → soft-delete → re-create leaves exactly one live row and no stale row', async () => {
    const [customer] = await db.insert(s.customers)
      .values({ name: `PhantomDup customer ${suffix}` }).returning();
    customerIds.push(customer.id);
    const [route] = await db.insert(s.routes)
      .values({ name: `PhantomDup route ${suffix}` }).returning();
    routeIds.push(route.id);
    const effectiveDate = '2098-06-01';

    const created = await api('POST', '/api/pricing-tables', {
      body: { customerId: customer.id, routeId: route.id, price: 1_500_000, effectiveDate },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const firstId = Number(created.body.id);

    const beforeDelete = await allRowsForSelector(customer.id, route.id, effectiveDate);
    assert.equal(beforeDelete.length, 1);

    const deleted = await api('DELETE', `/api/pricing-tables/${firstId}`, {
      body: {},
      expectedUpdatedAt: created.body.updatedAt as string,
    });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));

    // Soft-delete semantics unchanged: the row is tombstoned, not erased.
    const afterDelete = await allRowsForSelector(customer.id, route.id, effectiveDate);
    assert.equal(afterDelete.length, 1);
    assert.ok(afterDelete[0]!.deletedAt instanceof Date, 'delete must stay soft (tombstone)');

    // THE regression: re-adding the same selector must succeed (partial
    // index, prior incident) AND leave no stale row beside the live one.
    const recreated = await api('POST', '/api/pricing-tables', {
      body: { customerId: customer.id, routeId: route.id, price: 2_500_000, effectiveDate },
    });
    assert.equal(recreated.status, 201, JSON.stringify(recreated.body.body ?? recreated.body));
    const secondId = Number(recreated.body.id);
    assert.notEqual(secondId, firstId);

    const finalRows = await allRowsForSelector(customer.id, route.id, effectiveDate);
    assert.equal(
      finalRows.length,
      1,
      `expected exactly one physical row after re-add, got ${JSON.stringify(finalRows)}`,
    );
    assert.equal(finalRows[0]!.id, secondId);
    assert.equal(finalRows[0]!.deletedAt, null);
    assert.equal(Number(finalRows[0]!.price), 2_500_000);

    // The live-duplicate guard is not weakened by the purge.
    const liveDuplicate = await api('POST', '/api/pricing-tables', {
      body: { customerId: customer.id, routeId: route.id, price: 3_000_000, effectiveDate },
    });
    assert.equal(liveDuplicate.status, 409);
    assert.equal(
      liveDuplicate.body.error,
      'Bảng giá cho phạm vi và ngày hiệu lực này đã tồn tại',
    );
  });

  it('an update that moves a row onto a tombstoned selector also purges the stale row', async () => {
    const customerId = customerIds[0]!;
    const [route] = await db.insert(s.routes)
      .values({ name: `PhantomDup move route ${suffix}` }).returning();
    routeIds.push(route.id);

    const dateA = '2097-01-01';
    const dateB = '2097-02-01';

    // Row on dateA gets tombstoned; row on dateB moves onto dateA.
    const first = await api('POST', '/api/pricing-tables', {
      body: { customerId, routeId: route.id, price: 1_100_000, effectiveDate: dateA },
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    await api('DELETE', `/api/pricing-tables/${Number(first.body.id)}`, {
      body: {},
      expectedUpdatedAt: first.body.updatedAt as string,
    });

    const second = await api('POST', '/api/pricing-tables', {
      body: { customerId, routeId: route.id, price: 2_200_000, effectiveDate: dateB },
    });
    assert.equal(second.status, 201, JSON.stringify(second.body));

    const moved = await api('PUT', `/api/pricing-tables/${Number(second.body.id)}`, {
      body: { effectiveDate: dateA },
      expectedUpdatedAt: second.body.updatedAt as string,
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));

    const rows = await allRowsForSelector(customerId, route.id, dateA);
    assert.equal(
      rows.length,
      1,
      `expected the tombstone to be purged on selector move, got ${JSON.stringify(rows)}`,
    );
    assert.equal(rows[0]!.deletedAt, null);
    assert.equal(Number(rows[0]!.price), 2_200_000);
  });
});
