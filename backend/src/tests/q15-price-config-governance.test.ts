import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import configRoutes from '../routes/config';
import paymentsRoutes from '../routes/financial/payments.routes';
import governanceActionsRoutes from '../routes/financial/governance-actions.routes';
import { globalErrorHandler } from '../middleware/errorHandler';

const actorIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const pricingTableIds: number[] = [];
const governanceActionIds: number[] = [];
let actors: Array<{ id: number; role: string }> = [];
let customerId = 0;
let routeId = 0;
let server: http.Server;
let baseUrl = '';
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function pricingTableVersion(row: { updatedAt: Date }): number {
  return Math.max(1, Math.floor(row.updatedAt.getTime() / 1000));
}

async function api(method: string, path: string, body: Record<string, unknown> | undefined, actorIndex: number) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Test-Actor': String(actorIndex),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

before(async () => {
  actors = await db.insert(s.users).values([
    { username: `q15-price-maker-${suffix}`, passwordHash: 'x', role: Role.ACCOUNTANT, status: 'ACTIVE' },
    { username: `q15-price-checker-${suffix}`, passwordHash: 'x', role: Role.MANAGER, status: 'ACTIVE' },
    { username: `q15-price-approver-${suffix}`, passwordHash: 'x', role: Role.ADMIN, status: 'ACTIVE' },
  ]).returning({ id: s.users.id, role: s.users.role });
  actorIds.push(...actors.map((actor) => actor.id));

  const [customer] = await db.insert(s.customers).values({
    name: `Q15 Pricing Customer ${suffix}`,
  }).returning();
  customerIds.push(customer.id);
  customerId = customer.id;

  const [route] = await db.insert(s.routes).values({
    name: `Q15 Pricing Route ${suffix}`,
  }).returning();
  routeIds.push(route.id);
  routeId = route.id;

  const app = express();
  app.use(express.json());
  app.use('/api', (req, _res, next) => {
    const actorIndex = Number(req.header('X-Test-Actor') ?? 0);
    const actor = actors[actorIndex] ?? actors[0]!;
    req.user = {
      userId: actor.id,
      username: `q15-${actor.id}`,
      email: null,
      fullName: null,
      role: actor.role as Role,
    };
    next();
  });
  app.use('/api', configRoutes);
  app.use('/api', paymentsRoutes);
  app.use('/api', governanceActionsRoutes);
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
  if (governanceActionIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, governanceActionIds));
  }
  if (pricingTableIds.length > 0) {
    await db.delete(s.pricingTables).where(inArray(s.pricingTables.id, pricingTableIds));
  }
  if (routeIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  }
  if (customerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  }
  if (actorIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, actorIds));
  }
  await disconnectRedis();
  await client.end();
});

describe('Q15 pricing table governance slice', () => {
  it('requires request/check/approve for pricing table create, update, and delete', async () => {
    const createResponse = await api('POST', '/api/pricing-tables', {
      customerId,
      routeId,
      price: 1500000,
      reason: 'Đề nghị tạo bảng giá thử nghiệm',
    }, 0);
    assert.equal(createResponse.status, 201);
    assert.equal(createResponse.body.status, 'PENDING_CHECK');
    assert.equal(createResponse.body.subjectType, 'PRICE_CONFIG');
    assert.equal(createResponse.body.actionKind, 'PRICE_CONFIG_CHANGE');
    governanceActionIds.push(Number(createResponse.body.id));

    const [beforeApproveCreate] = await db.select()
      .from(s.pricingTables)
      .where(and(
        eq(s.pricingTables.customerId, customerId),
        eq(s.pricingTables.routeId, routeId),
        isNull(s.pricingTables.deletedAt),
      ))
      .limit(1);
    assert.equal(beforeApproveCreate, undefined, 'maker request must not create the pricing table directly');

    const selfCheck = await api('POST', `/api/governance-actions/${createResponse.body.id}/check`, {
      expectedVersion: Number(createResponse.body.version),
    }, 0);
    assert.equal(selfCheck.status, 403);

    const checkedCreate = await api('POST', `/api/governance-actions/${createResponse.body.id}/check`, {
      expectedVersion: Number(createResponse.body.version),
    }, 1);
    assert.equal(checkedCreate.status, 200);
    assert.equal(checkedCreate.body.status, 'PENDING_APPROVAL');

    const approvedCreate = await api('POST', `/api/governance-actions/${createResponse.body.id}/approve`, {
      expectedVersion: Number(checkedCreate.body.version),
    }, 2);
    assert.equal(approvedCreate.status, 200);
    assert.equal(approvedCreate.body.status, 'APPROVED');
    const createdPricingTableId = Number(approvedCreate.body.subjectId);
    pricingTableIds.push(createdPricingTableId);

    const [createdPricingTable] = await db.select()
      .from(s.pricingTables)
      .where(eq(s.pricingTables.id, createdPricingTableId))
      .limit(1);
    assert.equal(Number(createdPricingTable?.price), 1500000);

    const updateResponse = await api('PUT', `/api/pricing-tables/${createdPricingTableId}`, {
      price: 1750000,
      reason: 'Đề nghị tăng giá theo biểu mới',
      expectedVersion: pricingTableVersion(createdPricingTable!),
    }, 0);
    assert.equal(updateResponse.status, 201);
    governanceActionIds.push(Number(updateResponse.body.id));

    const [beforeApproveUpdate] = await db.select()
      .from(s.pricingTables)
      .where(eq(s.pricingTables.id, createdPricingTableId))
      .limit(1);
    assert.equal(Number(beforeApproveUpdate?.price), 1500000, 'maker request must not update the pricing table directly');

    const checkedUpdate = await api('POST', `/api/governance-actions/${updateResponse.body.id}/check`, {
      expectedVersion: Number(updateResponse.body.version),
    }, 1);
    assert.equal(checkedUpdate.status, 200);
    const approvedUpdate = await api('POST', `/api/governance-actions/${updateResponse.body.id}/approve`, {
      expectedVersion: Number(checkedUpdate.body.version),
    }, 2);
    assert.equal(approvedUpdate.status, 200);

    const [updatedPricingTable] = await db.select()
      .from(s.pricingTables)
      .where(eq(s.pricingTables.id, createdPricingTableId))
      .limit(1);
    assert.equal(Number(updatedPricingTable?.price), 1750000);

    const deleteResponse = await api('DELETE', `/api/pricing-tables/${createdPricingTableId}`, {
      reason: 'Ngừng áp dụng bảng giá thử nghiệm',
      expectedVersion: pricingTableVersion(updatedPricingTable!),
    }, 0);
    assert.equal(deleteResponse.status, 201);
    governanceActionIds.push(Number(deleteResponse.body.id));

    const [beforeApproveDelete] = await db.select()
      .from(s.pricingTables)
      .where(eq(s.pricingTables.id, createdPricingTableId))
      .limit(1);
    assert.equal(beforeApproveDelete?.deletedAt, null, 'maker request must not delete the pricing table directly');

    const checkedDelete = await api('POST', `/api/governance-actions/${deleteResponse.body.id}/check`, {
      expectedVersion: Number(deleteResponse.body.version),
    }, 1);
    assert.equal(checkedDelete.status, 200);
    const approvedDelete = await api('POST', `/api/governance-actions/${deleteResponse.body.id}/approve`, {
      expectedVersion: Number(checkedDelete.body.version),
    }, 2);
    assert.equal(approvedDelete.status, 200);

    const [deletedPricingTable] = await db.select()
      .from(s.pricingTables)
      .where(eq(s.pricingTables.id, createdPricingTableId))
      .limit(1);
    assert.ok(deletedPricingTable?.deletedAt instanceof Date);
  });

  it('rejects approval when the source pricing table changed after request', async () => {
    const [pricingTable] = await db.insert(s.pricingTables).values({
      customerId,
      routeId,
      price: '2100000',
      effectiveDate: '2099-01-01',
    }).returning();
    pricingTableIds.push(pricingTable.id);

    const updateResponse = await api('PUT', `/api/pricing-tables/${pricingTable.id}`, {
      price: 2200000,
      reason: 'Đề nghị chỉnh giá tương lai',
      expectedVersion: pricingTableVersion(pricingTable),
    }, 0);
    assert.equal(updateResponse.status, 201);
    governanceActionIds.push(Number(updateResponse.body.id));

    const checkedUpdate = await api('POST', `/api/governance-actions/${updateResponse.body.id}/check`, {
      expectedVersion: Number(updateResponse.body.version),
    }, 1);
    assert.equal(checkedUpdate.status, 200);

    await db.update(s.pricingTables).set({
      price: '2300000',
      updatedAt: new Date(Date.now() + 5000),
    }).where(eq(s.pricingTables.id, pricingTable.id));

    const staleApprove = await api('POST', `/api/governance-actions/${updateResponse.body.id}/approve`, {
      expectedVersion: Number(checkedUpdate.body.version),
    }, 2);
    assert.equal(staleApprove.status, 409);
    assert.match(String(staleApprove.body.error ?? staleApprove.body.message ?? ''), /đã thay đổi/i);

    const [afterConflict] = await db.select()
      .from(s.pricingTables)
      .where(eq(s.pricingTables.id, pricingTable.id))
      .limit(1);
    assert.equal(Number(afterConflict?.price), 2300000);

    const [action] = await db.select()
      .from(s.governanceActions)
      .where(eq(s.governanceActions.id, Number(updateResponse.body.id)))
      .limit(1);
    assert.equal(action?.status, 'PENDING_APPROVAL');
  });
});
